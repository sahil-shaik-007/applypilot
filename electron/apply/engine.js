// ApplyPilot browser auto-apply engine.
//
//   const engine = new ApplyEngine({ userDataDir, getSettings, log });
//   await engine.applyToJob({ job, profile, resume: { path, fileName, text }, coverLetterText,
//                             mode: 'auto'|'review'|'dryrun', answerQuestion, onEvent, signal })
//     → { status: 'submitted'|'filled-awaiting-user'|'needs-attention'|'failed', message,
//         filledCount, unanswered: [{question, required}], screenshotPath, url }
//   await engine.isAvailable() → { ok, channel, path, error }
//   await engine.openUrl(url)  → opens a tab in the shared browser profile (e.g. to log in)
//   await engine.close()
//
// One persistent browser context (the user's installed Edge/Chrome, separate profile folder)
// is shared by all applications so logins persist; each application gets its own tab and a
// semaphore bounds the number of tabs being automated concurrently.
//
// Safety: the engine never logs in, never touches CAPTCHAs, and only ever calls an adapter's
// submit() in mode 'auto' for allow-listed ATSs with every required question answered. In mode
// 'dryrun' submit() is unreachable, form submit events are cancelled in the page and
// non-GET network requests (other than file uploads) are aborted.

'use strict';

const fs = require('fs');
const path = require('path');
const dom = require('./dom');

const ADAPTERS = {
  greenhouse: require('./adapters/greenhouse'),
  lever: require('./adapters/lever'),
  ashby: require('./adapters/ashby'),
  workable: require('./adapters/workable'),
  smartrecruiters: require('./adapters/smartrecruiters'),
  recruitee: require('./adapters/recruitee'),
  generic: require('./adapters/generic'),
};
const AUTO_SUBMIT_ATS = new Set(['greenhouse', 'lever', 'ashby', 'workable', 'smartrecruiters', 'recruitee']);
const ASSISTED_ATS = new Set(['linkedin', 'indeed', 'naukri', 'glassdoor', 'workday']);
const WATCH_TIMEOUT_MS = 30 * 60 * 1000;
const CONFIRM_WAIT_MS = 45 * 1000;

const DEFAULT_SETTINGS = { browserChannel: 'msedge', browserPath: '', headless: false, maxParallelBrowsers: 3, slowMo: 0, humanDelays: true };

const BROWSER_PATHS = {
  msedge: [
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'Microsoft\\Edge\\Application\\msedge.exe'),
    '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
    '/usr/bin/microsoft-edge', '/usr/bin/microsoft-edge-stable', '/opt/microsoft/msedge/msedge',
  ],
  chrome: [
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'Google\\Chrome\\Application\\chrome.exe'),
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable',
  ],
};

function loadPlaywright() {
  // playwright-core is asar-unpacked in packaged builds; plain require works in both cases.
  return require('playwright-core');
}

class Semaphore {
  constructor(n) { this.n = Math.max(1, n | 0); this.active = 0; this.queue = []; }
  setLimit(n) { this.n = Math.max(1, n | 0); this._drain(); }
  acquire(signal) {
    return new Promise((resolve, reject) => {
      if (signal && signal.aborted) return reject(abortError());
      const entry = { resolve, reject };
      if (signal) {
        entry.onAbort = () => { const i = this.queue.indexOf(entry); if (i >= 0) { this.queue.splice(i, 1); reject(abortError()); } };
        signal.addEventListener('abort', entry.onAbort, { once: true });
      }
      this.queue.push(entry);
      this._drain();
    });
  }
  _drain() {
    while (this.active < this.n && this.queue.length) {
      const e = this.queue.shift();
      this.active++;
      let released = false;
      e.resolve(() => { if (!released) { released = true; this.active--; this._drain(); } });
    }
  }
}

function abortError() { const e = new Error('Aborted'); e.code = 'ABORTED'; return e; }
const safeName = (s) => String(s || 'job').replace(/[^a-z0-9._-]+/gi, '_').slice(0, 80);

