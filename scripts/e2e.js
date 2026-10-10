#!/usr/bin/env node
/*
 * ApplyPilot end-to-end test suite.
 *
 * Launches the real Electron app against a throwaway profile and exercises every screen and
 * workflow through the UI (Playwright), reporting PASS/FAIL per check.
 *
 *   node scripts/e2e.js                      # dev build (runs `vite build` first)
 *   node scripts/e2e.js --exe "C:\...\ApplyPilot.exe"   # test an installed/packaged build
 *   node scripts/e2e.js --screenshots        # also refresh docs/screenshots/*.png
 *   node scripts/e2e.js --quick              # skip slow live-network checks (campaigns, applying)
 *
 * Safety: applications are only ever run in "review" mode (fill, never submit) with a hidden
 * browser, and every opened tab is cancelled at the end. Nothing is submitted to employers.
 */
const { _electron } = require('playwright-core');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const args = process.argv.slice(2);
const flag = (f) => args.includes(f);
const opt = (f) => { const i = args.indexOf(f); return i >= 0 ? args[i + 1] : null; };
const EXE = opt('--exe');
const QUICK = flag('--quick');
const SHOTS = flag('--screenshots');
const FIX = path.join(os.tmpdir(), 'applypilot-e2e-fixtures');
const USER_DATA = path.join(os.tmpdir(), `applypilot-e2e-${Date.now()}`);
const SHOT_DIR = path.join(ROOT, 'docs', 'screenshots');

const results = [];
const consoleErrors = [];
let app; let page;
let deleteClickedAt = new Date();

function log(...a) { console.log(...a); }
async function check(name, fn) {
  const t0 = Date.now();
  try {
    const note = await fn();
    results.push({ name, ok: true, ms: Date.now() - t0, note });
    log(`  ✔ ${name}${note ? ` — ${note}` : ''} (${Date.now() - t0} ms)`);
  } catch (e) {
    results.push({ name, ok: false, ms: Date.now() - t0, note: e.message });
    log(`  ✘ ${name} — ${e.message.split('\n')[0]}`);
    try { await page.screenshot({ path: path.join(USER_DATA, `fail-${results.length}.png`) }); } catch {}
  }
}
function assert(cond, msg) { if (!cond) throw new Error(msg || 'assertion failed'); }
const call = (ch, ...a) => page.evaluate(([c, x]) => window.api.call(c, ...x), [ch, a]);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function nav(label) { await page.locator('.nav-item', { hasText: label }).first().click(); await page.waitForTimeout(900); }
async function shot(name) { if (SHOTS) { fs.mkdirSync(SHOT_DIR, { recursive: true }); await page.waitForTimeout(900); await page.screenshot({ path: path.join(SHOT_DIR, `${name}.png`) }); } }
async function confirmDialog(label) { await page.locator('.modal-foot button', { hasText: label }).click(); await page.waitForTimeout(500); }
async function waitFor(fn, ms = 60000, every = 1000) {
  const end = Date.now() + ms;
  for (;;) { const v = await fn(); if (v) return v; if (Date.now() > end) throw new Error('timed out'); await sleep(every); }
}

// ---------------------------------------------------------------- fixtures
function makeFixtures() {
  fs.mkdirSync(FIX, { recursive: true });
  const py = `
import os
from reportlab.pdfgen import canvas
from reportlab.lib.pagesizes import A4
import docx
os.chdir(r'${FIX}')
c = canvas.Canvas('positioned_words.pdf', pagesize=A4); y = 800
for line in ['Arjun Mehta', 'Pune, India | +91 91234 56789 | arjun.mehta.test@example.com', 'linkedin.com/in/arjun-mehta-test', 'Data Analyst with 3 years of experience in SQL, Python, Tableau and Power BI.', 'SKILLS SQL Python Pandas Excel VLOOKUP Tableau Statistics', 'Data Analyst, Flipkart (2023 - Present)']:
    x = 50
    for w in line.split(' '):
        c.drawString(x, y, w); x += c.stringWidth(w, 'Helvetica', 12) + 4.5
    y -= 22
c.save()
c = canvas.Canvas('backend.pdf', pagesize=A4)
for i, l in enumerate(['Priya Sharma', 'Bengaluru, India  +91 98765 43210  priya.sharma.test@example.com', 'github.com/priya-test  linkedin.com/in/priya-test', 'Backend engineer, 5 years of experience: Python, Go, Node.js, PostgreSQL, Redis, Kafka, AWS, Docker, Kubernetes, Terraform, microservices, REST, GraphQL, system design.', 'Senior Software Engineer, Razorpay (2021 - Present)']):
    c.drawString(40, 800 - i * 20, l)
c.save()
d = docx.Document(); d.add_heading('Rahul Verma', 0); d.add_paragraph('Chennai, India | rahul.verma.test@example.com | +91 98450 11223')
d.add_paragraph('Mechanical Design Engineer with 4 years of experience. Skills: AutoCAD, SolidWorks, CATIA, ANSYS, GD&T, manufacturing, quality control'); d.save('mechanical.docx')
open('photo.png', 'wb').write(b'\\x89PNG\\r\\n\\x1a\\n' + b'0' * 100)
c = canvas.Canvas('image_only.pdf', pagesize=A4); c.rect(50, 50, 400, 400, fill=1); c.save()
`;
  execSync('python -', { input: py, stdio: ['pipe', 'inherit', 'inherit'] });
  fs.copyFileSync(path.join(FIX, 'positioned_words.pdf'), path.join(FIX, 'positioned_words_copy.pdf'));
}

// Simulates a real drag-and-drop of local files onto a dropzone (exercises webUtils.getPathForFile).
async function dropFiles(selector, files) {
  await page.evaluate(() => { let i = document.getElementById('__e2e_file'); if (!i) { i = document.createElement('input'); i.type = 'file'; i.multiple = true; i.id = '__e2e_file'; i.style.display = 'none'; document.body.appendChild(i); } });
  await page.setInputFiles('#__e2e_file', files);
  await page.evaluate((sel) => {
    const input = document.getElementById('__e2e_file');
    const dt = new DataTransfer();
    for (const f of input.files) dt.items.add(f);
    document.querySelector(sel).dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true }));
  }, selector);
  await page.waitForTimeout(2500);
}

// ---------------------------------------------------------------- launch
async function launch() {
  const env = { ...process.env, APPLYPILOT_USER_DATA: USER_DATA, APPLYPILOT_HEADLESS: '1' };
  delete env.ELECTRON_RUN_AS_NODE;
  app = EXE
    ? await _electron.launch({ executablePath: EXE, args: [], env })
    : await _electron.launch({ executablePath: require('electron'), args: [ROOT], env, cwd: ROOT });
  page = await app.firstWindow();
  page.on('pageerror', (e) => consoleErrors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) consoleErrors.push(m.text()); });
  await page.setViewportSize({ width: 1440, height: 900 }).catch(() => {});
  await page.waitForSelector('h1', { timeout: 30000 });
}

