// Desktop-browser end-to-end test for "Apply in browser" (docs/WEB-BRIDGE.md), page side, against the REAL server.
// The browser extension is replaced by a stand-in that speaks the same window.postMessage protocol, so this checks
// everything on the web app's side: detection, labels, the data handed over, events, questions, the result in the
// tracker, and that nothing is sent when the extension is absent.
//
//   1) cd web/client && npm run build
//   2) cd web && AP_DEV_LOGIN=1 PORT=8790 APP_ORIGIN=http://localhost:8790 DATABASE_PATH=<temp>.db node server/index.js
//   3) AP_E2E_URL=http://localhost:8790 node web/client/e2e/browser-helper.e2e.mjs
//
// The job is a fixture saved in the tracker (no live search), so the run is deterministic and offline-friendly.
import { chromium } from 'playwright-core';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const BASE = (process.env.AP_E2E_URL || 'http://localhost:8790').replace(/\/$/, '');
const EMAIL = `helper-${Date.now()}@example.com`;
const PASS = 'copper river tiger lantern 42';
const results = [];
const t0 = Date.now();
async function check(name, fn) {
  try { const d = await fn(); results.push({ name, ok: true }); console.log(`  ✓ ${name}${d ? `  (${d})` : ''}`); } catch (e) {
    results.push({ name, ok: false });
    console.log(`  ✗ ${name}: ${String(e && e.message || e).split(/\r?\n/).slice(0, 9).join(' ')}`);
    if (dbgPage && process.env.AP_DEBUG) console.log('    page:', (await dbgPage.locator('body').innerText().catch(() => '')).replace(/\s+/g, ' ').slice(0, 600));
  }
}
let dbgPage = null;
const assert = (c, m) => { if (!c) throw new Error(m); };

function makePdf(lines) {
  const esc = (s) => s.replace(/[\\()]/g, (m) => `\\${m}`);
  const content = `BT /F1 12 Tf 72 740 Td 16 TL ${lines.map((l) => `(${esc(l)}) Tj T*`).join(' ')} ET`;
  const objs = ['<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Kids [3 0 R] /Count 1 >>', '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>', `<< /Length ${Buffer.byteLength(content)} >>\nstream\n${content}\nendstream`, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'];
  let out = '%PDF-1.4\n'; const offs = [];
  objs.forEach((o, i) => { offs.push(Buffer.byteLength(out)); out += `${i + 1} 0 obj\n${o}\nendobj\n`; });
  const xref = Buffer.byteLength(out);
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offs.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, 'latin1');
}

// Stand-in for the extension's content script on this origin.
const FAKE_EXTENSION = () => {
  window.__fakeExt = { applies: [], answers: [], cancels: 0 };
  window.addEventListener('message', (e) => {
    const m = e.data;
    if (e.source !== window || !m || m.apWeb !== 1 || m.dir !== 'to-ext') return;
    const reply = (o) => window.postMessage({ apWeb: 1, dir: 'to-page', id: m.id, ...o }, location.origin);
    if (m.type === 'ping') reply({ type: 'pong', version: '9.9.9', engine: 'test', needsPermission: false });
    else if (m.type === 'apply') {
      window.__fakeExt.applies.push(m.cfg);
      window.__fakeExt.lastId = m.id;
      reply({ type: 'event', event: { type: 'step', message: 'Opened the application page' } });
      if (!window.__fakeExt.hang) setTimeout(() => reply({ type: 'ask', qid: 'q1', question: 'Are you willing to relocate?', info: { type: 'radio', options: ['Yes', 'No'], required: true } }), 60);
    } else if (m.type === 'answer') {
      window.__fakeExt.answers.push({ qid: m.qid, answer: m.answer });
      reply({ type: 'event', event: { type: 'filled', message: 'Filled 12 fields', data: { filledCount: 12 } } });
      if (window.__fakeExt.early) { setTimeout(() => reply({ type: 'event', event: { type: 'fill-done', message: 'Filled 12 fields', data: { status: 'filled', filledCount: 12, unanswered: [], url: 'https://example.com/apply' } } }), 60); return; }
      setTimeout(() => reply({ type: 'result', result: { status: 'filled-awaiting-user', filledCount: 12, unanswered: [{ question: 'Why do you want to work here?', required: true, type: 'textarea', options: [] }], url: 'https://example.com/apply', message: 'Filled in, review and submit' } }), 80);
    } else if (m.type === 'cancel') { window.__fakeExt.cancels++; reply({ type: 'result', result: { status: 'needs-attention', filledCount: 0, unanswered: [], url: '', message: 'Cancelled.' } }); }
  });
};

