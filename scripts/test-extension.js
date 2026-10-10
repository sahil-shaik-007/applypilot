#!/usr/bin/env node
// End-to-end tests for the ApplyPilot browser extension + desktop bridge (electron/bridge.js).
//
//   node scripts/test-extension.js [--headed] [--no-real] [--screenshots]
//
// 1. Bridge security/unit checks over raw HTTP (Origin, Host, pairing, token, limits, CORS).
// 2. Loads the unpacked extension in Microsoft Edge (playwright-core, channel msedge, new headless mode),
//    pairs through the real options page, then drives the real popup against local fixture pages:
//    a schema.org JobPosting page, a LinkedIn-like page, a US-only remote job, a scam posting and a
//    Greenhouse-like application form (autofill must fill, attach the resume, skip password/OTP/CAPTCHA,
//    and NEVER submit).
// 3. Read-only extraction on live public job pages (informational; network dependent).
//
// Test-only difference from production: the temporary copy of the extension gets extra host permissions
// (https://*/*) because a headless browser cannot click the toolbar icon, which is what grants `activeTab`
// to the real extension. Everything else (manifest, scripts, popup, options) is the shipped code.
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { chromium } = require('playwright-core');
const { startBridge } = require('../electron/bridge');

const ROOT = path.join(__dirname, '..');
const EXT_SRC = path.join(ROOT, 'extension');
const args = new Set(process.argv.slice(2));
const HEADED = args.has('--headed');
const REAL = !args.has('--no-real');
const SHOTS = args.has('--screenshots');
const SHOT_DIR = path.join(EXT_SRC, 'store', 'screenshots');

const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok: !!ok, detail });
  console.log(`${ok ? '  PASS' : '  FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`);
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ------------------------------------------------------------------ fake desktop store / manager
function collection(data) {
  return { data, get() { return this.data; }, set(d) { this.data = d; return d; }, update(fn) { return fn(this.data); }, flush() {} };
}
function fakeStore(tmp) {
  const resumePath = path.join(tmp, 'resume.pdf');
  fs.writeFileSync(resumePath, Buffer.from('%PDF-1.4\n% ApplyPilot test resume\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n'));
  const store = {
    settings: collection({ notifications: true }),
    profile: collection({ values: {
      firstName: 'Asha', lastName: 'Rao', email: 'asha.rao@example.com', phone: '9876543210', phoneCountryCode: '+91',
      linkedin: 'https://www.linkedin.com/in/asha-rao-test', github: 'https://github.com/asharao-test', city: 'Bengaluru', state: 'Karnataka', country: 'India',
      skills: ['JavaScript', 'TypeScript', 'React', 'Node.js', 'SQL', 'GraphQL'], totalYearsExperience: 6, needsSponsorship: 'No',
      workModes: ['Remote', 'Hybrid'], desiredTitles: ['Frontend Engineer', 'Software Engineer'], noticePeriodDays: 30,
    } }),
    resumes: collection({ items: [{ id: 'r1', name: 'Asha Rao — Frontend', fileName: 'Asha_Rao_Resume.pdf', path: resumePath, ext: '.pdf', size: fs.statSync(resumePath).size, isDefault: true, roles: [], skills: ['javascript', 'typescript', 'react', 'node.js', 'graphql'], text: 'Asha Rao. Senior frontend engineer. 6 years of experience with JavaScript, TypeScript, React, Node.js, GraphQL, SQL, AWS and Jest.' }] }),
    jobs: collection({ items: {} }),
    applications: collection({ items: [] }),
    qa: collection({ items: [{ id: 'q1', question: 'What is the name of your favorite open-source project?', answer: 'Playwright', source: 'you', uses: 0 }, { id: 'q2', question: 'Pending question nobody answered', answer: '', source: 'pending' }] }),
    activity: collection({ items: [] }),
  };
  store.flushAll = () => {};
  return { store, resumePath };
}
function fakeManager(store) {
  const events = [];
  return {
    events,
    createApplication({ job, match, resume, campaign, status }) {
      const app = { id: `app-${store.applications.get().items.length + 1}`, jobId: job.id, job: { ...job }, campaignId: campaign ? campaign.id : null, campaignName: 'Manual', resumeId: resume ? resume.id : null, resumeName: resume ? resume.name : null, score: match ? match.score : null, match, status, events: [], createdAt: new Date().toISOString() };
      store.applications.get().items.unshift(app);
      events.push(['create', app.id]);
      return app;
    },
    patchApp(id, patch) { const a = store.applications.get().items.find((x) => x.id === id); if (a) Object.assign(a, patch); return a; },
    log(type, message) { events.push(['log', type, message]); },
  };
}

// ------------------------------------------------------------------ raw HTTP helper (lets us forge Origin / Host)
function raw(port, { method = 'GET', path: p = '/', headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const data = body == null ? null : Buffer.isBuffer(body) ? body : Buffer.from(typeof body === 'string' ? body : JSON.stringify(body));
    const req = http.request({ host: '127.0.0.1', port, method, path: p, headers: { ...(data ? { 'Content-Length': data.length } : {}), ...headers } }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => { const t = Buffer.concat(chunks).toString('utf8'); let j = null; try { j = JSON.parse(t); } catch { /* */ } resolve({ status: res.statusCode, headers: res.headers, json: j, text: t }); });
    });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