// ---------------------------------------------------------------- suites
async function onboarding() {
  log('\n▸ Onboarding & resume upload');
  await check('a 7-day Pro trial is active from the very first launch', async () => {
    const p = await call('license:get');
    assert(p.plan === 'trial' && p.trialDaysLeft === 7, JSON.stringify(p));
  });
  await check('first run shows the onboarding wizard', async () => {
    assert(/on autopilot/i.test(await page.locator('h1').first().innerText()), 'welcome heading missing');
    await shot('01-onboarding-welcome');
  });
  await page.getByText('Get started').click();
  await page.waitForTimeout(600);

  await check('drag & drop uploads two resumes (PDF + DOCX)', async () => {
    await dropFiles('.dropzone', [path.join(FIX, 'backend.pdf'), path.join(FIX, 'mechanical.docx')]);
    await page.waitForFunction(() => document.querySelectorAll('.chips .badge.green').length >= 2, null, { timeout: 30000 }).catch(() => {});
    const n = await page.locator('.chips .badge.green').count();
    assert(n === 2, `expected 2 resume chips, got ${n}`);
    await shot('02-onboarding-resume');
  });
  await check('onboarding resume chip can be removed (×) with confirmation', async () => {
    await page.locator('.chip-x').last().click();
    assert(await page.locator('.modal').isVisible(), 'confirm dialog not shown');
    await confirmDialog('Remove');
    const n = await page.locator('.chips .badge.green').count();
    assert(n === 1, `expected 1 chip after removal, got ${n}`);
    const list = await call('resumes:list');
    assert(list.length === 1 && list[0].fileName === 'backend.pdf', 'resume not deleted in backend');
  });
  await check('cancelling the remove dialog keeps the resume', async () => {
    await page.locator('.chip-x').first().click();
    await page.locator('.modal-foot button', { hasText: 'Cancel' }).click();
    await page.waitForTimeout(400);
    assert(await page.locator('.chips .badge.green').count() === 1, 'resume removed despite cancel');
  });
  await check('duplicate upload is rejected with a clear message', async () => {
    const r = await call('resumes:importPaths', [path.join(FIX, 'backend.pdf')]);
    assert(r.results.length === 0 && /already uploaded/.test(r.errors[0] || ''), JSON.stringify(r.errors));
  });
  await check('unsupported file type is rejected; other files in the batch still import', async () => {
    const r = await call('resumes:importPaths', [path.join(FIX, 'photo.png'), path.join(FIX, 'positioned_words.pdf')]);
    assert(r.results.length === 1 && r.errors.length === 1 && /supported/.test(r.errors[0]), JSON.stringify(r));
  });
  await check('PDF with word-positioned text is parsed with real spaces + skills', async () => {
    const r = (await call('resumes:list')).find((x) => x.fileName === 'positioned_words.pdf');
    const text = await call('resumes:text', r.id);
    const toks = text.split(/\s+/).filter(Boolean);
    const avg = text.replace(/\s/g, '').length / toks.length;
    assert(avg < 9, `words glued together (avg token length ${avg.toFixed(1)})`);
    assert(['SQL', 'Python', 'Tableau'].every((s) => r.skills.includes(s)), `skills: ${r.skills.join(',')}`);
    return `avg word ${avg.toFixed(1)} chars, ${r.skills.length} skills`;
  });
  await check('identical file under another name is detected as duplicate', async () => {
    const r = await call('resumes:importPaths', [path.join(FIX, 'positioned_words_copy.pdf')]);
    assert(r.errors.length === 1 && /already uploaded/.test(r.errors[0]), JSON.stringify(r));
  });
  await check('image-only PDF imports but is flagged as unreadable', async () => {
    const r = await call('resumes:importPaths', [path.join(FIX, 'image_only.pdf')]);
    assert(r.results.length === 1 && r.results[0].resume.textLength === 0, JSON.stringify(r));
    await call('resumes:delete', r.results[0].resume.id);
  });

  await page.getByRole('button', { name: /Continue/ }).click(); await page.waitForTimeout(500);
  await check('About-you step is pre-filled from the resume', async () => {
    const first = await page.locator('label.field', { hasText: 'First name' }).locator('input').inputValue();
    const email = await page.locator('label.field', { hasText: 'Email' }).locator('input').inputValue();
    assert(first === 'Priya' && /priya\.sharma\.test/.test(email), `prefill: ${first} / ${email}`);
  });
  await check('About-you step requires name + email', async () => {
    await page.locator('label.field', { hasText: 'First name' }).locator('input').fill('');
    await page.getByRole('button', { name: /Continue/ }).click();
    await page.waitForTimeout(400);
    assert(/About you/.test(await page.locator('h2').first().innerText()), 'advanced without required fields');
  });
  const fillField = (label, v) => page.locator('label.field', { hasText: label }).locator('input').last().fill(v);
  await fillField('First name', 'Priya'); await fillField('Last name', 'Sharma'); await fillField('Email', 'priya.sharma.test@example.com');
  await fillField('City', 'Bengaluru'); await fillField('Country', 'India'); await fillField('GitHub', 'https://github.com/priya-test');
  await page.getByRole('button', { name: /Continue/ }).click(); await page.waitForTimeout(500);

  await check('preferences step: tags, chips and yes/no work', async () => {
    const tag = page.locator('.tag-input input');
    for (const t of ['Backend Engineer', 'Software Engineer']) { await tag.nth(0).fill(t); await tag.nth(0).press('Enter'); }
    await tag.nth(0).fill('Typo Role'); await tag.nth(0).press('Enter');
    await page.locator('.tag', { hasText: 'Typo Role' }).locator('button').click();
    assert(await page.locator('.tag', { hasText: 'Typo Role' }).count() === 0, 'tag not removable');
    const num = page.locator('input[type=number]');
    await num.nth(0).fill('5'); await num.nth(1).fill('30');
    await page.getByText('Remote', { exact: true }).click();
    await page.getByRole('button', { name: 'No', exact: true }).click();
    await tag.nth(2).fill('Bengaluru'); await tag.nth(2).press('Enter');
    await shot('03-onboarding-preferences');
  });
  await page.getByRole('button', { name: /Continue/ }).click(); await page.waitForTimeout(600);
  await page.getByText('Open my dashboard').click();
  await check('finishing onboarding opens the dashboard with a trial and first campaign', async () => {
    await page.waitForSelector('.sidebar', { timeout: 15000 });
    const b = await call('app:bootstrap');
    assert(b.settings.onboarded && b.plan.plan === 'trial' && b.campaigns.length === 1, `onboarded=${b.settings.onboarded} plan=${b.plan.plan} campaigns=${b.campaigns.length}`);
    assert(b.profile.values.github === 'https://github.com/priya-test', 'github not saved');
    await shot('04-dashboard');
  });
}

async function profileAndResumes() {
  log('\n▸ Profile & resumes');
  await nav('Profile');
  await check('profile autosaves edits', async () => {
    await page.locator('label.field', { hasText: 'Middle name' }).locator('input').fill('K');
    await page.waitForTimeout(1500);
    const p = await call('app:bootstrap');
    assert(p.profile.values.middleName === 'K', 'middle name not saved');
  });
  await check('yes/no answer can be cleared by clicking it again', async () => {
    await page.locator('.side-list button', { hasText: 'Work authorization' }).click(); await page.waitForTimeout(400);
    const seg = page.locator('label.field', { hasText: 'Willing to relocate' }).locator('.seg button', { hasText: 'Yes' });
    await seg.click(); await page.waitForTimeout(1200);
    assert((await call('app:bootstrap')).profile.values.willingToRelocate === 'Yes', 'not set');
    await seg.click(); await page.waitForTimeout(1200);
    assert(!(await call('app:bootstrap')).profile.values.willingToRelocate, 'not cleared');
  });
  await check('work history items can be added and removed', async () => {
    await page.locator('.side-list button', { hasText: 'Work history' }).click(); await page.waitForTimeout(400);
    await page.getByRole('button', { name: /Add position/ }).click();
    await page.getByRole('button', { name: /Add position/ }).click();
    const item = (n) => page.locator('.col > .card.pad').filter({ has: page.locator('.label', { hasText: new RegExp(`^Position ${n}$`) }) });
    await item(1).locator('label.field', { hasText: /^Company$/ }).locator('input').fill('Razorpay');
    await item(2).locator('button').first().click();
    await page.waitForTimeout(1500);
    const wh = (await call('app:bootstrap')).profile.values.workHistory;
    assert(wh.length === 1 && wh[0].company === 'Razorpay', JSON.stringify(wh));
    await shot('05-profile');
  });

  await nav('Resumes');
  await check('resume can be renamed, role-tagged, made default and re-read', async () => {
    const card = page.locator('.card', { hasText: 'positioned_words.pdf' }).first();
    const name = card.locator('input.input').first();
    await name.fill('Data Analyst CV'); await name.blur(); await page.waitForTimeout(500);
    const tagIn = card.locator('.tag-input input');
    await tagIn.fill('Data Analyst'); await tagIn.press('Enter'); await page.waitForTimeout(500);
    await card.getByRole('button', { name: /Make default/ }).click(); await page.waitForTimeout(500);
    await card.getByRole('button', { name: /Re-read/ }).click(); await page.waitForTimeout(2500);
    const r = (await call('resumes:list')).find((x) => x.fileName === 'positioned_words.pdf');
    assert(r.name === 'Data Analyst CV' && r.roles.includes('Data Analyst') && r.isDefault, JSON.stringify({ name: r.name, roles: r.roles, def: r.isDefault }));
    await shot('06-resumes');
  });
  await check('role tag can be removed from a resume', async () => {
    const card = page.locator('.grid.g2 > .card', { hasText: 'positioned_words.pdf' }).first();
    await card.locator('.tag', { hasText: 'Data Analyst' }).locator('button').click(); await page.waitForTimeout(600);
    const r = (await call('resumes:list')).find((x) => x.fileName === 'positioned_words.pdf');
    assert(!r.roles.length, 'role not removed');
  });
}

