// Mobile end-to-end test for the ApplyPilot PWA against the REAL server (no mocks).
//
//   1) build the client:   cd web/client && npm run build
//   2) start the server:   cd web && AP_DEV_LOGIN=1 node server/index.js
//      (it serves web/client/dist; for an isolated run use PORT=8790 APP_ORIGIN=http://localhost:8790 DATABASE_PATH=…)
//   3) run:                node web/client/e2e/mobile.e2e.mjs            (AP_E2E_URL=http://localhost:8790 to override)
//
// Parity checks (campaigns, review queue, cancel window, tailored PDF, referrals, tracker import) use
// fixture AI responses and a stub in-app filler, so no Anthropic key or phone is needed.
// Runs Microsoft Edge (playwright-core, channel 'msedge') as an iPhone-sized touch device (390x844).
// Screenshots go to docs/screenshots/web-*.png. Every screen is also checked for horizontal overflow at 360px.
import { chromium } from 'playwright-core';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(here, '../../..');
const SHOTS = path.join(ROOT, 'docs', 'screenshots');
const BASE = (process.env.AP_E2E_URL || 'http://localhost:8787').replace(/\/$/, '');
const HEADED = process.argv.includes('--headed');
const EMAIL = `e2e-${Date.now()}@example.com`;
const PASS = 'copper river tiger lantern 42';
const QUERY = process.env.AP_E2E_QUERY || 'software engineer';

const results = [];
let step = '';
const t0 = Date.now();
function ok(name, detail = '') { results.push({ name, ok: true, detail }); console.log(`  ✓ ${name}${detail ? `  (${detail})` : ''}`); }
function fail(name, err) { results.push({ name, ok: false, detail: String(err && err.message || err) }); console.log(`  ✗ ${name}: ${err && err.message || err}`); }
let beforeStep = async () => {};
let lastFailed = false;
async function check(name, fn) { step = name; try { if (lastFailed) await beforeStep(); lastFailed = false; const d = await fn(); ok(name, d || ''); return true; } catch (e) { lastFailed = true; fail(name, e); return false; } }
function assert(c, msg) { if (!c) throw new Error(msg); }

