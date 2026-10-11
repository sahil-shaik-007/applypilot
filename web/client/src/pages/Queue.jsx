import React, { useEffect, useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Inbox, Check, X, ExternalLink, Send, Zap, CircleAlert, MessageSquareText, RotateCw, Laptop, Rocket, Smartphone, Hand } from 'lucide-react';
import { useApp, go } from '../lib/store.jsx';
import { Button, Logo, ScoreRing, Empty, Seg, timeAgo, salary } from '../components/ui.jsx';
import { JobSheet, QuickFillSheet } from '../components/jobs.jsx';
import { startInAppApply, UnansweredList } from '../components/apply.jsx';
import { AUTO_ATS, patchApplication, sendToLaptop, openExternal } from '../lib/apply.js';
import { canApplyInApp } from '../lib/bridge.js';
import { useApplySessions, resolveSubmit, openQuestions } from '../lib/applyFlow.js';

const asJob = (a) => ({ ...a.job, id: a.jobId, match: a.match });

function Check2({ on, onClick, label }) {
  return <button type="button" className={`check ${on ? 'on' : ''}`} role="checkbox" aria-checked={on} aria-label={label} onClick={onClick}><span className="box">{on && <Check size={13} />}</span></button>;
}

export default function Queue({ params }) {
  const app = useApp();
  const native = canApplyInApp();
  const [sel, setSel] = useState(new Set());
  const [camp, setCamp] = useState(params.campaign || 'all');
  const [mode, setMode] = useState(app.settings.defaultApplyMode === 'auto' ? 'auto' : 'review');
  const [open, setOpen] = useState(null);
  const [quick, setQuick] = useState(null);
  const [busy, setBusy] = useState(null);
  const [limit, setLimit] = useState(40);
  const [, tick] = useState(0);
  useEffect(() => { if (params.campaign) setCamp(params.campaign); }, [params.campaign]);
  const sessions = useApplySessions();

  const allQueued = app.applications.filter((a) => a.status === 'queued');
  const queued = useMemo(() => allQueued.filter((a) => camp === 'all' || (a.campaignId || 'manual') === camp).sort((a, b) => (b.score || 0) - (a.score || 0)), [app.applications, camp]); // eslint-disable-line
  const campaigns = useMemo(() => [...new Set(allQueued.map((a) => a.campaignId || 'manual'))].map((id) => app.campaigns.find((c) => c.id === id) || { id, name: id === 'manual' ? 'Phone & manual' : (allQueued.find((a) => a.campaignId === id) || {}).campaignName || 'Campaign' }), [app.applications, app.campaigns]); // eslint-disable-line
  const needs = app.applications.filter((a) => a.status === 'awaiting-you');
  const submitting = app.applications.filter((a) => a.pendingSubmitUntil && new Date(a.pendingSubmitUntil) > new Date());
  const pendingQ = app.qa.filter((q) => !q.answer).length;
  useEffect(() => { if (!submitting.length) return undefined; const t = setInterval(() => tick((n) => n + 1), 1000); return () => clearInterval(t); }, [submitting.length]);
  useEffect(() => { setSel((s) => new Set([...s].filter((id) => queued.some((a) => a.id === id)))); }, [queued]);

  const vis = queued.slice(0, limit);
  const toggle = (id) => setSel((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const ids = [...sel];

  const skip = async (list) => {
    if (list.length > 1 && !(await app.confirm({ title: `Skip ${list.length} jobs?`, message: 'They move to Skipped in your tracker and won\'t be suggested again.', confirmLabel: 'Skip' }))) return;
    setBusy('skip');
    try { for (const id of list) await patchApplication(app, id, { status: 'skipped' }, { type: 'status', message: 'Skipped in the Review queue' }); app.toast(`Skipped ${list.length}`, 'success'); setSel(new Set()); } catch (e) { app.toast(e.message, 'error'); } finally { setBusy(null); }
  };
  const toLaptop = async (list) => {
    setBusy('laptop');
    try {
      for (const id of list) {
        const a = app.applications.find((x) => x.id === id);
        await sendToLaptop(app, asJob(a), { resumeId: a.resumeId || 'auto', mode, profileId: a.profileId });
        await patchApplication(app, id, {}, { type: 'step', message: `Sent to your laptop (${mode === 'auto' ? 'autopilot' : 'fill, you submit'})` });
      }
      app.toast(`Sent ${list.length} to your laptop. They wait in its Review queue.`, 'success');
      setSel(new Set());
    } catch (e) { app.toast(e.message, 'error'); } finally { setBusy(null); }
  };
  const apply = async (list) => {
    if (!list.length) return;
    if (!native) {
      const a = app.applications.find((x) => x.id === list[0]);
      if (list.length > 1) { app.toast('In the browser you apply one at a time with Quick-fill. Use "Send to laptop" to apply in bulk.', 'info'); }
      openExternal(a.job.applyUrl || a.job.url);
      setQuick(a);
      return;
    }
    setBusy('apply');
    setSel(new Set());
    let done = 0;
    try {
      for (const id of list) {
        const r = await startInAppApply(app, { applicationId: id, mode });
        if (r) done++;
      }
    } finally { setBusy(null); }
    if (list.length > 1) app.toast(`Finished ${done} of ${list.length}`, 'success');
  };
  const markApplied = async (a) => { try { await patchApplication(app, a.id, { status: 'applied' }, { type: 'status', message: 'You submitted it' }); app.toast('Marked as applied ✓', 'success'); } catch (e) { app.toast(e.message, 'error'); } };

  const nothing = !queued.length && !needs.length && !submitting.length && camp === 'all';
  return (
    <div className="col" style={{ gap: 16 }} data-testid="queue-page">
      {pendingQ > 0 && (
        <button type="button" className="card pad row" style={{ gap: 10, color: 'inherit', textAlign: 'left', cursor: 'pointer', width: '100%', borderColor: 'rgba(129,140,248,.4)' }} onClick={() => go('answers')}>
          <MessageSquareText size={18} color="var(--accent-2)" />
          <span className="grow small"><b>{pendingQ} screening question{pendingQ > 1 ? 's' : ''}</b> <span className="muted">— answer once, reused everywhere.</span></span>
        </button>
      )}

      {submitting.length > 0 && (
        <section className="col" style={{ gap: 8 }}>
          <div className="section-title" style={{ margin: 0 }}><Zap size={14} color="var(--green)" />About to submit ({submitting.length})</div>
          {submitting.map((a) => {
            const local = sessions.find((s) => s.id === a.id && s.phase === 'countdown');
            return (
              <motion.div key={a.id} layout className="card pad col premium premium-shimmer" style={{ gap: 10 }} data-testid="submitting-row">
                <div className="row" style={{ gap: 10, position: 'relative', zIndex: 2 }}>
                  <Logo name={a.job.company} size="sm" />
                  <div className="grow"><div className="small ellipsis" style={{ fontWeight: 700 }}>{a.job.title}</div><div className="tiny muted">Submitting in <b style={{ color: 'var(--fg)' }}>{Math.max(0, Math.ceil((new Date(a.pendingSubmitUntil) - Date.now()) / 1000))}s</b>{local ? '' : ' · on your PC'}</div></div>
                </div>
                {local && (
                  <div className="grid g2" style={{ position: 'relative', zIndex: 2 }}>
                    <Button icon={Hand} onClick={() => resolveSubmit(a.id, false)}>Hold</Button>
                    <Button variant="primary" icon={Send} onClick={() => resolveSubmit(a.id, true)}>Submit now</Button>
                  </div>
                )}
              </motion.div>
            );
          })}
        </section>
      )}

      {needs.length > 0 && (
        <section className="col" style={{ gap: 8 }}>
          <div className="section-title" style={{ margin: 0 }}><CircleAlert size={14} color="var(--amber)" />Needs you ({needs.length})</div>
          <AnimatePresence>
            {needs.map((a) => {
              const openCount = openQuestions(app.qa, a.unanswered).length;
              return (
              <motion.div key={a.id} layout initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, x: 40 }} className="card pad col" style={{ gap: 10 }} data-testid="needs-row">
                <div className="row" style={{ gap: 10 }}>
                  <Logo name={a.job.company} size="sm" />
                  <div className="grow"><div className="small ellipsis" style={{ fontWeight: 700 }}>{a.job.title} <span className="muted" style={{ fontWeight: 400 }}>· {a.job.company}</span></div>
                    <div className="tiny muted ellipsis">{((a.events || []).slice(-1)[0] || {}).message || 'Review and submit'}{openCount ? ` · ${openCount} unanswered question${openCount > 1 ? 's' : ''}` : ''}</div></div>
                  <Button size="sm" variant="ghost" icon={X} aria-label="Skip this job" onClick={() => skip([a.id])} />
                </div>
                <div className="grid g3" style={{ gap: 6 }}>
                  <Button size="sm" icon={ExternalLink} onClick={() => { openExternal(a.job.applyUrl || a.job.url); setQuick(a); }}>Finish</Button>
                  <Button size="sm" icon={native ? RotateCw : MessageSquareText} onClick={() => (native ? apply([a.id]) : go('answers'))}>{native ? 'Retry' : 'Answers'}</Button>
                  <Button size="sm" variant="primary" icon={Check} onClick={() => markApplied(a)}>I sent it</Button>
                </div>
                <UnansweredList a={a} />
              </motion.div>
              );
            })}
          </AnimatePresence>
        </section>
      )}

      <section className="col" style={{ gap: 10 }}>
        <div className="row between wrap" style={{ gap: 8 }}>
          <div className="section-title" style={{ margin: 0 }}><Inbox size={14} />Ready for approval (<span data-testid="queue-total">{queued.length}</span>)</div>
          <Button size="sm" variant="ghost" icon={Rocket} onClick={() => go('campaigns')}>Campaigns</Button>
        </div>
        {(allQueued.length > 0 || camp !== 'all') && (
          <div className="col" style={{ gap: 8 }}>
            {campaigns.length > 1 && (
              <select className="select" value={camp} onChange={(e) => { setCamp(e.target.value); setSel(new Set()); }} aria-label="Filter by campaign" data-testid="queue-campaign-filter">
                <option value="all">All campaigns ({allQueued.length})</option>
                {campaigns.map((c) => <option key={c.id} value={c.id}>{c.name} ({allQueued.filter((a) => (a.campaignId || 'manual') === c.id).length})</option>)}
              </select>
            )}
            <div className="row between" style={{ gap: 8 }}>
              <Seg value={mode} onChange={setMode} options={[{ value: 'review', label: 'Fill, I submit' }, { value: 'auto', label: 'Autopilot' }]} />
              <Button size="sm" variant="ghost" onClick={() => setSel(sel.size === vis.length ? new Set() : new Set(vis.map((a) => a.id)))} data-testid="queue-select-all">{sel.size && sel.size === vis.length ? 'Clear' : 'Select all'}</Button>
            </div>
          </div>
        )}
        {queued.length ? (
          <div className="card" style={{ overflow: 'hidden' }}>
            <AnimatePresence initial={false}>
              {vis.map((a) => (
                <motion.div key={a.id} layout initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0, height: 0 }} className="queue-row" style={{ borderBottom: '1px solid var(--border)' }} data-testid="queue-row">
                  <Check2 on={sel.has(a.id)} onClick={() => toggle(a.id)} label={`Select ${a.job.title}`} />
                  <ScoreRing score={a.score || 0} size={38} stroke={3.5} />
                  <button type="button" className="grow" style={{ background: 'none', border: 0, color: 'inherit', textAlign: 'left', padding: '4px 0', cursor: 'pointer', minHeight: 44 }} onClick={() => setOpen(asJob(a))}>
                    <div className="small ellipsis" style={{ fontWeight: 700 }}>{a.job.title}</div>
                    <div className="tiny muted ellipsis">{a.job.company} · {salary(a.job)} {AUTO_ATS.includes(a.job.ats) && <Zap size={10} color="var(--green)" />}</div>
                    <div className="tiny dim ellipsis">{a.campaignName} · {a.resumeName || 'auto resume'} · {timeAgo(a.createdAt)}</div>
                  </button>
                  <Button size="sm" variant="ghost" icon={X} aria-label={`Skip ${a.job.title}`} onClick={() => skip([a.id])} data-testid="queue-skip-one" />
                </motion.div>
              ))}
            </AnimatePresence>
            {queued.length > limit && <div style={{ textAlign: 'center', padding: 10 }}><Button size="sm" onClick={() => setLimit(limit + 40)}>Show more ({queued.length - limit} left)</Button></div>}
          </div>
        ) : (
          <Empty icon={Inbox} title={nothing ? 'Queue is empty' : 'Nothing queued here'} action={<Button variant="primary" icon={Rocket} onClick={() => go('campaigns')}>Go to campaigns</Button>}>
            Campaigns drop their best matches here for one-tap approval.
          </Empty>
        )}
      </section>

      {sel.size > 0 && (
        <motion.div className="sticky-bar" initial={{ y: 20, opacity: 0 }} animate={{ y: 0, opacity: 1 }} data-testid="queue-bulk">
          <Button size="sm" icon={X} loading={busy === 'skip'} onClick={() => skip(ids)} data-testid="queue-skip">Skip</Button>
          <Button size="sm" icon={Laptop} loading={busy === 'laptop'} onClick={() => toLaptop(ids)} data-testid="queue-laptop" className="grow">Laptop</Button>
          <Button size="sm" variant="primary" icon={native ? Send : Smartphone} loading={busy === 'apply'} onClick={() => apply(ids)} data-testid="queue-apply" className="grow">Apply {sel.size}</Button>
        </motion.div>
      )}

      <JobSheet job={open} onClose={() => setOpen(null)} />
      <QuickFillSheet open={!!quick} job={quick && asJob(quick)} resumeId={(quick && quick.resumeId) || 'auto'} profileId={quick && quick.profileId} onClose={() => setQuick(null)} />
    </div>
  );
}