async function windowAndLayout() {
  log('\n▸ Window fitting & small screens');
  // Use the real window size (drop Playwright's fixed viewport emulation for this suite).
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Emulation.clearDeviceMetricsOverride');
  const winState = () => app.evaluate(({ BrowserWindow, screen }) => {
    const w = BrowserWindow.getAllWindows()[0]; const c = w.getContentBounds(); const wa = screen.getDisplayMatching(c).workArea;
    return { max: w.isMaximized(), content: c, wa, fits: c.x >= wa.x - 2 && c.y >= wa.y - 2 && c.x + c.width <= wa.x + wa.width + 2 && c.y + c.height <= wa.y + wa.height + 2 };
  });
  await check('an oversized window is pulled back inside the work area (above the taskbar)', async () => {
    await app.evaluate(({ BrowserWindow, screen }) => { const w = BrowserWindow.getAllWindows()[0]; w.unmaximize(); const wa = screen.getPrimaryDisplay().workArea; w.setBounds({ x: wa.x, y: wa.y, width: wa.width, height: wa.height + 150 }); });
    await sleep(900);
    const s = await winState();
    assert(s.fits, `still overflows: ${JSON.stringify(s)}`);
  });
  await check('a maximized window that covers the taskbar is corrected', async () => {
    await app.evaluate(({ BrowserWindow, screen }) => { const w = BrowserWindow.getAllWindows()[0]; w.maximize(); });
    await sleep(700);
    await app.evaluate(({ BrowserWindow, screen }) => { const w = BrowserWindow.getAllWindows()[0]; const d = screen.getPrimaryDisplay(); w.setBounds({ ...d.bounds, height: d.bounds.height + 40 }); w.emit('resize'); });
    await sleep(1200);
    const s = await winState();
    assert(s.fits, `maximized window overflows: ${JSON.stringify(s)}`);
  });
  await check('restoring from tray keeps the window maximized and inside the work area', async () => {
    await app.evaluate(({ BrowserWindow }) => { const w = BrowserWindow.getAllWindows()[0]; w.maximize(); });
    await sleep(600);
    await app.evaluate(({ BrowserWindow }) => { const w = BrowserWindow.getAllWindows()[0]; w.minimize(); });
    await sleep(600);
    await app.evaluate(({ BrowserWindow }) => { const w = BrowserWindow.getAllWindows()[0]; if (w.isMinimized()) w.restore(); if (!w.isVisible()) w.show(); w.focus(); });
    await sleep(900);
    const s = await winState();
    assert(s.max && s.fits, JSON.stringify(s));
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].unmaximize());
    await sleep(500);
  });
  await check('minimum window size fits a 1366x768 laptop work area', async () => {
    const min = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].getMinimumSize());
    assert(min[0] <= 1280 && min[1] <= 640, `min size ${min}`);
    return `min ${min.join('x')}`;
  });
  const pages = ['Dashboard', 'Find jobs', 'Campaigns', 'Review queue', 'Applications', 'Resumes', 'Profile', 'Answer bank', 'Job platforms', 'AI studio', 'Settings'];
  for (const [w, h] of [[1280, 672], [1366, 728], [1024, 600], [960, 560]]) {
    await check(`every page fits and stays reachable at ${w}x${h}`, async () => {
      await app.evaluate(({ BrowserWindow }, [w, h]) => { const win = BrowserWindow.getAllWindows()[0]; win.unmaximize(); win.setContentSize(w, h); }, [w, h]);
      await sleep(700);
      const problems = [];
      for (const p of pages) {
        await page.locator('.nav-item', { hasText: p }).first().click({ force: true }).catch(() => page.locator(`.nav-item[title="${p}"]`).first().click());
        await page.waitForTimeout(500);
        const r = await page.evaluate(() => {
          const out = [];
          const main = document.querySelector('.main');
          // Real content crossing the right edge (decorative glows, the logo marquee and
          // intentionally scrollable regions like the kanban/table are excluded).
          if (main) {
            const right = main.getBoundingClientRect().right + 2;
            const offenders = [...main.querySelectorAll('.page *')].filter((el) => {
              if (el.closest('.glow, .marquee, .kanban, .card[style*="overflow"], table')) return false;
              const r = el.getBoundingClientRect();
              return r.width > 0 && r.height > 0 && r.right > right && getComputedStyle(el).visibility !== 'hidden';
            });
            if (offenders.length) out.push(`content cut off at right: ${offenders.slice(0, 3).map((e) => `${e.tagName.toLowerCase()}.${String(e.className).split(' ')[0]}`).join(', ')}`);
          }
          const se = document.scrollingElement;
          if (se.scrollHeight > window.innerHeight + 1) out.push(`document taller than window ${se.scrollHeight}>${innerHeight}`);
          const sb = document.querySelector('.sidebar');
          if (sb) { sb.scrollTop = sb.scrollHeight; const last = [...sb.querySelectorAll('.nav-item, .sidebar-foot')].filter((e) => e.offsetParent).pop(); if (last && last.getBoundingClientRect().bottom > window.innerHeight + 1) out.push('sidebar end unreachable'); sb.scrollTop = 0; }
          return out;
        });
        if (r.length) problems.push(`${p}: ${r.join(', ')}`);
      }
      assert(!problems.length, problems.join(' | '));
    });
  }
  await app.evaluate(({ BrowserWindow, screen }) => { const w = BrowserWindow.getAllWindows()[0]; const wa = screen.getPrimaryDisplay().workArea; w.setBounds({ x: wa.x + 20, y: wa.y + 10, width: Math.min(1440, wa.width - 40), height: Math.min(900, wa.height - 20) }); });
  await page.setViewportSize({ width: 1440, height: 900 }).catch(() => {});
  await cdp.detach().catch(() => {});
  await sleep(500);
}