class ApplyEngine {
  constructor({ userDataDir, getSettings, log } = {}) {
    this.userDataDir = userDataDir || path.join(process.cwd(), '.applypilot');
    this.getSettings = typeof getSettings === 'function' ? getSettings : () => ({});
    this.log = typeof log === 'function' ? log : () => {};
    this._context = null;
    this._launching = null;
    this._sem = new Semaphore(this._settings().maxParallelBrowsers);
    this._closed = false;
  }

  _settings() {
    let s = {};
    try { s = this.getSettings() || {}; } catch { s = {}; }
    return { ...DEFAULT_SETTINGS, ...Object.fromEntries(Object.entries(s).filter(([, v]) => v !== undefined && v !== null)) };
  }

  _resolveExecutable(s = this._settings()) {
    if (s.browserChannel === 'custom') {
      return s.browserPath && fs.existsSync(s.browserPath) ? s.browserPath : null;
    }
    const list = (BROWSER_PATHS[s.browserChannel] || BROWSER_PATHS.msedge).filter(Boolean);
    return list.find((p) => { try { return fs.existsSync(p); } catch { return false; } }) || null;
  }

  async isAvailable() {
    const s = this._settings();
    const channel = s.browserChannel || 'msedge';
    try {
      loadPlaywright();
    } catch (e) {
      return { ok: false, channel, error: `playwright-core is not available: ${e.message}` };
    }
    const exe = this._resolveExecutable(s);
    if (!exe) {
      const name = channel === 'chrome' ? 'Google Chrome' : channel === 'custom' ? 'the custom browser' : 'Microsoft Edge';
      return { ok: false, channel, error: channel === 'custom' ? `Browser not found at "${s.browserPath || '(empty path)'}"` : `${name} was not found on this computer` };
    }
    return { ok: true, channel, path: exe };
  }

  async _ensureContext() {
    if (this._context) {
      try { this._context.pages(); return this._context; } catch { this._context = null; }
    }
    if (this._launching) return this._launching;
    this._launching = (async () => {
      const { chromium } = loadPlaywright();
      const s = this._settings();
      this._sem.setLimit(s.maxParallelBrowsers);
      const profileDir = path.join(this.userDataDir, 'browser-profile');
      fs.mkdirSync(profileDir, { recursive: true });
      const base = {
        headless: !!s.headless,
        viewport: null,
        slowMo: Number(s.slowMo) || 0,
        args: ['--start-maximized', '--disable-blink-features=AutomationControlled', '--no-first-run', '--no-default-browser-check'],
        ignoreDefaultArgs: ['--enable-automation'],
        acceptDownloads: false,
      };
      const exe = this._resolveExecutable(s);
      const attempts = [];
      if (s.browserChannel === 'custom') attempts.push({ executablePath: s.browserPath });
      else {
        attempts.push({ channel: s.browserChannel === 'chrome' ? 'chrome' : 'msedge' });
        if (exe) attempts.push({ executablePath: exe });
      }
      let lastErr;
      for (const a of attempts) {
        try {
          const ctx = await chromium.launchPersistentContext(profileDir, { ...base, ...a });
          ctx.on('close', () => { if (this._context === ctx) this._context = null; });
          this.log(`[apply] browser launched (${a.channel || a.executablePath})`);
          return ctx;
        } catch (e) {
          lastErr = e;
          this.log(`[apply] launch failed (${a.channel || a.executablePath}): ${String(e.message).split('\n')[0]}`);
        }
      }
      const msg = String(lastErr && lastErr.message || 'unknown error');
      if (/ProcessSingleton|user data directory is already in use|lock/i.test(msg)) {
        throw new Error('The ApplyPilot browser profile is already in use by another browser window. Close it and retry.');
      }
      throw new Error(`Could not launch the browser: ${msg.split('\n')[0]}`);
    })();
    try {
      this._context = await this._launching;
      return this._context;
    } finally {
      this._launching = null;
    }
  }

