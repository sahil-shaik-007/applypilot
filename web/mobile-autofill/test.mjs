// Tests for the mobile auto-fill engine and the native helpers.
//
//   node web/mobile-autofill/test.mjs              unit + fixture tests + 3 live public forms (DRY: nothing is submitted)
//   node web/mobile-autofill/test.mjs --no-live    skip the live pages
//   node web/mobile-autofill/test.mjs --headed     watch it
//
// Browser: Microsoft Edge via playwright-core (channel 'msedge'), emulating a 390x844 touch phone.
// Fixtures (web/mobile-autofill/fixtures/*.html) are served from fake https://*.applypilot.test hosts by
// request interception, so the engine sees realistic URLs and nothing touches the network.
// Live pages run with the desktop dry-run guards: every form submit is cancelled in the page and every
// non-GET request (including file uploads) is aborted, except read-only GraphQL queries the forms need
// to render. allowSubmit is false. Screenshots: docs/screenshots/mobile-autofill-*.png
import { chromium } from 'playwright-core';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(here, '../..');
const FIX = path.join(here, 'fixtures');
const SHOTS = path.join(ROOT, 'docs', 'screenshots');
const HEADED = process.argv.includes('--headed');
const LIVE = !process.argv.includes('--no-live');

execFileSync(process.execPath, [path.join(here, 'build.mjs')], { stdio: 'inherit' });
const { AUTOFILL_SOURCE, AUTOFILL_VERSION } = await import(pathToFileURL(path.join(ROOT, 'web/client/src/native/autofill.bundle.js')).href);
const ats = await import(pathToFileURL(path.join(ROOT, 'web/client/src/native/ats.js')).href);
const { parseIncoming } = await import(pathToFileURL(path.join(ROOT, 'web/client/src/native/incoming.js')).href);

// ------------------------------------------------------------------ tiny harness
const results = [];
async function check(name, fn) {
  try { const d = await fn(); results.push({ name, ok: true }); console.log(`  ✓ ${name}${d ? `  (${d})` : ''}`); return true; } catch (e) { results.push({ name, ok: false, err: e.message }); console.log(`  ✗ ${name}: ${e.message}`); return false; }
}
function assert(c, msg) { if (!c) throw new Error(msg); }
function eq(a, b, msg) { if (a !== b) throw new Error(`${msg}: expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`); }

