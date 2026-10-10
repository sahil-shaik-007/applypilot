// "Apply in app" on the phone (parity with CampaignManager.applyApplication on the desktop):
//   scam check -> eligibility check -> daily cap -> resume (tailored PDF if any / campaign tailoring)
//   -> cover letter -> native.applyInApp() fills the form in an in-app WebView, reporting progress
//   -> before any auto-submit: cancel window (Settings, default 30 s) with Hold / Submit now
//   -> result into the tracker; unanswered questions into the Answer bank.
// The native layer enforces the submit allow-list (it never submits on LinkedIn, Indeed, Naukri,
// Glassdoor, Workday or unknown sites) and never touches passwords or CAPTCHAs.
import { useSyncExternalStore } from 'react';
import { newId } from '@shared/vaultCrypto.js';
import { scamSignals, eligibility } from '@shared/eligibility.js';
import { attemptsToday, bestAnswer, worthAsking, resultStatus, fillTemplate, DEFAULT_COVER_TEMPLATE } from '@shared/campaignRules.js';
import { getApplication, patchApplication, pickResume, ensureApplication, AUTO_ATS } from './apply.js';
import { coverLetter as aiCoverLetter, answerQuestion as aiAnswer, aiError, DEFAULT_MODEL } from './ai.js';
import { generateTailored } from './tailored.js';
import { nat, canApplyInApp, notify, haptic } from './bridge.js';
import { patchCampaign } from './campaigns.js';

const MIME = { '.pdf': 'application/pdf', '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', '.txt': 'text/plain', '.md': 'text/markdown' };

// ---------------------------------------------------------------- live sessions (memory only)
const sessions = new Map(); // applicationId -> session
const listeners = new Set();
let snap = [];
const emit = () => { snap = [...sessions.values()]; listeners.forEach((f) => f()); };
export function useApplySessions() {
  return useSyncExternalStore((f) => { listeners.add(f); return () => listeners.delete(f); }, () => snap, () => snap);
}
function upd(id, patch) { const s = sessions.get(id); if (s) { sessions.set(id, { ...s, ...patch }); emit(); } }
function log(id, type, message) { const s = sessions.get(id); if (s) upd(id, { events: [...s.events, { t: Date.now(), type, message }].slice(-80) }); }
export function dismissSession(id) { const s = sessions.get(id); if (s && s.phase !== 'running' && s.phase !== 'countdown') { sessions.delete(id); emit(); } }

/** Hold (false) or submit now (true) during the cancel window. */
export function resolveSubmit(id, ok) {
  const s = sessions.get(id);
  if (s && s.resolveSubmit) { s.resolveSubmit(ok); return true; }
  return false;
}
/** Asks the in-app filler to stop (if the native layer supports cancel). */
export function cancelSession(id) {
  const s = sessions.get(id);
  if (!s) return;
  if (s.resolveSubmit) s.resolveSubmit(false);
  if (s.abort) s.abort.abort();
}

export function submitDelay(app) { const v = Number((app.settings || {}).submitDelaySeconds); return Number.isFinite(v) ? Math.max(0, Math.min(300, v)) : 30; }

/** Cancel window before every auto-submit (desktop cancelWindow). Resolves true = submit. */
export function cancelWindow(app, id, job) {
  const secs = submitDelay(app);
  if (!secs) return Promise.resolve(true);
  const until = Date.now() + secs * 1000;
  patchApplication(app, id, { pendingSubmitUntil: new Date(until).toISOString() }, `Submitting in ${secs}s — you can hold it`).catch(() => {});
  notify('About to submit an application', `${job.title} at ${job.company} in ${secs}s — open ApplyPilot to hold it`, { route: 'queue', applicationId: id });
  haptic('warning');
  return new Promise((resolve) => {
    let done = false;
    const finish = (ok, why) => {
      if (done) return; done = true;
      clearTimeout(t);
      upd(id, { phase: 'running', until: null, resolveSubmit: null });
      log(id, 'step', ok ? (why || 'Submitting now') : 'Held — you will review it');
      patchApplication(app, id, { pendingSubmitUntil: null }, ok ? (why || 'Submitting now') : 'Held — you will review it').catch(() => {});
      resolve(ok);
    };
    const t = setTimeout(() => finish(true, 'Cancel window ended, submitting'), secs * 1000);
    upd(id, { phase: 'countdown', until, resolveSubmit: finish });
  });
}

