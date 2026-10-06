// Mobile end-to-end test for the ApplyPilot PWA against the REAL server (no mocks).
//
//   1) build the client:   cd web/client && npm run build
//   2) start the server:   cd web && AP_DEV_LOGIN=1 node server/index.js
//      (it serves web/client/dist; for an isolated run use PORT=8790 APP_ORIGIN=http://localhost:8790 DATABASE_PATH=…)
//   3) run:                node web/client/e2e/mobile.e2e.mjs            (AP_E2E_URL=http://localhost:8790 to override)
//
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
    await tab('profile');
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

  // ---------------------------------------------------------------- answer bank
  await check('answer bank add → edit → delete', async () => {
    await more('answers');
    await page.click('[data-testid="qa-add"]');
    await page.fill('[data-testid="qa-question"]', 'What is your notice period?');
    await page.fill('[data-testid="qa-answer"]', '30 days, negotiable.');
    await page.click('[data-testid="qa-save"]');
    await page.locator('[data-testid="qa-card"]', { hasText: '30 days' }).waitFor();
    await page.click('[data-testid="qa-edit"]');
    await page.fill('[data-testid="qa-answer"]', '30 days, can join sooner.');
    await page.click('[data-testid="qa-save"]');
    await page.locator('[data-testid="qa-card"]', { hasText: 'join sooner' }).waitFor();
    await shot('13-answer-bank');
    await noOverflow('answer bank');
    await page.click('[data-testid="qa-delete"]');
    await page.click('[data-testid="confirm-ok"]');
    await page.locator('[data-testid="qa-card"]').waitFor({ state: 'detached', timeout: 10000 });
    const items = await api('/items?collection=qa');
    assert(items.body.items.every((i) => i.deleted || !i.ciphertext), 'qa record should be tombstoned');
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