function makePdf(lines) {
  const esc = (s) => s.replace(/[\\()]/g, (m) => `\\${m}`);
  const content = `BT /F1 12 Tf 72 740 Td 16 TL ${lines.map((l) => `(${esc(l)}) Tj T*`).join(' ')} ET`;
  const objs = ['<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${Buffer.byteLength(content)} >>\nstream\n${content}\nendstream`, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'];
  let out = '%PDF-1.4\n'; const offs = [];
  objs.forEach((o, i) => { offs.push(Buffer.byteLength(out)); out += `${i + 1} 0 obj\n${o}\nendobj\n`; });
  const xref = Buffer.byteLength(out);
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offs.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}`;
  out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, 'latin1');
}

// A fictional test persona (example.com / reserved 555 number): never a real person.
const PROFILE = {
  firstName: 'Asha', lastName: 'Verma', email: 'asha.verma@example.com', phoneCountryCode: '+1', phone: '4155550123',
  city: 'San Francisco', state: 'CA', country: 'United States', postalCode: '94107',
  linkedin: 'https://www.linkedin.com/in/asha-verma-example', github: 'https://github.com/asha-example', website: 'https://asha.example.com',
  currentCompany: 'Northwind Labs', currentTitle: 'Senior Software Engineer', totalYearsExperience: 7,
  skills: ['JavaScript', 'TypeScript', 'React', 'Node.js', 'PostgreSQL'], skillYears: 'React: 6\nNode.js: 5',
  needsSponsorship: 'No', workAuthUS: 'US Citizen', authorizedCountries: ['United States'], willingToRelocate: 'Yes',
  workModes: ['Remote', 'Hybrid'], gender: 'Decline to self-identify', race: 'Decline to self-identify', hispanicLatino: 'Decline to self-identify',
  veteranStatus: 'I am not a protected veteran', disabilityStatus: 'No, I do not have a disability',
  whyInterested: 'I build developer tools and Acme ships the tools I use every day. I want to help make them faster.',
  howDidYouHear: 'Company website', expectedSalaryMin: 180000, expectedSalaryMax: 210000, salaryCurrency: 'USD', noticePeriodDays: 14,
  languages: ['English (Native)', 'Hindi (Fluent)'], over18: 'Yes',
  education: [{ school: 'University of Washington', degree: "Bachelor's", field: 'Computer Science', endDate: '2017-06' }],
};
const ANSWERS = [{ question: 'What is your favorite programming language and why?', answer: 'TypeScript: types catch my mistakes before users do.' }];
const RESUME_NAME = 'Asha_Verma_Resume.pdf';
const RESUME = { name: RESUME_NAME, mime: 'application/pdf', base64: makePdf(['Asha Verma', 'Senior Software Engineer', 'asha.verma@example.com', 'React, Node.js, TypeScript']).toString('base64') };
const COVER = 'Dear Acme team,\n\nI would love to join as a Senior Software Engineer.\n\nAsha Verma';
const cfgFor = (over = {}) => ({ nonce: 'test-nonce', profile: PROFILE, answers: ANSWERS, resume: RESUME, coverLetter: COVER, mode: 'review', allowSubmit: false, cancelWindowSec: 1, resumeAfterCaptcha: false, job: { title: 'Senior Software Engineer', company: 'Acme', location: 'San Francisco, CA' }, ...over });

// ------------------------------------------------------------------ 1. pure unit tests
console.log(`\nApplyPilot mobile auto-fill tests (engine ${AUTOFILL_VERSION}, ${(AUTOFILL_SOURCE.length / 1024).toFixed(0)} KB)\n\nUnit`);
await check('ats: detection and form URLs match the desktop adapters', () => {
  eq(ats.detectAts({}, 'https://boards.greenhouse.io/acme/jobs/123'), 'greenhouse', 'gh');
  eq(ats.resolveApplyUrl({ url: 'https://job-boards.greenhouse.io/acme/jobs/4012345' }), 'https://job-boards.greenhouse.io/embed/job_app?for=acme&token=4012345', 'gh embed');
  eq(ats.resolveApplyUrl({ url: 'https://acme.com/careers?gh_jid=77', ats: 'greenhouse', atsMeta: { boardToken: 'acme' } }), 'https://job-boards.greenhouse.io/embed/job_app?for=acme&token=77', 'gh_jid');
  eq(ats.resolveApplyUrl({ url: 'https://jobs.lever.co/acme/0a1b2c3d-1111-2222-3333-444455556666' }), 'https://jobs.lever.co/acme/0a1b2c3d-1111-2222-3333-444455556666/apply', 'lever');
  eq(ats.resolveApplyUrl({ url: 'https://jobs.ashbyhq.com/acme/0a1b2c3d-1111-2222-3333-444455556666' }), 'https://jobs.ashbyhq.com/acme/0a1b2c3d-1111-2222-3333-444455556666/application', 'ashby');
  eq(ats.resolveApplyUrl({ url: 'https://acme.workable.com/j/AB12CD' }), 'https://apply.workable.com/acme/j/AB12CD/apply/', 'workable');
  eq(ats.resolveApplyUrl({ url: 'https://acme.recruitee.com/o/backend-dev' }), 'https://acme.recruitee.com/o/backend-dev/c/new', 'recruitee');
  eq(ats.detectAts({}, 'https://acme.teamtailor.com/jobs/123-dev'), 'teamtailor', 'teamtailor');
  for (const u of ['https://www.linkedin.com/jobs/view/1', 'https://www.naukri.com/job-listings-x', 'https://acme.wd5.myworkdayjobs.com/x', 'https://www.indeed.com/viewjob?jk=1']) assert(!ats.canAutoSubmit(ats.detectAts({}, u)), `never auto-submit ${u}`);
  assert(!ats.canAutoSubmit('generic') && !ats.canAutoSubmit('teamtailor') && ats.canAutoSubmit('lever'), 'allow-list');
  eq(ats.siteOf('https://job-boards.eu.greenhouse.io/x'), 'greenhouse.io', 'siteOf'); eq(ats.siteOf('careers.acme.co.uk'), 'acme.co.uk', 'siteOf co.uk');
});
await check('share: parses applypilot://share links and shared text', () => {
  eq(parseIncoming('applypilot://share?url=https%3A%2F%2Fwww.linkedin.com%2Fjobs%2Fview%2F123&text=Look').url, 'https://www.linkedin.com/jobs/view/123', 'scheme');
  eq(parseIncoming('Senior dev at Acme https://www.naukri.com/job-listings-abc-123. Apply now').url, 'https://www.naukri.com/job-listings-abc-123', 'text');
  eq(parseIncoming('https://app.applypilot.app/share?url=https%3A%2F%2Fjobs.lever.co%2Fa%2Fb').url, 'https://jobs.lever.co/a/b', 'universal link');
  eq((parseIncoming('javascript:alert(1)') || { url: '' }).url, '', 'no js urls');
  eq(parseIncoming(''), null, 'empty');
});
await check('bundle: syntax-valid, single IIFE, defines the API only once', () => {
  new vm.Script(AUTOFILL_SOURCE);
  assert(AUTOFILL_SOURCE.includes(AUTOFILL_VERSION), 'version embedded');
  assert(/function __apScan\(/.test(AUTOFILL_SOURCE) && /function answerFromProfile\(/.test(AUTOFILL_SOURCE), 'desktop scanner + answers included');
});

// background runner in a sandbox with fake Capacitor APIs and a fake server
await check('background runner: configure, first run silent, then "N new matches", auth error, clear', async () => {
  const src = fs.readFileSync(path.join(ROOT, 'web/client/runners/background.js'), 'utf8');
  const kv = new Map(); const notes = []; const handlers = {}; let serverJobs = [{ id: 'a', title: 'Dev', company: 'X' }]; let status = 200; const calls = [];
  const sandbox = {
    console, setTimeout, clearTimeout, JSON, Promise, encodeURIComponent, Date, Math, Object, Array, String, Number, Error,
    addEventListener: (ev, fn) => { handlers[ev] = fn; },
    CapacitorKV: { get: (k) => (kv.has(k) ? { value: kv.get(k) } : null), set: (k, v) => kv.set(k, v), remove: (k) => kv.delete(k) },
    CapacitorNotifications: { schedule: (list) => notes.push(...list) },
    CapacitorDevice: { getNetworkStatus: () => ({ connected: true }) },
    fetch: async (url, opts) => { calls.push({ url, auth: opts.headers.Authorization }); return { status, ok: status === 200, json: async () => ({ jobs: serverJobs }) }; },
  };
  vm.runInNewContext(src, sandbox, { filename: 'background.js' });
  const fire = (ev, args) => new Promise((resolve, reject) => handlers[ev](resolve, reject, args));
  const token = 'tok_' + 'x'.repeat(40);
  eq((await fire('configure', { apiBase: 'https://app.applypilot.app', token, queries: [{ q: 'Backend Engineer', location: 'Remote', remote: 'remote', campaignId: 'c1' }] })).ok, true, 'configure');
  eq((await fire('configure', { apiBase: 'http://evil.example', token })).ok, false, 'rejects http api base');
  const r1 = await fire('checkJobs'); eq(r1.notified, 0, 'first run is silent');
  assert(calls[0].url === 'https://app.applypilot.app/api/jobs/search?q=Backend%20Engineer&location=Remote&remote=remote', `query url ${calls[0].url}`);
  eq(calls[0].auth, `Bearer ${token}`, 'bearer');
  serverJobs = [{ id: 'b', title: 'Backend Engineer', company: 'Acme' }, { id: 'c', title: 'Platform Engineer', company: 'Beta' }, { id: 'a' }];
  const r2 = await fire('checkJobs'); eq(r2.notified, 1, 'notified once'); eq(r2.newJobs, 2, 'two new');
  eq(notes[0].title, '2 new matches for Backend Engineer', 'title');
  const r3 = await fire('checkJobs'); eq(r3.notified, 0, 'no repeat for seen jobs');
  const st = await fire('status'); assert(st.configured && st.lastRun > 0 && st.pending === 1, 'status');
  const p = await fire('consumePending'); eq(p.pending[0].jobIds.join(','), 'b,c', 'pending ids'); eq((await fire('consumePending')).pending.length, 0, 'consumed');
  status = 401; eq((await fire('checkJobs')).reason, 'auth', 'auth error');
  await fire('clear'); eq((await fire('status')).configured, false, 'cleared');
  assert(![...kv.values()].some((v) => /asha|profile|resume/i.test(v)), 'KV holds no personal data');
  return `${notes.length} notification(s)`;
});

// ------------------------------------------------------------------ 2. browser fixtures
const browser = await chromium.launch({ channel: 'msedge', headless: !HEADED });
const PHONE = { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true,
  userAgent: 'Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36 ApplyPilot/1.0' };
const SHIM = () => {
  window.__apEvents = [];
  window.mobileApp = { postMessage: (m) => window.__apEvents.push(m && m.detail ? m.detail : m), close: () => { window.__apClosed = true; } };
};
const FIXTURE_HOSTS = /^https:\/\/([a-z0-9-]+\.applypilot\.test|job-boards\.greenhouse\.io)\//;
async function fixtureContext() {
  const ctx = await browser.newContext(PHONE);
  await ctx.addInitScript(SHIM);
  await ctx.route(FIXTURE_HOSTS, (route) => {
    const u = new URL(route.request().url());
    if (u.pathname.startsWith('/recaptcha/')) return route.fulfill({ contentType: 'text/html', body: '<!doctype html><div style="width:300px;height:74px;background:#eee">captcha</div>' });
    let file = u.pathname === '/widgets.js' ? 'widgets.js' : u.hostname === 'job-boards.greenhouse.io' ? 'greenhouse.html' : `${u.pathname.replace(/^\/|\/$/g, '') || 'generic'}.html`;
    if (!fs.existsSync(path.join(FIX, file))) return route.fulfill({ status: 404, body: 'nope' });
    return route.fulfill({ contentType: file.endsWith('.js') ? 'application/javascript' : 'text/html', body: fs.readFileSync(path.join(FIX, file)) });
  });
  await ctx.route((u) => !FIXTURE_HOSTS.test(u.href), (route) => route.abort()); // no network for fixtures
  return ctx;
}
async function open(ctx, name) {
  const page = await ctx.newPage();
  await page.goto(`https://acme.applypilot.test/${name}`, { waitUntil: 'load' });
  await page.evaluate(AUTOFILL_SOURCE);
  return page;
}
const run = (page, cfg) => page.evaluate((c) => window.__ApplyPilotAutofill.run(c), cfg);
const events = (page, type) => page.evaluate((t) => window.__apEvents.filter((e) => !t || e.type === t), type);
const val = (page, sel) => page.$eval(sel, (e) => e.value);
const single = (page, id) => page.$eval(`#${id}`, (e) => { const c = e.closest('.select__control'); const v = c && c.querySelector('.select__single-value'); return v ? v.textContent : ''; });
const fileName = (page, sel) => page.$eval(sel, (e) => (e.files && e.files[0] ? e.files[0].name : ''));
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