async function main() {
  const health = await fetch(`${BASE}/api/health`).then((r) => r.json()).catch(() => null);
  if (!health || !health.ok) { console.error(`Server not reachable at ${BASE}/api/health. Start it first (see header).`); process.exit(2); }
  console.log(`ApplyPilot browser-helper e2e → ${BASE}\n`);
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ap-helper-'));
  const pdfPath = path.join(tmp, 'Asha-Rao-Resume.pdf');
  fs.writeFileSync(pdfPath, makePdf(['Asha Rao', 'Electronics graduate', 'asha.rao@example.com', 'Skills: C, Python, PCB design, Embedded systems']));

  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  const context = await browser.newContext({ viewport: { width: 1280, height: 860 }, locale: 'en-US', colorScheme: 'dark' });
  const withExt = process.env.NO_EXT ? false : true;
  const page = await context.newPage();
  dbgPage = page;
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const tab = (id) => page.click(`[data-tab="${id}"]`);
  const more = async (id) => { await tab('more'); await page.click(`[data-nav="${id}"]`); };

  // ---- 1. without the extension: nothing claims to fill forms
  await check('without the extension the job sheet offers Send to my PC, not an apply button, and Settings says Not connected', async () => {
    await page.goto(BASE, { waitUntil: 'networkidle' });
    await page.fill('input[type="email"]', EMAIL);
    await page.click('[data-testid="dev-login"] button[type="submit"]');
    await page.getByText('What should we call you?').waitFor({ timeout: 15000 });
    await page.fill('input[placeholder="Your name"]', 'Asha Rao');
    await page.getByRole('button', { name: 'Continue' }).click();
    await page.getByText('Create your vault').waitFor({ timeout: 15000 });
    await page.fill('[data-testid="new-pass"]', PASS);
    await page.fill('[data-testid="new-pass-confirm"]', PASS);
    await page.check('[data-testid="vault-ack"]');
    await page.click('[data-testid="create-vault"]');
    const key = page.locator('[data-testid="recovery-key"]');
    await key.waitFor({ timeout: 40000 });
    const rk = (await key.textContent()).trim();
    await page.fill('[data-testid="recovery-last4"]', rk.replace(/-/g, '').slice(-4));
    await page.click('[data-testid="recovery-saved"]');
    await page.locator('[data-tab="more"]').waitFor({ timeout: 30000 });
    await more('settings');
    await page.locator('[data-testid="browser-helper"]').waitFor();
    assert((await page.locator('[data-testid="helper-status"]').textContent()).includes('Not connected'), 'status should say Not connected');
    assert(await page.locator('a[href="/applypilot-extension.zip"]').count(), 'a download link for the extension');
  });

  // ---- 2. profile + resume (the profile is filled from the resume)
  await check('uploading a resume fills the empty profile fields from it', async () => {
    await more('resumes');
    await page.setInputFiles('[data-testid="resume-file"]', pdfPath);
    await page.locator('[data-testid="resume-card"]').first().waitFor({ timeout: 30000 });
    await page.locator('.toast', { hasText: /Filled \d+ empty profile field/ }).first().waitFor({ timeout: 15000 });
    await more('profile');
    assert(await page.locator('[data-field="email"]').inputValue() === 'asha.rao@example.com', 'email read from the resume');
    assert(await page.locator('[data-field="firstName"]').inputValue() === 'Asha', 'first name read from the resume');
  });
  await check('Fill from resume never overwrites what is already typed', async () => {
    await page.fill('[data-field="firstName"]', 'Ashwini');
    await page.click('[data-testid="fill-from-resume"]');
    await page.waitForTimeout(500);
    assert(await page.locator('[data-field="firstName"]').inputValue() === 'Ashwini', 'typed first name must stay');
    await page.fill('[data-field="phone"]', '9876543210');
  });
  await check('Yes/No question text can be tapped without selecting Yes', async () => {
    await page.click('[data-section="authorization"] .list-row');
    const f = page.locator('[data-section="authorization"] [role="group"]', { hasText: 'Willing to relocate?' }).first();
    await f.locator('.field-label').click();
    assert(await f.locator('[aria-selected="true"]').count() === 0, 'tapping the question text must not press Yes');
    await f.getByRole('tab', { name: 'No', exact: true }).click();
    assert(await f.locator('[aria-selected="true"]').textContent() === 'No', 'No selected');
    await page.click('[data-section="authorization"] .list-row');
  });
  await check('details needed by forms are filled (city, country, phone)', async () => {
    await page.click('[data-section="address"] .list-row');
    await page.fill('[data-field="city"]', 'Hyderabad');
    await page.fill('[data-field="country"]', 'India');
    await page.locator('[data-testid="save-state"][data-state="saved"]').waitFor({ timeout: 15000 });
  });

  // ---- 3. a saved job to apply to (fixture, written the way the app writes it)
  await check('a job found in a search can be saved and opened', async () => {
    await tab('jobs');
    await page.fill('[data-testid="job-search"] input[aria-label="Job title"]', 'engineer');
    await page.click('[data-testid="job-search"] button[type="submit"]');
    await page.locator('[data-testid="job-card"]').first().waitFor({ timeout: 120000 });
    await page.locator('[data-testid="job-card"]').first().click();
    await page.locator('[data-testid="job-title"]').waitFor();
    assert(!(await page.locator('[data-testid="apply-here"]').count()), 'no apply button without the extension');
    assert(await page.locator('[data-testid="send-laptop"]').count(), 'Send to my PC is offered');
    await page.keyboard.press('Escape');
  });

  // ---- 4. with the extension
  const searchAndOpen = async (n) => {
    await tab('jobs');
    if (!(await page.locator('[data-testid="job-card"]').count())) {
      await page.fill('[data-testid="job-search"] input[aria-label="Job title"]', 'engineer');
      await page.click('[data-testid="job-search"] button[type="submit"]');
      await page.locator('[data-testid="job-card"]').first().waitFor({ timeout: 120000 });
    }
    await page.locator('[data-testid="job-card"]').nth(n).click();
  };
  await check('with the extension present the app finds it, Settings says Connected', async () => {
    await context.addInitScript(FAKE_EXTENSION);
    await page.reload({ waitUntil: 'networkidle' });
    await page.fill('[data-testid="unlock-pass"]', PASS);
    await page.click('[data-testid="unlock"]');
    await page.locator('[data-tab="more"]').waitFor({ timeout: 30000 });
    await more('settings');
    await page.locator('[data-testid="helper-status"]', { hasText: 'Connected' }).waitFor({ timeout: 8000 });
    assert((await page.locator('[data-testid="helper-status"]').textContent()).includes('9.9.9'), 'version shown');
  });
  await check('Apply in browser hands over profile, resume and answers, streams events, asks the question, records the result', async () => {
    await searchAndOpen(0);
    const btn = page.locator('[data-testid="apply-here"]');
    await btn.waitFor({ timeout: 10000 });
    assert((await btn.textContent()).includes('Apply in browser'), `button says "${await btn.textContent()}"`);
    const tClick = Date.now();
    const reqs = [];
    const onReq = (r) => reqs.push([Date.now() - tClick, r.method(), r.url().replace(BASE, '').slice(0, 60)]);
    if (process.env.AP_DEBUG) page.on('request', onReq);
    await btn.click();
    await page.getByRole('button', { name: 'Apply anyway' }).click({ timeout: 2500 }).catch(() => {});
    await page.locator('[data-testid="apply-progress"][data-phase="done"]').waitFor({ timeout: 60000 });
    const took = ((Date.now() - tClick) / 1000).toFixed(1);
    if (process.env.AP_DEBUG) { page.off('request', onReq); console.log(reqs.map((r) => r.join(' ')).join(String.fromCharCode(10))); }
    const cfg = await page.evaluate(() => window.__fakeExt.applies[0]);
    assert(cfg && cfg.mode === 'review', 'mode review');
    assert(cfg.profile.firstName === 'Ashwini' && cfg.profile.email === 'asha.rao@example.com' && cfg.profile.city === 'Hyderabad', 'profile handed over');
    assert(cfg.resume && cfg.resume.name === 'Asha-Rao-Resume.pdf' && cfg.resume.base64.length > 100, 'resume handed over under its real file name');
    assert(Array.isArray(cfg.allowedSites) && cfg.allowedSites.includes('greenhouse.io'), 'allowedSites');
    assert(cfg.canAsk === true, 'the page answers questions');
    const events = await page.locator('[data-testid="apply-events"]').innerText();
    assert(/Opened the application page/.test(events) && /Filled 12 fields/.test(events), `events: ${events.slice(0, 120)}`);
    const ans = await page.evaluate(() => window.__fakeExt.answers[0]);
    assert(ans && ans.qid === 'q1', 'the question was answered back');
    assert(/Waiting for you/.test(await page.locator('.sheet-wrap h2').first().innerText()), 'ends as "Waiting for you"');
    await page.locator('[data-testid="apply-done"]').dispatchEvent('click');
    await page.keyboard.press('Escape'); await page.waitForTimeout(500);
    return `${took}s from click to result`;
  });
  await check('the unanswered question went to the answer bank and the tracker shows the application as waiting', async () => {
    await tab('queue');
    await page.locator('[data-testid="open-questions"], [data-testid="queue-row"]').first().waitFor({ timeout: 10000 });
    await more('answers');
    await page.getByText('Why do you want to work here?').first().waitFor({ timeout: 10000 });
  });
  await check('the result is reported as soon as the form is filled (the tab stays open), and a later submission is recorded as applied', async () => {
    await page.evaluate(() => { window.__fakeExt.early = true; window.__fakeExt.hang = false; });
    await searchAndOpen(2);
    await page.locator('[data-testid="apply-here"]').click();
    await page.getByRole('button', { name: 'Apply anyway' }).click({ timeout: 2500 }).catch(() => {});
    await page.locator('[data-testid="apply-progress"][data-phase="done"]').waitFor({ timeout: 30000 });
    assert(/Waiting for you/.test(await page.locator('.sheet-wrap h2').first().innerText()), 'ends as "Waiting for you" without the tab being closed');
    await page.locator('[data-testid="apply-done"]').dispatchEvent('click');
    await page.keyboard.press('Escape'); await page.waitForTimeout(400);
    await page.evaluate(() => { const id = window.__fakeExt.lastId; window.postMessage({ apWeb: 1, dir: 'to-page', id, type: 'event', event: { type: 'submitted', message: 'Application submitted', data: { url: 'https://example.com/done' } } }, location.origin); });
    await page.waitForTimeout(1500);
    await tab('applied');
    await page.locator('main').getByText('Applied', { exact: true }).first().waitFor({ timeout: 10000 });
    await page.evaluate(() => { window.__fakeExt.early = false; window.__fakeExt.hang = true; });
  });
  await check('Stop during a run cancels it in the extension', async () => {
    await page.evaluate(() => { window.__fakeExt.hang = true; });
    await searchAndOpen(1);
    await page.locator('[data-testid="apply-here"]').click();
    await page.getByRole('button', { name: 'Apply anyway' }).click({ timeout: 2500 }).catch(() => {});
    const stop = page.getByRole('button', { name: 'Stop', exact: true }).last();
    await stop.waitFor({ timeout: 20000 });
    await stop.dispatchEvent('click');
    await page.locator('[data-testid="apply-progress"][data-phase="done"]').waitFor({ timeout: 20000 });
    assert(await page.evaluate(() => window.__fakeExt.cancels) >= 1, 'cancel message sent to the extension');
  });
  await check('no script errors on the page', async () => { assert(!errors.length, errors.slice(0, 3).join(' | ')); });

  await browser.close();
  fs.rmSync(tmp, { recursive: true, force: true });
  const bad = results.filter((r) => !r.ok);
  console.log(`\n${results.length - bad.length}/${results.length} passed in ${((Date.now() - t0) / 1000).toFixed(0)}s`);
  process.exit(bad.length ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