  async openUrl(url) {
    const ctx = await this._ensureContext();
    const page = await ctx.newPage();
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 }).catch((e) => this.log(`[apply] openUrl: ${e.message}`));
    await page.bringToFront().catch(() => {});
    return true;
  }

  async close() {
    this._closed = true;
    const c = this._context;
    this._context = null;
    if (c) await c.close().catch(() => {});
  }

  pickAdapter(job, url) {
    const ats = job && job.ats;
    if (ats && ADAPTERS[ats]) return ADAPTERS[ats];
    if (ats && ASSISTED_ATS.has(ats)) return ADAPTERS.generic;
    for (const id of ['greenhouse', 'lever', 'ashby', 'workable', 'smartrecruiters', 'recruitee']) {
      if (ADAPTERS[id].match(job || {}, url || '')) return ADAPTERS[id];
    }
    return ADAPTERS.generic;
  }

  async applyToJob(opts = {}) {
    const { job = {}, profile = {}, resume = {}, coverLetterText = null, answerQuestion = null, onEvent = null, signal = null } = opts;
    const mode = ['auto', 'review', 'dryrun'].includes(opts.mode) ? opts.mode : 'review';
    const settings = this._settings();
    const result = { status: 'failed', message: '', filledCount: 0, unanswered: [], screenshotPath: null, url: job.applyUrl || job.url || '' };
    const emit = (type, message, data) => {
      try { if (onEvent) onEvent({ type, message, data: data || null, jobId: job.id || null, at: Date.now() }); } catch { /* UI errors never break the run */ }
    };
    const log = (m) => { try { this.log(`[apply ${job.id || ''}] ${m}`); } catch { /* */ } };

    let release = null;
    let page = null;
    let keepOpen = false;
    let onAbort = null;
    try {
      if (!job.applyUrl && !job.url) throw new Error('Job has no apply URL');
      emit('step', 'Waiting for a free browser slot');
      release = await this._sem.acquire(signal);
      if (signal && signal.aborted) throw abortError();

      emit('step', 'Opening browser');
      const context = await this._ensureContext();
      page = await context.newPage();
      onAbort = () => { if (page) page.close().catch(() => {}); };
      if (signal) signal.addEventListener('abort', onAbort, { once: true });

      if (mode === 'dryrun') await installDryRunGuards(page, log);

      const startUrl = job.applyUrl || job.url;
      const adapter = this.pickAdapter(job, startUrl);
      const atsKey = job.ats || (adapter.id !== 'generic' ? adapter.id : null);
      const assisted = adapter.id === 'generic' || !AUTO_SUBMIT_ATS.has(adapter.id) || (atsKey && ASSISTED_ATS.has(atsKey));
      const target = adapter.resolveUrl ? adapter.resolveUrl(job) : startUrl;
      result.url = target;

      const ctx = {
        job, profile, resume, coverLetterText, answerQuestion, signal, settings, mode, page,
        human: settings.humanDelays !== false && mode !== 'dryrun',
        allowSubmit: false,
        emit, log,
      };

      emit('step', `Opening ${adapter.id === 'generic' ? 'application page' : adapter.id + ' form'}`, { url: target });
      await page.goto(target, { waitUntil: 'domcontentloaded', timeout: 60000 });
      await page.waitForLoadState('networkidle', { timeout: 8000 }).catch(() => {});
      throwIfAborted(signal);
      await dom.rejectCookies(page); // most privacy-preserving choice only
      if (adapter.prepare) await adapter.prepare(page, ctx);
      result.url = page.url();
      throwIfAborted(signal);

      // Sign-in walls: never log in on the user's behalf.
      if (await looksLikeLoginWall(page)) {
        emit('needs-user', 'This site needs you to sign in. Please log in in the browser window; ApplyPilot will not enter credentials.');
      }

      let captcha = await dom.detectCaptcha(page);
      if (captcha) {
        emit('captcha', `A ${captcha.kind} challenge is shown — please complete it in the browser.`, captcha);
        if (mode !== 'dryrun' && !settings.headless) {
          // Never solve it ourselves: wait for the user to clear it, then carry on filling.
          await page.bringToFront().catch(() => {});
          const end = Date.now() + 5 * 60 * 1000;
          while (Date.now() < end && !page.isClosed() && await dom.detectCaptcha(page)) {
            throwIfAborted(signal);
            await dom.sleep(2000);
          }
          if (page.isClosed()) throw new Error('Tab was closed while waiting for the CAPTCHA');
          if (!(await dom.detectCaptcha(page))) {
            emit('step', 'Challenge cleared — continuing');
            captcha = null;
            await page.waitForLoadState('domcontentloaded').catch(() => {});
            if (adapter.prepare) await adapter.prepare(page, ctx).catch(() => {});
          }
        }
      }

      emit('step', 'Filling the application form');
      // Watchdog: a slow or stuck page must never hold a browser slot forever.
      const FILL_TIMEOUT_MS = opts.fillTimeoutMs || 180000;
      let fillTimer;
      const fill = await Promise.race([
        adapter.fill(page, ctx),
        new Promise((resolve) => { fillTimer = setTimeout(() => { emit('step', 'Form is taking too long to fill — handing it to you'); resolve({ filledCount: 0, unanswered: [], timedOut: true }); }, FILL_TIMEOUT_MS); }),
      ]).finally(() => clearTimeout(fillTimer));
      if (fill.timedOut) result.message = 'Filling took too long';
      throwIfAborted(signal);
      result.filledCount = fill.filledCount || 0;
      result.unanswered = fill.unanswered || [];
      const requiredMissing = result.unanswered.filter((u) => u.required);
      emit('step', `Filled ${result.filledCount} field(s); ${result.unanswered.length} unanswered (${requiredMissing.length} required)`, { filledCount: result.filledCount, unanswered: result.unanswered });

      result.screenshotPath = await this._screenshot(page, job, mode === 'dryrun' ? 'dryrun' : 'filled');

      // ---------------- dry run: never submit ----------------
      if (mode === 'dryrun') {
        result.status = requiredMissing.length ? 'needs-attention' : 'filled-awaiting-user';
        result.message = `Dry run: filled ${result.filledCount} field(s), ${requiredMissing.length} required question(s) unanswered. Nothing was submitted.`;
        return result;
      }

      captcha = captcha || await dom.detectCaptcha(page);
      const canAuto = mode === 'auto' && !assisted && !fill.timedOut && adapter.autoSubmit && AUTO_SUBMIT_ATS.has(adapter.id); // a timed-out fill is never submitted

      // Optional last-chance hook (e.g. a cancel window): returning false turns this into a review hand-off.
      let proceed = true;
      if (canAuto && !requiredMissing.length && !captcha && typeof opts.beforeSubmit === 'function') {
        try { proceed = (await opts.beforeSubmit({ filledCount: result.filledCount, screenshotPath: result.screenshotPath })) !== false; } catch { proceed = false; }
        throwIfAborted(signal);
      }
      if (canAuto && !requiredMissing.length && !captcha && !proceed) {
        emit('needs-user', 'Auto-submit was held — review the filled form and submit it yourself.', { unanswered: result.unanswered });
      } else if (canAuto && !requiredMissing.length && !captcha) {
        emit('step', 'Submitting application');
        ctx.allowSubmit = true;
        let clicked = false;
        try { clicked = await adapter.submit(page, ctx); } finally { ctx.allowSubmit = false; }
        if (!clicked) {
          emit('needs-user', 'Could not find the submit button — please submit manually.');
        } else {
          const outcome = await this._waitForOutcome(page, adapter, signal, CONFIRM_WAIT_MS);
          if (outcome === 'submitted') {
            result.status = 'submitted';
            result.message = 'Application submitted.';
            result.screenshotPath = (await this._screenshot(page, job, 'confirmation')) || result.screenshotPath;
            emit('submitted', 'Application submitted', { url: page.url() });
            return result;
          }
          if (outcome === 'captcha') emit('captcha', 'A CAPTCHA appeared after submitting — please complete it in the browser.');
          else {
            const errs = await dom.visibleErrors(await dom.bestFormFrame(page));
            emit('needs-user', errs.length ? `The form reported problems: ${errs.slice(0, 3).join(' | ')}` : 'No confirmation detected — please check the form and submit it.', { errors: errs });
          }
        }
      } else if (mode === 'auto' && !assisted && requiredMissing.length) {
        emit('needs-user', `${requiredMissing.length} required question(s) need your answer — please complete and submit in the browser.`, { unanswered: requiredMissing });
      } else if (assisted) {
        emit('needs-user', 'This site is assisted-only: review the pre-filled form and submit it yourself.', { unanswered: result.unanswered });
      } else {
        emit('needs-user', result.filledCount ? 'Form filled — review it and click submit in the browser.' : 'Could not find an application form to fill on this page — please apply in the browser tab that opened.', { unanswered: result.unanswered });
      }

      // ---------------- review / assisted: hand over to the user and watch -------------
      keepOpen = true;
      if (release) { release(); release = null; } // free the slot while the user works
      await page.bringToFront().catch(() => {});
      const outcome = await this._watchForUser(page, adapter, signal, WATCH_TIMEOUT_MS);
      if (outcome === 'submitted') {
        result.status = 'submitted';
        result.message = 'Application submitted (confirmed in browser).';
        result.screenshotPath = (await this._screenshot(page, job, 'confirmation')) || result.screenshotPath;
        emit('submitted', 'Application submitted', { url: page.url() });
        keepOpen = false;
      } else if (outcome === 'aborted') {
        throw abortError();
      } else {
        const needs = requiredMissing.length > 0;
        result.status = needs && mode === 'auto' ? 'needs-attention' : 'filled-awaiting-user';
        result.message = outcome === 'closed' ? 'Tab was closed before a confirmation was seen.' : 'Waiting for you to submit (timed out watching for a confirmation).';
        keepOpen = outcome === 'timeout';
      }
      return result;
    } catch (e) {
      if (e && (e.code === 'ABORTED' || (signal && signal.aborted))) {
        result.status = 'failed';
        result.message = 'Cancelled.';
        keepOpen = false;
      } else {
        result.status = 'failed';
        result.message = String((e && e.message) || e).split('\n')[0];
        log(`error: ${e && e.stack ? e.stack : e}`);
        emit('error', result.message);
        if (page && !page.isClosed()) {
          result.screenshotPath = (await this._screenshot(page, job, 'error')) || result.screenshotPath;
          // leave the tab for the user in interactive modes so they can finish by hand
          keepOpen = mode !== 'dryrun' && result.filledCount > 0;
          if (keepOpen) result.status = 'needs-attention';
        }
      }
      return result;
    } finally {
      if (signal && onAbort) signal.removeEventListener('abort', onAbort);
      if (release) release();
      if (page && !keepOpen) await page.close().catch(() => {});
    }
  }

  async _screenshot(page, job, suffix) {
    try {
      if (!page || page.isClosed()) return null;
      const dir = path.join(this.userDataDir, 'screenshots');
      fs.mkdirSync(dir, { recursive: true });
      const p = path.join(dir, `${safeName(job.id || job.externalId || job.title)}${suffix && suffix !== 'filled' ? '-' + suffix : ''}.png`);
      await page.screenshot({ path: p, fullPage: true, timeout: 20000 }).catch(async () => page.screenshot({ path: p, timeout: 10000 }));
      return fs.existsSync(p) ? p : null;
    } catch { return null; }
  }

  async _waitForOutcome(page, adapter, signal, ms) {
    const end = Date.now() + ms;
    while (Date.now() < end) {
      if (signal && signal.aborted) return 'aborted';
      if (page.isClosed()) return 'closed';
      if (await adapter.isConfirmation(page).catch(() => false)) return 'submitted';
      if (await dom.detectCaptcha(page)) return 'captcha';
      await dom.sleep(1000);
    }
    return 'timeout';
  }

  async _watchForUser(page, adapter, signal, ms) {
    const end = Date.now() + ms;
    while (Date.now() < end) {
      if (signal && signal.aborted) return 'aborted';
      if (page.isClosed()) return 'closed';
      if (await adapter.isConfirmation(page).catch(() => false)) return 'submitted';
      await dom.sleep(2000);
    }
    return 'timeout';
  }
}