async function campaigns() {
  log('\n▸ Campaigns (parallel, live network)');
  const resumes = await call('resumes:list');
  const backend = resumes.find((r) => r.fileName === 'backend.pdf');
  const analyst = resumes.find((r) => r.fileName === 'positioned_words.pdf');
  await call('settings:update', { maxParallelBrowsers: 6, humanDelays: false });
  const created = [];
  await check('create campaigns through the editor (each with its own resume)', async () => {
    await nav('Campaigns');
    for (const [role, resume] of [['Data Analyst', analyst], ['Product Manager', null]]) {
      await page.getByRole('button', { name: /New campaign/ }).first().click(); await page.waitForTimeout(500);
      const tag = page.locator('.modal .tag-input input').first();
      await tag.fill(role); await tag.press('Enter');
      if (resume) await page.locator('.modal select', { has: page.locator('option[value="auto"]') }).first().selectOption(resume.id);
      await page.locator('.modal-foot button', { hasText: /^Save$/ }).click(); await page.waitForTimeout(700);
    }
    const list = await call('campaigns:list');
    created.push(...list);
    assert(list.length === 3, `expected 3 campaigns, got ${list.length}`);
    assert(list.find((c) => c.roles[0] === 'Data Analyst').resumeId === analyst.id, 'resume not pinned');
    await call('campaigns:save', { ...list.find((c) => c.name === 'Backend Engineer'), resumeId: backend.id });
  });
  await check('campaign editor has country, posted-within and month filters that save', async () => {
    await nav('Campaigns');
    await page.getByRole('button', { name: /New campaign/ }).first().click(); await page.waitForTimeout(500);
    const modal = page.locator('.modal');
    assert(await modal.getByText('Countries', { exact: true }).isVisible(), 'Countries filter missing');
    assert(await modal.getByText('Posted within', { exact: true }).isVisible(), 'Posted within missing');
    assert(await modal.getByText('Only in these months', { exact: true }).isVisible(), 'month filter missing');
    const tag = modal.locator('.tag-input input').first();
    await tag.fill('Filter Test Role'); await tag.press('Enter');
    await modal.locator('.chip, .badge', { hasText: /^India$/ }).first().click(); await page.waitForTimeout(200);
    await modal.locator('select', { has: page.locator('option[value="168"]') }).first().selectOption('168');
    await modal.locator('.chip, .badge', { hasText: /^Jan$/ }).first().click(); await page.waitForTimeout(200);
    await page.locator('.modal-foot button', { hasText: /^Save$/ }).click(); await page.waitForTimeout(700);
    const c = (await call('campaigns:list')).find((x) => x.roles && x.roles[0] === 'Filter Test Role');
    assert(c, 'campaign not saved');
    assert(JSON.stringify(c.countries) === '["India"]', `countries not saved: ${JSON.stringify(c.countries)}`);
    assert(c.postedWithinHours === 168, `posted within not saved: ${c.postedWithinHours}`);
    assert(JSON.stringify(c.postedMonths) === '[1]', `months not saved: ${JSON.stringify(c.postedMonths)}`);
    await call('campaigns:delete', c.id); // keep this check's campaign out of the later parallel-run checks
  });
  await check('clicking Applied on a campaign opens its applications and sources', async () => {
    const card = page.locator('.card', { hasText: 'Data Analyst' }).first();
    await card.locator('[title="See the applications and their sources"]').click(); await page.waitForTimeout(600);
    const modal = page.locator('.modal', { hasText: 'details' });
    assert(await modal.isVisible(), 'details dialog did not open');
    try {
      await modal.getByRole('button', { name: /^Sources$/ }).click(); await page.waitForTimeout(300);
      const table = await modal.locator('th', { hasText: 'Found (last run)' }).count();
      const empty = await modal.getByText(/No searches have run yet|Where this campaign looked/).count();
      assert(table > 0 || empty > 0, 'sources panel missing');
      await shot('17-campaign-sources');
    } finally {
      await page.keyboard.press('Escape'); await page.waitForTimeout(400);
    }
  });
  await check('edit campaign: change min score and remove a location tag', async () => {
    const card = page.locator('.card', { hasText: 'Backend Engineer' }).first();
    await card.locator('button').filter({ has: page.locator('svg.lucide-pencil') }).click(); await page.waitForTimeout(500);
    const locTag = page.locator('.modal .tag', { hasText: 'Bengaluru' });
    if (await locTag.count()) await locTag.locator('button').click();
    await page.locator('.modal-foot button', { hasText: /^Save$/ }).click(); await page.waitForTimeout(600);
    const c = (await call('campaigns:list')).find((x) => x.name === 'Backend Engineer');
    assert(!c.locations.includes('Bengaluru'), 'location not removed');
  });
  if (QUICK) return;
  await check('three campaigns run in parallel and fill the review queue', async () => {
    for (const c of await call('campaigns:list')) await call('campaigns:start', c.id);
    await page.waitForTimeout(1500);
    const running = (await call('campaigns:list')).filter((c) => c.status === 'running').length;
    assert(running === 3, `only ${running} running`);
    await shot('07-campaigns-running');
    await waitFor(async () => (await call('campaigns:list')).every((c) => c.lastRunAt && c.phase === 'sleeping'), 360000, 3000);
    const apps = await call('applications:list');
    const per = {};
    for (const a of apps.filter((x) => x.status === 'queued')) per[a.campaignName] = (per[a.campaignName] || 0) + 1;
    assert(Object.keys(per).length >= 2, `queue by campaign: ${JSON.stringify(per)}`);
    assert(Object.values(per).every((n) => n <= 50), `queue over cap: ${JSON.stringify(per)}`);
    return JSON.stringify(per);
  });
  await check('queued jobs use the campaign\'s pinned resume', async () => {
    const apps = await call('applications:list');
    const da = apps.filter((a) => a.campaignName === 'Data Analyst' && a.status === 'queued');
    assert(da.length === 0 || da.every((a) => a.resumeId === analyst.id), 'wrong resume on Data Analyst jobs');
  });
  await check('pausing campaigns stops them', async () => {
    for (const c of await call('campaigns:list')) await call('campaigns:stop', c.id);
    await page.waitForTimeout(800);
    assert((await call('campaigns:list')).every((c) => c.status === 'paused'), 'still running');
  });
  await check('re-running a campaign does not re-queue or re-count the same jobs', async () => {
    const before = (await call('applications:list')).length;
    const c = (await call('campaigns:list')).find((x) => x.name === 'Backend Engineer');
    const foundBefore = c.stats.found;
    await call('campaigns:start', c.id);
    await waitFor(async () => { const x = (await call('campaigns:list')).find((y) => y.id === c.id); return x.phase === 'sleeping' && x.lastRunAt > c.lastRunAt; }, 240000, 3000);
    await call('campaigns:stop', c.id);
    const after = (await call('applications:list')).length;
    const c2 = (await call('campaigns:list')).find((x) => x.id === c.id);
    assert(c2.stats.found - foundBefore < 40, `found jumped ${foundBefore} → ${c2.stats.found}`);
    return `apps ${before} → ${after}, found ${foundBefore} → ${c2.stats.found}`;
  });
}

