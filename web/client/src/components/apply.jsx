// Live "Apply in app" progress + cancel window, tailored-resume PDF preview, campaign scheduler.
import React, { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { Zap, Hand, Send, Check, CircleAlert, Loader2, FileText, Share2, ExternalLink, Trash2, RefreshCw, ShieldCheck, Sparkles, X } from 'lucide-react';
import { useApp, go } from '../lib/store.jsx';
import { Button, Sheet, timeAgo } from './ui.jsx';
import { useApplySessions, resolveSubmit, dismissSession, cancelSession, applyInApp, applyJobInApp } from '../lib/applyFlow.js';
import { previewPages, generateTailored, deleteTailored } from '../lib/tailored.js';
import { saveBytes, nat } from '../lib/bridge.js';
import { tick, resetRuntime, campaignWatchlist } from '../lib/campaigns.js';
import { forgetJobs } from '../lib/insights.js';
import { aiError } from '../lib/ai.js';
import { getApplication } from '../lib/apply.js';

/** Runs due campaigns while the app is open: on unlock, every minute while visible, and on resume. */
export function CampaignScheduler() {
  const app = useApp();
  const ref = React.useRef(app);
  ref.current = app;
  useEffect(() => {
    const run = () => tick(ref.current).catch(() => {});
    const first = setTimeout(run, 1500);
    const t = setInterval(run, 60000);
    const onVis = () => { if (!document.hidden) setTimeout(run, 800); };
    document.addEventListener('visibilitychange', onVis);
    return () => { clearTimeout(first); clearInterval(t); document.removeEventListener('visibilitychange', onVis); resetRuntime(); forgetJobs(); };
  }, []);
  // Tapping a "new matches" / "about to submit" notification opens the Review queue.
  useEffect(() => nat().notifications.onTap((d) => { if (d && (d.route === 'queue' || d.type === 'campaign-matches')) go('queue', d.campaignId ? { campaign: d.campaignId } : undefined); }), []);
  // Keep the background check's search list in step with running campaigns.
  const sig = app.campaigns.filter((c) => c.status === 'running').map((c) => `${c.id}:${(c.roles || []).join('|')}:${(c.locations || []).join('|')}:${c.remote}:${c.runOn}`).join(',');
  useEffect(() => { const list = campaignWatchlist(app.campaigns); if (nat().isNative) nat().background.register(list).catch(() => {}); }, [sig]); // eslint-disable-line
  return null;
}

function Countdown({ until }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 250); return () => clearInterval(t); }, []);
  return <span className="countdown mono-num" data-testid="cancel-countdown">{Math.max(0, Math.ceil((until - now) / 1000))}s</span>;
}

