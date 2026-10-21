#!/usr/bin/env node
// End-to-end test of the web app <-> extension bridge ("Apply in browser", docs/WEB-BRIDGE.md).
//
//   node scripts/test-extension-web.js [--headed]
//
// Loads the unpacked extension in Microsoft Edge (playwright-core, channel msedge, new headless mode) and serves, from a
// local HTTP server, (a) a fake "web app" page at http://localhost:<port>/ that speaks the page side of the protocol and
// (b) a Greenhouse-like application form on http://127.0.0.1:<port>/form. Nothing leaves the machine and nothing is
// ever submitted: every test asserts the fixture server saw no POST.
//
// Test-only differences from production: the temporary copy of the extension gets this server's port added to the web app
// content-script matches (production has the dev ports 5174/8787/8790 plus the address added in the options).
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const vm = require('vm');
const { chromium } = require('playwright-core');

const ROOT = path.join(__dirname, '..');
const EXT_SRC = path.join(ROOT, 'extension');
const HEADED = process.argv.includes('--headed');

const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok: !!ok, detail });
  console.log(`${ok ? '  PASS' : '  FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`);
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, ms = 20000, step = 150) {
  const end = Date.now() + ms;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > end) return null;
    await sleep(step);
  }
}

// ------------------------------------------------------------------ fixtures
const hits = { post: 0, form: 0, formByTag: {} };

// The web app side of the protocol, as the real web app implements it: it posts to-ext messages, logs everything coming
// back and answers `ask` from a configurable list (window.__answers = [[regexSource, answer]]).
const WEB_APP = `<!doctype html><html><head><title>ApplyPilot web app (fixture)</title></head><body><h1>Web app</h1><script>
window.__log = []; window.__answers = [['secret word', 'pineapple']];
window.apSend = (type, o) => window.postMessage(Object.assign({ apWeb: 1, dir: 'to-ext', type: type }, o), location.origin);
window.addEventListener('message', (e) => {
  if (e.source !== window || e.origin !== location.origin) return;
  const m = e.data;
  if (!m || m.apWeb !== 1 || m.dir !== 'to-page') return;
  window.__log.push(m);
  if (m.type === 'ask') {
    const hit = window.__answers.find((a) => new RegExp(a[0], 'i').test(m.question));
    window.apSend('answer', { id: m.id, qid: m.qid, answer: hit ? hit[1] : null });
  }
});
</script></body></html>`;

const FORM = `<!doctype html><html><head><title>Job Application for Frontend Engineer at Acme</title></head><body>
<h1>Frontend Engineer</h1><p>Acme builds robots.</p>
<form id="application_form" action="/submit" method="post">
  <div class="field"><label for="first_name">First Name *</label><input type="text" id="first_name" name="first_name" required></div>
  <div class="field"><label for="last_name">Last Name *</label><input type="text" id="last_name" name="last_name" required></div>
  <div class="field"><label for="email">Email *</label><input type="text" id="email" name="email" required></div>
  <div class="field"><label for="phone">Phone</label><input type="tel" id="phone" name="phone"></div>
  <div class="field"><label for="city">City</label><input type="text" id="city" name="city"></div>
  <div class="field"><label for="resume">Resume/CV *</label><input type="file" id="resume" name="resume" accept=".pdf,.doc,.docx" required></div>
  <div class="field"><label for="q_auth">Are you legally authorized to work in India? *</label>
    <select id="q_auth" name="auth" required><option value="">Please select</option><option value="1">Yes</option><option value="0">No</option></select></div>
  <fieldset class="field"><legend>Will you now or in the future require visa sponsorship? *</legend>
    <label><input type="radio" name="sponsor" value="yes"> Yes</label><label><input type="radio" name="sponsor" value="no"> No</label></fieldset>
  <div class="field"><label for="q_fav">What is the name of your favorite open-source project?</label><textarea id="q_fav" name="fav"></textarea></div>
  <div class="field"><label for="q_secret">What is the secret word from our careers page? *</label><textarea id="q_secret" name="secret" required></textarea></div>
  <div class="field"><label for="pw">Create a password</label><input type="password" id="pw" name="password"></div>
  <div class="g-recaptcha" id="captcha" style="width:304px;height:78px;border:1px solid #ccc"><label><input type="checkbox" id="notrobot"> I'm not a robot</label></div>
  <button type="submit" id="submit_app">Submit application</button>
</form></body></html>`;