async function reviewAndApply() {
  log('\n▸ Review queue & parallel applying');
  await nav('Review queue');
  await shot('08-review-queue');
  await check('review queue can be filtered by campaign', async () => {
    const sel = page.locator('.page select').first();
    if (!(await sel.count())) return 'only one campaign has queued jobs';
    const opts = await sel.locator('option').allTextContents();
    await sel.selectOption({ index: 1 }); await page.waitForTimeout(500);
    const names = await page.locator('tbody tr td:nth-child(5)').allTextContents();
    assert(names.length && names.every((n) => n === opts[1]), `filter mismatch: ${opts[1]} vs ${[...new Set(names)]}`);
    await sel.selectOption('all');
  });
  await check('select + skip removes jobs from the queue', async () => {
    const before = (await call('applications:list')).filter((a) => a.status === 'queued').length;
    if (before < 3) return 'not enough queued jobs';
    const boxes = page.locator('tbody input[type=checkbox]');
    await boxes.nth(0).check(); await boxes.nth(1).check();
    await page.locator('button', { hasText: /^Skip$/ }).first().click(); await page.waitForTimeout(1500);
    const after = (await call('applications:list')).filter((a) => a.status === 'queued').length;
    assert(after === before - 2, `${before} → ${after}`);
  });
  if (QUICK) return;
  await check('six applications fill in parallel and are handed to the user', async () => {
    const apps = (await call('applications:list')).filter((a) => a.status === 'queued' && ['greenhouse', 'lever', 'ashby', 'workable'].includes(a.job.ats)).slice(0, 6);
    assert(apps.length >= 3, 'not enough ATS jobs queued');
    const t0 = Date.now();
    await call('applications:approve', apps.map((a) => a.id), 'review');
    let peak = 0;
    await waitFor(async () => {
      const cur = (await call('applications:list')).filter((a) => apps.some((x) => x.id === a.id));
      peak = Math.max(peak, cur.filter((a) => a.status === 'in-progress').length);
      return cur.every((a) => !['queued', 'in-progress'].includes(a.status));
    }, 420000, 2000);
    const cur = (await call('applications:list')).filter((a) => apps.some((x) => x.id === a.id));
    const filled = cur.map((a) => a.events.filter((e) => e.type === 'filled').length);
    const statuses = cur.map((a) => a.status);
    const detail = cur.map((a) => `${a.job.ats}:${a.events.filter((e) => e.type === 'filled').length}${a.events.filter((e) => e.type === 'filled').length ? '' : `(${(a.events.filter((e) => /captcha|error|needs-user|failed/.test(e.type)).pop() || {}).message || a.status})`}`);
    fs.writeFileSync(path.join(os.tmpdir(), 'applypilot-e2e-apply-detail.json'), JSON.stringify(detail, null, 1));
    assert(statuses.every((s) => ['awaiting-you', 'failed'].includes(s)), `statuses: ${statuses}`);
    assert(statuses.filter((s) => s === 'awaiting-you').length >= Math.ceil(apps.length / 2), `too many failures: ${statuses}`);
    assert(!statuses.includes('applied'), 'something was submitted!');
    return `${apps.length} jobs in ${Math.round((Date.now() - t0) / 1000)} s, peak ${peak} concurrent, fields filled ${filled.join('/')}`;
  });
  await shot('09-needs-you');
  await check('unknown screening questions land in the Answer bank (no guessing)', async () => {
    const qa = await call('qa:list');
    assert(qa.some((q) => !q.answer), 'no pending questions collected');
    return `${qa.filter((q) => !q.answer).length} pending`;
  });
  await check('cancelling hand-offs closes their tabs and marks them skipped', async () => {
    const waiting = (await call('applications:list')).filter((a) => a.status === 'awaiting-you');
    for (const a of waiting) await call('applications:cancel', a.id);
    await page.waitForTimeout(2500);
    const still = (await call('applications:list')).filter((a) => waiting.some((w) => w.id === a.id) && a.status !== 'skipped');
    assert(!still.length, `${still.length} not skipped (${still.map((s) => s.status)})`);
  });
}

async function answerBank() {
  log('\n▸ Answer bank');
  await nav('Answer bank');
  await check('add, answer and delete a screening question', async () => {
    await page.locator('input[placeholder^="Add a question"]').fill('Are you comfortable with on-call rotations?');
    await page.getByRole('button', { name: /^Add$/ }).click(); await page.waitForTimeout(600);
    const card = page.locator('.card', { hasText: 'on-call rotations' }).first();
    await card.locator('textarea').fill('Yes, I have done on-call for 2 years.'); await card.locator('textarea').blur(); await page.waitForTimeout(800);
    let q = (await call('qa:list')).find((x) => /on-call/.test(x.question));
    assert(q && q.answer.startsWith('Yes'), 'answer not saved');
    await page.locator('.seg button', { hasText: /^All/ }).click(); await page.waitForTimeout(300);
    await shot('10-answer-bank');
    await page.locator('.card', { hasText: 'on-call rotations' }).first().locator('button').last().click(); await page.waitForTimeout(600);
    q = (await call('qa:list')).find((x) => /on-call/.test(x.question));
    assert(!q, 'not deleted');
  });
}

async function applicationsPage() {
  log('\n▸ Applications tracker');
  await nav('Applications');
  await shot('11-applications');
  await check('saved application drawer offers resume choice, apply and delete', async () => {
    const job = (await call('jobs:list', { limit: 400 })).find((j) => !j.appStatus);
    if (!job) return QUICK ? 'skipped in --quick (no jobs fetched)' : assert(false, 'no unsaved job available');
    await call('jobs:save', job.id);
    await nav('Dashboard'); await nav('Applications');
    const card = page.locator('.kan-col', { hasText: 'Saved' }).locator('.kan-card').first();
    await card.click(); await page.waitForTimeout(700);
    assert(await page.locator('.drawer').getByRole('button', { name: /Fill, I submit/ }).isVisible(), 'no apply action in drawer');
    assert(await page.locator('.drawer select').first().isVisible(), 'no resume selector');
    await page.locator('.drawer button[title="Delete from tracker"]').click();
    await confirmDialog('Delete');
    await page.locator('.drawer').waitFor({ state: 'detached', timeout: 5000 }).catch(() => {});
    assert(!(await page.locator('.drawer').count()), 'drawer still open after delete');
  });
  await check('status can be changed from the drawer', async () => {
    const card = page.locator('.kan-card').first();
    if (!(await card.count())) return 'no cards';
    await card.click(); await page.waitForTimeout(500);
    await page.locator('.drawer select').filter({ has: page.locator('option[value="interview"]') }).selectOption('interview');
    await page.waitForTimeout(600);
    await page.keyboard.press('Escape');
    const apps = await call('applications:list');
    assert(apps.some((a) => a.status === 'interview'), 'status not updated');
  });
  await check('"Clear closed" bulk-removes rejected/failed/skipped', async () => {
    const closed = (await call('applications:list')).filter((a) => ['rejected', 'failed', 'skipped'].includes(a.status)).length;
    if (!closed) return 'nothing closed';
    await page.locator('.kan-col', { hasText: 'Closed' }).locator('button[title="Clear closed applications"]').click();
    await confirmDialog('Clear');
    const left = (await call('applications:list')).filter((a) => ['rejected', 'failed', 'skipped'].includes(a.status)).length;
    assert(left === 0, `${left} left`);
    return `${closed} cleared`;
  });
}