/** Global sheet showing the in-app application in progress (one at a time is shown). */
export function ApplyHost() {
  const sessions = useApplySessions();
  const s = sessions.find((x) => x.phase === 'countdown') || sessions.find((x) => x.phase === 'running') || sessions[sessions.length - 1];
  if (!s) return null;
  const done = s.phase === 'done';
  const close = () => (done ? dismissSession(s.id) : null);
  return (
    <Sheet open={!!s} onClose={close} label="Applying" header={(
      <div><h2 style={{ marginTop: 2 }}>{done ? (s.status === 'applied' ? 'Application submitted' : s.status === 'failed' ? 'Could not finish' : 'Waiting for you') : s.phase === 'countdown' ? 'About to submit' : 'Applying in the app…'}</h2>
        <div className="small muted ellipsis">{s.job.title} · {s.job.company}</div></div>
    )} footer={s.phase === 'countdown' ? (
      <>
        <Button size="lg" icon={Hand} onClick={() => resolveSubmit(s.id, false)} data-testid="hold-submit">Hold, I'll review</Button>
        <Button size="lg" variant="primary" icon={Send} onClick={() => resolveSubmit(s.id, true)} data-testid="submit-now">Submit now</Button>
      </>
    ) : done ? (
      <>
        {s.status !== 'applied' && <Button size="lg" icon={ExternalLink} onClick={() => { dismissSession(s.id); go('applied', { id: s.id }); }}>Open in tracker</Button>}
        <Button size="lg" variant="primary" icon={Check} onClick={close} data-testid="apply-done">Done</Button>
      </>
    ) : <Button size="lg" variant="ghost" icon={X} onClick={() => cancelSession(s.id)}>Stop</Button>}>
      <div className="col" style={{ gap: 14 }} data-testid="apply-progress" data-phase={s.phase} data-status={s.status || ''}>
        {s.phase === 'countdown' && (
          <motion.div className="card pad premium premium-shimmer" initial={{ opacity: 0, scale: 0.98 }} animate={{ opacity: 1, scale: 1 }} style={{ textAlign: 'center' }}>
            <div style={{ position: 'relative', zIndex: 2 }} className="col">
              <Zap size={20} color="var(--green)" style={{ margin: '0 auto' }} />
              <div className="small">Every required field is filled. Submitting in</div>
              <Countdown until={s.until} />
              <div className="tiny dim">Hold it to check the form yourself first. You can change the delay in Settings → Applying.</div>
            </div>
          </motion.div>
        )}
        {s.phase === 'running' && <div className="row small" style={{ gap: 8 }}><Loader2 size={16} className="spin" />{s.mode === 'auto' ? (s.auto ? 'Autopilot: fills and submits after a cancel window if every answer is known.' : 'This site only allows filling; you press submit.') : 'Filling the form; you review and submit.'}</div>}
        {done && s.status === 'applied' && <div className="row small" style={{ color: 'var(--green)', gap: 8 }}><Check size={16} />Logged in your tracker. Follow-up reminder set for 7 days.</div>}
        {done && s.status !== 'applied' && (s.error || (s.result && s.result.unanswered && s.result.unanswered.length > 0)) && (
          <div className="card pad small col" style={{ gap: 6, borderColor: 'rgba(251,191,36,.35)' }}>
            {s.error && <div className="row" style={{ color: 'var(--red)', alignItems: 'flex-start' }}><CircleAlert size={14} style={{ flexShrink: 0, marginTop: 3 }} />{s.error}</div>}
            {s.result && s.result.unanswered && s.result.unanswered.length > 0 && <div>{s.result.unanswered.length} question(s) need your answer. <a href="#/answers" onClick={(e) => { e.preventDefault(); dismissSession(s.id); go('answers'); }}>Answer them once</a> and ApplyPilot reuses them everywhere.</div>}
          </div>
        )}
        <div>
          <div className="label">Live progress</div>
          <div className="event-log" data-testid="apply-events">
            {s.events.slice().reverse().map((e, i) => (
              <div key={i} className="row small" style={{ alignItems: 'flex-start', gap: 8 }}>
                <span className="dot" style={{ marginTop: 7, flexShrink: 0, color: e.type === 'error' || e.type === 'failed' ? 'var(--red)' : e.type === 'submitted' ? 'var(--green)' : 'var(--accent-2)' }} />
                <span className="grow break">{e.message}</span>
              </div>
            ))}
            {!s.events.length && <div className="small dim">Starting…</div>}
          </div>
        </div>
        <div className="tiny dim row" style={{ alignItems: 'flex-start' }}><ShieldCheck size={12} style={{ flexShrink: 0, marginTop: 2 }} />Never submits on LinkedIn, Indeed, Naukri, Glassdoor, Workday or unknown sites, never touches passwords or CAPTCHAs, and never guesses a required answer.</div>
      </div>
    </Sheet>
  );
}

/**
 * Starts an in-app application with the eligibility confirm (blockers) handled.
 * Pass either `applicationId` or `job` (+ resumeId). Returns the result or undefined.
 */
export async function startInAppApply(app, { applicationId, job, resumeId, mode }) {
  const run = (force) => (applicationId ? applyInApp(app, applicationId, { mode, force }) : applyJobInApp(app, job, { resumeId, mode, force }));
  try { return await run(false); } catch (e) {
    if (e.code === 'ineligible') {
      const ok = await app.confirm({ title: 'Apply anyway?', message: `${e.reasons.join(' · ')}. ApplyPilot can still fill this application if you're sure.`, confirmLabel: 'Apply anyway', danger: false });
      if (!ok) return undefined;
      try { return await run(true); } catch (e2) { app.toast(e2.message, 'error'); return undefined; }
    }
    app.toast(e.message, 'error');
    return undefined;
  }
}

