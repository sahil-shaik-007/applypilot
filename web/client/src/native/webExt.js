// "Apply in browser": the ApplyPilot extension is the web app's native layer on desktop Chrome/Edge.
// This module is the page side of the protocol in docs/WEB-BRIDGE.md. It never touches another site: it only
// talks (window.postMessage) to the extension's content script on THIS origin, which opens the job's page in
// a new tab, injects the auto-fill engine and streams events back. Same contract as native applyInApp().
import { eligibility } from '@shared/eligibility.js';
import { resolveApplyUrl, siteOf, ATS_SITES, isHttpUrl } from './ats.js';

const state = { phase: 'unknown', version: '', engine: '' }; // unknown -> ready | missing
let snapshot = { ...state };
const listeners = new Set();
const emitState = () => { snapshot = { ...state }; listeners.forEach((f) => f()); };

export function subscribeExt(f) { listeners.add(f); return () => listeners.delete(f); }
export function extSnapshot() { return snapshot; }
export function extReady() { return state.phase === 'ready'; }

const runs = new Map(); // application id -> { onEvent, onAsk, resolve }
let pings = new Map();
let wired = false;

function send(msg) { window.postMessage({ apWeb: 1, dir: 'to-ext', ...msg }, location.origin); }

function wire() {
  if (wired || typeof window === 'undefined') return;
  wired = true;
  window.addEventListener('message', (e) => {
    const m = e.data;
    if (e.source !== window || e.origin !== location.origin || !m || m.apWeb !== 1 || m.dir !== 'to-page') return;
    if (m.type === 'pong') {
      state.phase = 'ready'; state.version = String(m.version || ''); state.engine = String(m.engine || '');
      const p = pings.get(m.id); if (p) { pings.delete(m.id); p(true); }
      emitState();
      return;
    }
    const run = runs.get(m.id);
    if (!run) return;
    if (m.type === 'event') run.onEvent(m.event || {});
    else if (m.type === 'ask') run.onAsk(m);
    else if (m.type === 'result') { runs.delete(m.id); run.resolve(m.result || {}); }
  });
}