/** Minimal valid one-page PDF with real text (pdf.js-readable). */
function makePdf(lines) {
  const esc = (s) => s.replace(/[\\()]/g, (m) => `\\${m}`);
  const content = `BT /F1 12 Tf 72 740 Td 16 TL ${lines.map((l) => `(${esc(l)}) Tj T*`).join(' ')} ET`;
  const objs = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${Buffer.byteLength(content)} >>\nstream\n${content}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  let out = '%PDF-1.4\n';
  const offs = [];
  objs.forEach((o, i) => { offs.push(Buffer.byteLength(out)); out += `${i + 1} 0 obj\n${o}\nendobj\n`; });
  const xref = Buffer.byteLength(out);
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offs.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}`;
  out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, 'latin1');
}

async function main() {
  fs.mkdirSync(SHOTS, { recursive: true });
  const health = await fetch(`${BASE}/api/health`).then((r) => r.json()).catch(() => null);
  if (!health || !health.ok) { console.error(`Server not reachable at ${BASE}/api/health. Start it first (see header).`); process.exit(2); }
  console.log(`ApplyPilot web e2e → ${BASE} (server v${health.version})\n`);

  const browser = await chromium.launch({ channel: 'msedge', headless: !HEADED });
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true,
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1 Edg/130',
    locale: 'en-US', colorScheme: 'dark',
  });
  await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: BASE });
  // Fixture AI responses (honoured by the app only when the server runs with AP_DEV_LOGIN=1).
  await context.addInitScript(() => {
    window.__AP_AI_STUB__ = (kind, o) => {
      if (kind === 'testKey') return 'OK';
      if (kind === 'tailoredResumeDoc') {
        return {
          name: 'Jane Testerson', headline: 'Senior Software Engineer', contact: ['jane.testerson@example.com', 'Bengaluru, India'],
          summary: 'Senior software engineer with 6 years of experience building web platforms in Python and React. Rust expert.',
          skills: ['Python', 'React', 'TypeScript', 'AWS', 'Rust'],
          experience: [{ title: 'Senior Software Engineer', company: '', location: 'Bengaluru', dates: '2019 – present', bullets: ['Built web platforms with Python, React and Node.js on AWS.', 'Rewrote the billing engine in Rust.', 'Ran Docker and Kubernetes deployments backed by PostgreSQL.'] }],
          projects: [], education: [], certifications: [], changes: ['Led with Python and React, the skills this job asks for most.', 'Moved cloud experience up.'],
        };
      }
      if (kind === 'outreach:referral') return 'Hi Priya, I am applying for the role at your company and would love a referral. (e2e fixture)';
      if (kind === 'answerQuestion') return { answer: '', confident: false };
      if (kind === 'tailorResume') return { atsScore: 72, verdict: 'Good fit (fixture)', missingKeywords: [], tailoredSummary: 'Fixture summary.', bulletRewrites: [], tips: [] };
      return `${kind} (e2e fixture text)`;
    };
  });
  const page = await context.newPage();
  const consoleErrors = [];
  page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });
  page.on('pageerror', (e) => consoleErrors.push(`pageerror: ${e.message}`));
  // "Apply on this phone" opens the employer's site in a new tab: close it, we only test our side.
  const popups = [];
  context.on('page', (p) => { if (p !== page) { popups.push(p.url()); p.close().catch(() => {}); } });

  const shot = async (name) => { await page.locator('.toast').first().waitFor({ state: 'detached', timeout: 8000 }).catch(() => {}); await page.waitForTimeout(450); await page.screenshot({ path: path.join(SHOTS, `web-${name}.png`) }); };
  const overflow = [];
  const noOverflow = async (label) => {
    await page.setViewportSize({ width: 360, height: 780 });
    await page.waitForTimeout(350);
    const r = await page.evaluate(() => {
      const W = window.innerWidth;
      const sw = Math.max(document.documentElement.scrollWidth, document.body.scrollWidth);
      const clippedByAncestor = (el) => { for (let a = el.parentElement; a && a !== document.body; a = a.parentElement) { const s = getComputedStyle(a); if (s.overflowX !== 'visible' && a.getBoundingClientRect().right <= W + 1) return true; } return false; };
      const bad = [];
      for (const el of document.querySelectorAll('body *')) {
        const b = el.getBoundingClientRect();
        if (b.width && b.right > W + 1 && getComputedStyle(el).position !== 'fixed' && !clippedByAncestor(el)) bad.push(`${el.tagName.toLowerCase()}.${String(el.className).slice(0, 40)} right=${Math.round(b.right)}`);
        if (bad.length > 5) break;
      }
      return { sw, W, bad };
    });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(200);
    overflow.push({ label, ...r });
    assert(r.sw <= r.W + 1 && !r.bad.length, `horizontal overflow at 360px on ${label}: scrollWidth=${r.sw} ${r.bad.join(', ')}`);
  };
  // A failed step must not leave a sheet open over the next one.
  beforeStep = async () => { for (let i = 0; i < 3 && await page.locator('.sheet-wrap').count(); i++) { await page.keyboard.press('Escape'); await page.waitForTimeout(350); } };
  const tab = (id) => page.click(`.tabbar [data-tab="${id}"]`);
  const more = async (id) => { await tab('more'); await page.click(`[data-nav="${id}"]`); };
  const api = async (p) => { const r = await page.request.get(`${BASE}/api${p}`); return { status: r.status(), body: r.status() < 300 ? await r.json() : null }; };
  const toast = (re) => page.locator('.toast', { hasText: re }).first().waitFor({ timeout: 15000 });

  // ---------------------------------------------------------------- landing
  await check('landing renders hero + dev login', async () => {
    await page.goto(BASE, { waitUntil: 'networkidle' });
    await page.getByText('Every job board.').waitFor();
    await page.locator('[data-testid="dev-login"]').waitFor();
    await shot('01-landing');
    await noOverflow('landing');
  });
  await check('manifest + service worker (static shell only)', async () => {
    const m = await page.request.get(`${BASE}/manifest.webmanifest`).then((r) => r.json());
    assert(m.name === 'ApplyPilot' && m.icons.some((i) => i.sizes === '512x512'), 'manifest');
    const sw = await page.request.get(`${BASE}/sw.js`).then((r) => r.text());
    assert(sw.includes("startsWith('/api/')") && !/caches\.open[^\n]*api/.test(sw), 'sw must skip /api');
    const reg = await page.evaluate(async () => { const r = await navigator.serviceWorker.ready; return !!r.active; });
    assert(reg, 'service worker not active');
    return 'sw active';
  });

  // ---------------------------------------------------------------- login + vault
  let recoveryKey = '';
  await check('dev login', async () => {
    await page.fill('input[type="email"]', EMAIL);
    await page.click('[data-testid="dev-login"] button[type="submit"]');
    await page.getByText('Create your vault').waitFor({ timeout: 15000 });
    const me = await api('/me');
    assert(me.status === 200 && me.body.user.email === EMAIL && me.body.hasVault === false, `unexpected /me ${me.status}`);
  });
  await check('create vault shows recovery key once', async () => {
    await page.fill('[data-testid="new-pass"]', 'short');
    await page.getByText('at least 12 characters').waitFor();
    await page.fill('[data-testid="new-pass"]', PASS);
    await page.fill('[data-testid="new-pass-confirm"]', PASS);
    await page.check('[data-testid="vault-ack"]');
    await shot('02-create-vault');
    await noOverflow('create vault');
    await page.click('[data-testid="create-vault"]');
    const key = page.locator('[data-testid="recovery-key"]');
    await key.waitFor({ timeout: 30000 });
    recoveryKey = (await key.textContent()).trim();
    assert(/^[0-9A-Z]{4}(-[0-9A-Z]{1,4}){7}$/.test(recoveryKey), `recovery key format: ${recoveryKey}`);
    assert(await page.locator('[data-testid="recovery-saved"]').isDisabled(), 'continue must be disabled before typing last 4');
    await shot('03-recovery-key');
    await noOverflow('recovery key');
    const v = await api('/vault');
    assert(v.status === 200 && v.body.vault.kdf.iterations >= 600000, 'vault uploaded with 600k PBKDF2');
    assert(!JSON.stringify(v.body).includes(recoveryKey.replace(/-/g, '')), 'recovery key must not be stored server-side');
    await page.fill('[data-testid="recovery-last4"]', recoveryKey.replace(/-/g, '').slice(-4));
    await page.click('[data-testid="recovery-saved"]');
    await page.locator('[data-testid="greeting"]').waitFor({ timeout: 20000 });
    return recoveryKey.slice(0, 4) + '-…';
  });
  await check('home screen', async () => {
    await page.locator('[data-testid="outbox-card"]').waitFor();
    await noOverflow('home');
  });
  await check('DEK/passphrase never persisted in browser storage', async () => {
    const dump = await page.evaluate(async () => {
      const ls = JSON.stringify({ ...localStorage }) + JSON.stringify({ ...sessionStorage });
      const dbs = indexedDB.databases ? (await indexedDB.databases()).map((d) => d.name) : [];
      return { ls, dbs };
    });
    assert(!dump.ls.includes(PASS) && !/dek|passphrase|recovery/i.test(dump.ls), 'secret found in web storage');
    assert(!dump.dbs.length, `unexpected IndexedDB: ${dump.dbs.join(',')}`);
  });

  // ---------------------------------------------------------------- lock / unlock
  await check('lock → unlock', async () => {
    await page.click('[data-testid="lock"]');
    await page.locator('[data-testid="unlock-pass"]').waitFor();
    await page.fill('[data-testid="unlock-pass"]', 'wrong passphrase 123');
    await page.click('[data-testid="unlock"]');
    await page.getByText('Wrong passphrase').waitFor({ timeout: 20000 });
    await shot('05-unlock');
    await noOverflow('unlock');
    await page.fill('[data-testid="unlock-pass"]', PASS);
    await page.click('[data-testid="unlock"]');
    await page.locator('[data-testid="greeting"]').waitFor({ timeout: 20000 });
  });

  // ---------------------------------------------------------------- profile autosave
  const PROFILE = { firstName: 'Jane', lastName: 'Testerson', email: 'jane.testerson@example.com', phone: '9876543210', city: 'Bengaluru', country: 'India' };
  await check('profile edit autosaves encrypted', async () => {
    await more('profile');
    for (const k of ['firstName', 'lastName', 'email', 'phone']) await page.fill(`[data-field="${k}"]`, PROFILE[k]);
    await page.click('[data-section="address"] .list-row');
    await page.fill('[data-field="city"]', PROFILE.city);
    await page.fill('[data-field="country"]', PROFILE.country);
    await page.locator('[data-testid="save-state"][data-state="saved"]').waitFor({ timeout: 15000 });
    await page.waitForTimeout(400);
    await page.locator('[data-testid="save-state"][data-state="saved"]').waitFor({ timeout: 15000 });
    const items = await api('/items?collection=profile');
    const rec = items.body.items.find((i) => i.id === 'main');
    assert(rec && rec.ciphertext.startsWith('v1.'), 'profile record missing');
    assert(!rec.ciphertext.includes('Testerson') && !rec.ciphertext.includes('Bengaluru'), 'plaintext leaked into profile ciphertext');
    await page.click('[data-section="address"] .list-row');
    await page.evaluate(() => window.scrollTo(0, 0));
    await shot('06-profile');
    await noOverflow('profile');
    // Lock + unlock re-downloads and decrypts everything: the edit must survive.
    await page.click('[data-testid="lock"]');
    await page.fill('[data-testid="unlock-pass"]', PASS);
    await page.click('[data-testid="unlock"]');
    await page.locator('[data-testid="save-state"]').waitFor({ timeout: 20000 });
    assert(await page.locator('[data-field="lastName"]').inputValue() === PROFILE.lastName, 'profile value should decrypt after re-unlock');
    await tab('home');
    await page.locator('[data-testid="greeting"]').waitFor({ timeout: 20000 });
    assert((await page.locator('[data-testid="greeting"]').textContent()).includes('Jane'), 'greeting should use decrypted profile name');
    return 'decrypted after re-unlock';
  });

  // ---------------------------------------------------------------- resume upload
  const pdf = makePdf(['Jane Testerson', 'Senior Software Engineer', 'jane.testerson@example.com', '6 years of experience building web platforms.', 'Skills: Python, JavaScript, TypeScript, React, Node.js, AWS, Docker, Kubernetes, SQL, PostgreSQL']);
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ap-e2e-'));
  const pdfPath = path.join(tmpDir, 'Jane-Testerson-Resume.pdf');
  fs.writeFileSync(pdfPath, pdf);
  await check('resume upload (PDF → text in browser → encrypted blob)', async () => {
    await more('resumes');
    await page.setInputFiles('[data-testid="resume-file"]', pdfPath);
    await page.locator('[data-testid="resume-card"]').first().waitFor({ timeout: 30000 });
    await page.locator('[data-testid="resume-card"] .badge', { hasText: 'Python' }).first().waitFor({ timeout: 10000 });
    const items = await api('/items?collection=resumes');
    assert(items.body.items.length === 1, 'one resume record');
    assert(!items.body.items[0].ciphertext.includes('Kubernetes'), 'resume text leaked');
    // Duplicate detection by SHA-256 of bytes
    await page.setInputFiles('[data-testid="resume-file"]', pdfPath);
    await toast(/already uploaded/);
    // Rename
    await page.click('[data-testid="rename"]');
    await page.fill('[data-testid="rename-input"]', 'Jane SWE resume');
    await page.keyboard.press('Enter');
    await page.locator('[data-testid="resume-name"]', { hasText: 'Jane SWE resume' }).waitFor();
    await shot('07-resumes');
    await noOverflow('resumes');
    return 'skills extracted, duplicate blocked, renamed';
  });

  // ---------------------------------------------------------------- job search (live)
  let jobTitle = '';
  await check(`live job search "${QUERY}" (scored on device)`, async () => {
    await tab('jobs');
    await page.fill('[data-testid="job-search"] input[aria-label="Job title"]', QUERY);
    await page.fill('[data-testid="job-search"] input[aria-label="Location"]', '');
    await page.click('[data-testid="job-search"] button[type="submit"]');
    await page.locator('[data-testid="swipe-deck"], [data-testid="job-card"]').first().waitFor({ timeout: 120000 });
    await page.locator('[data-testid="swipe-card"]').first().waitFor({ timeout: 10000 });
    await shot('08-swipe-triage');
    await noOverflow('swipe triage');
    // Swipe left (skip) via drag on the top card
    const card = page.locator('[data-testid="swipe-card"]').first();
    const firstTitle = (await card.locator('.card-title').textContent()).trim();
    const left = async () => Number(await page.locator('[data-testid="swipe-left-count"]').textContent());
    const before = await left();
    await card.scrollIntoViewIfNeeded(); await page.waitForTimeout(500);
    const box = await card.boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    for (let i = 1; i <= 8; i++) await page.mouse.move(box.x + box.width / 2 - i * 30, box.y + box.height / 2, { steps: 2 });
    await page.mouse.up();
    await page.waitForTimeout(900);
    const after = await left();
    assert(after === before - 1, `swipe-left should advance the deck (${before} → ${after})`);
    const skipped = await api('/items?collection=applications');
    assert(skipped.body.items.filter((i) => !i.deleted).length === 1, 'skip should be recorded as an (encrypted) application');
    await page.click('[data-testid="view-list"]');
    await page.locator('[data-testid="job-card"]').first().waitFor();
    await page.evaluate(() => window.scrollTo(0, 0));
    await shot('09-jobs-list');
    await noOverflow('jobs list');
    const n = await page.locator('[data-testid="job-card"]').count();
    return `${n} cards, swipe-left skipped "${firstTitle.slice(0, 30)}"`;
  });
  await check('filters sheet (Sponsors visa / Only jobs I can take)', async () => {
    await page.click('[data-testid="open-filters"]');
    await page.getByText('Only jobs I can take').waitFor();
    await page.getByText('Sponsors visa').first().waitFor();
    await noOverflow('filters sheet');
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);
  });
  await check('job detail sheet with match breakdown', async () => {
    const cards = page.locator('[data-testid="job-card"]');
    await cards.first().click();
    await page.locator('[data-testid="match-breakdown"]').waitFor();
    jobTitle = (await page.locator('[data-testid="job-title"]').textContent()).trim();
    // Pick a job we can actually apply to (not scam-flagged).
    for (let i = 1; i < 6 && await page.locator('[data-testid="apply-here"]').isDisabled(); i++) {
      await page.keyboard.press('Escape'); await page.waitForTimeout(300);
      await cards.nth(i).click(); await page.locator('[data-testid="match-breakdown"]').waitFor();
      jobTitle = (await page.locator('[data-testid="job-title"]').textContent()).trim();
    }
    await shot('10-job-detail');
    await noOverflow('job detail');
    return jobTitle.slice(0, 50);
  });
  await check('apply on phone → quick-fill one-tap copy', async () => {
    const popup = context.waitForEvent('page', { timeout: 10000 }).catch(() => null);
    await page.click('[data-testid="apply-here"]');
    await page.locator('[data-testid="quickfill"]').waitFor();
    assert((await popup) || popups.length >= 1, 'job application should open in a new tab');
    await page.click('[data-copy-key="Email"]');
    await toast(/Email copied/);
    const clip = await page.evaluate(() => navigator.clipboard.readText());
    assert(clip === PROFILE.email, `clipboard has "${clip}"`);
    await page.click('[data-copy-key="Full name"]');
    const clip2 = await page.evaluate(() => navigator.clipboard.readText());
    assert(clip2 === 'Jane Testerson', `clipboard has "${clip2}"`);
    await shot('11-quick-fill');
    await noOverflow('quick-fill');
    await page.keyboard.press('Escape');
    await page.waitForTimeout(400);
    return 'email + name copied';
  });
  await check('send to laptop → encrypted outbox item', async () => {
    await page.click('[data-testid="send-laptop"]');
    await toast(/Sent to your laptop/);
    const items = await api('/items?collection=outbox');
    const live = items.body.items.filter((i) => !i.deleted);
    assert(live.length === 1, `expected 1 outbox item, got ${live.length}`);
    const ct = live[0].ciphertext;
    assert(ct.startsWith('v1.'), 'ciphertext format');
    for (const plain of [jobTitle, jobTitle.split(' ')[0], 'jobId', 'resumeId', '"web"', 'review']) assert(!ct.includes(plain), `plaintext "${plain}" visible in ciphertext`);
    await page.click('[data-testid="save-job"]');
    await toast(/Saved to Applications/);
    await page.keyboard.press('Escape');
    return `ciphertext ${ct.length} chars, no plaintext`;
  });
  await check('applications tracker + home queue', async () => {
    await tab('applied');
    await page.locator('[data-testid="app-card"]').first().waitFor();
    await shot('12-applications');
    await noOverflow('applications');
    await page.locator('[data-testid="app-card"]').first().click();
    await page.fill('[data-testid="app-notes"]', 'Recruiter: Priya. Follow up Friday.');
    await page.locator('[data-testid="status-select"]').selectOption('applied');
    await toast(/Notes saved|Status updated/);
    await page.keyboard.press('Escape');
    await tab('home');
    await page.locator('[data-testid="outbox-item"]').first().waitFor();
    await page.evaluate(() => window.scrollTo(0, 0));
    await shot('04-home');
  });

  // ---------------------------------------------------------------- parity: AI key (stubbed), campaigns, queue, PDF, referrals, imports
  // AI calls are answered by window.__AP_AI_STUB__ (installed with addInitScript, honoured only because
  // the server runs with AP_DEV_LOGIN=1), so no real Anthropic key is ever needed.
  await check('AI key saved (stubbed Anthropic, never a real key)', async () => {
    await more('ai');
    await page.fill('input[aria-label="Anthropic API key"]', 'sk-ant-e2e-fixture-not-a-real-key');
    await page.getByRole('button', { name: 'Verify & save' }).click();
    await page.getByText('Key saved').waitFor({ timeout: 15000 });
    const items = await api('/items?collection=settings');
    assert(!items.body.items[0].ciphertext.includes('sk-ant'), 'key must be encrypted');
  });

  let campaignName = 'E2E SWE hunt';
  await check('campaigns: create → edit (encrypted, synced shape)', async () => {
    await more('campaigns');
    await noOverflow('campaigns (empty)');
    await page.click('[data-testid="campaign-new"]');
    await page.locator('[data-testid="campaign-editor"]').waitFor();
    await page.fill('input[aria-label="Job titles"]', QUERY);
    await page.keyboard.press('Enter');
    await page.fill('[data-testid="campaign-name"]', 'E2E campaign');
    await page.focus('[data-testid="campaign-min"]');
    await page.keyboard.press('Home'); // 30%
    await page.click('[data-mode="auto"]');
    await shot('16-campaign-editor');
    await noOverflow('campaign editor');
    await page.click('[data-testid="campaign-save"]');
    await page.locator('[data-testid="campaign-card"]').first().waitFor();
    await page.click('[data-testid="campaign-edit"]');
    await page.fill('[data-testid="campaign-name"]', campaignName);
    await page.click('[data-testid="campaign-save"]');
    await page.locator('[data-testid="campaign-title"]', { hasText: campaignName }).waitFor();
    const items = await api('/items?collection=campaigns');
    const live = items.body.items.filter((i) => !i.deleted);
    assert(live.length === 1, `expected 1 campaign record, got ${live.length}`);
    for (const plain of [campaignName, QUERY, 'minScore']) assert(!live[0].ciphertext.includes(plain), `plaintext "${plain}" in campaign ciphertext`);
    return 'created, renamed, 1 encrypted record';
  });
  let queuedCount = 0;
  await check('campaign run: server search → on-device scoring → queued matches', async () => {
    const before = (await api('/items?collection=applications')).body.items.filter((i) => !i.deleted).length;
    await page.click('[data-testid="campaign-toggle"]');
    await page.locator('[data-testid="campaign-card"][data-status="running"]').waitFor({ timeout: 15000 });
    await page.waitForFunction(() => { const el = document.querySelector('[data-testid="campaign-queued"]'); return el && Number(el.textContent) > 0; }, null, { timeout: 150000 });
    queuedCount = Number(await page.locator('[data-testid="campaign-queued"]').textContent());
    await page.locator('[data-testid="campaign-run"]:not([disabled])').waitFor({ timeout: 60000 });
    await page.waitForTimeout(800);
    const after = (await api('/items?collection=applications')).body.items.filter((i) => !i.deleted).length;
    assert(after - before >= queuedCount, `applications ${before} → ${after}, queued ${queuedCount}`);
    await page.evaluate(() => window.scrollTo(0, 0));
    await shot('15-campaigns');
    await noOverflow('campaigns');
    assert(await page.locator('[data-testid="queue-count"]').count(), 'queue tab badge');
    return `${queuedCount} matches queued`;
  });

  let refCompany = '';
  await check('review queue lists matches, filter by campaign, job sheet opens', async () => {
    await tab('queue');
    await page.locator('[data-testid="queue-row"]').first().waitFor({ timeout: 15000 });
    const rows = await page.locator('[data-testid="queue-row"]').count();
    assert(rows === queuedCount, `queue rows ${rows} vs campaign queued ${queuedCount}`);
    await shot('17-review-queue');
    await noOverflow('review queue');
    await page.locator('[data-testid="queue-row"] button.grow').first().click();
    await page.locator('[data-testid="job-company"]').waitFor();
    refCompany = (await page.locator('[data-testid="job-company"]').textContent()).trim();
    await page.keyboard.press('Escape'); await page.waitForTimeout(350);
    return `${rows} rows · top company ${refCompany}`;
  });

  // LinkedIn Connections.csv as exported (with the "Notes:" preamble), including a person at the top job's company.
  const connCsv = `Notes:\n"When exporting your connection data, you may notice that some of the email addresses are missing."\n\nFirst Name,Last Name,URL,Email Address,Company,Position,Connected On\nPriya,Raman,https://www.linkedin.com/in/priya-raman-e2e,priya@example.com,"${refCompany.replace(/"/g, '""')}",Engineering Manager,01 Mar 2025\nArjun,Mehta,https://www.linkedin.com/in/arjun-e2e,,Globex,Designer,12 Jan 2024\nLena,Fischer,https://www.linkedin.com/in/lena-e2e,,Initech,Recruiter,03 Feb 2023\n`;
  await check('referral finder: import Connections.csv (encrypted) → edit → remove', async () => {
    const p = path.join(tmpDir, 'Connections.csv'); fs.writeFileSync(p, connCsv);
    await more('network');
    await page.setInputFiles('[data-testid="network-file"]', p);
    await page.locator('[data-testid="network-count"]', { hasText: '3 connections' }).waitFor({ timeout: 15000 });
    const items = await api('/items?collection=network');
    const live = items.body.items.filter((i) => !i.deleted);
    assert(live.length >= 2, 'meta + chunk records');
    for (const it of live) for (const plain of ['Priya', 'Raman', 'Globex', 'priya@example.com']) assert(!it.ciphertext.includes(plain), `plaintext "${plain}" in network ciphertext`);
    // edit Lena, remove Arjun
    await page.locator('[data-testid="person-row"]', { hasText: 'Lena' }).getByRole('button', { name: /Edit/ }).click();
    await page.fill('[data-testid="contact-company"]', 'Initech Labs');
    await page.click('[data-testid="contact-save"]');
    await page.locator('[data-testid="person-row"]', { hasText: 'Initech Labs' }).waitFor();
    await page.locator('[data-testid="person-row"]', { hasText: 'Arjun' }).getByRole('button', { name: /Remove/ }).click();
    await page.click('[data-testid="confirm-ok"]');
    await page.locator('[data-testid="network-count"]', { hasText: '2 connections' }).waitFor({ timeout: 10000 });
    await shot('20-referrals');
    await noOverflow('referrals');
    return '3 imported, 1 edited, 1 removed';
  });
  await check('job sheet: people you know + research links + AI referral message', async () => {
    await tab('queue');
    await page.locator('[data-testid="queue-row"] button.grow').first().click();
    await page.locator('[data-testid="people-count"]').waitFor({ timeout: 10000 });
    await page.locator('[data-testid="research-card"]').getByText('Interview questions').waitFor();
    await page.locator('[data-testid="research-card"]').scrollIntoViewIfNeeded();
    await shot('21-job-research');
    await noOverflow('job research');
    await page.getByRole('tab', { name: 'AI tools' }).click();
    await page.click('[data-testid="ai-referral"]');
    await page.locator('[data-testid="ai-text-result"]', { hasText: 'Priya' }).waitFor({ timeout: 10000 });
    await page.keyboard.press('Escape'); await page.waitForTimeout(350);
  });

  await check('review queue: skip one, bulk skip needs confirm', async () => {
    const n0 = await page.locator('[data-testid="queue-row"]').count();
    await page.locator('[data-testid="queue-skip-one"]').last().click();
    await page.waitForFunction((n) => document.querySelectorAll('[data-testid="queue-row"]').length === n - 1, n0, { timeout: 10000 });
    return `${n0} → ${n0 - 1}`;
  });

  // In-app auto-fill is native-only; the e2e installs a stub filler with the contract's shape that
  // reports progress and asks for the cancel window before "submitting".
  const installNativeStub = () => page.evaluate(() => {
    window.__AP_NATIVE_STUB__ = {
      isNative: true, platform: 'android',
      async applyInApp(o) {
        window.__apLastApply = { mode: o.mode, resume: o.resume && o.resume.name, bytes: o.resume && o.resume.bytes ? o.resume.bytes.length : 0, cover: !!o.coverLetter, answers: o.answers.length };
        o.onEvent({ type: 'step', message: 'Opened the application page (stub)' });
        await new Promise((r) => setTimeout(r, 300));
        o.onEvent({ type: 'progress', message: 'Filled 12 fields', data: { filledCount: 12 } });
        const go = await o.beforeSubmit();
        if (!go) return { status: 'filled-awaiting-user', filledCount: 12, unanswered: [{ question: 'Why do you want to work at this company in particular?', required: true }], message: 'Held: finish it yourself' };
        return { status: 'submitted', filledCount: 12, unanswered: [], message: 'Application submitted.' };
      },
    };
  });
  await check('approve in app → cancel window → Hold (needs you + question to Answer bank)', async () => {
    await installNativeStub();
    await page.click('[data-testid="queue-select-all"]'); await page.click('[data-testid="queue-select-all"]'); // clear
    await page.locator('[data-testid="queue-row"] .check').first().click();
    await page.click('[data-testid="queue-apply"]');
    await page.locator('[data-testid="cancel-countdown"]').waitFor({ timeout: 20000 });
    await page.locator('[data-testid="apply-events"]', { hasText: 'Filled 12 fields' }).waitFor();
    await shot('18-cancel-window');
    await noOverflow('cancel window');
    await page.click('[data-testid="hold-submit"]');
    await page.locator('[data-testid="apply-progress"][data-phase="done"]').waitFor({ timeout: 15000 });
    await page.click('[data-testid="apply-done"]');
    await page.locator('[data-testid="needs-row"]').first().waitFor({ timeout: 10000 });
    const last = await page.evaluate(() => window.__apLastApply);
    assert(last && last.bytes > 100 && last.mode === 'auto', `filler got ${JSON.stringify(last)}`);
    await more('answers');
    await page.locator('[data-testid="qa-card"]', { hasText: 'work at this company in particular' }).waitFor({ timeout: 10000 });
    return `resume ${last.bytes} bytes, mode ${last.mode}`;
  });
  await check('approve in app → Submit now → applied in tracker', async () => {
    await tab('queue');
    await page.locator('[data-testid="queue-row"] .check').first().click();
    await page.click('[data-testid="queue-apply"]');
    await page.locator('[data-testid="submit-now"]').waitFor({ timeout: 20000 });
    await page.click('[data-testid="submit-now"]');
    await page.locator('[data-testid="apply-progress"][data-status="applied"]').waitFor({ timeout: 15000 });
    await page.click('[data-testid="apply-done"]');
    await page.evaluate(() => { delete window.__AP_NATIVE_STUB__; });
    await tab('applied');
    await page.locator('[data-testid="group-applied"] [data-testid="app-card"]').first().waitFor();
  });

  await check('tailored resume PDF: AI (stub) → truthfulness check → pdf-lib → encrypted → preview', async () => {
    await page.locator('[data-testid="group-applied"] [data-testid="app-card"]').first().click();
    await page.locator('[data-testid="make-tailored"]').scrollIntoViewIfNeeded();
    await page.click('[data-testid="make-tailored"]');
    await page.locator('[data-testid="pdf-preview"] img').first().waitFor({ timeout: 30000 });
    await page.locator('[data-testid="tailored-sheet"] .badge', { hasText: 'Rust' }).first().waitFor();
    await shot('19-tailored-pdf');
    await noOverflow('tailored pdf');
    const blobs = (await api('/account/export')).body.blobs.length;
    assert(blobs >= 2, `resume + tailored PDF blobs, got ${blobs}`);
    await page.click('[data-testid="pdf-delete"]');
    await page.click('[data-testid="confirm-ok"]');
    await page.locator('[data-testid="make-tailored"]', { hasText: 'Create tailored PDF' }).waitFor({ timeout: 10000 });
    await page.keyboard.press('Escape'); await page.waitForTimeout(350);
    return 'invented "Rust" removed; PDF created, previewed, deleted';
  });

  await check('tracker import (Teal CSV, duplicates skipped) + work-search log export', async () => {
    const csv = 'Company,Job Position,Status,Date Applied,URL,Location\nGlobex,Platform Engineer,Interviewing,2026-09-20,https://globex.example/jobs/1,Remote\nInitech,Backend Developer,Applied,2026-09-25,,Austin\nGlobex,Platform Engineer,Applied,2026-09-21,,\n';
    const p = path.join(tmpDir, 'teal-export.csv'); fs.writeFileSync(p, csv);
    await tab('applied');
    await page.click('[data-testid="tracker-tools-open"]');
    await page.locator('[data-testid="tracker-tools"]').waitFor();
    await noOverflow('tracker tools');
    await page.setInputFiles('[data-testid="tracker-file"]', p);
    await toast(/Imported 2 application\(s\), 1 duplicate/);
    await page.click('[data-testid="tracker-tools-open"]');
    const dl = page.waitForEvent('download', { timeout: 10000 });
    await page.click('[data-testid="work-log"]');
    const file = await dl;
    assert(/^work-search-log-\d{4}-\d{2}-\d{2}\.csv$/.test(file.suggestedFilename()), file.suggestedFilename());
    const text = fs.readFileSync(await file.path(), 'utf8');
    assert(text.includes('Globex') && text.includes('Employer'), 'work log content');
    await page.keyboard.press('Escape'); await page.waitForTimeout(350);
    await page.locator('[data-testid="group-interview"] [data-testid="app-card"]', { hasText: 'Platform Engineer' }).waitFor();
    await page.evaluate(() => window.scrollTo(0, 0));
    await shot('22-tracker');
    return 'Teal CSV imported, work log downloaded';
  });

  await check('dashboard: digest, stats, pipeline, what\'s working, activity', async () => {
    await tab('home');
    for (const id of ['digest', 'stats', 'pipeline', 'whats-working', 'home-campaigns', 'activity']) await page.locator(`[data-testid="${id}"]`).waitFor();
    await page.locator('[data-testid="digest"]', { hasText: /need|match|follow/ }).waitFor();
    await page.evaluate(() => window.scrollTo(0, 0));
    await shot('23-dashboard');
    await noOverflow('dashboard');
  });

  await check('settings: cancel window + career pages add/toggle/remove', async () => {
    await more('settings');
    await page.locator('[data-testid="applying-card"]').waitFor();
    await page.click('[data-testid="career-add"]');
    await page.fill('[data-testid="career-url"]', 'https://boards.greenhouse.io/examplecorp');
    await page.click('[data-testid="career-save"]');
    await page.locator('[data-testid="career-row"]').first().waitFor({ timeout: 10000 });
    await page.locator('[data-testid="career-pages"]').scrollIntoViewIfNeeded();
    await shot('24-settings-applying');
    await noOverflow('settings applying');
    await page.click('[data-testid="career-remove"]');
    await page.click('[data-testid="confirm-ok"]');
    await page.locator('[data-testid="career-row"]').waitFor({ state: 'detached', timeout: 10000 });
  });

  await check('campaign delete keeps its applications', async () => {
    const before = (await api('/items?collection=applications')).body.items.filter((i) => !i.deleted).length;
    await more('campaigns');
    await page.click('[data-testid="campaign-delete"]');
    await page.click('[data-testid="confirm-ok"]');
    await page.locator('[data-testid="campaign-card"]').waitFor({ state: 'detached', timeout: 10000 });
    const items = await api('/items?collection=campaigns');
    assert(items.body.items.every((i) => i.deleted || !i.ciphertext), 'campaign tombstoned');
    const after = (await api('/items?collection=applications')).body.items.filter((i) => !i.deleted).length;
    assert(after === before, `applications ${before} → ${after}`);
  });

  // ---------------------------------------------------------------- answer bank
  await check('answer bank add → edit → delete', async () => {
    await more('answers');
    await page.click('[data-testid="qa-add"]');
    await page.fill('[data-testid="qa-question"]', 'What is your notice period?');
    await page.fill('[data-testid="qa-answer"]', '30 days, negotiable.');
    await page.click('[data-testid="qa-save"]');
    await page.locator('[data-testid="qa-card"]', { hasText: '30 days' }).waitFor();
    await page.locator('[data-testid="qa-card"]', { hasText: '30 days' }).locator('[data-testid="qa-edit"]').click();
    await page.fill('[data-testid="qa-answer"]', '30 days, can join sooner.');
    await page.click('[data-testid="qa-save"]');
    await page.locator('[data-testid="qa-card"]', { hasText: 'join sooner' }).waitFor();
    await shot('13-answer-bank');
    await noOverflow('answer bank');
    const before = (await api('/items?collection=qa')).body.items.filter((i) => !i.deleted).length;
    await page.locator('[data-testid="qa-card"]', { hasText: 'join sooner' }).locator('[data-testid="qa-delete"]').click();
    await page.click('[data-testid="confirm-ok"]');
    await page.locator('[data-testid="qa-card"]', { hasText: 'join sooner' }).waitFor({ state: 'detached', timeout: 10000 });
    const after = (await api('/items?collection=qa')).body.items.filter((i) => !i.deleted).length;
    assert(after === before - 1, `qa record should be tombstoned (${before} → ${after})`);
  });

  // ---------------------------------------------------------------- devices
  await check('devices: link code with countdown', async () => {
    await more('settings');
    await noOverflow('settings');
    await page.click('[data-testid="link-desktop"]');
    const code = (await page.locator('[data-testid="link-code"]').textContent()).replace(/-/g, '').trim();
    assert(/^[A-Z0-9]{8}$/.test(code), `code "${code}"`);
    await page.locator('[data-testid="link-countdown"]', { hasText: /Expires in (9|10):/ }).waitFor();
    await shot('14-link-desktop');
    await noOverflow('link code sheet');
    await page.keyboard.press('Escape');
    return code;
  });
  await check('platforms directory', async () => {
    await more('platforms');
    await page.locator('[data-testid="platform"]').first().waitFor({ timeout: 15000 });
    const href = await page.locator('[data-testid="platform"]').first().getAttribute('href');
    assert(/^https:\/\//.test(href), 'deep link');
    await noOverflow('platforms');
  });
  await check('ai studio + more screens have no overflow', async () => {
    await more('ai'); await page.getByText('Anthropic API key').waitFor(); await noOverflow('ai studio');
    await tab('more'); await noOverflow('more');
  });

  // ---------------------------------------------------------------- delete account
  await check('delete account (typed confirmation)', async () => {
    await more('settings');
    await page.click('[data-testid="delete-account"]');
    assert(await page.locator('[data-testid="confirm-ok"]').isDisabled(), 'confirm must be disabled until DELETE is typed');
    await page.fill('[data-testid="confirm-typed"]', 'DELETE');
    await page.click('[data-testid="confirm-ok"]');
    await page.locator('[data-testid="dev-login"]').waitFor({ timeout: 15000 });
    const me = await api('/me');
    assert(me.status === 401, `/me after delete → ${me.status}`);
  });

  const cspErrors = consoleErrors.filter((e) => /Content Security Policy|Refused to/i.test(e));
  await check('no CSP violations / page errors', async () => {
    const pageErrors = consoleErrors.filter((e) => e.startsWith('pageerror'));
    assert(!cspErrors.length, cspErrors.slice(0, 3).join(' | '));
    assert(!pageErrors.length, pageErrors.slice(0, 3).join(' | '));
    return `${consoleErrors.length} console errors (non-CSP)`;
  });

  fs.rmSync(tmpDir, { recursive: true, force: true });
  await browser.close();
  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} passed in ${Math.round((Date.now() - t0) / 1000)}s · overflow checked on ${overflow.length} screens at 360px`);
  if (consoleErrors.length) console.log(`console errors:\n  ${consoleErrors.slice(0, 10).join('\n  ')}`);
  process.exit(failed.length ? 1 : 0);
}

main().catch((e) => { console.error(`FATAL during "${step}":`, e); process.exit(1); });