console.log('\nFixtures (in-page engine in Edge, phone viewport)');
const ctx = await fixtureContext();

await check('Greenhouse-like: fills text, react-select comboboxes, selects, consent, resume, cover letter; reports unknown required; never submits in review', async () => {
  const page = await open(ctx, 'greenhouse');
  const s = await run(page, cfgFor({ ats: 'greenhouse' }));
  eq(await val(page, '#first_name'), 'Asha', 'first'); eq(await val(page, '#last_name'), 'Verma', 'last'); eq(await val(page, '#email'), 'asha.verma@example.com', 'email');
  assert((await val(page, '#phone')).includes('4155550123'), 'phone');
  eq(await val(page, '#question_1'), PROFILE.linkedin, 'linkedin');
  eq(await val(page, '#question_2'), PROFILE.whyInterested, 'why');
  eq(await single(page, 'question_3'), 'Yes', 'authorized (react-select)'); eq(await single(page, 'question_4'), 'No', 'sponsorship (react-select)');
  assert((await single(page, 'candidate-location')).startsWith('San Francisco'), `location typeahead: ${await single(page, 'candidate-location')}`);
  eq(await page.$eval('#gender', (e) => e.options[e.selectedIndex].text), 'Decline To Self Identify', 'gender');
  eq(await page.$eval('#veteran', (e) => e.options[e.selectedIndex].text), 'I am not a protected veteran', 'veteran');
  eq(await page.$eval('#consent', (e) => e.checked), true, 'consent');
  eq(await fileName(page, '#resume'), RESUME_NAME, 'resume attached');
  eq(await page.$eval('#resume', (e) => e.files[0].type), 'application/pdf', 'resume mime');
  eq(await val(page, '#cover_letter_text'), COVER, 'cover letter via Enter manually');
  eq(await val(page, '#question_6'), ANSWERS[0].answer, 'answer bank');
  eq(await val(page, '#pw'), '', 'password untouched');
  assert(s.unanswered.some((u) => /secret word/i.test(u.question) && u.required), 'secret word reported as unanswered');
  assert((await events(page, 'question')).some((e) => /secret word/i.test(e.message)), 'question event');
  eq(await page.evaluate(() => window.__submits + window.__submitClicks), 0, 'no submit');
  assert(!(await events(page, 'submit-clicked')).length, 'no submit-clicked');
  assert(await page.$('#__applypilot_bar'), 'top bar shown');
  fs.mkdirSync(SHOTS, { recursive: true });
  await page.screenshot({ path: path.join(SHOTS, 'mobile-autofill-fixture-greenhouse.png'), fullPage: true });
  await page.close();
  return `${s.filledCount} filled, ${s.unanswered.length} unanswered`;
});