/** Looks for the extension (a pong comes back within a moment when it is installed and allowed on this address). */
export function detectExtension({ wait = 700 } = {}) {
  wire();
  if (typeof window === 'undefined') return Promise.resolve(false);
  const id = `ping-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  return new Promise((resolve) => {
    const t = setTimeout(() => { pings.delete(id); if (state.phase !== 'ready') { state.phase = 'missing'; emitState(); } resolve(extReady()); }, wait);
    pings.set(id, (ok) => { clearTimeout(t); resolve(ok); });
    send({ id, type: 'ping' });
  });
}

function toB64(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(s);
}
const slimJob = (j = {}) => ({ id: j.id, title: j.title, company: j.company, location: j.location, remote: j.remote, ats: j.ats, atsMeta: j.atsMeta, url: j.url, applyUrl: j.applyUrl, externalId: j.externalId });
function normAnswers(answers) {
  const list = !answers ? [] : Array.isArray(answers) ? answers : Object.entries(answers).map(([question, answer]) => ({ question, answer }));
  return list.filter((a) => a && a.question && a.answer != null && String(a.answer).trim() !== '').slice(0, 500)
    .map((a) => ({ question: String(a.question).slice(0, 500), answer: Array.isArray(a.answer) ? a.answer : String(a.answer).slice(0, 4000) }));
}
const cleanProfile = (p) => { const out = {}; for (const [k, v] of Object.entries(p || {})) if (!k.startsWith('_') && v !== undefined && typeof v !== 'function') out[k] = v; return out; };

/**
 * Same signature and result as the phone app's applyInApp. `applicationId` identifies the run on the bridge.
 * @returns {Promise<{status, filledCount, unanswered, url, message}>}
 */
export async function applyInBrowser(opts = {}) {
  const { job = {}, profile = {}, answers = [], resume = null, coverLetter = null, mode: modeIn = 'review', onEvent = null, cancelWindowSec = 10,
    answerQuestion = null, signal = null, ignoreEligibility = false, applicationId, onLate = null } = opts;
  const mode = modeIn === 'auto' ? 'auto' : 'review';
  const emit = (type, message, data) => { try { if (onEvent) onEvent({ type, message: message || '', data: data == null ? null : data, at: Date.now() }); } catch { /* UI errors never break the run */ } };
  const startUrl = job.applyUrl || job.url || '';
  const base = { status: 'failed', filledCount: 0, unanswered: [], url: startUrl, message: '' };
  if (!isHttpUrl(startUrl)) return { ...base, message: 'This job has no application link.' };
  const el = eligibility(job, profile || {});
  if (el.scam.length || (!el.ok && !ignoreEligibility)) { emit('blocked', el.blockers.join('; '), el); return { ...base, status: 'blocked', blockers: el.blockers, message: el.blockers.join('; ') }; }
  if (!extReady() && !(await detectExtension())) return { ...base, status: 'failed', message: 'The ApplyPilot browser extension is not connected. Install it and allow it on this address (Settings → Browser helper).' };

  const target = resolveApplyUrl(job);
  const allowedSites = [...new Set([siteOf(startUrl), siteOf(target), siteOf(job.url || ''), siteOf(job.applyUrl || ''), ...ATS_SITES].filter(Boolean))];
  const id = String(applicationId || `run-${Date.now().toString(36)}`);
  const bytes = resume && resume.bytes && resume.bytes.length ? (resume.bytes instanceof Uint8Array ? resume.bytes : new Uint8Array(resume.bytes)) : null;
  const cfg = {
    job: slimJob(job), profile: cleanProfile(profile), answers: normAnswers(answers),
    resume: bytes ? { name: resume.name || 'resume.pdf', mime: resume.mime || 'application/pdf', base64: toB64(bytes) } : null,
    coverLetter: coverLetter || null, mode, cancelWindowSec: Math.max(3, Number(cancelWindowSec) || 10),
    canAsk: typeof answerQuestion === 'function', allowedSites,
  };
  return new Promise((resolve) => {
    // The form stays open in its own tab until you submit or close it. The app does not wait for that: as soon as the
    // form is filled the result is reported ("waiting for you"); a later confirmed submission still reaches `onLate`.
    let settled = false;
    const finish = (r) => { if (settled) return; settled = true; if (signal) signal.removeEventListener('abort', onAbort); resolve({ url: target, filledCount: 0, unanswered: [], message: '', ...r }); };
    const onAbort = () => send({ id, type: 'cancel' });
    if (signal) { if (signal.aborted) { finish({ status: 'needs-attention', message: 'Cancelled.' }); return; } signal.addEventListener('abort', onAbort, { once: true }); }
    runs.set(id, {
      onEvent: (ev) => {
        emit(ev.type, ev.message, ev.data);
        const d = ev.data || {};
        if (ev.type === 'fill-done' && !settled && d.status !== 'submit-pending' && d.status !== 'submitted') {
          finish({ status: d.status === 'needs-user' ? 'needs-attention' : 'filled-awaiting-user', filledCount: d.filledCount || 0, unanswered: d.unanswered || [], url: d.url || target, message: ev.message || 'Filled in. Review it in the other tab and submit.' });
        } else if (ev.type === 'submitted' && settled && onLate) { try { onLate({ status: 'submitted', url: d.url || target }); } catch { /* best effort */ } }
      },
      onAsk: async (m) => {
        let answer = null;
        try { answer = await Promise.race([answerQuestion(m.question, { ...(m.info || {}), job }), new Promise((r) => setTimeout(() => r(null), 20000))]); } catch { answer = null; }
        send({ id, type: 'answer', qid: m.qid, answer: answer == null ? null : answer });
        emit('question', m.question, { ...(m.info || {}), answered: answer != null });
      },
      resolve: (r) => { if (settled) { runs.delete(id); if (onLate && r && r.status === 'submitted') { try { onLate(r); } catch { /* best effort */ } } } else { runs.delete(id); finish(r); } },
    });
    emit('step', 'Opening the application page in a new tab', { url: target });
    send({ id, type: 'apply', cfg });
  });
}

/** Holds a running cancel-window countdown (the page's own Hold button also does this inside the job tab). */
export function holdSubmit(id) { send({ id, type: 'cancel-submit' }); }
