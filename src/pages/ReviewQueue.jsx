import React, { useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Inbox, Check, X, ExternalLink, Send, Zap, CircleAlert, MessageSquareText, RotateCw } from 'lucide-react';
import { useApp } from '../lib/store';
import { Button, Logo, ScoreRing, Empty, Seg, timeAgo, salary } from '../components/ui';
import { JobDrawer, AUTO_ATS } from '../components/jobs';

export default function ReviewQueue() {
  const app = useApp();
  const [sel, setSel] = useState(new Set());
  const [mode, setMode] = useState(app.plan.autoSubmit ? 'auto' : 'review');
  const [open, setOpen] = useState(null);
  const needs = app.applications.filter((a) => a.status === 'awaiting-you');
  const queued = useMemo(() => app.applications.filter((a) => a.status === 'queued').sort((a, b) => (b.score || 0) - (a.score || 0)), [app.applications]);
  const pendingQ = app.qa.filter((q) => !q.answer).length;

  const toggle = (id) => setSel((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const approve = async (ids) => {
    if (!ids.length) return;
    await app.run('applications:approve', [ids, mode], `Applying to ${ids.length} job${ids.length > 1 ? 's' : ''}…`);
    setSel(new Set());
  };
  const skip = async (ids) => { for (const id of ids) await app.run('applications:update', [id, { status: 'skipped' }]); setSel(new Set()); };
  const mark = (id, status) => app.run('applications:update', [id, { status }], status === 'applied' ? 'Marked as applied ✓' : undefined);
  const setResume = (id, resumeId) => app.run('applications:update', [id, { resumeId }]);

  return (
    <div className="page">
      <div className="page-head">
        <div><h1>Review queue</h1><p>You stay in control: approve matches in bulk, and finish anything ApplyPilot couldn't answer with certainty.</p></div>
      </div>

      {pendingQ > 0 && (
        <motion.div className="card pad row between" style={{ marginBottom: 20, borderColor: 'rgba(129,140,248,.4)' }} initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
          <div className="row"><MessageSquareText size={18} color="var(--accent-2)" /><span><b>{pendingQ} new screening question{pendingQ > 1 ? 's' : ''}</b> <span className="muted">— answer once and ApplyPilot remembers forever.</span></span></div>
          <Button size="sm" variant="primary" onClick={() => app.go('qa')}>Answer now</Button>
        </motion.div>
      )}

      {needs.length > 0 && (
        <section style={{ marginBottom: 32 }}>
          <div className="section-title"><CircleAlert size={14} color="var(--amber)" />Needs you ({needs.length})</div>
          <div className="col">
            <AnimatePresence>
              {needs.map((a) => (
                <motion.div key={a.id} layout initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, x: 40 }} className="card pad row" style={{ gap: 14 }}>
                  <Logo name={a.job.company} src={a.job.companyLogo} size="sm" />
                  <div className="grow">
                    <div style={{ fontWeight: 700 }} className="ellipsis">{a.job.title} <span className="muted" style={{ fontWeight: 400 }}>· {a.job.company}</span></div>
                    <div className="small muted ellipsis">{(a.events || []).slice(-1)[0]?.message || 'Review and submit'}{a.unanswered && a.unanswered.length ? ` · ${a.unanswered.length} unanswered question(s)` : ''}</div>
                  </div>
                  <Button size="sm" icon={ExternalLink} onClick={() => app.run('browser:open', [a.job.applyUrl || a.job.url])}>Open & finish</Button>
                  <Button size="sm" icon={RotateCw} onClick={() => approve([a.id])}>Retry</Button>
                  <Button size="sm" variant="primary" icon={Check} onClick={() => mark(a.id, 'applied')}>I submitted it</Button>
                  <Button size="sm" variant="ghost" icon={X} onClick={() => mark(a.id, 'skipped')} />
                </motion.div>
              ))}
            </AnimatePresence>
          </div>
        </section>
      )}

      <section>
        <div className="row between" style={{ marginBottom: 12 }}>
          <div className="section-title" style={{ margin: 0 }}><Inbox size={14} />Ready for approval ({queued.length})</div>
          {queued.length > 0 && (
            <div className="row">
              <Seg value={mode} onChange={setMode} options={[{ value: 'review', label: 'Fill, I submit' }, { value: 'auto', label: 'Autopilot' }]} />
              <Button size="sm" variant="ghost" onClick={() => setSel(sel.size === queued.length ? new Set() : new Set(queued.map((a) => a.id)))}>{sel.size === queued.length ? 'Clear' : 'Select all'}</Button>
              <Button size="sm" icon={X} disabled={!sel.size} onClick={() => skip([...sel])}>Skip</Button>
              <Button size="sm" variant="primary" icon={Send} disabled={!sel.size} onClick={() => approve([...sel])}>Apply to {sel.size || ''} selected</Button>
            </div>
          )}
        </div>
        {queued.length ? (
          <div className="card" style={{ overflow: 'hidden' }}>
            <table className="table">
              <thead><tr><th style={{ width: 36 }} /><th>Match</th><th>Role</th><th>Salary</th><th>Campaign</th><th>Resume</th><th>Found</th><th /></tr></thead>
              <tbody>
                <AnimatePresence>
                  {queued.map((a) => (
                    <motion.tr key={a.id} layout initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                      <td><input type="checkbox" checked={sel.has(a.id)} onChange={() => toggle(a.id)} style={{ accentColor: 'var(--accent)', width: 16, height: 16 }} /></td>
                      <td><ScoreRing score={a.score || 0} size={38} stroke={3.5} /></td>
                      <td style={{ maxWidth: 340, cursor: 'pointer' }} onClick={() => setOpen({ id: a.jobId, ...a.job, match: a.match })}>
                        <div className="ellipsis" style={{ fontWeight: 600 }}>{a.job.title}</div>
                        <div className="small muted ellipsis">{a.job.company} · {a.job.location || (a.job.remote ? 'Remote' : '')} {AUTO_ATS.includes(a.job.ats) && <Zap size={11} color="var(--green)" />}</div>
                      </td>
                      <td className="small">{salary(a.job)}</td>
                      <td className="small muted">{a.campaignName}</td>
                      <td>
                        <select className="select" style={{ height: 30, fontSize: 13, width: 170 }} value={a.resumeId || ''} onChange={(e) => setResume(a.id, e.target.value)}>
                          {app.resumes.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
                        </select>
                      </td>
                      <td className="small dim">{timeAgo(a.createdAt)}</td>
                      <td><div className="row" style={{ gap: 2 }}><Button size="sm" variant="ghost" icon={X} onClick={() => skip([a.id])} /><Button size="sm" icon={Send} onClick={() => approve([a.id])} /></div></td>
                    </motion.tr>
                  ))}
                </AnimatePresence>
              </tbody>
            </table>
          </div>
        ) : (
          <Empty icon={Inbox} title="Queue is empty" action={<Button variant="primary" onClick={() => app.go('campaigns')}>Go to campaigns</Button>}>
            Campaigns in "Review queue" mode drop their best matches here for one-click approval.
          </Empty>
        )}
      </section>
      <JobDrawer job={open} onClose={() => setOpen(null)} />
    </div>
  );
}