await check('autopilot never submits while a required answer is missing', async () => {
  const page = await open(ctx, 'greenhouse');
  const s = await run(page, cfgFor({ ats: 'greenhouse', mode: 'auto', allowSubmit: true }));
  await wait(2500);
  eq(s.status, 'filled', 'status'); eq(await page.evaluate(() => window.__submits + window.__submitClicks), 0, 'no submit');
  assert((await events(page, 'needs-user')).some((e) => /required/.test(e.message)), 'needs-user');
  await page.close();
});

await check('autopilot: all answered + allow-listed + allowSubmit -> cancel window -> submit -> confirmation detected', async () => {
  const page = await open(ctx, 'greenhouse');
  const s = await run(page, cfgFor({ ats: 'greenhouse', mode: 'auto', allowSubmit: true, answers: [...ANSWERS, { question: 'What is the secret word from our onboarding email?', answer: 'pineapple' }] }));
  eq(s.status, 'submit-pending', 'armed');
  assert((await events(page, 'countdown')).length >= 1, 'countdown events');
  eq(await page.evaluate(() => window.__submits), 0, 'not before the window');
  for (let i = 0; i < 20 && !(await events(page, 'submitted')).length; i++) await wait(300);
  eq(await page.evaluate(() => window.__submits), 1, 'submitted once');
  assert((await events(page, 'submitted')).length === 1, 'submitted event');
  await page.close();
});