async function resumeUpload(app, a, job, campaign, apiKey, onStep) {
  let cur = getApplication(app, a.id);
  if (!cur.tailored && campaign && campaign.tailorResume && apiKey) {
    try {
      const r = await generateTailored(app, { job, applicationId: a.id, resumeId: cur.resumeId || campaign.resumeId || 'auto', onStep });
      cur = r.application;
      return { name: r.tailored.fileName, bytes: r.bytes, mime: 'application/pdf', tailored: true };
    } catch (e) {
      await patchApplication(app, a.id, {}, `Couldn't tailor the resume (${aiError(e)}); using your resume as-is`).catch(() => {});
    }
  }
  if (cur.tailored && cur.tailored.blobId) {
    try { return { name: cur.tailored.fileName, bytes: await app.sync.getBlob(cur.tailored.blobId), mime: 'application/pdf', tailored: true }; } catch { /* fall back */ }
  }
  const resume = pickResume(app.resumes, job, cur.resumeId || (campaign && campaign.resumeId) || 'auto');
  if (!resume) throw new Error('Upload a resume first (More → Resumes).');
  const bytes = resume.blobId ? await app.sync.getBlob(resume.blobId) : null;
  return { name: resume.fileName || `${resume.name}${resume.ext || '.pdf'}`, bytes, mime: MIME[resume.ext] || 'application/pdf', resumeId: resume.id, resumeName: resume.name };
}

async function buildCoverLetter(app, cur, job, style, apiKey, resumeText) {
  if (cur.coverLetter) return cur.coverLetter;
  if (style === 'none') return '';
  const profile = app.profile || {};
  if (style !== 'template' && apiKey) {
    try { return await aiCoverLetter({ apiKey, model: app.settings.aiModel || DEFAULT_MODEL, job, profile, resumeText }); } catch { /* template */ }
  }
  return fillTemplate(profile.coverLetterTemplate || DEFAULT_COVER_TEMPLATE, job, profile);
}

/** Remembers unanswered form questions in the Answer bank (once each). */
export async function rememberQuestions(app, unanswered = []) {
  let added = 0;
  const known = app.sync.list('qa');
  for (const u of unanswered) {
    const q = typeof u === 'string' ? { question: u } : u;
    if (!worthAsking(known, q.question, q.required)) continue;
    const rec = { id: newId(), question: String(q.question).trim().slice(0, 500), answer: '', options: (q.options || []).slice(0, 30), source: 'pending', uses: 0, updatedAt: new Date().toISOString() };
    await app.put('qa', rec.id, rec);
    known.push(rec);
    added++;
  }
  return added;
}

/** Checks a job before anything is sent (scam = hard stop; blockers need `force`). */
export function preflight(app, job) {
  const scam = scamSignals(job);
  if (scam.length) return { ok: false, scam: true, reasons: scam };
  const el = eligibility(job, app.profile || {});
  if (!el.ok) return { ok: false, scam: false, reasons: el.blockers };
  return { ok: true, reasons: [] };
}

/**
 * Applies to one tracked application inside the app. Throws on a precondition failure (scam,
 * daily cap, no resume). `force` skips the eligibility (not scam) check after the user confirmed.
 */
