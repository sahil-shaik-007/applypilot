// In-app apply: opens the job's application page in @capgo/inappbrowser, injects the auto-fill
// engine (autofill.bundle.js, built from the desktop engine by web/mobile-autofill/build.mjs) and
// drives it over the plugin's messaging bridge.
//
// Protocol
//   1. every page load -> executeScript(AUTOFILL_SOURCE + ping())   (engine only, no personal data)
//   2. page posts 'ready' {url}  -> the app checks the page's site is part of this application
//      (the job's own site(s) + known ATS hosts) and only then executeScript(run(cfg)) with the data
//   3. page posts step / filled / question / ask / captcha / needs-user / fill-done / countdown /
//      submit-cancelled / submit-clicked / submitted / ui; the app answers 'ask' via postMessage
//   4. the result resolves when the browser closes (auto-closes 3 s after a confirmed submission)
//
// Safety (same rules as the desktop engine):
//   - eligibility/scam check runs BEFORE any page is opened with data; a scam signal always blocks
//   - allowSubmit is only true for mode 'auto' on an allow-listed ATS; the page additionally requires
//     every required answer, no CAPTCHA, and the cancel window (cancelWindowSec) before clicking
//   - submit is armed at most once per application; never on LinkedIn/Indeed/Naukri/Glassdoor/Workday/unknown
//   - the engine never touches password fields and never logs in or solves CAPTCHAs
import { InAppBrowser, ToolBarType } from '@capgo/inappbrowser';
import { eligibility } from '@shared/eligibility.js';
import { isNative } from './secure.js';
import { detectAts, resolveApplyUrl, canAutoSubmit, siteOf, ATS_SITES, isHttpUrl } from './ats.js';

let active = null;
const MAX_RUNS = 12;

function toB64(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(s);
}
function slimJob(job) {
  const j = job || {};
  return { id: j.id, title: j.title, company: j.company, location: j.location, remote: j.remote, ats: j.ats, atsMeta: j.atsMeta,
    url: j.url, applyUrl: j.applyUrl, externalId: j.externalId };
}
function normAnswers(answers) {
  if (!answers) return [];
  const list = Array.isArray(answers) ? answers : Object.entries(answers).map(([question, answer]) => ({ question, answer }));
  return list.filter((a) => a && a.question && a.answer != null && String(a.answer).trim() !== '')
    .slice(0, 500).map((a) => ({ question: String(a.question).slice(0, 500), answer: Array.isArray(a.answer) ? a.answer : String(a.answer).slice(0, 4000) }));
}
function cleanProfile(p) {
  const out = {};
  for (const [k, v] of Object.entries(p || {})) if (!k.startsWith('_') && v !== undefined && typeof v !== 'function') out[k] = v;
  return out;
}

/**
 * @returns {Promise<{status:'submitted'|'filled-awaiting-user'|'needs-attention'|'blocked'|'failed'|'opened-external',
 *   filledCount:number, unanswered:{question,required,type,options}[], url:string, message:string, blockers?:string[]}>}
 */