await check('autopilot: cancel during the window stops the submit', async () => {
  const page = await open(ctx, 'greenhouse');
  await run(page, cfgFor({ ats: 'greenhouse', mode: 'auto', allowSubmit: true, cancelWindowSec: 3, answers: [...ANSWERS, { question: 'What is the secret word from our onboarding email?', answer: 'pineapple' }] }));
  await wait(800);
  await page.evaluate(() => window.__ApplyPilotAutofill.cancelSubmit());
  await wait(3500);
  eq(await page.evaluate(() => window.__submits + window.__submitClicks), 0, 'no submit after cancel');
  assert((await events(page, 'submit-cancelled')).length === 1, 'cancel event');
  await page.close();
});

await check('allowSubmit=false in auto mode never clicks submit', async () => {
  const page = await open(ctx, 'greenhouse');
  await run(page, cfgFor({ ats: 'greenhouse', mode: 'auto', allowSubmit: false, answers: [...ANSWERS, { question: 'What is the secret word from our onboarding email?', answer: 'pineapple' }] }));
  await wait(2000);
  eq(await page.evaluate(() => window.__submits + window.__submitClicks), 0, 'no submit');
  await page.close();
});

await check('Lever-like: name, location suggestion, radios, checkbox group, skill years, resume; header/footer untouched', async () => {
  const page = await open(ctx, 'lever');
  const s = await run(page, cfgFor({ ats: 'lever' }));
  eq(await fileName(page, 'input[name=resume]'), RESUME_NAME, 'resume');
  eq(await val(page, 'input[name=name]'), 'Asha Verma', 'name'); eq(await val(page, 'input[name=email]'), PROFILE.email, 'email');
  eq(await val(page, 'input[name=location]'), 'San Francisco, CA, United States', 'location picked from suggestions');
  eq(await val(page, 'input[name=org]'), 'Northwind Labs', 'org');
  eq(await val(page, 'input[name="urls[LinkedIn]"]'), PROFILE.linkedin, 'linkedin'); eq(await val(page, 'input[name="urls[GitHub]"]'), PROFILE.github, 'github');
  eq(await page.$eval('input[name="cards[relocate]"][value=Yes]', (e) => e.checked), true, 'relocate yes');
  eq(await page.$$eval('input[name="cards[lang]"]:checked', (l) => l.map((e) => e.value).join(',')), 'English,Hindi', 'languages');
  eq(await val(page, 'input[name="cards[react]"]'), '6', 'React years from skillYears');
  eq(await val(page, 'input[name=search-header]'), '', 'header untouched'); eq(await val(page, 'input[name=newsletter]'), '', 'footer untouched');
  assert(s.unanswered.some((u) => /disagreed/.test(u.question) && u.required), 'story unanswered');
  eq(await page.evaluate(() => window.__submits + window.__submitClicks), 0, 'no submit');
  await page.screenshot({ path: path.join(SHOTS, 'mobile-autofill-fixture-lever.png'), fullPage: true });
  await page.close();
  return `${s.filledCount} filled`;
});

