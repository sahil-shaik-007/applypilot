import React, { useEffect, useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { SquareKanban, ExternalLink, Trash2, Laptop, Search, ChevronDown, Undo2 } from 'lucide-react';
import { useApp, go } from '../lib/store.jsx';
import { Button, Sheet, Logo, StatusBadge, Empty, Seg, timeAgo, salary, STATUS, stagger } from '../components/ui.jsx';
import { openExternal, sendToLaptop } from '../lib/apply.js';
import { ResumeSelect } from '../components/jobs.jsx';

const GROUPS = [
  { id: 'awaiting-you', label: 'Needs you', statuses: ['awaiting-you'], color: 'var(--amber)' },
  { id: 'saved', label: 'Saved', statuses: ['saved'], color: 'var(--muted)' },
  { id: 'queued', label: 'Queued', statuses: ['queued', 'in-progress'], color: 'var(--blue)' },
  { id: 'applied', label: 'Applied', statuses: ['applied'], color: 'var(--green)' },
  { id: 'interview', label: 'Interview', statuses: ['interview'], color: 'var(--accent-2)' },
  { id: 'offer', label: 'Offer', statuses: ['offer'], color: '#f472b6' },
  { id: 'closed', label: 'Closed', statuses: ['rejected', 'failed'], color: 'var(--red)' },
  { id: 'skipped', label: 'Skipped', statuses: ['skipped'], color: 'var(--muted-2)' },
];

function AppSheet({ a, onClose }) {
  const app = useApp();
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(null);
  useEffect(() => { setNotes(a ? a.notes || '' : ''); }, [a && a.id]); // eslint-disable-line
  const update = async (patch, msg, ev) => {
    const now = new Date().toISOString();
    const next = { ...a, ...patch, updatedAt: now, events: [...(a.events || []), ...(ev ? [{ t: now, type: 'status', message: ev }] : [])] };
    if (patch.status === 'applied' && !a.appliedAt) next.appliedAt = now;
    try { await app.put('applications', a.id, next); if (msg) app.toast(msg, 'success'); } catch (e) { app.toast(e.message, 'error'); }
  };
  const del = async () => {
    if (!(await app.confirm({ title: 'Delete application?', message: `"${a.job.title}" at ${a.job.company} will be removed from your tracker on every device. The employer is not notified.` }))) return;
    try { await app.remove('applications', a.id); app.toast('Deleted', 'success'); onClose(); } catch (e) { app.toast(e.message, 'error'); }
  };
  return (
    <Sheet open={!!a} onClose={onClose} tall label="Application" header={a && (
      <div className="row" style={{ gap: 12, alignItems: 'flex-start' }}>
        <Logo name={a.job.company} />
        <div className="grow"><h2 style={{ marginTop: 2 }}>{a.job.title}</h2><div className="small muted">{a.job.company}{a.job.location ? ` · ${a.job.location}` : ''} · {salary(a.job)}</div></div>
      </div>
    )} footer={a && (
      <>
        <Button size="lg" variant="danger" icon={Trash2} onClick={del} data-testid="delete-app">Delete</Button>
        <Button size="lg" icon={ExternalLink} onClick={() => openExternal(a.job.applyUrl || a.job.url)}>Open job</Button>
      </>
    )}>
      {a && (
        <div className="col" style={{ gap: 16 }}>
          <div className="grid g2">
            <label className="field"><span className="label">Status</span>
              <select className="select" value={a.status} onChange={(e) => update({ status: e.target.value }, 'Status updated', `Status → ${STATUS[e.target.value] ? STATUS[e.target.value].label : e.target.value}`)} data-testid="status-select">
                {Object.entries(STATUS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
              </select></label>
            <div className="field"><span className="label">Resume</span><ResumeSelect value={a.resumeId || 'auto'} onChange={(v) => { const r = app.resumes.find((x) => x.id === v); update({ resumeId: v === 'auto' ? null : v, resumeName: r ? r.name : null }, 'Resume updated'); }} /></div>
          </div>
          <div className="grid g3">
            <div className="card pad metric"><div className="k">Match</div><div className="v">{a.score ?? '—'}{a.score != null && '%'}</div></div>
            <div className="card pad metric"><div className="k">Applied</div><div className="v small">{a.appliedAt ? timeAgo(a.appliedAt) : '—'}</div></div>
            <div className="card pad metric"><div className="k">From</div><div className="v small ellipsis">{a.source === 'web' ? 'Phone' : a.campaignName || 'Desktop'}</div></div>
          </div>
          {['saved', 'failed', 'awaiting-you'].includes(a.status) && (
            <Button icon={Laptop} loading={busy === 'send'} onClick={async () => { setBusy('send'); try { await sendToLaptop(app, { ...a.job, id: a.jobId, match: a.match }, { resumeId: a.resumeId || 'auto' }); app.toast('Sent to your laptop', 'success'); } catch (e) { app.toast(e.message, 'error'); } finally { setBusy(null); } }}>Send to my laptop</Button>
          )}
          <label className="field">
            <span className="label">Notes</span>
            <textarea className="textarea" rows={4} value={notes} onChange={(e) => setNotes(e.target.value)} onBlur={() => notes !== (a.notes || '') && update({ notes }, 'Notes saved')} placeholder="Recruiter name, interview dates, salary discussed…" data-testid="app-notes" />
            <span className="help">Saved (encrypted) when you leave the field.</span>
          </label>
          <div className="card pad">
            <div className="section-title">Activity</div>
            <div className="col" style={{ gap: 6 }}>
              {(a.events || []).slice().reverse().map((e, i) => (
                <div key={i} className="row small" style={{ alignItems: 'flex-start' }}><span className="dim mono-num" style={{ width: 70, flexShrink: 0 }}>{timeAgo(e.t)}</span><span className="grow break">{e.message}</span></div>
              ))}
            </div>
          </div>
        </div>
      )}
    </Sheet>
  );
}

export default function Applied({ params }) {
  const app = useApp();
  const [filter, setFilter] = useState('active');
  const [text, setText] = useState('');
  const [openId, setOpenId] = useState(params.id || null);
  const [collapsed, setCollapsed] = useState({ skipped: true });
  useEffect(() => { if (params.id) setOpenId(params.id); }, [params.id]);
  const list = useMemo(() => {
    const t = text.toLowerCase();
    return app.applications.filter((a) => !t || `${a.job.title} ${a.job.company}`.toLowerCase().includes(t));
  }, [app.applications, text]);
  const groups = GROUPS.filter((g) => filter === 'all' || !['closed', 'skipped'].includes(g.id))
    .map((g) => ({ ...g, items: list.filter((a) => g.statuses.includes(a.status)) })).filter((g) => g.items.length);
  const open = app.applications.find((a) => a.id === openId);

  const unskip = async (a) => { try { await app.remove('applications', a.id); app.toast('Un-skipped. It will show in searches again.', 'success'); } catch (e) { app.toast(e.message, 'error'); } };

  if (!app.applications.length) {
    return <Empty icon={SquareKanban} title="No applications yet" action={<Button variant="primary" onClick={() => go('jobs')}>Find jobs</Button>}>Save a job, apply from your phone, or send one to your laptop and track it here.</Empty>;
  }
  return (
    <div className="col" style={{ gap: 14 }}>
      <div className="row" style={{ gap: 8 }}>
        <div className="search-wrap grow"><Search size={16} /><input className="input" style={{ height: 44 }} value={text} onChange={(e) => setText(e.target.value)} placeholder="Search applications" aria-label="Search applications" /></div>
        <Seg value={filter} onChange={setFilter} options={[{ value: 'active', label: 'Active' }, { value: 'all', label: 'All' }]} />
      </div>
      {groups.map((g) => (
        <div key={g.id} data-testid={`group-${g.id}`}>
          <button type="button" className="row between" style={{ width: '100%', background: 'none', border: 0, color: 'inherit', padding: '6px 0', minHeight: 44, cursor: 'pointer' }} onClick={() => setCollapsed((c) => ({ ...c, [g.id]: !c[g.id] }))} aria-expanded={!collapsed[g.id]}>
            <span className="row" style={{ gap: 8 }}><span className="dot" style={{ color: g.color }} /><span className="section-title" style={{ margin: 0 }}>{g.label}</span><span className="badge">{g.items.length}</span></span>
            <ChevronDown size={16} style={{ transform: collapsed[g.id] ? 'rotate(-90deg)' : 'none', transition: 'transform .2s' }} />
          </button>
          <AnimatePresence initial={false}>
            {!collapsed[g.id] && (
              <motion.div className="col" style={{ gap: 8, overflow: 'hidden' }} initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }}>
                {g.items.map((a, i) => (
                  <motion.div key={a.id} {...stagger(i)} className="card clickable row" style={{ padding: 12, gap: 12 }} onClick={() => setOpenId(a.id)} data-testid="app-card" role="button" tabIndex={0}>
                    <Logo name={a.job.company} size="sm" />
                    <div className="grow">
                      <div className="small ellipsis" style={{ fontWeight: 700 }}>{a.job.title}</div>
                      <div className="tiny dim ellipsis">{a.job.company} · {timeAgo(a.updatedAt)}{a.notes ? ' · 📝' : ''}</div>
                    </div>
                    {g.id === 'skipped' ? <Button size="sm" variant="ghost" icon={Undo2} aria-label="Un-skip" onClick={(e) => { e.stopPropagation(); unskip(a); }} /> : <StatusBadge status={a.status} />}
                  </motion.div>
                ))}
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      ))}
      {!groups.length && <Empty icon={Search} title="Nothing matches">Try another search or show all.</Empty>}
      <AppSheet a={open} onClose={() => { setOpenId(null); if (params.id) go('applied'); }} />
    </div>
  );
}