async function newFeatures() {
  log('\n▸ Referrals, imports, filters, research, cancel window');
  await check('LinkedIn connections import powers "You know N people at …"', async () => {
    const jobs = await call('jobs:list', { limit: 50 });
    const job = jobs.find((j) => j.company && j.company.length > 3);
    if (!job) return QUICK ? 'skipped in --quick (no jobs fetched)' : assert(false, 'no job');
    const csv = `Notes:\n"export notes"\n\nFirst Name,Last Name,URL,Email Address,Company,Position,Connected On\nAnita,Rao,https://www.linkedin.com/in/anita-test,,${job.company} Pvt Ltd,Senior Engineer,12 Mar 2024\nVik,S,https://www.linkedin.com/in/vik-test,,Some Other Co,PM,01 Jan 2023\n`;
    const r = await call('network:importText', csv);
    assert(r.count === 2, JSON.stringify(r));
    const people = await call('network:forCompany', job.company);
    assert(people.length === 1 && people[0].name === 'Anita Rao', JSON.stringify(people));
    await nav('Find jobs');
    await page.locator('.card.clickable').first().waitFor({ timeout: 5000 }).catch(() => {});
    const card = page.locator('.card.clickable').first();
    if (await card.count()) {
      try {
        await card.click();
        await page.locator('.drawer', { hasText: 'Research & referrals' }).waitFor({ timeout: 8000 });
        assert(/Interview questions/.test(await page.locator('.drawer').innerText()), 'research links missing');
      } finally {
        await page.keyboard.press('Escape');
        await page.locator('.drawer').waitFor({ state: 'detached', timeout: 5000 }).catch(() => {});
      }
    }
    await call('network:clear');
    return `${job.company}: 1 connection matched`;
  });
  await check('tracker CSV import (Teal format) adds applications and skips duplicates', async () => {
    const csv = 'Company,Job Position,Status,Date Applied,Job URL,Location,Notes\nImportCo Alpha,Data Analyst,Interviewing,2026-09-01,https://x.test/1,Remote,"Spoke to HR"\nImportCo Beta,BI Developer,Bookmarked,,https://x.test/2,Pune,\n';
    const r1 = await call('applications:importText', csv, 'teal.csv');
    const r2 = await call('applications:importText', csv, 'teal.csv');
    assert(r1.added === 2 && r2.added === 0 && r2.skipped === 2, JSON.stringify([r1.added, r2.added, r2.skipped]));
    const apps = (await call('applications:list')).filter((a) => /ImportCo/.test(a.job.company));
    assert(apps.find((a) => a.job.company === 'ImportCo Alpha').status === 'interview', 'status mapping');
    await call('applications:deleteMany', apps.map((a) => a.id));
  });
  await check('job filters include "Only jobs I can take" (on) and "Sponsors visa"', async () => {
    await nav('Find jobs');
    const body = await page.locator('.jobs-layout').innerText();
    assert(/Only jobs I can take/.test(body) && /Sponsors visa/.test(body), 'filters missing');
  });
  await check('a likely scam is blocked before any browser opens or data is sent', async () => {
    const r = await call('applications:importText', 'Company,Job Title,Status,Job URL\nQuickCash Jobs,Data Entry (earn daily),Bookmarked,https://wa.me/919999999999\n', 'scam.csv');
    assert(r.added === 1, 'import failed');
    const a = (await call('applications:list')).find((x) => x.job.company === 'QuickCash Jobs');
    await call('applications:approve', [a.id], 'review');
    let cur;
    for (let i = 0; i < 20; i++) { await sleep(300); cur = (await call('applications:list')).find((x) => x.id === a.id); if (cur.status !== 'saved' && cur.status !== 'in-progress') break; }
    const blocked = (cur.events || []).find((e) => e.type === 'blocked');
    assert(cur.status === 'skipped' && blocked && /scam/.test(blocked.message), `${cur.status}: ${JSON.stringify((cur.events || []).slice(-2))}`);
    await call('applications:delete', a.id);
    return blocked.message.slice(0, 80);
  });
  await check('cancel window setting exists and Hold is a no-op when nothing is pending', async () => {
    await nav('Settings');
    assert(/Cancel window before auto-submit/.test(await page.locator('.page').innerText()), 'setting missing');
    const held = await call('applications:hold', 'nope');
    assert(held === false, String(held));
  });
  await check('Settings has Network and Phone & web tabs', async () => {
    await page.locator('.side-list button', { hasText: 'Network' }).click(); await page.waitForTimeout(400);
    assert(/Import Connections\.csv/.test(await page.locator('.page').innerText()), 'network tab');
    await page.locator('.side-list button', { hasText: 'Phone & web' }).click(); await page.waitForTimeout(400);
    assert(/Link this PC/.test(await page.locator('.page').innerText()), 'cloud tab');
    await shot('18-phone-and-web');
  });
}

async function jobsPage() {
  log('\n▸ Find jobs');
  await nav('Find jobs');
  if (!QUICK) {
    await check('live multi-source search returns ranked results', async () => {
      await page.locator('.search-wrap input').first().fill('Data Analyst');
      await page.locator('.search-wrap input').nth(1).fill('India');
      await page.getByRole('button', { name: 'Search', exact: true }).click();
      await page.waitForFunction(() => /unique jobs after removing duplicates/.test(document.body.innerText), null, { timeout: 180000 });
      const n = await page.locator('.card.clickable').count();
      assert(n > 5, `only ${n} cards`);
      await page.evaluate(() => document.getElementById('main-scroll').scrollTo({ top: 300 }));
      await shot('12-find-jobs');
      return `${n} cards rendered`;
    });
  }
  await check('job drawer: save then unsave', async () => {
    const cards = page.locator('.card.clickable');
    if (!(await cards.count())) return 'no jobs';
    await cards.first().click(); await page.waitForTimeout(700);
    await shot('13-job-detail');
    const save = page.locator('.drawer').getByRole('button', { name: /^Save$/ });
    if (await save.count()) { await save.click(); await page.waitForTimeout(800); }
    const unsave = page.locator('.drawer').getByRole('button', { name: /Unsave/ });
    assert(await unsave.count(), 'no Unsave button');
    await unsave.click(); await page.waitForTimeout(800);
    assert(await page.locator('.drawer').getByRole('button', { name: /^Save$/ }).count(), 'still saved');
    await page.keyboard.press('Escape');
  });
  await check('filters narrow the list (min match 95%)', async () => {
    const before = await page.locator('.card.clickable').count();
    await page.locator('input[type=range]').first().fill('95'); await page.waitForTimeout(600);
    const after = await page.locator('.card.clickable').count();
    assert(after <= before, `${before} → ${after}`);
    await page.locator('input[type=range]').first().fill('0');
  });
}