// ---------------------------------------------------------------- tailored PDF
/** Preview / share / delete the tailored resume PDF of an application. */
export function TailoredPdfSheet({ applicationId, onClose }) {
  const app = useApp();
  const a = applicationId ? getApplication(app, applicationId) : null;
  const t = a && a.tailored;
  const [pages, setPages] = useState(null);
  const [bytes, setBytes] = useState(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(null);
  useEffect(() => {
    let on = true;
    setPages(null); setBytes(null); setErr('');
    if (!t || !t.blobId) return undefined;
    (async () => {
      try { const b = await app.sync.getBlob(t.blobId); if (!on) return; setBytes(b); const p = await previewPages(b); if (on) setPages(p); } catch (e) { if (on) setErr(e.message); }
    })();
    return () => { on = false; };
  }, [t && t.blobId]); // eslint-disable-line
  const share = async () => { if (bytes) { try { await saveBytes(t.fileName, bytes, 'application/pdf'); } catch (e) { app.toast(e.message, 'error'); } } };
  const open = () => { if (!bytes) return; const url = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' })); window.open(url, '_blank', 'noopener'); setTimeout(() => URL.revokeObjectURL(url), 60000); };
  const del = async () => {
    if (!(await app.confirm({ title: 'Delete tailored resume?', message: `"${t.fileName}" is removed from every device. This application will use your regular resume again.` }))) return;
    try { await deleteTailored(app, a.id); app.toast('Tailored resume deleted', 'success'); onClose(); } catch (e) { app.toast(e.message, 'error'); }
  };
  const regen = async () => {
    setBusy('regen');
    try { await generateTailored(app, { job: { ...a.job, id: a.jobId }, applicationId: a.id, resumeId: (t && t.baseResumeId) || a.resumeId || 'auto' }); app.toast('New tailored resume ready', 'success'); } catch (e) { app.toast(aiError(e), 'error'); } finally { setBusy(null); }
  };
  return (
    <Sheet open={!!t} onClose={onClose} tall label="Tailored resume" header={t && (
      <div><h2 style={{ marginTop: 2 }}>Tailored resume</h2><div className="small muted ellipsis">{t.fileName}</div></div>
    )} footer={t && (
      <>
        <Button icon={Share2} disabled={!bytes} onClick={share} data-testid="pdf-share">Save / share</Button>
        <Button variant="primary" icon={ExternalLink} disabled={!bytes} onClick={open}>Open PDF</Button>
      </>
    )}>
      {t && (
        <div className="col" style={{ gap: 14 }} data-testid="tailored-sheet">
          <div className="card pad col" style={{ gap: 6 }}>
            <div className="row" style={{ gap: 8 }}><ShieldCheck size={15} color="var(--green)" /><span className="small" style={{ fontWeight: 700 }}>Verified truthful</span><span className="tiny dim grow" style={{ textAlign: 'right' }}>{timeAgo(t.createdAt)}</span></div>
            <div className="small muted">Built only from "{t.baseResumeName || 'your resume'}". {t.removed && t.removed.length ? `${t.removed.length} unsupported claim(s) removed automatically.` : 'Nothing had to be removed.'}</div>
            {t.removed && t.removed.length > 0 && <div className="chips">{t.removed.slice(0, 8).map((r) => <span key={r} className="badge red">− {r}</span>)}</div>}
            {t.changes && t.changes.length > 0 && <ul className="small" style={{ margin: '4px 0 0', paddingLeft: 18 }}>{t.changes.map((c, i) => <li key={i}>{c}</li>)}</ul>}
          </div>
          {err && <div className="small" style={{ color: 'var(--red)' }}>{err}</div>}
          {!pages && !err && <div className="skeleton" style={{ height: 360 }} />}
          {pages && <div className="col" style={{ gap: 10 }} data-testid="pdf-preview">{pages.images.map((src, i) => <img key={i} src={src} className="pdf-page" alt={`Page ${i + 1} of the tailored resume`} />)}{pages.pages > pages.images.length && <div className="tiny dim">+{pages.pages - pages.images.length} more page(s) in the PDF</div>}</div>}
          <div className="grid g2">
            <Button icon={RefreshCw} loading={busy === 'regen'} disabled={!app.settings.anthropicKey} onClick={regen}>Regenerate</Button>
            <Button variant="danger" icon={Trash2} onClick={del} data-testid="pdf-delete">Delete</Button>
          </div>
          <div className="tiny dim">This PDF is uploaded instead of your regular resume when you apply to this job.</div>
        </div>
      )}
    </Sheet>
  );
}

/** Card + button to create/open a tailored PDF for a job or application. */
export function TailoredCard({ job, resumeId, applicationId }) {
  const app = useApp();
  const a = applicationId ? getApplication(app, applicationId) : app.applications.find((x) => x.jobId === job.id);
  const [busy, setBusy] = useState('');
  const [open, setOpen] = useState(null);
  const make = async () => {
    setBusy('Starting…');
    try { const r = await generateTailored(app, { job, resumeId: resumeId || 'auto', applicationId: a && a.id, onStep: setBusy }); setOpen(r.application.id); } catch (e) { app.toast(aiError(e), 'error'); } finally { setBusy(''); }
  };
  return (
    <div className="card pad col" style={{ gap: 10 }} data-testid="tailored-card">
      <div className="section-title" style={{ margin: 0 }}><FileText size={14} />Tailored resume PDF</div>
      {a && a.tailored ? (
        <button type="button" className="list-row" style={{ padding: 0 }} onClick={() => setOpen(a.id)} data-testid="open-tailored">
          <span className="ico"><FileText size={16} /></span>
          <span className="grow"><span className="small ellipsis" style={{ display: 'block', fontWeight: 600 }}>{a.tailored.fileName}</span><span className="tiny dim">{a.tailored.removed && a.tailored.removed.length ? `${a.tailored.removed.length} unsupported claim(s) removed` : 'verified · nothing invented'} · {timeAgo(a.tailored.createdAt)}</span></span>
        </button>
      ) : <div className="small muted">AI rewrites your resume for this job using only facts already in it; anything it invents is removed automatically. Used for this application's upload.</div>}
      <Button icon={busy ? undefined : Sparkles} loading={!!busy} disabled={!app.settings.anthropicKey || !app.resumes.length} onClick={make} data-testid="make-tailored">{busy || (a && a.tailored ? 'Make a new one' : 'Create tailored PDF')}</Button>
      {!app.settings.anthropicKey && <div className="tiny dim">Needs your Anthropic key (AI studio).</div>}
      <TailoredPdfSheet applicationId={open} onClose={() => setOpen(null)} />
    </div>
  );
}