// ------------------------------------------------------------------ fixtures
const DESC = `<p>Acme Robotics is hiring a <strong>Senior Frontend Engineer</strong> to build our fleet dashboard.</p>
<h3>Responsibilities</h3><ul><li>Build React and TypeScript interfaces</li><li>Work with Node.js and GraphQL APIs</li><li>Write tests with Jest</li></ul>
<h3>Requirements</h3><ul><li>5+ years of experience with JavaScript</li><li>Strong SQL and AWS knowledge</li></ul><p>Hybrid, 3 days a week in our Bengaluru office.</p>`;
const today = new Date(Date.now() - 2 * 86400000).toISOString().slice(0, 10);
const FIX = {
  '/jsonld-job.html': `<!doctype html><html><head><title>Senior Frontend Engineer | Acme Robotics Careers</title>
<script type="application/ld+json">${JSON.stringify({ '@context': 'https://schema.org', '@graph': [{ '@type': 'Organization', name: 'Acme Robotics' }, {
    '@type': 'JobPosting', title: 'Senior Frontend Engineer', description: DESC, datePosted: today, employmentType: 'FULL_TIME', identifier: { '@type': 'PropertyValue', name: 'Acme', value: 'ACME-4471' },
    hiringOrganization: { '@type': 'Organization', name: 'Acme Robotics', logo: 'https://example.com/logo.png' },
    jobLocation: { '@type': 'Place', address: { '@type': 'PostalAddress', addressLocality: 'Bengaluru', addressRegion: 'Karnataka', addressCountry: 'IN' } },
    baseSalary: { '@type': 'MonetaryAmount', currency: 'INR', value: { '@type': 'QuantitativeValue', minValue: 3500000, maxValue: 5000000, unitText: 'YEAR' } },
  }] })}</script></head>
<body><nav>Home · Jobs · About</nav><main><h1>Senior Frontend Engineer</h1><div class="meta">Bengaluru · Full-time</div><div class="content">${DESC}</div><a href="/apply/4471">Apply now</a></main></body></html>`,
  '/remote-us.html': `<!doctype html><html><head><title>Staff Engineer (Remote, US only) - Globex</title>
<script type="application/ld+json">${JSON.stringify({ '@context': 'https://schema.org', '@type': 'JobPosting', title: 'Staff Software Engineer', datePosted: today,
    description: '<p>Globex is a fully remote company. You must be based in the United States. We do not provide visa sponsorship.</p><p>Requirements: 8+ years of experience with TypeScript, React and Node.js; distributed systems; AWS.</p><p>Responsibilities: lead the design of our platform, mentor engineers, own reliability.</p>',
    hiringOrganization: { '@type': 'Organization', name: 'Globex' }, jobLocationType: 'TELECOMMUTE', applicantLocationRequirements: { '@type': 'Country', name: 'United States' } })}</script></head>
<body><h1>Staff Software Engineer</h1></body></html>`,
  '/scam-job.html': `<!doctype html><html><head><title>Data Entry Executive - Work From Home</title><meta property="og:site_name" content="QuickHire Jobs"></head>
<body><header><a href="/">QuickHire</a></header><main><h1>Data Entry Executive (Work From Home)</h1><div class="company-name">Bright Future Solutions</div><div class="job-location">Remote, India</div>
<div class="job-description"><p>Earn ₹5,000 per day from home! No experience needed, earn big income.</p><p>Responsibilities: simple copy paste typing work. Requirements: a phone and internet.</p>
<p>Pay a refundable registration fee of ₹1,999 to start. Contact us on WhatsApp at wa.me/911234567890 to apply. Qualification: any graduate. We are looking for 50 candidates. Apply today.</p></div></main></body></html>`,
  '/blank.html': '<!doctype html><html><body>blank</body></html>',
};
const LINKEDIN_URL = 'https://www.linkedin.com/jobs/view/senior-react-developer-at-initech-4012345678/?trk=public_jobs_topcard-title&refId=abc';
const LINKEDIN_HTML = `<!doctype html><html><head><title>Initech hiring Senior React Developer in Pune, Maharashtra, India | LinkedIn</title></head><body>
<header class="global-nav">LinkedIn</header><main><section class="top-card-layout"><h1 class="top-card-layout__title topcard__title">Senior React Developer</h1>
<h4 class="top-card-layout__second-subline"><span class="topcard__flavor"><a class="topcard__org-name-link" href="https://www.linkedin.com/company/initech">Initech</a></span>
<span class="topcard__flavor topcard__flavor--bullet">Pune, Maharashtra, India</span></h4></section>
<section class="description"><div class="show-more-less-html__markup"><p>Initech is looking for a Senior React Developer.</p><p><strong>Responsibilities</strong></p><ul><li>Own our React + Redux front end</li><li>Collaborate with designers in Figma</li></ul><p><strong>Requirements</strong></p><ul><li>4+ years of experience with React, JavaScript and TypeScript</li><li>Experience with REST and GraphQL APIs</li></ul></div></section></main></body></html>`;
const GH_URL = 'https://job-boards.greenhouse.io/acme/jobs/5550001';
const GH_HTML = `<!doctype html><html><head><title>Job Application for Frontend Engineer at Acme</title></head><body>
<div id="header"><h1 class="app-title">Frontend Engineer</h1><span class="company-name">at Acme</span><div class="location">Bengaluru, India</div></div>
<div id="content"><p>We build robots. Requirements: 3+ years of experience with React and TypeScript.</p></div>
<form id="application_form" action="https://job-boards.greenhouse.io/acme/submit" method="post" onsubmit="window.__submitted = (window.__submitted||0)+1; return true;">
  <div class="field"><label for="first_name">First Name <span class="asterisk">*</span></label><input type="text" id="first_name" name="job_application[first_name]" required></div>
  <div class="field"><label for="last_name">Last Name <span class="asterisk">*</span></label><input type="text" id="last_name" name="job_application[last_name]" required></div>
  <div class="field"><label for="email">Email <span class="asterisk">*</span></label><input type="text" id="email" name="job_application[email]" required></div>
  <div class="field"><label for="phone">Phone</label><input type="tel" id="phone" name="job_application[phone]"></div>
  <div class="field"><label for="resume">Resume/CV <span class="asterisk">*</span></label><input type="file" id="resume" name="job_application[resume]" accept=".pdf,.doc,.docx,.txt,.rtf" required></div>
  <div class="field"><label for="q_linkedin">LinkedIn Profile</label><input type="text" id="q_linkedin" name="job_application[answers][0][text_value]"></div>
  <div class="field"><label for="q_auth">Are you legally authorized to work in India? <span class="asterisk">*</span></label>
    <select id="q_auth" name="job_application[answers][1][boolean_value]" required><option value="">Please select</option><option value="1">Yes</option><option value="0">No</option></select></div>
  <fieldset class="field"><legend>Will you now or in the future require visa sponsorship? *</legend>
    <label><input type="radio" name="sponsor" value="yes"> Yes</label><label><input type="radio" name="sponsor" value="no"> No</label></fieldset>
  <div class="field"><label for="q_fav">What is the name of your favorite open-source project?</label><textarea id="q_fav" name="job_application[answers][2][text_value]"></textarea></div>
  <div class="field"><label for="q_secret">What is the secret word from our careers page? <span class="asterisk">*</span></label><input type="text" id="q_secret" name="job_application[answers][3][text_value]" required></div>
  <div class="field"><label for="q_team">Which team are you most excited to join at Acme?</label><input type="text" id="q_team" name="job_application[answers][4][text_value]"></div>
  <div class="field"><label for="hear">How did you hear about us?</label>
    <div class="combo"><input id="hear" role="combobox" aria-autocomplete="list" aria-expanded="false" aria-controls="hear_list" autocomplete="off">
    <ul id="hear_list" role="listbox" style="display:none;border:1px solid #ccc;margin:0;padding:0;list-style:none">
      <li role="option">LinkedIn</li><li role="option">Company website</li><li role="option">Employee referral</li><li role="option">Other</li></ul></div></div>
  <div class="field"><label for="gender">Gender</label><select id="gender" name="gender"><option value="">Select...</option><option>Male</option><option>Female</option><option>Decline to self-identify</option></select></div>
  <div class="field"><label for="pw">Create a password</label><input type="password" id="pw" name="password"></div>
  <div class="field"><label for="otp">One-time code</label><input type="text" id="otp" name="otp" autocomplete="one-time-code"></div>
  <div class="field"><label><input type="checkbox" id="consent" name="consent" required> I agree to the privacy policy *</label></div>
  <iframe title="reCAPTCHA" src="https://www.google.com/recaptcha/api2/anchor?k=test&size=normal" width="304" height="78" style="border:0"></iframe>
  <button type="submit" id="submit_app">Submit application</button>
</form>
<script>
  const input = document.getElementById('hear'); const list = document.getElementById('hear_list');
  const open = () => { list.style.display = 'block'; input.setAttribute('aria-expanded', 'true'); };
  input.addEventListener('focus', open); input.addEventListener('click', open);
  input.addEventListener('keydown', (e) => { if (e.key === 'Escape') { list.style.display = 'none'; input.setAttribute('aria-expanded', 'false'); } });
  list.querySelectorAll('[role=option]').forEach((o) => o.addEventListener('click', () => { input.value = o.textContent; list.style.display = 'none'; input.setAttribute('aria-expanded', 'false'); input.dataset.chosen = o.textContent; }));
</script></body></html>`;