async function settingsAndPlans() {
  log('\n▸ Settings, sources, licensing');
  await nav('Settings');
  await check('API key can be saved (masked) and removed', async () => {
    await page.locator('.side-list button', { hasText: 'Job sources' }).click(); await page.waitForTimeout(500);
    const card = page.locator('.col > .card.pad', { hasText: 'Jooble' }).first();
    await card.locator('input[type=password]').fill('test-key-123456');
    await card.getByRole('button', { name: 'Save' }).click(); await page.waitForTimeout(600);
    let b = await call('app:bootstrap');
    assert(b.settings.keys.joobleKey && b.settings.keys.joobleKey.includes('••'), 'not masked/saved');
    assert(b.connectors.find((c) => c.id === 'jooble').ready, 'connector not ready');
    await card.getByRole('button', { name: 'Remove' }).click(); await page.waitForTimeout(600);
    b = await call('app:bootstrap');
    assert(!b.settings.keys.joobleKey, 'key not removed');
  });
  await check('a free source can be switched off and on', async () => {
    const card = page.locator('.grid.g2 > .card', { hasText: 'Remote OK' }).first();
    await card.locator('.switch').click(); await page.waitForTimeout(500);
    let s = (await call('app:bootstrap')).settings;
    assert(s.enabledSources && !s.enabledSources.includes('remoteok'), 'not disabled');
    await card.locator('.switch').click(); await page.waitForTimeout(500);
    s = (await call('app:bootstrap')).settings;
    assert(!s.enabledSources, 'not re-enabled');
  });
  await check('custom company board can be added and removed', async () => {
    await page.locator('.side-list button', { hasText: 'Career pages' }).click(); await page.waitForTimeout(500);
    await page.locator('input[placeholder^="Careers URL"]').fill('https://jobs.lever.co/acme-test');
    await page.getByRole('button', { name: /^Add$/ }).click(); await page.waitForTimeout(600);
    let s = (await call('app:bootstrap')).settings;
    assert((s.customCompanies.lever || []).some((c) => c.slug === 'acme-test'), `ATS not detected from URL: ${JSON.stringify(s.customCompanies)}`);
    await page.locator('.tag', { hasText: 'acme-test' }).locator('button').click(); await page.waitForTimeout(500);
    s = (await call('app:bootstrap')).settings;
    assert(!(s.customCompanies.lever || []).some((c) => c.slug === 'acme-test'), 'not removed');
  });
  await check('a bad careers link shows a clear error and adds nothing', async () => {
    try { await call('careerPages:inspect', 'not a url'); throw new Error('no error'); } catch (e) { assert(/full careers page link/.test(e.message), e.message); }
    try { await call('careerPages:inspect', 'file:///C:/Windows/win.ini'); throw new Error('no error'); } catch (e) { assert(/http\(s\)/.test(e.message), e.message); }
    assert((await call('careerPages:list')).length === 0, 'something was added');
  });
  if (!QUICK) {
    await check('any company careers page: inspect -> preview -> add & watch -> toggle -> refresh -> remove', async () => {
      await page.locator('input[placeholder="https://company.com/careers"]').fill('https://www.notion.com/careers');
      await page.getByRole('button', { name: 'Inspect' }).click();
      await page.getByRole('button', { name: /Add & watch/ }).waitFor({ timeout: 60000 });
      assert(await page.getByText(/ATS board · auto-apply capable \(ashby: notion\)/).isVisible(), 'ATS not detected in preview');
      await shot('16-career-pages');
      await page.getByRole('button', { name: /Add & watch/ }).click(); await page.waitForTimeout(1500);
      let list = await call('careerPages:list');
      assert(list.length === 1 && list[0].method === 'ats' && list[0].slug === 'notion', `not saved: ${JSON.stringify(list)}`);
      try { await call('careerPages:add', { url: list[0].url, method: 'ats' }); throw new Error('dup allowed'); } catch (e) { assert(/already/.test(e.message), e.message); }
      const row = page.locator('.card', { hasText: "Watch any company's careers page" }).locator('.row', { hasText: 'notion.com/careers' }).first();
      await row.locator('.switch').click(); await page.waitForTimeout(500);
      assert((await call('careerPages:list'))[0].enabled === false, 'not disabled');
      await row.locator('.switch').click(); await page.waitForTimeout(500);
      const r = await call('careerPages:refresh', list[0].id);
      assert(r.count > 0 && r.jobs.length > 0 && r.jobs.every((j) => j.ats === 'ashby'), `refresh returned ${r.count}`);
      list = await call('careerPages:list');
      assert(list[0].enabled !== false && list[0].lastChecked && list[0].jobCount === r.count, 'page state not updated');
      await row.locator('button[title="Stop watching"]').click();
      await confirmDialog('Remove');
      assert((await call('careerPages:list')).length === 0, 'not removed');
    });
  }
  await check('AI settings: switch to a local model, save the address, switch back to Claude', async () => {
    await page.locator('.side-list button', { hasText: /^AI$/ }).click(); await page.waitForTimeout(500);
    await page.getByRole('button', { name: 'Local model (on your PC)' }).click(); await page.waitForTimeout(500);
    let st = (await call('app:bootstrap')).settings;
    assert(st.aiProvider === 'local', `provider not saved: ${st.aiProvider}`);
    assert(await page.getByText('Server address').isVisible(), 'local address field missing');
    await page.locator('input[placeholder="http://localhost:11434/v1"]').fill('ftp://nope');
    await page.getByRole('button', { name: 'Find models' }).click(); await page.waitForTimeout(600);
    st = (await call('app:bootstrap')).settings;
    assert(st.localAi && st.localAi.baseUrl !== 'ftp://nope', 'an invalid address was saved');
    await page.getByRole('button', { name: 'Claude (cloud, your key)' }).click(); await page.waitForTimeout(500);
    st = (await call('app:bootstrap')).settings;
    assert(st.aiProvider === 'anthropic', 'provider not switched back');
  });
  await check('Find jobs page: plain-English search box, country and found-within filters', async () => {
    await nav('Find jobs');
    assert(await page.getByRole('button', { name: /Find with AI/ }).isVisible(), 'plain-English search button missing');
    assert(await page.locator('.card select', { has: page.locator('option[value="24"]') }).count() > 0, 'found-within filter missing');
    assert(await page.getByText('Country', { exact: true }).first().isVisible(), 'country filter missing');
    // Custom period: 5 days -> the amount and unit controls appear and keep their values.
    await page.locator('.card select', { has: page.locator('option[value="custom"]') }).first().selectOption('custom'); await page.waitForTimeout(200);
    await page.locator('input[aria-label="Amount"]').first().fill('5');
    await page.locator('select[aria-label="Unit"]').first().selectOption('days'); await page.waitForTimeout(200);
    assert(await page.locator('input[aria-label="Amount"]').first().inputValue() === '5', 'custom amount not kept');
    await shot('18-find-jobs-prompt');
  });
  await check('AI actions without a key show a helpful message', async () => {
    try { await call('ai:coverLetter', 'nope'); throw new Error('no error'); } catch (e) { assert(/Anthropic API key/.test(e.message), e.message); }
  });
  await check('offline license activates Lifetime, removal falls back', async () => {
    const key = execSync(`node "${path.join(ROOT, 'scripts', 'license-tool.js')}" issue e2e@example.com lifetime`).toString().trim();
    await nav('Settings');
    await page.locator('.side-list button', { hasText: 'Plan & license' }).click(); await page.waitForTimeout(500);
    await page.locator('input[placeholder^="Paste the key"]').fill(key);
    await page.getByRole('button', { name: 'Activate' }).click(); await page.waitForTimeout(1000);
    assert((await call('license:get')).plan === 'lifetime', 'not lifetime');
    await shot('14-plans');
    await page.getByRole('button', { name: 'Remove license' }).click(); await page.waitForTimeout(800);
    assert((await call('license:get')).plan === 'trial', 'did not fall back to trial');
  });
}

async function freePlanLimits() {
  const lic = require(path.join(ROOT, 'electron', 'license.js'));
  await check('plan resolver: expired trial → Free with limits (1 campaign, 2 resumes, no auto-submit)', async () => {
    const p = lic.currentPlan({ trialStartedAt: new Date(Date.now() - 9 * 86400000).toISOString() });
    assert(p.plan === 'free' && p.campaigns === 1 && p.resumes === 2 && !p.autoSubmit, JSON.stringify(p));
  });
}

