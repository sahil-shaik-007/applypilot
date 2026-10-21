// "Apply in browser" for the ApplyPilot web app (docs/WEB-BRIDGE.md). The web app hands one application to the extension
// through content/webapp-bridge.js; this opens the job in a NEW tab, injects the phone app's auto-fill engine into it
// (content/apply-engine.js, isolated world) and relays progress back. A port of web/client/src/native/inapp.js, with the
// WebView calls replaced by chrome.tabs / chrome.scripting.
//
// Safety (same rules as the desktop engine and the phone app):
//   - data is injected only into a tab whose real URL (never what the page claims) is on cfg.allowedSites
//   - allowSubmit only for mode 'auto' on an allow-listed ATS, once per application; the engine adds the cancel window,
//     "every required question answered" and "no CAPTCHA"
//   - the engine never touches password fields and never solves CAPTCHAs; the job page cannot see window.mobileApp
// The service worker can be stopped at any time: run state lives in chrome.storage.session, ports are re-attached by the
// content script, and only the timers (3 s auto-close, 20 s ask timeout) are memory-only.
/* global chrome, ApAts */
'use strict';

const ApWebApply = (() => {
  const MAX_RUNS = 12; // fill attempts per application (multi-step forms re-run on every page load)
  const MAX_CONCURRENT = 3;
  const RESUME_B64_MAX = 8 * 1024 * 1024;
  const PERSIST_RESUME_MAX = 2.5 * 1024 * 1024; // larger resumes stay in memory only (storage.session holds ~10 MB in total)
  const KEEP_RESULT_MS = 10 * 60 * 1000;
  const CLOSE_AFTER_SUBMIT_MS = 3000;
  const ASK_TIMEOUT_MS = 20000;

  const runs = new Map(); // String(application id) -> run state (mirrored in chrome.storage.session as apRun:<key>)
  const ports = new Map(); // key -> content-script port (memory only)
  const asks = new Map(); // `${key}:${qid}` -> { timer, question, data }
  let hydrating = null;
  let engineVer = null;

  const keyOf = (id) => String(id);
  const okId = (id) => (typeof id === 'string' && id.length > 0 && id.length <= 200) || (typeof id === 'number' && Number.isFinite(id));
  const isHttp = (u) => typeof u === 'string' && /^https?:\/\/[^\s]+$/i.test(u);

  // ---------------------------------------------------------------- persistence
  function save(st) {
    const { cfg, ...state } = st; // the (big) config is stored once, at creation
    return chrome.storage.session.set({ [`apRun:${st.key}`]: state }).catch(() => {});
  }
  async function saveCfg(st) {
    const cfg = st.cfg;
    const slim = cfg.resume && cfg.resume.base64.length > PERSIST_RESUME_MAX ? { ...cfg, resume: null } : cfg;
    await chrome.storage.session.set({ [`apCfg:${st.key}`]: slim }).catch(() => chrome.storage.session.set({ [`apCfg:${st.key}`]: { ...cfg, resume: null } }).catch(() => {}));
  }
  function forget(st) {
    runs.delete(st.key);
    chrome.storage.session.remove([`apRun:${st.key}`, `apCfg:${st.key}`]).catch(() => {});
  }
  // After a worker restart: reload the runs, drop the ones whose tab is gone, drop old finished ones.
  function hydrate() {
    if (!hydrating) {
      hydrating = (async () => {
        const all = await chrome.storage.session.get(null).catch(() => ({}));
        for (const [k, v] of Object.entries(all || {})) {
          if (!k.startsWith('apRun:') || !v || runs.has(v.key)) continue;
          runs.set(v.key, { ...v, cfg: all[`apCfg:${v.key}`] || null });
        }
        for (const st of [...runs.values()]) {
          if (st.closed) { if (Date.now() - (st.closedAt || 0) > KEEP_RESULT_MS) forget(st); continue; }
          if (!st.cfg) { await finish(st, 'The browser extension restarted and lost this application.'); continue; }
          const tab = await chrome.tabs.get(st.tabId).catch(() => null);
          if (!tab) await finish(st);
        }
      })();
    }
    return hydrating;
  }
  const byTab = (tabId) => [...runs.values()].find((r) => !r.closed && r.tabId === tabId);

  // ---------------------------------------------------------------- talking to the web app
  function toPage(st, msg) {
    const port = ports.get(st.key);
    if (!port) return false;
    try { port.postMessage({ id: st.id, ...msg }); return true; } catch { ports.delete(st.key); return false; }
  }
  const emit = (st, type, message, data) => toPage(st, { type: 'event', event: { type, message: message || '', data: data == null ? null : data, at: Date.now() } });

  // The page must be on one of these origins: the manifest's web app matches plus the addresses added in the options.
  async function trustedOrigin(sender) {
    if (!sender || sender.id !== chrome.runtime.id || !sender.tab || sender.frameId !== 0) return null;
    let origin;
    try { origin = new URL(sender.url || sender.tab.url).origin; } catch { return null; }
    const ok = new Set();
    for (const cs of chrome.runtime.getManifest().content_scripts || []) for (const p of cs.matches || []) ok.add(p.replace(/\/\*$/, ''));
    for (const o of (await chrome.storage.local.get(['webApps'])).webApps || []) ok.add(o);
    return ok.has(origin) ? origin : null;
  }
  async function engineVersion() {
    if (engineVer) return engineVer;
    try { engineVer = (/auto-fill engine (\S+?)\. Generated/.exec((await (await fetch(chrome.runtime.getURL('content/apply-engine.js'))).text()).slice(0, 200)) || [])[1] || 'unknown'; } catch { engineVer = 'unknown'; }
    return engineVer;
  }

  // ---------------------------------------------------------------- validation of what the page sends
  const str = (v, max) => (typeof v === 'string' ? v.slice(0, max) : '');
  function slimJob(j) {
    j = j && typeof j === 'object' ? j : {};
    let meta = {};
    try { if (j.atsMeta && typeof j.atsMeta === 'object' && JSON.stringify(j.atsMeta).length <= 4000) meta = JSON.parse(JSON.stringify(j.atsMeta)); } catch { /* not JSON */ }
    return {
      id: okId(j.id) ? j.id : undefined, title: str(j.title, 300), company: str(j.company, 300), location: str(j.location, 300),
      remote: typeof j.remote === 'boolean' ? j.remote : typeof j.remote === 'string' ? j.remote.slice(0, 50) : undefined,
      ats: str(j.ats, 50), atsMeta: meta, url: str(j.url, 2000), applyUrl: str(j.applyUrl, 2000), externalId: okId(j.externalId) ? j.externalId : undefined,
    };
  }
  function normAnswers(answers) {
    const list = Array.isArray(answers) ? answers : [];
    return list.filter((a) => a && typeof a === 'object' && typeof a.question === 'string' && a.question && a.answer != null && String(a.answer).trim() !== '')
      .slice(0, 500).map((a) => ({ question: a.question.slice(0, 500), answer: Array.isArray(a.answer) ? a.answer.slice(0, 50).map((x) => String(x).slice(0, 500)) : String(a.answer).slice(0, 4000) }));
  }
  function cleanProfile(p) {
    const out = {};
    for (const [k, v] of Object.entries(p && typeof p === 'object' && !Array.isArray(p) ? p : {})) if (!k.startsWith('_') && v !== undefined && typeof v !== 'function') out[k] = v;
    return out;
  }
  // Returns { cfg } or { error }.
  function sanitize(raw) {
    if (!raw || typeof raw !== 'object') return { error: 'Invalid request.' };
    const job = slimJob(raw.job);
    const profile = cleanProfile(raw.profile);
    let size = 0;
    try { size = JSON.stringify(profile).length; } catch { return { error: 'The profile could not be read.' }; }
    if (size > 1024 * 1024) return { error: 'The profile is too large to send to the extension.' };
    let resume = null;
    if (raw.resume) {
      const r = raw.resume;
      if (typeof r !== 'object' || typeof r.base64 !== 'string') return { error: 'The resume could not be read.' };
      if (r.base64.length > RESUME_B64_MAX) return { error: 'The resume is larger than 8 MB.' };
      if (r.base64.length && !/^[A-Za-z0-9+/\s]*={0,2}\s*$/.test(r.base64)) return { error: 'The resume could not be read.' };
      if (r.base64.length) resume = { name: str(r.name, 200).replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_') || 'resume.pdf', mime: str(r.mime, 100) || 'application/pdf', base64: r.base64 };
    }
    if (!Array.isArray(raw.allowedSites)) return { error: 'No allowed sites were given.' };
    return {
      cfg: {
        mode: raw.mode === 'auto' ? 'auto' : 'review', job, profile, answers: normAnswers(raw.answers), resume,
        coverLetter: typeof raw.coverLetter === 'string' && raw.coverLetter ? raw.coverLetter.slice(0, 20000) : null,
        canAsk: raw.canAsk === true, cancelWindowSec: Math.min(120, Math.max(3, Number(raw.cancelWindowSec) || 10)),
        allowedSites: [...new Set(raw.allowedSites.filter((s) => typeof s === 'string').map((s) => s.toLowerCase().trim().slice(0, 100)).filter(Boolean))].slice(0, 200),
      },
    };
  }

  // ---------------------------------------------------------------- finishing
  async function finish(st, why, cancelled) {
    if (st.closed) return;
    st.closed = true; st.closedAt = Date.now();
    for (const [k, a] of asks) if (k.startsWith(`${st.key}:`)) { clearTimeout(a.timer); asks.delete(k); }
    const s = st.summary || {};
    const out = { status: 'failed', filledCount: s.filledCount || 0, unanswered: s.unanswered || [], url: st.url, message: '' };
    const mode = st.cfg ? st.cfg.mode : 'review';
    if (st.submitted) { out.status = 'submitted'; out.message = 'Application submitted.'; }
    else if (cancelled) { out.status = 'needs-attention'; out.message = 'Cancelled.'; }
    else if (st.failed) { out.status = 'failed'; out.message = why || 'Could not open the application.'; }
    else if (!st.summary) { out.status = 'needs-attention'; out.message = why || 'Closed before the form was filled.'; }
    else if (mode === 'auto' && (s.unanswered || []).some((u) => u.required)) { out.status = 'needs-attention'; out.message = 'Required questions were left for you; nothing was submitted.'; }
    else { out.status = 'filled-awaiting-user'; out.message = why || 'Closed before a confirmation was seen.'; }
    st.result = out;
    if (!deliver(st)) await save(st); // nobody is listening yet: keep the result until the web app reattaches
  }
  function deliver(st) {
    if (!st.result || !toPage(st, { type: 'result', result: st.result })) return false;
    ports.delete(st.key);
    forget(st);
    return true;
  }
  async function closeTab(st) { try { await chrome.tabs.remove(st.tabId); } catch { /* already closed */ } }

  // ---------------------------------------------------------------- web app -> extension (one port per run)
  function onPort(port) {
    // Listeners are attached synchronously (messages sent right after connect() must not be lost); each waits for the origin check.
    const trusted = trustedOrigin(port.sender);
    trusted.then((origin) => { if (!origin) port.disconnect(); }).catch(() => {});
    port.onMessage.addListener((msg) => { trusted.then((origin) => origin && onOp(port, origin, msg)).catch(() => {}); });
    port.onDisconnect.addListener(() => { void chrome.runtime.lastError; for (const [k, p] of ports) if (p === port) ports.delete(k); });
  }

  async function onOp(port, origin, msg) {
    if (!msg || typeof msg !== 'object' || !okId(msg.id)) return;
    await hydrate();
    const key = keyOf(msg.id);
    let st = runs.get(key);
    if (msg.op === 'apply') return apply(port, origin, msg, st);
    if (msg.op === 'attach') {
      if (!st || st.origin !== origin) {
        if (msg.recover) port.postMessage({ type: 'result', id: msg.id, result: { status: 'needs-attention', filledCount: 0, unanswered: [], url: '', message: 'The browser extension restarted and lost this application. Check the job tab.' } });
        port.disconnect();
        return;
      }
      ports.set(key, port);
      if (st.closed) deliver(st);
      return;
    }
    if (!st || st.closed || st.origin !== origin) return;
    if (msg.op === 'answer') {
      const a = asks.get(`${key}:${msg.qid}`);
      if (a) { clearTimeout(a.timer); asks.delete(`${key}:${msg.qid}`); }
      const answer = Array.isArray(msg.answer) ? msg.answer.slice(0, 50).map((x) => String(x).slice(0, 500)) : typeof msg.answer === 'string' ? msg.answer.slice(0, 4000) : null;
      if (typeof msg.qid === 'string' && msg.qid.length <= 100) await toTab(st, { type: 'answer', id: msg.qid, answer });
      if (a) emit(st, 'question', a.question, { ...a.data, answered: answer != null });
    } else if (msg.op === 'cancel-submit') await toTab(st, { type: 'cancel-submit' });
    else if (msg.op === 'cancel') { await finish(st, 'Cancelled.', true); await closeTab(st); }
  }

  async function apply(port, origin, msg, existing) {
    const id = msg.id;
    if (existing && !existing.closed) { ports.set(existing.key, port); return; } // already running: ignore (the new port just listens)
    const fail = (message, url) => {
      try {
        port.postMessage({ type: 'event', id, event: { type: 'error', message, data: null, at: Date.now() } });
        port.postMessage({ type: 'result', id, result: { status: 'failed', filledCount: 0, unanswered: [], url: url || '', message } });
      } catch { /* page gone */ }
      port.disconnect();
    };
    if (existing) forget(existing);
    if ([...runs.values()].filter((r) => !r.closed).length >= MAX_CONCURRENT) return fail(`${MAX_CONCURRENT} applications are already open in this browser. Finish or close one first.`);
    const { cfg, error } = sanitize(msg.cfg);
    if (error) return fail(error);
    const startUrl = cfg.job.applyUrl || cfg.job.url || '';
    if (!isHttp(startUrl)) return fail('This job has no application link.');
    const target = ApAts.resolveApplyUrl(cfg.job);
    if (!isHttp(target)) return fail('This job has no application link.', startUrl);

    const nonce = Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, '0')).join('');
    const st = { id, key: keyOf(id), origin, tabId: -1, nonce, target, url: target, runs: 0, summary: null, submitted: false, submitArmedOnce: false, failed: false, closed: false, lastDoc: null, skipped: [], startedAt: Date.now(), cfg };
    runs.set(st.key, st);
    ports.set(st.key, port);
    emit(st, 'step', 'Opening the application page', { url: target });
    try {
      const winId = port.sender && port.sender.tab ? port.sender.tab.windowId : undefined;
      const tab = await chrome.tabs.create({ url: target, active: true, ...(winId != null ? { windowId: winId } : {}) }).catch(() => chrome.tabs.create({ url: target, active: true }));
      st.tabId = tab.id;
      await saveCfg(st); await save(st);
      emit(st, 'opened', 'Opened the application page', { url: target });
    } catch (e) {
      st.failed = true;
      const m = `Could not open the application page: ${e && e.message ? e.message : e}`;
      emit(st, 'error', m);
      await finish(st, m);
    }
  }

  // ---------------------------------------------------------------- extension -> job tab
  // Same CustomEvent the phone app uses: the engine listens for it in the isolated world.
  function toTab(st, detail) {
    return chrome.scripting.executeScript({
      target: { tabId: st.tabId },
      func: (d) => { window.dispatchEvent(new CustomEvent('messageFromNative', { detail: d })); },
      args: [{ ap: 'applypilot', nonce: st.nonce, ...detail }],
    }).catch(() => {});
  }
  const siteOk = (st, host) => !!host && st.cfg.allowedSites.includes(ApAts.siteOf(host));
  const hostOf = (url) => { try { return new URL(url).hostname; } catch { return ''; } };

  function cfgForPage(st, url) {
    const ats = ApAts.detectAts(st.cfg.job, url);
    // allowSubmit only for autopilot on an allow-listed ATS, and only until the first submit attempt.
    const allowSubmit = st.cfg.mode === 'auto' && ApAts.canAutoSubmit(ats) && !st.submitArmedOnce && !st.submitted;
    return { ...st.cfg, nonce: st.nonce, ats, allowSubmit, afterSubmit: st.submitArmedOnce, ui: true };
  }

  // Every load of the job tab: engine only (no personal data) on allowed sites, then ping -> 'ready' -> run(cfg).
  async function onLoaded(st, tab) {
    const url = tab && tab.url;
    if (!url) { emit(st, 'step', "ApplyPilot can't read this page."); return; }
    if (!isHttp(url)) return; // browser error pages etc.
    st.url = url;
    const host = hostOf(url);
    if (!siteOk(st, host)) {
      if (!st.skipped.includes(host)) { st.skipped.push(host); emit(st, 'step', `Not filling on ${host}: it isn't part of this application.`); await save(st); }
      return;
    }
    if (st.submitted || st.runs >= MAX_RUNS) return;
    try {
      await chrome.scripting.executeScript({ target: { tabId: st.tabId }, files: ['content/apply-shim.js', 'content/apply-engine.js'] });
      await chrome.scripting.executeScript({ target: { tabId: st.tabId }, func: () => { if (window.__ApplyPilotAutofill) window.__ApplyPilotAutofill.ping(); } });
    } catch (e) { emit(st, 'error', `Script injection failed: ${e && e.message ? e.message : e}`); }
  }

  // What the engine reports (via content/apply-shim.js).
  async function onEngine(sender, msg) {
    if (sender.id !== chrome.runtime.id || !sender.tab || sender.frameId !== 0) return;
    await hydrate();
    const st = byTab(sender.tab.id);
    if (!st) return;
    if (msg.close) { await closeTab(st); return; }
    const m = msg.msg;
    if (!m || typeof m !== 'object' || m.ap !== 'applypilot') return;
    if (typeof m.url === 'string' && isHttp(m.url)) st.url = m.url;

    if (m.type === 'ready') {
      // Trust the URL the browser reports, not what the page claims.
      const host = hostOf(sender.tab.url || sender.url || '');
      const claimed = (m.data && m.data.host) || '';
      if (!siteOk(st, host) || (claimed && !siteOk(st, claimed))) { emit(st, 'step', `Not filling on ${host}: it isn't part of this application.`); return; }
      if (st.submitted || st.runs >= MAX_RUNS) return;
      if (sender.documentId && st.lastDoc === sender.documentId) return; // this page was already filled
      st.lastDoc = sender.documentId || null;
      st.runs++;
      await save(st);
      const target = sender.documentId ? { tabId: st.tabId, documentIds: [sender.documentId] } : { tabId: st.tabId };
      // The function must not return the run() promise: executeScript would wait for the whole fill.
      await chrome.scripting.executeScript({ target, func: (cfg) => { if (window.__ApplyPilotAutofill) window.__ApplyPilotAutofill.run(cfg); }, args: [cfgForPage(st, sender.tab.url || sender.url)] })
        .catch((e) => emit(st, 'error', `Script injection failed: ${e && e.message ? e.message : e}`));
      return;
    }
    if (m.nonce !== st.nonce) return; // events from a page script that never received our config
    const d = m.data;
    switch (m.type) {
      case 'ask': {
        if (!d || typeof d.id !== 'string') return;
        const k = `${st.key}:${d.id}`;
        const timer = setTimeout(async () => { // the page did not answer in time: tell the engine "no answer"
          const a = asks.get(k);
          if (!a) return;
          asks.delete(k);
          await toTab(st, { type: 'answer', id: d.id, answer: null });
          emit(st, 'question', a.question, { ...a.data, answered: false });
        }, ASK_TIMEOUT_MS);
        asks.set(k, { timer, question: d.question, data: d });
        toPage(st, { type: 'ask', qid: d.id, question: d.question, info: { type: d.type, options: d.options || [], required: !!d.required } });
        return;
      }
      case 'fill-done':
        st.summary = d || st.summary;
        if (d && d.status === 'submit-pending') st.submitArmedOnce = true;
        break;
      case 'submit-clicked': st.submitArmedOnce = true; break;
      case 'submitted':
        st.submitted = true;
        setTimeout(async () => { await closeTab(st); await finish(st); }, CLOSE_AFTER_SUBMIT_MS);
        break;
      case 'ui': return; // 'close' is followed by mobileApp.close()
      default: break;
    }
    await save(st);
    emit(st, m.type, m.message, d);
  }

  // ---------------------------------------------------------------- chrome events
  chrome.tabs.onUpdated.addListener(async (tabId, info, tab) => {
    if (info.status !== 'complete') return;
    await hydrate();
    const st = byTab(tabId);
    if (st) await onLoaded(st, tab);
  });
  chrome.tabs.onRemoved.addListener(async (tabId) => {
    await hydrate();
    const st = byTab(tabId);
    if (st) await finish(st);
  });
  chrome.runtime.onConnect.addListener((port) => { if (port.name === 'ap-web') onPort(port); });

  // runtime.onMessage entry point (background.js delegates here). Returns true when it answers asynchronously.
  function onMessage(msg, sender, sendResponse) {
    if (msg.apEngine) { onEngine(sender, msg).catch(() => {}); return false; }
    if (msg.apWeb === 'ping') {
      trustedOrigin(sender).then(async (origin) => {
        if (!origin) { sendResponse(null); return; }
        chrome.storage.local.get(['webSeen']).then((r) => chrome.storage.local.set({ webSeen: { ...(r.webSeen || {}), [origin]: Date.now() } })).catch(() => {});
        sendResponse({ version: chrome.runtime.getManifest().version, engine: await engineVersion() });
      }).catch(() => sendResponse(null));
      return true;
    }
    return false;
  }

  return { onMessage };
})();