function startFixtures() {
  return new Promise((resolve) => {
    const srv = http.createServer((req, res) => {
      const p = new URL(req.url, 'http://x').pathname;
      const body = FIX[p];
      if (!body) { res.writeHead(404); res.end('nope'); return; }
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(body);
    });
    srv.listen(0, '127.0.0.1', () => resolve(srv));
  });
}

function copyExtensionForTest(dest) {
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
  m.host_permissions = [...m.host_permissions, 'https://*/*']; // test-only stand-in for the activeTab grant
  fs.writeFileSync(path.join(dest, 'manifest.json'), JSON.stringify(m, null, 2));
}

// ------------------------------------------------------------------ live job URLs (read-only)
async function liveUrls() {
  const out = [];
  const get = async (u, json = true) => { const r = await fetch(u, { signal: AbortSignal.timeout(12000), headers: { 'User-Agent': 'Mozilla/5.0 ApplyPilot-test' } }); if (!r.ok) throw new Error(`HTTP ${r.status}`); return json ? r.json() : r.text(); };
  let companies = {};
  try { companies = require('../electron/data/companies.json'); } catch { /* */ }
  for (const c of (companies.greenhouse || []).slice(0, 8)) {
    try { const d = await get(`https://boards-api.greenhouse.io/v1/boards/${c.slug}/jobs`); if (d.jobs && d.jobs[0]) { out.push({ kind: 'Greenhouse', url: d.jobs[0].absolute_url, expect: d.jobs[0].title }); break; } } catch { /* next */ }
  }
  for (const c of (companies.lever || []).slice(0, 8)) {
    try { const d = await get(`https://api.lever.co/v0/postings/${c.slug}?mode=json&limit=1`); if (d[0]) { out.push({ kind: 'Lever', url: d[0].hostedUrl, expect: d[0].text }); break; } } catch { /* next */ }
  }
  for (const c of (companies.ashby || []).slice(0, 8)) {
    try { const d = await get(`https://api.ashbyhq.com/posting-api/job-board/${c.slug}`); if (d.jobs && d.jobs[0]) { out.push({ kind: 'Ashby', url: d.jobs[0].jobUrl, expect: d.jobs[0].title }); break; } } catch { /* next */ }
  }
  try {
    const t = await get('https://www.linkedin.com/jobs-guest/jobs/api/seeMoreJobPostings/search?keywords=software%20engineer&location=India&start=0', false);
    const id = (t.match(/jobPosting:(\d{8,})/) || [])[1];
    if (id) out.push({ kind: 'LinkedIn (public)', url: `https://www.linkedin.com/jobs/view/${id}/`, expect: null });
  } catch (e) { out.push({ kind: 'LinkedIn (public)', url: null, error: e.message }); }
  return out;
}