function startServer() {
  return new Promise((resolve) => {
    const srv = http.createServer((req, res) => {
      const u = new URL(req.url, 'http://x');
      if (req.method === 'POST') { hits.post++; req.resume(); res.writeHead(200, { 'Content-Type': 'text/html' }); res.end('<h1>Thank you for applying</h1>'); return; }
      if (u.pathname === '/form') {
        hits.form++;
        const n = u.searchParams.get('n') || '';
        hits.formByTag[n] = (hits.formByTag[n] || 0) + 1;
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); res.end(FORM); return;
      }
      if (u.pathname === '/') { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); res.end(WEB_APP); return; }
      res.writeHead(404); res.end('nope');
    });
    srv.listen(0, '127.0.0.1', () => resolve(srv));
  });
}

function copyExtensionForTest(dest, ports) {
  const skip = new Set(['dist', 'store', 'tools']);
  const cp = (s, d) => {
    fs.mkdirSync(d, { recursive: true });
    for (const e of fs.readdirSync(s, { withFileTypes: true })) {
      if (skip.has(e.name) && s === EXT_SRC) continue;
      const sp = path.join(s, e.name); const dp = path.join(d, e.name);
      if (e.isDirectory()) cp(sp, dp); else fs.copyFileSync(sp, dp);
    }
  };
  cp(EXT_SRC, dest);
  const m = JSON.parse(fs.readFileSync(path.join(dest, 'manifest.json'), 'utf8'));
  m.content_scripts[0].matches = [...m.content_scripts[0].matches, ...ports.map((p) => `http://localhost:${p}/*`)]; // test-only: this run's web app port
  fs.writeFileSync(path.join(dest, 'manifest.json'), JSON.stringify(m, null, 2));
  return m;
}

const PROFILE = {
  firstName: 'Asha', lastName: 'Rao', email: 'asha.rao@example.com', phone: '9876543210', phoneCountryCode: '+91',
  city: 'Bengaluru', state: 'Karnataka', country: 'India', linkedin: 'https://www.linkedin.com/in/asha-rao-test',
  skills: ['JavaScript', 'React'], totalYearsExperience: 6, needsSponsorship: 'No', workModes: ['Remote'], desiredTitles: ['Frontend Engineer'],
};
const RESUME_NAME = 'Asha_Rao_Resume.pdf';