export async function applyInApp(app, applicationId, { mode, force = false } = {}) {
  if (!canApplyInApp()) throw new Error('In-app auto-fill needs the ApplyPilot phone app.');
  if (sessions.has(applicationId) && ['running', 'countdown'].includes(sessions.get(applicationId).phase)) throw new Error('Already applying to this job.');
  const a = getApplication(app, applicationId);
  if (!a) throw new Error('Application not found');
  const job = { ...a.job, id: a.jobId, match: a.match };
  const pf = preflight(app, job);
  if (pf.scam) {
    await patchApplication(app, a.id, { status: 'skipped' }, { type: 'blocked', message: `Blocked before sending any data — looks like a scam (${pf.reasons.join(', ')}).` });
    throw new Error(`Blocked: this posting looks like a scam (${pf.reasons.join(', ')}).`);
  }
  if (!pf.ok && !force) { const e = new Error(`You may not be able to take this job: ${pf.reasons.join(' · ')}`); e.code = 'ineligible'; e.reasons = pf.reasons; throw e; }
  const settings = app.settings || {};
  const cap = Number(settings.dailyApplyLimit) || 25;
  const all = app.sync.list('applications');
  if (attemptsToday(all) >= cap) throw new Error(`Daily limit of ${cap} applications reached (Settings → Applying).`);
  const campaign = a.campaignId ? app.sync.get('campaigns', a.campaignId) : null;
  if (campaign && attemptsToday(all, campaign.id) >= (Number(campaign.dailyLimit) || 25)) throw new Error(`"${campaign.name}" reached its daily limit of ${campaign.dailyLimit}.`);

  const effMode = (mode || (campaign && campaign.mode !== 'queue' ? campaign.mode : settings.defaultApplyMode) || 'review') === 'auto' ? 'auto' : 'review';
  const abort = new AbortController();
  sessions.set(a.id, { id: a.id, job, mode: effMode, phase: 'running', events: [], startedAt: Date.now(), abort, auto: AUTO_ATS.includes(job.ats) });
  emit();
  const step = (m) => log(a.id, 'step', m);
  const apiKey = settings.anthropicKey;
  try {
    step('Preparing application');
    await patchApplication(app, a.id, { status: 'in-progress', attemptedAt: new Date().toISOString(), appliedVia: 'phone-app' }, 'Applying in the ApplyPilot app');
    const resume = await resumeUpload(app, a, job, campaign, apiKey, step);
    const base = pickResume(app.resumes, job, a.resumeId || 'auto');
    const letter = await buildCoverLetter(app, getApplication(app, a.id), job, campaign ? campaign.coverLetter : 'ai', apiKey, base ? base.text : '');
    const patch = { coverLetter: letter || null };
    if (resume.resumeId) Object.assign(patch, { resumeId: resume.resumeId, resumeName: resume.resumeName });
    await patchApplication(app, a.id, patch);
    step(`Opening the application with ${resume.tailored ? 'your tailored resume' : `"${resume.name}"`}`);
    const answers = app.sync.list('qa').filter((q) => q.answer).map((q) => ({ id: q.id, question: q.question, answer: q.answer }));
    const profile = app.profile || {};
    const result = await nat().applyInApp({
      job,
      profile,
      answers,
      resume: { name: resume.name, bytes: resume.bytes, mime: resume.mime },
      coverLetter: letter,
      mode: effMode,
      submitDelaySeconds: submitDelay(app),
      signal: abort.signal,
      beforeSubmit: () => cancelWindow(app, a.id, job),
      answerQuestion: async (question, info = {}) => {
        const hit = bestAnswer(app.sync.list('qa'), question);
        if (hit) return hit.answer;
        if (settings.aiAnswerQuestions && apiKey) {
          try { return await aiAnswer({ apiKey, model: settings.aiModel || DEFAULT_MODEL, question, options: info.options, type: info.type, job, profile, resumeText: base ? base.text : '' }); } catch { return null; }
        }
        return null;
      },
      onEvent: (ev) => {
        if (!ev) return;
        log(a.id, ev.type || 'step', ev.message || ev.type);
        if (ev.type === 'progress' || ev.type === 'filled') upd(a.id, { filled: (ev.data && ev.data.filledCount) || undefined });
      },
    }) || {};
    const status = resultStatus(result);
    const unanswered = result.unanswered || [];
    const added = await rememberQuestions(app, unanswered);
    const msg = result.message || ({ applied: 'Application submitted', 'awaiting-you': result.status === 'held' ? 'Held — finish it yourself' : 'Filled in — review and submit', failed: 'Could not complete the application' }[status]);
    await patchApplication(app, a.id, { status, unanswered, pendingSubmitUntil: null, ...(result.url ? { finalUrl: result.url } : {}), ...(status === 'applied' ? { appliedAt: new Date().toISOString(), followUpAt: new Date(Date.now() + 7 * 86400000).toISOString() } : {}) }, { type: result.status || status, message: `${msg}${result.filledCount != null ? ` (${result.filledCount} fields filled)` : ''}${added ? ` · ${added} new question(s) in your Answer bank` : ''}` });
    if (campaign && (status === 'applied' || status === 'failed')) await patchCampaign(app, campaign.id, (c) => ({ stats: { ...(c.stats || {}), [status]: ((c.stats || {})[status] || 0) + 1 } })).catch(() => {});
    log(a.id, status === 'applied' ? 'submitted' : status, msg);
    upd(a.id, { phase: 'done', status, result: { ...result, added } });
    haptic(status === 'applied' ? 'success' : 'warning');
    return { status, ...result, added };
  } catch (e) {
    const cur = getApplication(app, a.id);
    if (cur && cur.status === 'in-progress') await patchApplication(app, a.id, { status: 'failed', pendingSubmitUntil: null }, { type: 'error', message: e.message }).catch(() => {});
    log(a.id, 'error', e.message);
    upd(a.id, { phase: 'done', status: 'failed', error: e.message });
    throw e;
  }
}

/** Starts an in-app application for a job from the job sheet (creates the tracker entry). */
export async function applyJobInApp(app, job, { resumeId = 'auto', mode, force } = {}) {
  const a = await ensureApplication(app, job, { status: 'queued', resumeId, message: 'Applying from phone' });
  if (resumeId !== 'auto' && a.resumeId !== resumeId) {
    const r = app.resumes.find((x) => x.id === resumeId);
    if (r) await patchApplication(app, a.id, { resumeId: r.id, resumeName: r.name });
  }
  return applyInApp(app, a.id, { mode, force });
}