await check('Ashby-like: Yes/No button groups, location combobox, resume outside the autofill pane, salary', async () => {
  const page = await open(ctx, 'ashby');
  const s = await run(page, cfgFor({ ats: 'ashby' }));
  eq(await val(page, '#_systemfield_name'), 'Asha Verma', 'name'); eq(await val(page, '#_systemfield_email'), PROFILE.email, 'email');
  eq(await fileName(page, '#_systemfield_resume'), RESUME_NAME, 'resume'); eq(await fileName(page, '#autofill-resume'), '', 'autofill pane skipped');
  const pressed = await page.$$eval('.yesno', (gs) => gs.map((g) => { const b = g.querySelector('[aria-pressed=true]'); return b ? b.textContent : ''; }));
  eq(pressed.join(','), 'Yes,No', 'yes/no groups');
  assert((await single(page, 'loc')).startsWith('San Francisco'), 'location');
  assert(/180,000/.test(await val(page, '#salary')), 'salary');
  eq(await val(page, 'input[name=header-search]'), '', 'header untouched');
  assert(s.unanswered.some((u) => /bug/.test(u.question)), 'unknown question reported');
  eq(await page.evaluate(() => window.__submits + window.__submitClicks), 0, 'no submit');
  await page.screenshot({ path: path.join(SHOTS, 'mobile-autofill-fixture-ashby.png'), fullPage: true });
  await page.close();
  return `${s.filledCount} filled`;
});

await check('generic form: rejects cookies, selects (country/notice), number, date-less, radio, no marketing, no password', async () => {
  const page = await open(ctx, 'generic');
  const s = await run(page, cfgFor({}));
  eq(await page.evaluate(() => window.__cookie), 'rejected', 'cookie banner rejected (never accepted)');
  eq(await val(page, '#fn'), 'Asha', 'first'); eq(await val(page, '#ln'), 'Verma', 'surname'); eq(await val(page, '#em'), PROFILE.email, 'email');
  eq(await page.$eval('#country', (e) => e.value), 'United States of America', 'country');
  eq(await page.$eval('#notice', (e) => e.value), '2 weeks', 'notice');
  eq(await val(page, '#sal'), '180000', 'salary number');
  eq(await fileName(page, '#cv'), RESUME_NAME, 'cv');
  eq(await page.$eval('input[name=adult][value=y]', (e) => e.checked), true, 'over 18');
  eq(await page.$eval('input[name=marketing]', (e) => e.checked), false, 'no marketing');
  eq(await val(page, '#pw2'), '', 'password untouched'); eq(await val(page, 'input[name=q]'), '', 'site search untouched');
  eq(await page.evaluate(() => window.__submits + window.__submitClicks), 0, 'no submit');
  await page.close();
  return `${s.filledCount} filled`;
});

await check('generic site with autopilot + allowSubmit forced on: still fill-only', async () => {
  const page = await open(ctx, 'generic');
  await run(page, cfgFor({ mode: 'auto', allowSubmit: true }));
  await wait(2000);
  eq(await page.evaluate(() => window.__submits + window.__submitClicks), 0, 'no submit on a non-allow-listed site');
  assert((await events(page, 'needs-user')).some((e) => /fill-only/.test(e.message)), 'fill-only message');
  await page.close();
});

await check('CAPTCHA wall: stops before filling and hands over', async () => {
  const page = await open(ctx, 'captcha-wall');
  const s = await run(page, cfgFor({ ats: 'greenhouse' }));
  eq(s.status, 'captcha', 'status'); eq(await val(page, 'input[name=first_name]'), '', 'nothing filled');
  assert((await events(page, 'captcha')).length === 1, 'captcha event');
  await page.close();
});

await check('CAPTCHA widget on a form: fills, but autopilot does not submit', async () => {
  const page = await open(ctx, 'captcha-form');
  const s = await run(page, cfgFor({ ats: 'greenhouse', mode: 'auto', allowSubmit: true }));
  await wait(2500);
  assert(s.captcha && s.captcha.kind === 'recaptcha', `captcha detected: ${JSON.stringify(s.captcha)}`);
  eq(s.status, 'filled', 'not armed'); eq(await val(page, '#first_name'), 'Asha', 'filled');
  eq(await page.evaluate(() => window.__submits + window.__submitClicks), 0, 'no submit');
  await page.close();
});