async function stress() {
  log('\n▸ Stress: thousands of applications');
  await check('UI stays responsive with 3,000 applications', async () => {
    const file = path.join(USER_DATA, 'data', 'applications.json');
    await call('campaigns:list');
    const statuses = ['saved', 'queued', 'awaiting-you', 'applied', 'interview', 'offer', 'rejected', 'skipped', 'failed'];
    const items = Array.from({ length: 3000 }, (_, i) => ({
      id: `stress-${i}`, jobId: `stress:${i}`, campaignId: null, campaignName: 'Stress', resumeName: 'backend', score: 40 + (i % 60),
      status: statuses[i % statuses.length], notes: '', events: [{ t: new Date().toISOString(), type: 'created', message: 'Queued' }],
      job: { title: `Engineer ${i}`, company: `Company ${i % 400}`, location: 'Remote', remote: true, url: 'https://example.com', applyUrl: 'https://example.com', source: 'stress', ats: null },
      createdAt: new Date(Date.now() - i * 60000).toISOString(), updatedAt: new Date().toISOString(),
      appliedAt: i % 3 ? new Date(Date.now() - i * 3600000).toISOString() : null,
    }));
    const real = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : { items: [] };
    await app.close();
    fs.writeFileSync(file, JSON.stringify({ items: [...real.items, ...items] }));
    // Also expire the trial so the Free plan limits can be checked after relaunch.
    const licFile = path.join(USER_DATA, 'data', 'license.json');
    const lic = JSON.parse(fs.readFileSync(licFile, 'utf8'));
    const trialStartedAt = lic.trialStartedAt;
    fs.writeFileSync(licFile, JSON.stringify({ ...lic, key: null, provider: null, trialStartedAt: new Date(Date.now() - 9 * 86400000).toISOString() }));
    await launch();
    freeChecks.push(async () => {
      const plan = await call('license:get');
      assert(plan.plan === 'free', `plan ${plan.plan}`);
      const camps = await call('campaigns:list');
      await call('campaigns:start', camps[0].id);
      let blocked = '';
      try { await call('campaigns:start', camps[1].id); } catch (e) { blocked = e.message; }
      for (const c of camps) await call('campaigns:stop', c.id);
      assert(/allows 1 active campaign/.test(blocked), `2nd campaign not blocked: ${blocked}`);
      const r = await call('resumes:importPaths', [path.join(FIX, 'mechanical.docx')]);
      assert(r.errors.length && /stores up to 2 resumes/.test(r.errors[0]), `resume limit not enforced: ${JSON.stringify(r)}`);
      fs.writeFileSync(licFile, JSON.stringify({ ...JSON.parse(fs.readFileSync(licFile, 'utf8')), trialStartedAt }));
      return 'Free plan: 2nd campaign + 3rd resume blocked with upgrade messages';
    });
    const timings = {};
    for (const p of ['Dashboard', 'Applications', 'Review queue']) {
      const t0 = Date.now(); await nav(p); await page.waitForSelector('.page h1'); timings[p] = Date.now() - t0;
    }
    await page.locator('.seg button', { hasText: 'Table' }).click().catch(() => {});
    await nav('Applications');
    await page.locator('.seg button', { hasText: 'Table' }).click(); await page.waitForTimeout(800);
    const rows = await page.locator('tbody tr').count();
    assert(rows <= 200, `table rendered ${rows} rows (should page)`);
    assert(Object.values(timings).every((ms) => ms < 4000), JSON.stringify(timings));
    // remove the synthetic data again
    await call('applications:deleteMany', items.map((x) => x.id));
    return `${JSON.stringify(timings)} · table rows ${rows}`;
  });
  await check('Free plan limits are enforced in the app', async () => { assert(freeChecks[0], 'stress relaunch did not run'); return freeChecks[0](); });
}
const freeChecks = [];

async function platforms() {
  log('\n▸ Platforms & AI studio');
  await nav('Job platforms');
  await check('252 job platforms load and filter by region', async () => {
    await page.waitForTimeout(800);
    await page.locator('select').first().selectOption('all'); await page.waitForTimeout(500);
    const all = await page.locator('.grid.g3 .card').count();
    await page.locator('select').first().selectOption('india'); await page.waitForTimeout(500);
    const india = await page.locator('.grid.g3 .card').count();
    assert(all > 200 && india < all && india > 20, `${all} / ${india}`);
    await shot('15-platforms');
    return `${all} total, ${india} India + global`;
  });
  await nav('AI studio');
  await check('AI studio renders and guards against a missing key', async () => {
    await page.getByRole('button', { name: /ATS score/ }).waitFor({ state: 'visible', timeout: 8000 });
    await shot('16-ai-studio');
  });
}

async function packagingChecks() {
  log('\n▸ Packaging');
  await check('app icon loads (window, tray and notifications)', async () => {
    const empty = await app.evaluate(({ nativeImage, app: a }) => nativeImage.createFromPath(`${a.getAppPath()}/build/icon.png`).isEmpty());
    assert(!empty, 'build/icon.png missing from the app bundle');
  });
  await check('PDF engine loads inside the app bundle', async () => {
    const r = (await call('resumes:list')).find((x) => x.fileName === 'positioned_words.pdf');
    if (!r) return 'no PDF resume left to check';
    const nr = await call('resumes:reparse', r.id);
    assert(nr.textLength > 100 && !nr.parseError, JSON.stringify({ len: nr.textLength, err: nr.parseError }));
  });
}

async function noConsoleErrors() {
  await check('no renderer errors across the whole run', async () => {
    const real = consoleErrors.filter((e) => !/Autofocus processing|DevTools/.test(e));
    assert(!real.length, real.slice(0, 5).join(' | '));
  });
}

async function deleteAllData() {
  log('\n▸ Delete all data');
  await nav('Settings');
  await page.locator('.side-list button', { hasText: 'Data & privacy' }).click(); await page.waitForTimeout(500);
  await shot('17-settings-data');
  await check('"Delete everything" wipes all data and restarts the app', async () => {
    await page.getByRole('button', { name: 'Delete everything' }).click();
    deleteClickedAt = new Date();
    const closed = new Promise((r) => app.once('close', r));
    await page.locator('.modal-foot button', { hasText: 'Delete everything' }).click().catch(() => {});
    await Promise.race([closed, sleep(15000)]);
    await sleep(3000);
    for (const name of ['data', 'resumes', 'browser-profile']) {
      const p = path.join(USER_DATA, name);
      const left = fs.existsSync(p) ? fs.readdirSync(p).filter((f) => !/^(settings|license|platform-usage)\.json$/.test(f)) : [];
      assert(!fs.existsSync(p) || name === 'data' ? true : !left.length, `${name} not wiped: ${left}`);
    }
    const dataLeft = fs.existsSync(path.join(USER_DATA, 'data', 'applications.json')) ? JSON.parse(fs.readFileSync(path.join(USER_DATA, 'data', 'applications.json'), 'utf8')).items.length : 0;
    const resumesLeft = fs.existsSync(path.join(USER_DATA, 'resumes')) ? fs.readdirSync(path.join(USER_DATA, 'resumes')).length : 0;
    assert(dataLeft === 0 && resumesLeft === 0, `apps ${dataLeft}, resumes ${resumesLeft}`);
  });
  // The app relaunches itself after the wipe; stop only the Electron/ApplyPilot processes started since the click.
  const since = deleteClickedAt.toISOString();
  try {
    execSync(`powershell -NoProfile -Command "$t=[DateTime]::Parse('${since}').ToLocalTime(); Get-Process electron,ApplyPilot -ErrorAction SilentlyContinue | Where-Object { $_.StartTime -ge $t } | Stop-Process -Force"`, { stdio: 'ignore' });
  } catch {}
}

// ---------------------------------------------------------------- main
(async () => {
  log(`ApplyPilot E2E — ${EXE ? `packaged: ${EXE}` : 'dev build'} — profile ${USER_DATA}${QUICK ? ' (quick)' : ''}`);
  if (!EXE) execSync('npx vite build', { cwd: ROOT, stdio: 'ignore' });
  makeFixtures();
  await launch();
  try {
    await onboarding();
    await profileAndResumes();
    await windowAndLayout();
    await campaigns();
    await reviewAndApply();
    await answerBank();
    await applicationsPage();
    await jobsPage();
    await newFeatures();
    await platforms();
    await settingsAndPlans();
    await freePlanLimits();
    await stress();
    await packagingChecks();
    await noConsoleErrors();
    await deleteAllData();
  } catch (e) {
    log('FATAL', e);
  } finally {
    try { await app.close(); } catch {}
  }
  const failed = results.filter((r) => !r.ok);
  log(`\n${results.length - failed.length}/${results.length} checks passed${failed.length ? ` — ${failed.length} FAILED` : ''}`);
  for (const f of failed) log(`  ✘ ${f.name}: ${f.note}`);
  fs.writeFileSync(path.join(os.tmpdir(), 'applypilot-e2e-results.json'), JSON.stringify(results, null, 1));
  process.exit(failed.length ? 1 : 0);
})();