// ------------------------------------------------------------------ main
(async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ap-ext-test-'));
  const { store, resumePath } = fakeStore(tmp);
  const manager = fakeManager(store);
  const notes = [];
  const bridge = await startBridge({ store, manager, appVersion: '1.2.0-test', notify: (t, b) => notes.push([t, b]), log: () => {} });
  const port = bridge.port;
  const fx = await startFixtures();
  const FX = `http://127.0.0.1:${fx.address().port}`;
  let context;
  try {
    console.log(`\nBridge on 127.0.0.1:${port}\n\n[1] Bridge security`);
    const EXT_A = `chrome-extension://${'a'.repeat(32)}`;
    const EXT_B = `chrome-extension://${'b'.repeat(32)}`;
    const H = (o = {}) => ({ Host: `127.0.0.1:${port}`, ...o });
    check('listens on 127.0.0.1 in 47823-47833', port >= 47823 && port <= 47833, String(port));
    let r = await raw(port, { path: '/status', headers: H() });
    check('rejects requests without Origin', r.status === 403);
    r = await raw(port, { path: '/status', headers: H({ Origin: 'https://evil.example' }) });
    check('rejects web-page Origin', r.status === 403 && !r.headers['access-control-allow-origin']);
    r = await raw(port, { path: '/status', headers: { Host: `evil.example:${port}`, Origin: EXT_A } });
    check('rejects foreign Host header (DNS rebinding)', r.status === 403);
    r = await raw(port, { path: '/status', headers: H({ Origin: EXT_A }) });
    check('unpaired /status is 401 but identifies the app', r.status === 401 && r.json && r.json.app === 'ApplyPilot' && !r.headers['access-control-allow-origin']);
    r = await raw(port, { method: 'OPTIONS', path: '/jobs', headers: H({ Origin: EXT_A, 'Access-Control-Request-Method': 'POST' }) });
    check('preflight from unknown extension refused', r.status === 403);
    const c1 = bridge.getPairingCode().code;
    let lastWrong;
    for (let i = 0; i < 5; i++) lastWrong = await raw(port, { method: 'POST', path: '/pair', headers: H({ Origin: EXT_A, 'Content-Type': 'application/json' }), body: { code: c1 === '000000' ? '111111' : '000000' } });
    r = await raw(port, { method: 'POST', path: '/pair', headers: H({ Origin: EXT_A, 'Content-Type': 'application/json' }), body: { code: c1 } });
    check('5 wrong codes invalidate the code', lastWrong.status === 401 && r.status === 401 && bridge.getPairingCode().code !== undefined);
    r = await raw(port, { method: 'POST', path: '/pair', headers: H({ Origin: EXT_A, 'Content-Type': 'text/plain' }), body: JSON.stringify({ code: bridge.getPairingCode().code }) });
    check('non-JSON content type refused (415)', r.status === 415);
    const code = bridge.resetPairing().code;
    r = await raw(port, { method: 'POST', path: '/pair', headers: H({ Origin: EXT_A, 'Content-Type': 'application/json' }), body: { code, browser: 'unit' } });
    const token = r.json && r.json.token;
    check('correct code returns a 256-bit token', r.status === 200 && token && Buffer.from(token, 'base64url').length === 32);
    r = await raw(port, { method: 'POST', path: '/pair', headers: H({ Origin: EXT_A, 'Content-Type': 'application/json' }), body: { code } });
    check('pairing code is single-use', r.status === 401);
    check('only the token hash is stored', !JSON.stringify(store.settings.get()).includes(token) && bridge.listPairings().length === 1 && !('tokenHash' in bridge.listPairings()[0]));
    const AUTH = (o = EXT_A) => H({ Origin: o, Authorization: `Bearer ${token}` });
    r = await raw(port, { path: '/status', headers: AUTH() });
    check('authorised /status works, CORS echoes exact origin', r.status === 200 && r.json.app === 'ApplyPilot' && r.headers['access-control-allow-origin'] === EXT_A);
    r = await raw(port, { method: 'OPTIONS', path: '/jobs', headers: H({ Origin: EXT_A, 'Access-Control-Request-Method': 'POST' }) });
    check('preflight for paired extension: exact origin, never *', r.status === 204 && r.headers['access-control-allow-origin'] === EXT_A);
    r = await raw(port, { path: '/status', headers: AUTH(EXT_B) });
    check('token is bound to the extension ID it was issued to', r.status === 401);
    r = await raw(port, { path: '/status', headers: H({ Origin: EXT_A, Authorization: 'Bearer xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx' }) });
    check('wrong token rejected', r.status === 401);
    r = await raw(port, { method: 'POST', path: '/jobs', headers: { ...AUTH(), 'Content-Type': 'application/json' }, body: Buffer.alloc(600 * 1024, 0x20) });
    check('oversized body rejected (413)', r.status === 413);
    r = await raw(port, { method: 'POST', path: '/jobs', headers: { ...AUTH(), 'Content-Type': 'application/json' }, body: '{not json' });
    check('invalid JSON rejected (400)', r.status === 400);
    r = await raw(port, { method: 'POST', path: '/score', headers: { ...AUTH(), 'Content-Type': 'application/json' }, body: { job: { title: 'X', url: 'javascript:alert(1)' } } });
    check('non-http job URL rejected (422)', r.status === 422);
    r = await raw(port, { path: '/autofill-data', headers: AUTH() });
    check('/autofill-data returns profile + answered bank, no resume bytes by default', r.status === 200 && r.json.profile.firstName === 'Asha' && r.json.answers.length === 1 && !r.json.resumeFile && r.json.resumes[0].fileName === 'Asha_Rao_Resume.pdf' && !('path' in r.json.resumes[0]) && !('text' in r.json.resumes[0]));
    r = await raw(port, { path: '/autofill-data?resume=auto', headers: AUTH() });
    check('resume bytes only on explicit request', r.status === 200 && r.json.resumeFile && Buffer.from(r.json.resumeFile.base64, 'base64').equals(fs.readFileSync(resumePath)));
    r = await raw(port, { method: 'POST', path: '/answers', headers: { ...AUTH(), 'Content-Type': 'application/json' }, body: { items: Array.from({ length: 51 }, (_, i) => ({ question: `q ${i}`, answer: 'a' })) } });
    check('answers batch limit (413)', r.status === 413);
    r = await raw(port, { method: 'POST', path: '/answers', headers: { ...AUTH(), 'Content-Type': 'application/json' }, body: { items: [{ question: 'What is the name of your favorite open-source project?', answer: 'Something else' }] } });
    check('browser answers never overwrite an answer you wrote', r.status === 200 && r.json.updated === 0 && store.qa.get().items.find((x) => x.id === 'q1').answer === 'Playwright');
    bridge.revokePairing(bridge.listPairings()[0].id);
    r = await raw(port, { path: '/status', headers: AUTH() });
    check('revoked token stops working immediately', r.status === 401);
    check('unknown route 404', (await raw(port, { path: '/nope', headers: H({ Origin: EXT_A }) })).status === 404);

    // ---------------------------------------------------------------- browser
    console.log('\n[2] Extension in Microsoft Edge');
    const extDir = path.join(tmp, 'ext');
    copyExtensionForTest(extDir);
    context = await chromium.launchPersistentContext(path.join(tmp, 'profile'), {
      channel: 'msedge', headless: !HEADED, viewport: { width: 1280, height: 860 },
      args: [`--disable-extensions-except=${extDir}`, `--load-extension=${extDir}`, '--no-first-run', '--no-default-browser-check'],
    });
    let submits = 0;
    await context.route('https://www.linkedin.com/jobs/view/**', (rt) => rt.fulfill({ status: 200, contentType: 'text/html', body: LINKEDIN_HTML }));
    await context.route('https://job-boards.greenhouse.io/acme/jobs/**', (rt) => rt.fulfill({ status: 200, contentType: 'text/html', body: GH_HTML }));
    await context.route('https://job-boards.greenhouse.io/acme/submit', (rt) => { submits++; rt.fulfill({ status: 200, contentType: 'text/html', body: '<h1>Thank you for applying</h1>' }); });
    await context.route('https://www.google.com/recaptcha/**', (rt) => rt.fulfill({ status: 200, contentType: 'text/html', body: '<div style="width:300px;height:74px;background:#f9f9f9">I am not a robot</div>' }));
    let sw = context.serviceWorkers()[0];
    if (!sw) sw = await context.waitForEvent('serviceworker', { timeout: 15000 });
    const extId = new URL(sw.url()).host;
    check('extension loads (MV3 service worker)', /^[a-p]{32}$/.test(extId), extId);
    // onInstalled opens the options page for a fresh install
    let optionsAuto = null;
    for (let i = 0; i < 60 && !optionsAuto; i++) { optionsAuto = context.pages().find((p) => p.url().includes('/options/options.html')); if (!optionsAuto) await sleep(250); }
    check('first install opens the pairing page', !!optionsAuto);
    const options = optionsAuto || await context.newPage();
    if (!optionsAuto) await options.goto(`chrome-extension://${extId}/options/options.html`);
    await options.waitForLoadState('domcontentloaded');
    await options.fill('#code', '123');
    await options.click('#pairBtn');
    await options.waitForSelector('#pairMsg.err');
    check('options validates code format', /6-digit/.test(await options.textContent('#pairMsg')));
    await options.fill('#code', bridge.resetPairing().code);
    await options.click('#pairBtn');
    await options.waitForSelector('#pairedBox:not(.hidden)', { timeout: 15000 }).catch(async (e) => { throw new Error(`pairing failed: ${await options.textContent('#pairMsg')}`); });
    const stored = await options.evaluate(() => chrome.storage.local.get(['pairing']));
    const pl = bridge.listPairings();
    check('pairs through the options page', !!(stored.pairing && stored.pairing.token && stored.pairing.port === port), `port ${stored.pairing && stored.pairing.port}`);
    check('desktop records the extension ID + browser', pl.length === 1 && pl[0].extensionId === extId && /Edge/.test(pl[0].browser), pl[0] && pl[0].browser);
    check('desktop notified on pairing', notes.some(([t]) => /connected/i.test(t)));
    check('options shows profile from desktop', /Asha Rao/.test(await options.textContent('#pairedMeta')));
    if (SHOTS) { fs.mkdirSync(SHOT_DIR, { recursive: true }); await options.setViewportSize({ width: 1280, height: 800 }); await options.screenshot({ path: path.join(SHOT_DIR, 'options.png') }); }

    const tabIdFor = async (url) => {
      const tabs = await options.evaluate(() => chrome.tabs.query({}));
      const t = tabs.find((x) => x.url === url || (x.url || '').startsWith(url.split('?')[0]));
      return t && t.id;
    };
    const openPopup = async (tabId, shot) => {
      const p = await context.newPage();
      await p.setViewportSize({ width: 360, height: 640 });
      p.on('pageerror', (e) => console.log(`        [popup error] ${e.message}`));
      await p.goto(`chrome-extension://${extId}/popup/popup.html?tabId=${tabId}`);
      // A real popup never hides the job tab; opened as a tab here, so keep the job tab in front.
      if (typeof jobPage !== 'undefined') await jobPage.bringToFront();
      await p.waitForSelector('#loading.hidden', { state: 'attached', timeout: 20000 }).catch(async (e) => { throw new Error(`popup stuck (tab ${tabId}): ${(await p.textContent('body')).replace(/\s+/g, ' ').slice(0, 300)}`); });
      await p.waitForFunction(() => !document.querySelector('#jobCard:not(.hidden)') || !document.querySelector('#scoreRing.hidden') || document.querySelector('#unpaired:not(.hidden)'), null, { timeout: 15000 }).catch(() => {});
      if (shot && SHOTS) { await p.bringToFront(); await p.screenshot({ path: path.join(SHOT_DIR, shot), fullPage: true }); await jobPage.bringToFront(); }
      return p;
    };
    const lastApp = () => store.applications.get().items[0];

    // ---- JSON-LD page: popup score + save
    const jobPage = await context.newPage();
    await jobPage.goto(`${FX}/jsonld-job.html`);
    let tid = await tabIdFor(`${FX}/jsonld-job.html`);
    let pop = await openPopup(tid, 'popup-job.png');
    const title = await pop.textContent('#jobTitle');
    const meta = await pop.textContent('#jobMeta');
    const score = Number(await pop.textContent('#scoreValue'));
    check('popup: JSON-LD title/company/location', title === 'Senior Frontend Engineer' && /Acme Robotics/.test(meta) && /Bengaluru, Karnataka, IN/.test(meta), `${title} | ${meta}`);
    check('popup: JSON-LD salary shown', /INR 3,500,000 – 5,000,000 \/ year/.test(meta));
    check('popup shows match score', Number.isFinite(score) && score > 0 && score <= 100, `score ${score}`);
    check('popup shows eligibility (eligible)', /Eligible/.test(await pop.textContent('#elig')));
    check('popup shows matched skills', /React/.test(await pop.textContent('#skills')));
    await pop.click('#saveBtn');
    await pop.waitForSelector('#saveMsg.ok', { timeout: 10000 });
    let a = lastApp();
    check('save -> bridge created application', a && a.job.title === 'Senior Frontend Engineer' && a.job.company === 'Acme Robotics' && a.status === 'saved', a && `${a.id} ${a.status}`);
    check('saved job: location, salary, posted date, description', a && a.job.location === 'Bengaluru, Karnataka, IN' && a.job.salaryMin === 3500000 && a.job.salaryCurrency === 'INR' && !!a.job.postedAt && /Responsibilities/.test(a.job.description) && /• Build React/.test(a.job.description));
    check('saved job: id from JSON-LD identifier, extractedBy json-ld', a && a.jobId === 'ext:web:ACME-4471' && (a.job.extractedBy || []).includes('json-ld'), a && a.jobId);
    check('saved job: apply URL from the Apply link', a && a.job.applyUrl === `${FX}/apply/4471`, a && a.job.applyUrl);
    check('saved job is scored and stored in jobs', !!store.jobs.get().items['ext:web:ACME-4471'] && typeof a.score === 'number' && a.score === score, `stored score ${a && a.score}`);
    check('popup save message shows score', new RegExp(`${score}% match`).test(await pop.textContent('#saveMsg')));
    await pop.close();
    pop = await openPopup(tid);
    check('re-opening shows "already in your tracker"', /Already in your tracker · saved/.test(await pop.textContent('#existing')));
    await pop.click('#saveBtn');
    await pop.waitForSelector('#saveMsg.ok');
    check('second save is de-duplicated', store.applications.get().items.length === 1 && /Already in ApplyPilot/.test(await pop.textContent('#saveMsg')));
    await pop.close();

    // ---- LinkedIn-like (site selectors, no JSON-LD)
    await jobPage.goto(LINKEDIN_URL);
    tid = await tabIdFor('https://www.linkedin.com/jobs/view/');
    pop = await openPopup(tid);
    check('LinkedIn: site selectors', (await pop.textContent('#jobTitle')) === 'Senior React Developer' && /Initech · Pune, Maharashtra, India/.test(await pop.textContent('#jobMeta')), await pop.textContent('#jobMeta'));
    check('LinkedIn: source label', /^LinkedIn · high/.test(await pop.textContent('#jobSource')));
    await pop.click('#queueBtn');
    await pop.waitForSelector('#saveMsg.ok');
    a = lastApp();
    check('LinkedIn: queued with canonical URL and job id', a && a.status === 'queued' && a.job.url === 'https://www.linkedin.com/jobs/view/4012345678/' && a.jobId === 'ext:linkedin:4012345678' && a.job.source === 'linkedin', a && `${a.jobId} ${a.job.url}`);
    check('LinkedIn: description with structure', a && /Requirements/.test(a.job.description) && /• Own our React/.test(a.job.description));
    check('popup says Review queue', /Review queue/.test(await pop.textContent('#saveMsg')));
    await pop.close();

    // ---- remote US-only (region + visa)
    await jobPage.goto(`${FX}/remote-us.html`);
    tid = await tabIdFor(`${FX}/remote-us.html`);
    pop = await openPopup(tid, 'popup-region.png');
    const elig2 = await pop.textContent('#elig');
    check('eligibility: remote US-only flagged for a candidate in India', /Remote: US only/.test(elig2) && (await pop.getAttribute('#elig .pill.red', 'class')) !== null, elig2);
    check('eligibility: no visa sponsorship shown', /No visa sponsorship/.test(elig2));
    await pop.close();

    // ---- scam (generic extraction)
    await jobPage.goto(`${FX}/scam-job.html`);
    tid = await tabIdFor(`${FX}/scam-job.html`);
    pop = await openPopup(tid, 'popup-scam.png');
    check('generic extraction: title/company/location', (await pop.textContent('#jobTitle')) === 'Data Entry Executive (Work From Home)' && /Bright Future Solutions · Remote, India/.test(await pop.textContent('#jobMeta')), await pop.textContent('#jobMeta'));
    check('scam warning shown', /Possible scam/.test(await pop.textContent('#elig')));
    await pop.close();

    // ---- Greenhouse-like application form: autofill
    const form = jobPage;
    await form.goto(GH_URL);
    tid = await tabIdFor(GH_URL);
    pop = await openPopup(tid);
    check('form detected in popup', !(await pop.isHidden('#formCard')) && /resume upload/.test(await pop.textContent('#formFields')));
    await pop.click('#fillBtn');
    await pop.waitForSelector('#fillMsg.warn, #fillMsg.ok, #fillMsg.err', { timeout: 30000 });
    const fillText = await pop.textContent('#fillMsg');
    const v = await form.evaluate(() => {
      const $ = (id) => document.getElementById(id);
      return {
        first: $('first_name').value, last: $('last_name').value, email: $('email').value, phone: $('phone').value, linkedin: $('q_linkedin').value,
        auth: $('q_auth').selectedOptions[0].textContent, sponsor: (document.querySelector('input[name=sponsor]:checked') || {}).value || '', fav: $('q_fav').value,
        secret: $('q_secret').value, team: $('q_team').value, hear: $('hear').value, gender: $('gender').selectedOptions[0].textContent,
        pw: $('pw').value, otp: $('otp').value, consent: $('consent').checked, file: $('resume').files[0] ? `${$('resume').files[0].name}:${$('resume').files[0].size}` : '',
        submitted: window.__submitted || 0, url: location.href, marked: document.querySelectorAll('[data-ap-mark=filled]').length, needs: document.querySelectorAll('[data-ap-mark=needs]').length,
        toast: !!document.getElementById('__applypilot_toast'),
      };
    });
    check('autofill: names, email, phone', v.first === 'Asha' && v.last === 'Rao' && v.email === 'asha.rao@example.com' && v.phone === '+91 9876543210', `${v.first} ${v.last} ${v.email} ${v.phone}`);
    check('autofill: LinkedIn URL', v.linkedin === 'https://www.linkedin.com/in/asha-rao-test');
    check('autofill: work authorisation select = Yes', v.auth === 'Yes', v.auth);
    check('autofill: sponsorship radio = No', v.sponsor === 'no', v.sponsor);
    check('autofill: Answer bank question', v.fav === 'Playwright', v.fav);
    check('autofill: ARIA combobox (how did you hear)', v.hear === 'Company website', v.hear);
    check('autofill: EEO select declines by default', v.gender === 'Decline to self-identify', v.gender);
    check('autofill: consent checkbox', v.consent === true);
    check('autofill: resume attached from desktop', v.file === `Asha_Rao_Resume.pdf:${fs.statSync(resumePath).size}`, v.file);
    check('autofill: password field untouched', v.pw === '');
    check('autofill: one-time-code field untouched', v.otp === '');
    check('autofill: unknown questions left for the user', v.secret === '' && v.team === '');
    check('autofill: did NOT submit', submits === 0 && v.submitted === 0 && v.url === GH_URL, `route hits ${submits}, onsubmit ${v.submitted}`);
    check('autofill: highlights filled + needed fields, shows in-page notice', v.marked >= 8 && v.needs >= 2 && v.toast, `${v.marked} filled, ${v.needs} need you`);
    check('popup: fill summary + CAPTCHA warning', /Filled \d+ fields/.test(fillText) && /attached Asha_Rao_Resume\.pdf/.test(fillText) && /reCAPTCHA detected/.test(fillText) && /click Submit yourself/.test(fillText), fillText);
    const needs = await pop.textContent('#needsList');
    check('popup lists questions that need you', /secret word/.test(needs) && /Which team/.test(needs), needs);
    if (SHOTS) {
      await pop.bringToFront();
      await pop.screenshot({ path: path.join(SHOT_DIR, 'popup-autofill.png'), fullPage: true });
      await form.bringToFront();
      await form.screenshot({ path: path.join(SHOT_DIR, 'form-filled.png'), fullPage: true });
    }
    // user types an answer, saves it to the Answer bank from the popup
    await form.fill('#q_secret', 'pineapple');
    await pop.click('#learnBtn');
    await pop.waitForSelector('#learnMsg.ok, #learnMsg.err, #learnMsg.warn');
    const learned = store.qa.get().items.find((q) => /secret word/.test(q.question));
    check('"Save answers I typed" -> Answer bank', learned && learned.answer === 'pineapple' && learned.source === 'browser', learned && learned.answer);
    // user clicks Submit themselves: allowed, and the typed answer is learned
    await form.fill('#q_team', 'Robotics platform');
    await form.click('#submit_app');
    await sleep(1500);
    const team = store.qa.get().items.find((q) => /Which team/.test(q.question));
    check('your own Submit click goes through (extension does not block you)', submits === 1, `route hits ${submits}`);
    check('learn-on-submit saves the answer you typed', team && team.answer === 'Robotics platform', team && team.answer);
    await pop.close();

    // ---- popup when desktop is unreachable / unpaired
    const sp = await context.newPage();
    await sp.goto(`chrome-extension://${extId}/popup/popup.html?tabId=${tid}`);
    await sp.waitForSelector('#loading.hidden', { state: 'attached' });
    check('popup shows connected profile name', /Asha Rao/.test(await sp.textContent('#connText')));
    await sp.close();

    // ---- package
    const pkg = require('../extension/tools/package.js');
    const files = pkg.walk(EXT_SRC);
    const chk = pkg.checks(files);
    check('package checks (minimal permissions, no remote code, shared.js in sync)', chk.problems.length === 0, chk.problems.join('; '));
    const zipPath = pkg.main();
    check('package zip written', fs.existsSync(zipPath) && fs.statSync(zipPath).size > 20000, path.relative(ROOT, zipPath));

    // ---------------------------------------------------------------- live pages (informational)
    if (REAL) {
      console.log('\n[3] Live public job pages (read-only extraction, informational)');
      const urls = await liveUrls().catch((e) => [{ kind: 'discovery', error: e.message }]);
      const live = await context.newPage();
      for (const u of urls) {
        if (!u.url) { console.log(`  INFO  ${u.kind}: no URL (${u.error || 'none found'})`); continue; }
        try {
          await live.goto(u.url, { waitUntil: 'domcontentloaded', timeout: 30000 });
          await sleep(3500);
          const ltid = await tabIdFor(live.url());
          const ex = await options.evaluate(async (id) => {
            await chrome.scripting.executeScript({ target: { tabId: id }, files: ['content/extract.js'] });
            const [res] = await chrome.scripting.executeScript({ target: { tabId: id }, func: () => globalThis.__apExtract() });
            return res.result;
          }, ltid);
          const j = ex.job;
          const good = !!j.title && (!u.expect || j.title.toLowerCase().includes(u.expect.toLowerCase().slice(0, 20)) || u.expect.toLowerCase().includes(j.title.toLowerCase().slice(0, 20)));
          console.log(`  ${good ? 'OK  ' : 'WARN'}  ${u.kind}: ${live.url().slice(0, 90)}\n        title="${j.title}" company="${j.company}" location="${j.location}" desc=${j.description.length} chars via ${j.extractedBy.join('+')} (${ex.confidence}${u.expect ? `; expected "${u.expect}"` : ''})`);
          results.push({ name: `live: ${u.kind}`, ok: true, info: true, detail: `${j.title} | ${j.company} | ${j.location} | ${j.description.length} chars | ${j.extractedBy.join('+')} | ${good ? 'matches' : 'MISMATCH'}` });
        } catch (e) {
          console.log(`  INFO  ${u.kind}: ${e.message.split('\n')[0]}`);
        }
      }
    }
  } catch (e) {
    check('test run completed without crashing', false, e.stack || e.message);
  } finally {
    if (context) await context.close().catch(() => {});
    await bridge.stop();
    fx.close();
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* Edge may still hold files */ }
  }
  const real = results.filter((r) => !r.info);
  const failed = real.filter((r) => !r.ok);
  console.log(`\n${real.length - failed.length}/${real.length} checks passed${failed.length ? ` — ${failed.length} FAILED` : ''}`);
  process.exit(failed.length ? 1 : 0);
})();