function throwIfAborted(signal) { if (signal && signal.aborted) throw abortError(); }

async function looksLikeLoginWall(page) {
  try {
    const u = page.url();
    if (/\/(login|signin|sign-in|uas\/login|authwall|checkpoint)/i.test(u)) return true;
    return await page.evaluate(() => {
      const pw = [...document.querySelectorAll('input[type=password]')].some((e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0; });
      const formish = document.querySelectorAll('input:not([type=hidden]),textarea,select').length;
      return pw && formish < 8;
    });
  } catch { return false; }
}

// Dry-run safety net (in addition to submit() never being called):
//  * cancel every form "submit" event in the page,
//  * abort non-GET requests except file uploads (and abort anything mentioning submit/apply).
async function installDryRunGuards(page, log) {
  await page.addInitScript(() => {
    const block = (e) => { e.preventDefault(); e.stopImmediatePropagation(); console.warn('[ApplyPilot dry-run] blocked form submit'); };
    window.addEventListener('submit', block, true);
    try { HTMLFormElement.prototype.submit = function () { console.warn('[ApplyPilot dry-run] blocked form.submit()'); }; } catch { /* */ }
    try { HTMLFormElement.prototype.requestSubmit = function () { console.warn('[ApplyPilot dry-run] blocked form.requestSubmit()'); }; } catch { /* */ }
  });
  await page.route('**/*', (route) => {
    const req = route.request();
    const method = req.method();
    if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') return route.continue();
    const url = req.url();
    let body = '';
    try { body = (req.postData() || '').slice(0, 4000); } catch { body = '[binary]'; }
    const submitish = /submit/i.test(`${url} ${body}`) || /createapplication|\/apply\/?(\?|$)|\/applications?\/?(\?|$)/i.test(url);
    // Read-only GraphQL queries (Ashby loads its form this way) are harmless.
    const gqlOps = [...body.matchAll(/"query"\s*:\s*"\s*(query|mutation)\b/g)].map((m) => m[1]);
    const gqlReadOnly = gqlOps.length > 0 && gqlOps.every((o) => o === 'query');
    // Bot-protection / captcha infrastructure checks must work or the page breaks; they submit nothing.
    const infra = /\/cdn-cgi\/(challenge-platform|rum)\b|hcaptcha\.com\/(checksiteconfig|getcaptcha)|google\.com\/recaptcha|recaptcha\.net|challenges\.cloudflare\.com/i.test(url);
    const op = (/"operationName"\s*:\s*"([^"]+)"/.exec(body) || [])[1] || (/[?&]op=([^&]+)/.exec(url) || [])[1];
    if (gqlReadOnly || infra) return route.continue();
    const uploadish = /upload|presign|s3[.-]|amazonaws|storage\.googleapis|filestack|\/files?\b|resume/i.test(url) || /upload|presign|file/i.test(op || '');
    if (uploadish && !/submit/i.test(`${url} ${op || ''}`)) return route.continue();
    log(`[dry-run] blocked ${method} ${url.split('?')[0]}${op ? ` op=${op}` : ''}${submitish ? ' (submit-like)' : ''}`);
    return route.abort('blockedbyclient');
  });
}

module.exports = { ApplyEngine, ADAPTERS, AUTO_SUBMIT_ATS };