// ------------------------------------------------------------------ main
(async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ap-ext-web-'));
  const resumeBytes = Buffer.from('%PDF-1.4\n% ApplyPilot web bridge test resume\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n');
  const resumeB64 = resumeBytes.toString('base64');
  const srv = await startServer();
  const srv2 = await startServer(); // a second "web app" address that is NOT in the manifest (added through the options page)
  const P = srv.address().port; const P2 = srv2.address().port;
  const WEB = `http://localhost:${P}/`; const WEB_OTHER = `http://127.0.0.1:${P}/`; const WEB_CUSTOM = `http://localhost:${P2}/`;
  const formUrl = (tag) => `http://127.0.0.1:${P}/form?n=${tag}`;
  const atsSandbox = {}; vm.createContext(atsSandbox); vm.runInContext(fs.readFileSync(path.join(EXT_SRC, 'lib', 'ats.js'), 'utf8'), atsSandbox);
  const SITE = atsSandbox.ApAts.siteOf('127.0.0.1');
  let context;
  try {
    console.log(`\nFixtures on 127.0.0.1:${P} (web app on localhost:${P}, custom web app address on localhost:${P2})\n\n[1] Extension in Microsoft Edge`);
    const extDir = path.join(tmp, 'ext');
    const manifest = copyExtensionForTest(extDir, [P]);
    context = await chromium.launchPersistentContext(path.join(tmp, 'profile'), {
      channel: 'msedge', headless: !HEADED, viewport: { width: 1100, height: 800 },
      args: [`--disable-extensions-except=${extDir}`, `--load-extension=${extDir}`, '--no-first-run', '--no-default-browser-check', '--host-resolver-rules=MAP localhost 127.0.0.1'],
    });
    let sw = context.serviceWorkers()[0];
    if (!sw) sw = await context.waitForEvent('serviceworker', { timeout: 15000 });
    const extId = new URL(sw.url()).host;
    check('extension loads (MV3 service worker)', /^[a-p]{32}$/.test(extId), `${extId} v${manifest.version}`);
    const opt = await (async () => {
      const first = await until(() => context.pages().find((p) => p.url().includes('/options/options.html')), 8000);
      const p = first || await context.newPage();
      if (!first) await p.goto(`chrome-extension://${extId}/options/options.html`);
      return p;
    })();
    await opt.waitForLoadState('domcontentloaded');
    const extEval = (fn, arg) => opt.evaluate(fn, arg);

    // ---- helpers around the web app page
    const wp = await context.newPage();
    await wp.goto(WEB);
    const wpOther = await context.newPage();
    await wpOther.goto(WEB_OTHER);
    const logOf = (page, id) => page.evaluate((i) => window.__log.filter((m) => m.id === i), id);
    const events = async (page, id) => (await logOf(page, id)).filter((m) => m.type === 'event').map((m) => m.event);
    const resultsOf = async (page, id) => (await logOf(page, id)).filter((m) => m.type === 'result').map((m) => m.result);
    const waitEvent = (page, id, type, ms = 40000) => until(async () => (await events(page, id)).find((e) => e.type === type), ms);
    const waitResult = (page, id, ms = 20000) => until(async () => (await resultsOf(page, id))[0], ms);
    const apply = (page, id, cfg) => page.evaluate(([i, c]) => window.apSend('apply', { id: i, cfg: c }), [id, cfg]);
    const cfgFor = (tag, over = {}) => ({
      job: { id: `job-${tag}`, title: 'Frontend Engineer', company: 'Acme', location: 'Bengaluru', url: formUrl(tag), applyUrl: formUrl(tag), ats: '' },
      profile: PROFILE, answers: [{ question: 'What is the name of your favorite open-source project?', answer: 'Playwright' }],
      resume: { name: RESUME_NAME, mime: 'application/pdf', base64: resumeB64 }, coverLetter: null,
      mode: 'review', cancelWindowSec: 3, canAsk: true, allowedSites: [SITE, 'greenhouse.io'], ...over,
    });
    const jobPageFor = (tag) => until(() => context.pages().find((p) => p.url().includes(`/form?n=${tag}`)), 20000);
    const formValues = (p) => p.evaluate(() => {
      const $ = (id) => document.getElementById(id);
      return {
        first: $('first_name').value, last: $('last_name').value, email: $('email').value, phone: $('phone').value, city: $('city').value,
        file: $('resume').files[0] ? `${$('resume').files[0].name}:${$('resume').files[0].size}` : '', auth: $('q_auth').selectedOptions[0].textContent,
        sponsor: (document.querySelector('input[name=sponsor]:checked') || {}).value || '', fav: $('q_fav').value, secret: $('q_secret').value,
        pw: $('pw').value, notrobot: $('notrobot').checked, captchaHtml: $('captcha').innerHTML.length,
        leaked: typeof window.mobileApp + ',' + typeof window.__ApplyPilotAutofill,
      };
    });
    const pong = (page, id, ms = 3000) => page.evaluate(([i, t]) => new Promise((resolve) => {
      window.__log.length = 0;
      const end = Date.now() + t;
      window.apSend('ping', { id: i });
      const iv = setInterval(() => {
        const m = window.__log.find((x) => x.type === 'pong' && x.id === i);
        if (m) { clearInterval(iv); resolve(m); } else if (Date.now() > end) { clearInterval(iv); resolve(null); }
      }, 50);
    }), [id, ms]);

    // ---------------------------------------------------------------- 1. ping / origins
    console.log('\n[2] Ping and origin rules');
    const pg = await pong(wp, 'ping-1', 8000);
    check('ping -> pong on the allowed web app origin', pg && pg.apWeb === 1 && pg.dir === 'to-page' && pg.id === 'ping-1', pg ? JSON.stringify(pg) : 'no pong');
    check('pong carries version, engine and needsPermission:false', pg && pg.version === manifest.version && /^\d+\.\d+\.\d+/.test(pg.engine || '') && pg.needsPermission === false, pg && `${pg.version} / ${pg.engine}`);
    check('no pong on another origin (127.0.0.1)', (await pong(wpOther, 'ping-2', 2000)) === null);
    const formsBefore = hits.form;
    await apply(wpOther, 'rogue', cfgFor('rogue'));
    await sleep(2000);
    check('apply from another origin opens nothing', hits.form === formsBefore && !(await resultsOf(wpOther, 'rogue')).length && !context.pages().some((p) => p.url().includes('n=rogue')));
    await wp.evaluate(() => {
      window.__log.length = 0;
      const f = document.createElement('iframe'); f.srcdoc = '<script>parent.postMessage({ apWeb: 1, dir: "to-ext", type: "ping", id: "from-frame" }, "*")<\/script>'; document.body.appendChild(f);
    });
    await sleep(1500);
    check('messages posted by another window (iframe) are ignored', !(await logOf(wp, 'from-frame')).length);

    // ---------------------------------------------------------------- 2. review mode
    console.log('\n[3] Apply in review mode');
    await wp.evaluate(() => { window.__log.length = 0; window.__answers = [['secret word', 'pineapple']]; });
    await apply(wp, 'a1', cfgFor('a1'));
    const job = await jobPageFor('a1');
    check('apply opens the job page in a new tab', !!job, job && job.url());
    const done = await waitEvent(wp, 'a1', 'fill-done');
    check('engine events stream to the web app (opened, filled, fill-done)', done && (await events(wp, 'a1')).some((e) => e.type === 'opened') && (await events(wp, 'a1')).some((e) => e.type === 'filled'), (await events(wp, 'a1')).map((e) => e.type).join(','));
    const v = await formValues(job);
    check('fills first/last name, email, phone, city', v.first === 'Asha' && v.last === 'Rao' && v.email === 'asha.rao@example.com' && v.phone.includes('9876543210') && v.city === 'Bengaluru', JSON.stringify([v.first, v.last, v.email, v.phone, v.city]));
    check('attaches the resume under its real file name', v.file === `${RESUME_NAME}:${resumeBytes.length}`, v.file);
    check('answers select, radio and answer-bank question', v.auth === 'Yes' && v.sponsor === 'no' && v.fav === 'Playwright', `${v.auth} / ${v.sponsor} / ${v.fav}`);
    const asked = (await logOf(wp, 'a1')).find((m) => m.type === 'ask');
    check('asks the web app for the question the answer bank cannot answer', asked && /secret word/i.test(asked.question) && asked.info && asked.info.required === true && typeof asked.qid === 'string', asked && JSON.stringify(asked.info));
    check('fills the answer the web app returned', v.secret === 'pineapple', v.secret);
    check('question event reports the answer', (await events(wp, 'a1')).some((e) => e.type === 'question' && e.data && e.data.answered === true));
    check('password untouched', v.pw === '');
    check('CAPTCHA decoy untouched', v.notrobot === false && done && (await events(wp, 'a1')).some((e) => e.type === 'captcha'), `checked=${v.notrobot}`);
    check('job page cannot see the engine bridge (window.mobileApp / __ApplyPilotAutofill)', v.leaked === 'undefined,undefined', v.leaked);
    await sleep(500);
    check('review mode never submits', hits.post === 0 && !(await events(wp, 'a1')).some((e) => /countdown|submit-clicked|submitted/.test(e.type)), `POSTs ${hits.post}`);
    check('no result yet while the tab is open', !(await resultsOf(wp, 'a1')).length);
    await job.close();
    const r1 = await waitResult(wp, 'a1');
    check('closing the tab ends the run: filled-awaiting-user, filledCount > 0', r1 && r1.status === 'filled-awaiting-user' && r1.filledCount > 0 && Array.isArray(r1.unanswered), r1 && `${r1.status} filled ${r1.filledCount} — ${r1.message}`);
    await sleep(1200);
    check('exactly one result per run', (await resultsOf(wp, 'a1')).length === 1);

    // ---------------------------------------------------------------- 3. site not on the allow-list
    console.log('\n[4] Site not on allowedSites');
    await wp.evaluate(() => { window.__log.length = 0; });
    await apply(wp, 'n1', cfgFor('n1', { allowedSites: ['example.com'] }));
    const njob = await jobPageFor('n1');
    const skip = await waitEvent(wp, 'n1', 'step', 20000).then(async () => until(async () => (await events(wp, 'n1')).find((e) => /Not filling on/.test(e.message || '')), 15000));
    await sleep(2500);
    const probe = await extEval(async (u) => {
      const [t] = await chrome.tabs.query({ url: u });
      const [r] = await chrome.scripting.executeScript({ target: { tabId: t.id }, func: () => `${typeof window.__ApplyPilotAutofill},${typeof window.mobileApp}` });
      return r.result;
    }, formUrl('n1'));
    const nv = njob ? await formValues(njob) : {};
    check('host not in allowedSites: nothing injected, nothing filled', skip && probe === 'undefined,undefined' && nv.first === '' && nv.email === '' && !(await events(wp, 'n1')).some((e) => e.type === 'filled'), `probe ${probe}; ${skip && skip.message}`);
    if (njob) await njob.close();
    const rn = await waitResult(wp, 'n1');
    check('…and closing the tab gives needs-attention', rn && rn.status === 'needs-attention' && rn.filledCount === 0, rn && `${rn.status} — ${rn.message}`);

    // ---------------------------------------------------------------- 4. cancel
    console.log('\n[5] Cancel');
    await wp.evaluate(() => { window.__log.length = 0; });
    await apply(wp, 'c1', cfgFor('c1'));
    const cjob = await jobPageFor('c1');
    await waitEvent(wp, 'c1', 'fill-done');
    await wp.evaluate(() => window.apSend('cancel', { id: 'c1' }));
    const rc = await waitResult(wp, 'c1');
    check('cancel yields needs-attention "Cancelled."', rc && rc.status === 'needs-attention' && rc.message === 'Cancelled.', rc && `${rc.status} — ${rc.message}`);
    check('cancel closes the job tab', !!(await until(() => cjob.isClosed(), 8000)));
    await sleep(1200);
    check('cancel yields exactly one result', (await resultsOf(wp, 'c1')).length === 1);

    // ---------------------------------------------------------------- 5. auto mode on a non-allow-listed site
    console.log('\n[6] Autopilot on an unknown site');
    await wp.evaluate(() => { window.__log.length = 0; window.__answers = []; });
    await apply(wp, 'u1', cfgFor('u1', { mode: 'auto' }));
    const ujob = await jobPageFor('u1');
    await waitEvent(wp, 'u1', 'fill-done');
    await sleep(4500); // longer than the cancel window (3 s) plus a tick
    const uev = await events(wp, 'u1');
    check('auto mode on an unknown site never submits', hits.post === 0 && !uev.some((e) => /countdown|submit-clicked|submitted/.test(e.type)) && uev.some((e) => e.type === 'needs-user' && /fill-only/.test(e.message)), `POSTs ${hits.post}; ${uev.map((e) => e.type).join(',')}`);
    if (ujob) await ujob.close();
    const ru = await waitResult(wp, 'u1');
    check('auto mode with a required question left: needs-attention, nothing submitted', ru && ru.status === 'needs-attention' && /nothing was submitted/.test(ru.message) && ru.unanswered.some((q) => q.required), ru && `${ru.status} — ${ru.message}`);

    // ---------------------------------------------------------------- 6. concurrency
    console.log('\n[7] Simultaneous runs');
    await wp.evaluate(() => { window.__log.length = 0; window.__answers = [['secret word', 'pineapple']]; });
    await apply(wp, 's1', cfgFor('s1'));
    await apply(wp, 's2', cfgFor('s2'));
    await apply(wp, 's3', cfgFor('s3'));
    await apply(wp, 's1', cfgFor('s1')); // same id while running: ignored
    const [j1, j2, j3] = await Promise.all(['s1', 's2', 's3'].map(jobPageFor));
    const d = await Promise.all(['s1', 's2', 's3'].map((i) => waitEvent(wp, i, 'fill-done', 60000)));
    const vals = await Promise.all([j1, j2, j3].map((p) => (p ? formValues(p) : {})));
    check('three simultaneous runs each fill their own tab', d.every(Boolean) && vals.every((x) => x.first === 'Asha' && x.email === 'asha.rao@example.com' && x.secret === 'pineapple'), vals.map((x) => x.first).join(','));
    check('same application id while running is ignored (no second tab, one fill)', hits.formByTag.s1 === 1 && (await events(wp, 's1')).filter((e) => e.type === 'fill-done').length === 1, `loads ${hits.formByTag.s1}`);
    await apply(wp, 's4', cfgFor('s4'));
    const r4 = await waitResult(wp, 's4', 8000);
    check('a 4th concurrent run is refused with a clear message', r4 && r4.status === 'failed' && /already open/.test(r4.message) && !hits.formByTag.s4, r4 && r4.message);
    await Promise.all([j1, j2, j3].map((p) => p && p.close()));
    const rs = await Promise.all(['s1', 's2', 's3'].map((i) => waitResult(wp, i)));
    await sleep(1000);
    const counts = await Promise.all(['s1', 's2', 's3'].map(async (i) => (await resultsOf(wp, i)).length));
    check('each simultaneous run ends with exactly one result', rs.every((r) => r && r.status === 'filled-awaiting-user') && counts.every((c) => c === 1), counts.join(','));

    // ---------------------------------------------------------------- 7. validation
    console.log('\n[8] Validation');
    await wp.evaluate(() => { window.__log.length = 0; });
    await wp.evaluate(() => window.apSend('apply', { id: 'big', cfg: { job: { url: 'http://127.0.0.1/x', applyUrl: 'http://127.0.0.1/x' }, profile: {}, answers: [], resume: { name: 'a.pdf', mime: 'application/pdf', base64: 'A'.repeat(8 * 1024 * 1024 + 4) }, mode: 'review', allowedSites: [] } }));
    const rb = await waitResult(wp, 'big', 20000);
    check('resume over 8 MB is refused', rb && rb.status === 'failed' && /8 MB/.test(rb.message), rb && rb.message);
    await apply(wp, 'nolink', { ...cfgFor('nolink'), job: { id: 'x', title: 'No link' } });
    const rl = await waitResult(wp, 'nolink', 8000);
    check('a job without an application link is refused', rl && rl.status === 'failed' && /no application link/.test(rl.message), rl && rl.message);
    await apply(wp, 'js', { ...cfgFor('js'), job: { id: 'x', url: 'javascript:alert(1)', applyUrl: 'javascript:alert(1)' } });
    const rj = await waitResult(wp, 'js', 8000);
    check('a non-http application link is refused', rj && rj.status === 'failed', rj && rj.message);

    // ---------------------------------------------------------------- 8. worker restart (best effort)
    console.log('\n[9] Service worker restart in the middle of a run (best effort)');
    try {
      await wp.evaluate(() => { window.__log.length = 0; });
      await apply(wp, 'w1', cfgFor('w1'));
      const wjob = await jobPageFor('w1');
      await waitEvent(wp, 'w1', 'fill-done');
      // Stop the extension's worker through the DevTools protocol (seen from an extension page), as the browser does when idle.
      const cdp = await context.newCDPSession(opt);
      const versions = new Map();
      cdp.on('ServiceWorker.workerVersionUpdated', (e) => e.versions.forEach((x) => versions.set(x.versionId, x)));
      await cdp.send('ServiceWorker.enable');
      await sleep(500);
      await sw.evaluate(() => { globalThis.__apMarker = 1; });
      for (const x of versions.values()) if (x.scriptURL.includes(extId)) await cdp.send('ServiceWorker.stopWorker', { versionId: x.versionId });
      await sleep(2500); // the bridge reattaches to the restarted worker
      const marks = await Promise.all(context.serviceWorkers().map((w) => w.evaluate(() => globalThis.__apMarker).catch(() => 'gone')));
      const stopped = !marks.includes(1);
      await wjob.close();
      const rw = await waitResult(wp, 'w1', 20000);
      await sleep(1000);
      const n = (await resultsOf(wp, 'w1')).length;
      check('worker stopped mid-run: the run still ends with exactly one result', rw && rw.status === 'filled-awaiting-user' && n === 1 && stopped, rw ? `${rw.status} ×${n}, worker ${stopped ? 'was stopped' : 'kept running'}` : 'no result');
    } catch (e) {
      console.log(`  INFO  worker restart not testable here: ${e.message.split('\n')[0]}`);
    }

    // ---------------------------------------------------------------- 9. options page: web app address
    console.log('\n[10] Options: add / remove the web app address');
    const cp = await context.newPage();
    await cp.goto(WEB_CUSTOM);
    check('address not added yet: no pong', (await pong(cp, 'c-1', 1500)) === null);
    await opt.bringToFront();
    await opt.reload();
    await opt.waitForSelector('#webList li');
    check('options lists the built-in local addresses', /built-in/.test(await opt.textContent('#webList')) && /Not set|not set/.test(await opt.textContent('#webText')), (await opt.textContent('#webText')));
    await opt.fill('#webOrigin', 'ftp://example.com');
    await opt.click('#webAdd');
    check('options rejects an address that is not https:// or localhost', /https:\/\//.test(await opt.textContent('#webMsg')) && (await opt.getAttribute('#webMsg', 'class')).includes('err'));
    await opt.fill('#webOrigin', WEB_CUSTOM);
    await opt.click('#webAdd');
    await opt.waitForSelector('#webMsg.ok', { timeout: 10000 }).catch(() => {});
    check('adding the address shows "connected"', /connected/.test(await opt.textContent('#webText')) && (await opt.textContent('#webList')).includes(`localhost:${P2}`), await opt.textContent('#webText'));
    await cp.bringToFront();
    const pc = await pong(cp, 'c-2', 5000);
    check('open tab on the new address works without a reload', !!pc, pc ? 'pong' : 'no pong');
    await cp.reload();
    check('registered content script serves the address after a reload', !!(await pong(cp, 'c-3', 5000)));
    await opt.bringToFront();
    await opt.click('#webList li:first-child button');
    await sleep(800);
    await cp.bringToFront();
    await cp.reload();
    check('removing the address stops the bridge', (await pong(cp, 'c-4', 2000)) === null && /not set/.test(await opt.textContent('#webText')));
    await cp.close();

    check('no submit anywhere in this run', hits.post === 0, `POSTs ${hits.post}`);
  } catch (e) {
    check('test run completed without crashing', false, e.stack || e.message);
  } finally {
    if (context) await context.close().catch(() => {});
    srv.close(); srv2.close();
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* Edge may still hold files */ }
  }
  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed${failed.length ? ` — ${failed.length} FAILED` : ''}`);
  process.exit(failed.length ? 1 : 0);
})();