await check('login wall: never types credentials', async () => {
  const page = await open(ctx, 'login');
  const s = await run(page, cfgFor({}));
  assert(s.loginWall && s.status === 'needs-user', 'login wall');
  eq(await val(page, '#u'), '', 'email not typed'); eq(await val(page, '#p'), '', 'password not typed');
  await page.close();
});

await check('Greenhouse embed on a company site: jumps to the hosted form, then fills after reload', async () => {
  const page = await open(ctx, 'embed');
  const s = await run(page, cfgFor({ job: { company: 'Acme', ats: 'greenhouse' } }));
  eq(s.status, 'navigating', 'navigating');
  await page.waitForURL(/job-boards\.greenhouse\.io\/embed\/job_app\?for=acme&token=4012345/, { timeout: 8000 });
  await page.waitForLoadState('load');
  await page.evaluate(AUTOFILL_SOURCE);
  const s2 = await run(page, cfgFor({ ats: 'greenhouse' }));
  eq(await val(page, '#first_name'), 'Asha', 'filled on hosted form');
  await page.close();
  return `${s2.filledCount} filled`;
});

await check('site guard: refuses to fill on a site that is not part of the application; ping reports host', async () => {
  const page = await open(ctx, 'generic');
  const s = await run(page, cfgFor({ allowedSites: ['greenhouse.io'] }));
  eq(s.status, 'blocked-site', 'blocked'); eq(await val(page, '#fn'), '', 'nothing filled');
  await page.evaluate(AUTOFILL_SOURCE); // re-injecting is a no-op
  await page.evaluate(() => window.__ApplyPilotAutofill.ping());
  const r = (await events(page, 'ready')).pop();
  eq(r.data.host, 'acme.applypilot.test', 'ready host');
  await page.close();
});

await check('ask protocol: unknown question is asked to the app and the answer filled', async () => {
  const page = await open(ctx, 'greenhouse');
  await page.evaluate(() => {
    const orig = window.mobileApp.postMessage;
    window.mobileApp.postMessage = (m) => {
      orig(m); const d = m.detail;
      if (d.type === 'ask' && /secret word/i.test(d.data.question)) setTimeout(() => window.dispatchEvent(new CustomEvent('messageFromNative', { detail: { ap: 'applypilot', nonce: d.nonce, type: 'answer', id: d.data.id, answer: 'mango' } })), 50);
      else if (d.type === 'ask') setTimeout(() => window.dispatchEvent(new CustomEvent('messageFromNative', { detail: { ap: 'applypilot', nonce: d.nonce, type: 'answer', id: d.data.id, answer: null } })), 10);
    };
  });
  const s = await run(page, cfgFor({ ats: 'greenhouse', canAsk: true }));
  eq(await val(page, '#question_5'), 'mango', 'answer from app');
  assert(!s.unanswered.some((u) => /secret/.test(u.question)), 'no longer unanswered');
  await page.close();
});
await ctx.close();