export async function applyInApp(opts = {}) {
  const {
    job = {}, profile = {}, answers = [], resume = null, coverLetter = null, mode: modeIn = 'review',
    onEvent = null, cancelWindowSec = 10, answerQuestion = null, signal = null, ignoreEligibility = false,
    autoCloseAfterSubmitMs = 3000,
  } = opts;
  const mode = modeIn === 'auto' ? 'auto' : 'review';
  const emit = (type, message, data) => { try { if (onEvent) onEvent({ type, message: message || '', data: data == null ? null : data, at: Date.now() }); } catch { /* UI errors never break the run */ } };
  const startUrl = job.applyUrl || job.url || '';
  const result = { status: 'failed', filledCount: 0, unanswered: [], url: startUrl, message: '' };

  if (!isHttpUrl(startUrl)) return { ...result, message: 'This job has no application link.' };

  // 1. eligibility + scam check before any data goes near a page
  const el = eligibility(job, profile || {});
  if (el.scam.length || (!el.ok && !ignoreEligibility)) {
    emit('blocked', el.blockers.join('; '), el);
    return { ...result, status: 'blocked', blockers: el.blockers, message: el.blockers.join('; ') };
  }

  const target = resolveApplyUrl(job);
  result.url = target;

  // Plain browser (PWA): no injection possible; open the page for the user.
  if (!isNative) {
    try { window.open(target, '_blank', 'noopener,noreferrer'); } catch { /* popup blocked */ }
    return { ...result, status: 'opened-external', message: 'Opened the application page. Auto-fill needs the ApplyPilot app.' };
  }
  if (active) throw new Error('Another application is already open. Finish or close it first.');

  const allowedSites = [...new Set([siteOf(startUrl), siteOf(target), siteOf(job.url || ''), siteOf(job.applyUrl || ''), ...ATS_SITES].filter(Boolean))];
  const nonce = Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, '0')).join('');
  const resumeB64 = resume && resume.bytes && resume.bytes.length ? { name: resume.name || 'resume.pdf', mime: resume.mime || 'application/pdf', base64: toB64(resume.bytes instanceof Uint8Array ? resume.bytes : new Uint8Array(resume.bytes)) } : null;
  const baseCfg = {
    nonce, mode, job: slimJob(job), profile: cleanProfile(profile), answers: normAnswers(answers), resume: resumeB64,
    coverLetter: coverLetter || null, canAsk: typeof answerQuestion === 'function', cancelWindowSec: Math.max(3, Number(cancelWindowSec) || 10),
    ui: true, allowedSites,
  };
  const { AUTOFILL_SOURCE } = await import('./autofill.bundle.js');

  return new Promise((resolve) => {
    const st = { id: null, url: target, nativeUrl: target, failed: false, runs: 0, summary: null, submitted: false, submitArmedOnce: false, closed: false, handles: [], requiredMissing: 0 };
    active = st;
    const sameView = (ev) => !st.id || !ev || !ev.id || ev.id === st.id;
    const exec = (code) => InAppBrowser.executeScript({ code, ...(st.id ? { id: st.id } : {}) }).catch((e) => emit('error', `Script injection failed: ${e && e.message ? e.message : e}`));
    const toPage = (detail) => InAppBrowser.postMessage({ detail: { ap: 'applypilot', nonce, ...detail }, ...(st.id ? { id: st.id } : {}) }).catch(() => {});

    const finish = async (why) => {
      if (st.closed) return;
      st.closed = true;
      active = null;
      for (const h of st.handles) { try { await h.remove(); } catch { /* */ } }
      if (signal && onAbort) signal.removeEventListener('abort', onAbort);
      const s = st.summary || {};
      const out = { ...result, url: st.url, filledCount: s.filledCount || 0, unanswered: s.unanswered || [] };
      if (st.submitted) { out.status = 'submitted'; out.message = 'Application submitted.'; }
      else if (st.failed) { out.status = 'failed'; out.message = why || 'Could not open the application.'; }
      else if (!st.summary) { out.status = 'needs-attention'; out.message = why || 'Closed before the form was filled.'; }
      else if (mode === 'auto' && (s.unanswered || []).some((u) => u.required)) { out.status = 'needs-attention'; out.message = 'Required questions were left for you; nothing was submitted.'; }
      else { out.status = 'filled-awaiting-user'; out.message = why || 'Closed before a confirmation was seen.'; }
      emit('closed', out.message, out);
      resolve(out);
    };
    const onAbort = () => { InAppBrowser.close(st.id ? { id: st.id } : undefined).catch(() => {}); finish('Cancelled.'); };
    if (signal) { if (signal.aborted) { finish('Cancelled.'); return; } signal.addEventListener('abort', onAbort, { once: true }); }

    const cfgForPage = (url) => {
      const ats = detectAts(job, url);
      // allowSubmit only for autopilot on an allow-listed ATS, and only until the first submit attempt.
      const allowSubmit = mode === 'auto' && canAutoSubmit(ats) && !st.submitArmedOnce && !st.submitted;
      return { ...baseCfg, ats, allowSubmit, afterSubmit: st.submitArmedOnce };
    };

    const onMessage = async (ev) => {
      if (st.closed || !sameView(ev)) return;
      let m = ev && (ev.detail || ev);
      if ((!m || !m.ap) && ev && ev.rawMessage) { try { const p = JSON.parse(ev.rawMessage); m = p.detail || p; } catch { return; } }
      if (!m || m.ap !== 'applypilot') return;
      if (m.url) st.url = m.url;
      if (m.type === 'ready') {
        // Trust the URL the native WebView reports, not what the page claims.
        let host = '';
        try { host = new URL(st.nativeUrl).hostname; } catch { host = ''; }
        const claimed = (m.data && m.data.host) || '';
        if (!allowedSites.includes(siteOf(host)) || (claimed && !allowedSites.includes(siteOf(claimed)))) { emit('step', `Not filling on ${host}: it isn't part of this application.`); return; }
        if (st.submitted || st.runs >= MAX_RUNS) return;
        st.runs++;
        exec(`window.__ApplyPilotAutofill && window.__ApplyPilotAutofill.run(${JSON.stringify(cfgForPage(st.nativeUrl))});void 0;`);
        return;
      }
      if (m.nonce !== nonce) return; // events from a page script that never received our config
      switch (m.type) {
        case 'ask': {
          let answer = null;
          try { answer = await Promise.race([answerQuestion(m.data.question, { type: m.data.type, options: m.data.options, required: m.data.required, job }), new Promise((r) => setTimeout(() => r(null), 20000))]); } catch { answer = null; }
          toPage({ type: 'answer', id: m.data.id, answer: answer == null ? null : answer });
          emit('question', m.data.question, { ...m.data, answered: answer != null });
          return;
        }
        case 'fill-done':
          st.summary = m.data || st.summary;
          if (m.data && m.data.status === 'submit-pending') st.submitArmedOnce = true;
          break;
        case 'submit-clicked': st.submitArmedOnce = true; break;
        case 'submitted':
          st.submitted = true;
          if (autoCloseAfterSubmitMs >= 0) setTimeout(() => { if (!st.closed) InAppBrowser.close(st.id ? { id: st.id } : undefined).catch(() => {}).finally(() => finish()); }, autoCloseAfterSubmitMs);
          break;
        case 'ui': if (m.message === 'close') { /* page calls mobileApp.close(); closeEvent follows */ } return;
        default: break;
      }
      emit(m.type, m.message, m.data);
    };

    (async () => {
      try {
        st.handles.push(await InAppBrowser.addListener('messageFromWebview', onMessage));
        st.handles.push(await InAppBrowser.addListener('urlChangeEvent', (ev) => { if (sameView(ev) && ev && ev.url) { st.url = ev.url; st.nativeUrl = ev.url; } }));
        st.handles.push(await InAppBrowser.addListener('browserPageLoaded', (ev) => {
          if (st.closed || !sameView(ev)) return;
          exec(`${AUTOFILL_SOURCE}\n;window.__ApplyPilotAutofill && window.__ApplyPilotAutofill.ping();void 0;`);
        }));
        st.handles.push(await InAppBrowser.addListener('pageLoadError', (ev) => { if (sameView(ev)) emit('error', 'The page failed to load. Check your connection and use reload.'); }));
        st.handles.push(await InAppBrowser.addListener('closeEvent', (ev) => { if (sameView(ev)) finish(); }));
        emit('step', 'Opening the application page', { url: target });
        const r = await InAppBrowser.openWebView({
          url: target,
          title: job.company ? `${job.company}: ${job.title || 'Apply'}`.slice(0, 60) : 'Apply',
          toolbarType: ToolBarType.NAVIGATION,
          visibleTitle: true,
          showReloadButton: true,
          toolbarColor: '#0a0a0a',
          toolbarTextColor: '#f4f4f5',
          preventDeeplink: true, // keep LinkedIn/Indeed links inside the app browser
          openBlankTargetInWebView: true,
          isPresentAfterPageLoad: false,
          materialPicker: true,
          closeModal: true,
          closeModalTitle: 'Leave this application?',
          closeModalDescription: 'Anything you have not submitted stays unsent.',
          closeModalOk: 'Leave',
          closeModalCancel: 'Stay',
        });
        st.id = r && r.id ? r.id : null;
      } catch (e) {
        emit('error', e && e.message ? e.message : String(e));
        result.message = `Could not open the in-app browser: ${e && e.message ? e.message : e}`;
        st.failed = true;
        await finish(result.message);
      }
    })();
  });
}

/** Cancels a running cancel-window countdown in the open application (e.g. from an app notification). */
export async function cancelPendingSubmit() {
  if (!active) return false;
  await InAppBrowser.executeScript({ code: 'window.__ApplyPilotAutofill && window.__ApplyPilotAutofill.cancelSubmit();void 0;', ...(active.id ? { id: active.id } : {}) }).catch(() => {});
  return true;
}