// ------------------------------------------------------------------ 3. live public forms (DRY)
const live = [];
if (LIVE) {
  console.log('\nLive public application pages (DRY: submits cancelled, non-GET requests aborted, allowSubmit=false)');
  const getJSON = async (u) => { const r = await fetch(u, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(15000) }); if (!r.ok) throw new Error(`${r.status} ${u}`); return r.json(); };
  const finders = [
    ['greenhouse', async () => {
      for (const b of ['gitlab', 'airbnb', 'discord', 'figma', 'stripe', 'databricks']) {
        try { const j = await getJSON(`https://boards-api.greenhouse.io/v1/boards/${b}/jobs`); if (j.jobs && j.jobs.length) return { url: ats.greenhouseFormUrl(b, j.jobs[0].id), job: { ats: 'greenhouse', company: b, title: j.jobs[0].title, location: j.jobs[0].location && j.jobs[0].location.name } }; } catch { /* next */ }
      }
      return null;
    }],
    ['lever', async () => {
      for (const c of ['palantir', 'spotify', 'plaid', 'lever', 'mistral', 'zoox']) {
        try { const j = await getJSON(`https://api.lever.co/v0/postings/${c}?mode=json&limit=3`); if (Array.isArray(j) && j.length) return { url: `${j[0].hostedUrl}/apply`, job: { ats: 'lever', company: c, title: j[0].text, location: j[0].categories && j[0].categories.location } }; } catch { /* next */ }
      }
      return null;
    }],
    ['ashby', async () => {
      for (const o of ['ashby', 'notion', 'openai', 'ramp', 'linear', 'vercel']) {
        try { const j = await getJSON(`https://api.ashbyhq.com/posting-api/job-board/${o}`); if (j.jobs && j.jobs.length) return { url: `${j.jobs[0].jobUrl}/application`, job: { ats: 'ashby', company: o, title: j.jobs[0].title, location: j.jobs[0].location } }; } catch { /* next */ }
      }
      return null;
    }],
  ];
  for (const [id, find] of finders) {
    await check(`live ${id}: fills a real public form in DRY mode`, async () => {
      const target = await find();
      if (!target) throw new Error(`no public ${id} job found (network?)`);
      const lctx = await browser.newContext(PHONE);
      await lctx.addInitScript(SHIM);
      await lctx.addInitScript(() => {
        const block = (e) => { e.preventDefault(); e.stopImmediatePropagation(); window.__dryBlocked = (window.__dryBlocked || 0) + 1; };
        window.addEventListener('submit', block, true);
        HTMLFormElement.prototype.submit = function () { window.__dryBlocked = (window.__dryBlocked || 0) + 1; };
        HTMLFormElement.prototype.requestSubmit = function () { window.__dryBlocked = (window.__dryBlocked || 0) + 1; };
      });
      const blocked = [];
      await lctx.route('**/*', (route) => {
        const req = route.request(); const m = req.method();
        if (m === 'GET' || m === 'HEAD' || m === 'OPTIONS') return route.continue();
        let body = ''; try { body = (req.postData() || '').slice(0, 4000); } catch { body = '[binary]'; }
        const ops = [...body.matchAll(/"query"\s*:\s*"\s*(query|mutation)\b/g)].map((x) => x[1]);
        const infra = /\/cdn-cgi\/(challenge-platform|rum)\b|hcaptcha\.com\/(checksiteconfig|getcaptcha)|google\.com\/recaptcha|recaptcha\.net|challenges\.cloudflare\.com/i.test(req.url());
        if ((ops.length && ops.every((o) => o === 'query')) || infra) return route.continue(); // read-only GraphQL (Ashby renders its form this way)
        blocked.push(`${m} ${req.url().split('?')[0]}`);
        return route.abort('blockedbyclient');
      });
      const page = await lctx.newPage();
      try {
        await page.goto(target.url, { waitUntil: 'domcontentloaded', timeout: 60000 });
        await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
        await page.evaluate(AUTOFILL_SOURCE);
        const s = await Promise.race([run(page, cfgFor({ job: target.job, mode: 'review', allowSubmit: false })), wait(150000).then(() => ({ status: 'timeout', filledCount: 0, unanswered: [] }))]);
        const files = await page.evaluate(() => { const out = []; const walk = (r) => { r.querySelectorAll('input[type=file]').forEach((e) => { if (e.files && e.files[0]) out.push(e.files[0].name); }); r.querySelectorAll('*').forEach((e) => e.shadowRoot && walk(e.shadowRoot)); }; walk(document); return out; });
        const submitted = (await events(page, 'submit-clicked')).length;
        await page.screenshot({ path: path.join(SHOTS, `mobile-autofill-live-${id}.png`), fullPage: false });
        const row = { id, url: target.url, status: s.status, filled: s.filledCount, unanswered: s.unanswered.length, requiredUnanswered: s.unanswered.filter((u) => u.required).length, resume: files.includes(RESUME_NAME), blockedRequests: blocked.length, submitClicks: submitted };
        live.push(row);
        assert(!submitted, 'submit was clicked');
        assert(s.filledCount >= 3, `only ${s.filledCount} fields filled (status ${s.status})`);
        assert(files.includes(RESUME_NAME), 'resume not attached');
        return `${s.filledCount} filled, ${row.unanswered} unanswered (${row.requiredUnanswered} required), resume attached, ${blocked.length} non-GET request(s) blocked: ${target.url}`;
      } finally { await lctx.close(); }
    });
  }
}

await browser.close();
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed${failed.length ? `; FAILED: ${failed.map((f) => f.name).join(' | ')}` : ''}`);
if (live.length) fs.writeFileSync(path.join(here, 'dist', 'live-results.json'), JSON.stringify({ at: new Date().toISOString(), engine: AUTOFILL_VERSION, live }, null, 2));
process.exit(failed.length ? 1 : 0);
