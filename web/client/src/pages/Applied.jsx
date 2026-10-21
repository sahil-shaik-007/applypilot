import React, { useEffect, useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { SquareKanban, ExternalLink, Trash2, Laptop, Search, ChevronDown, Undo2, Upload, Download, FileText, Bell, Mail, GraduationCap, Zap, MoreHorizontal, Eraser, Copy } from 'lucide-react';
import { useApp, go } from '../lib/store.jsx';
import { Button, Sheet, Logo, StatusBadge, Empty, Seg, Markdown, timeAgo, salary, STATUS, stagger, copyText } from '../components/ui.jsx';
import { openExternal, sendToLaptop } from '../lib/apply.js';
import { getProfile, pickResumeFor, profileIdOfApplication } from '../lib/profiles.js';
import { ResumeSelect } from '../components/jobs.jsx';
import { TailoredCard, startInAppApply, UnansweredList, ReviewAndApply } from '../components/apply.jsx';
import { openQuestions } from '../lib/applyFlow.js';
import { useApplyTarget } from '../lib/bridge.js';
import { outreach, interviewPrep, aiError, DEFAULT_MODEL } from '../lib/ai.js';
import { importTracker, exportWorkLog, exportTrackerCsv, readCsvFile } from '../lib/trackerIo.js';

const waitingCount = (app, a) => openQuestions(app.qa, a.unanswered, profileIdOfApplication(app, a)).filter((i) => !i.answerRec).length;

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
  const [ai, setAi] = useState({});
  useEffect(() => { setNotes(a ? a.notes || '' : ''); setAi({}); }, [a && a.id]); // eslint-disable-line
  const target = useApplyTarget();
  const native = target !== 'none';
  const runAi = async (k, fn, extra = {}) => {
    const resume = pickResumeFor(app, a.job, a.resumeId || 'auto', a.profileId);
    setBusy(k);
    try { const r = await fn({ apiKey: app.settings.anthropicKey, model: app.settings.aiModel || DEFAULT_MODEL, profile: getProfile(app, a.profileId).values, resumeText: resume ? resume.text : '', job: { ...a.job, id: a.jobId }, ...extra }); setAi((o) => ({ ...o, [k]: r })); } catch (e) { app.toast(aiError(e), 'error'); } finally { setBusy(null); }
  };
  const days = a && a.appliedAt ? Math.max(1, Math.round((Date.now() - new Date(a.appliedAt)) / 86400000)) : 7;
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
          {['saved', 'queued', 'failed', 'awaiting-you'].includes(a.status) && (
            <div className={native && a.status !== 'awaiting-you' ? 'grid g2' : 'col'} style={{ gap: 8 }}>
              {native && <Button variant="primary" icon={Zap} loading={busy === 'inapp'} onClick={async () => { setBusy('inapp'); try { await startInAppApply(app, { applicationId: a.id }); } finally { setBusy(null); } }} data-testid="app-apply-inapp">{a.status === 'awaiting-you' || a.status === 'failed' ? (target === 'browser' ? 'Retry in browser' : 'Retry in app') : (target === 'browser' ? 'Apply in browser' : 'Apply in app')}</Button>}
              {a.status !== 'awaiting-you' && <Button icon={Laptop} loading={busy === 'send'} onClick={async () => { setBusy('send'); try { await sendToLaptop(app, { ...a.job, id: a.jobId, match: a.match }, { resumeId: a.resumeId || 'auto', profileId: a.profileId }); app.toast('Sent to your laptop', 'success'); } catch (e) { app.toast(e.message, 'error'); } finally { setBusy(null); } }}>Send to laptop</Button>}
            </div>
          )}
          <div className="grid g2">
            <label className="field"><span className="label">Follow up on</span>
              <input type="date" className="input" value={(a.followUpAt || '').slice(0, 10)} onChange={(e) => update({ followUpAt: e.target.value ? new Date(`${e.target.value}T09:00:00`).toISOString() : null }, 'Follow-up date saved')} data-testid="followup-date" /></label>
            <label className="field"><span className="label">Interview</span>
              <input type="datetime-local" className="input" value={(a.interviewAt || '').slice(0, 16)} onChange={(e) => update({ interviewAt: e.target.value || null }, 'Interview date saved')} /></label>
          </div>
          {(openQuestions(app.qa, a.unanswered, profileIdOfApplication(app, a)).length > 0 || a.status === 'awaiting-you') && (
            <div className="card pad col" style={{ gap: 10 }}>
              <UnansweredList a={a} />
              {a.status === 'awaiting-you' && <ReviewAndApply a={a} />}
            </div>
          )}
          <TailoredCard job={{ ...a.job, id: a.jobId }} resumeId={a.resumeId || 'auto'} applicationId={a.id} />
          {a.coverLetter && <div className="card pad"><div className="row between"><div className="section-title" style={{ margin: 0 }}>Cover letter</div><Button size="sm" variant="ghost" icon={Copy} aria-label="Copy cover letter" onClick={async () => { await copyText(a.coverLetter); app.toast('Copied', 'success'); }} /></div><div className="small prewrap" style={{ marginTop: 6 }}>{a.coverLetter}</div></div>}
          {['applied', 'interview'].includes(a.status) && (
            <div className="card pad col" style={{ gap: 8 }}>
              <div className="row between"><div className="section-title" style={{ margin: 0 }}><Mail size={14} />Follow-up email</div>
                <Button size="sm" icon={Mail} loading={busy === 'follow'} disabled={!app.settings.anthropicKey} onClick={() => runAi('follow', outreach, { kind: 'followup', days })} data-testid="write-followup">{ai.follow ? 'Rewrite' : 'Write it'}</Button></div>
              {ai.follow ? <><div className="small prewrap" data-testid="followup-text">{ai.follow}</div><Button size="sm" variant="ghost" icon={Copy} onClick={async () => { await copyText(ai.follow); app.toast('Copied', 'success'); }}>Copy</Button></>
                : <div className="small dim">{app.settings.anthropicKey ? 'A short, polite nudge after ~7 days roughly doubles reply rates.' : 'Add your Anthropic key in AI studio to write it.'}</div>}
            </div>
          )}
          <div className="card pad col" style={{ gap: 8 }}>
            <div className="row between"><div className="section-title" style={{ margin: 0 }}><GraduationCap size={14} />Interview prep</div>
              <Button size="sm" icon={GraduationCap} loading={busy === 'prep'} disabled={!app.settings.anthropicKey} onClick={() => runAi('prep', interviewPrep)}>Generate</Button></div>
            {ai.prep && <Markdown text={ai.prep} />}
          </div>
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

  const fileRef = React.useRef(null);
  const [tools, setTools] = useState(false);
  const [busy, setBusy] = useState('');
  const followUps = app.applications.filter((a) => a.status === 'applied' && a.followUpAt && new Date(a.followUpAt) < new Date());
  const onImport = async (files) => {
    const f = files && files[0];
    if (!f) return;
    setBusy('import');
    try { const r = await importTracker(app, await readCsvFile(f), f.name); app.toast(`Imported ${r.added} application(s)${r.skipped ? `, ${r.skipped} duplicate(s) skipped` : ''}`, 'success'); setTools(false); } catch (e) { app.toast(e.message, 'error'); } finally { setBusy(''); if (fileRef.current) fileRef.current.value = ''; }
  };
  const workLog = async () => { setBusy('log'); try { const r = await exportWorkLog(app); app.toast(`Work-search log saved (${r.count} applications, last 4 weeks)`, 'success'); } catch (e) { app.toast(e.message, 'error'); } finally { setBusy(''); } };
  const csv = async () => { setBusy('csv'); try { const r = await exportTrackerCsv(app); app.toast(`Exported ${r.count} applications`, 'success'); } catch (e) { app.toast(e.message, 'error'); } finally { setBusy(''); } };
  const clearClosed = async () => {
    const items = app.applications.filter((a) => ['rejected', 'failed', 'skipped'].includes(a.status));
    if (!items.length) { app.toast('Nothing to clear', 'info'); return; }
    if (!(await app.confirm({ title: 'Clear closed applications?', message: `${items.length} rejected, failed or skipped application(s) are removed from your tracker on every device. Skipped jobs may show up again in searches.`, confirmLabel: 'Clear' }))) return;
    setBusy('clear');
    try { for (const a of items) await app.remove('applications', a.id); app.toast('Cleared', 'success'); setTools(false); } catch (e) { app.toast(e.message, 'error'); } finally { setBusy(''); }
  };
  const toolsSheet = (
    <Sheet open={tools} onClose={() => setTools(false)} title="Import & export">
      <div className="col" style={{ gap: 10 }} data-testid="tracker-tools">
        <Button icon={Upload} loading={busy === 'import'} onClick={() => fileRef.current.click()} data-testid="tracker-import">Import CSV (Teal, Huntr, Simplify…)</Button>
        <div className="tiny dim">Columns are detected automatically (Company, Title/Position, Status, Date…). Duplicates are skipped.</div>
        <Button icon={FileText} loading={busy === 'log'} onClick={workLog} data-testid="work-log">Work-search log (last 4 weeks)</Button>
        <div className="tiny dim">Dated list of every application, e.g. for unemployment-benefit work-search requirements.</div>
        <Button icon={Download} loading={busy === 'csv'} onClick={csv}>Export all as CSV</Button>
        <Button variant="danger" icon={Eraser} loading={busy === 'clear'} onClick={clearClosed}>Clear closed applications</Button>
        <input ref={fileRef} type="file" accept=".csv,text/csv" hidden onChange={(e) => onImport(e.target.files)} data-testid="tracker-file" />
      </div>
    </Sheet>
  );

  const unskip = async (a) => { try { await app.remove('applications', a.id); app.toast('Un-skipped. It will show in searches again.', 'success'); } catch (e) { app.toast(e.message, 'error'); } };

  if (!app.applications.length) {
    return <><Empty icon={SquareKanban} title="No applications yet" action={<div className="col" style={{ gap: 8 }}><Button variant="primary" onClick={() => go('jobs')}>Find jobs</Button><Button icon={Upload} onClick={() => setTools(true)} data-testid="tracker-tools-open">Import from another tracker</Button></div>}>Save a job, apply from your phone, or send one to your laptop and track it here.</Empty>{toolsSheet}</>;
  }
  return (
    <div className="col" style={{ gap: 14 }}>
      <div className="row" style={{ gap: 8 }}>
        <div className="search-wrap grow"><Search size={16} /><input className="input" style={{ height: 44 }} value={text} onChange={(e) => setText(e.target.value)} placeholder="Search applications" aria-label="Search applications" /></div>
        <Seg value={filter} onChange={setFilter} options={[{ value: 'active', label: 'Active' }, { value: 'all', label: 'All' }]} />
        <Button icon={MoreHorizontal} aria-label="Import & export" onClick={() => setTools(true)} data-testid="tracker-tools-open" />
      </div>
      {followUps.length > 0 && (
        <div className="card pad row" style={{ gap: 10, borderColor: 'rgba(251,191,36,.35)' }}>
          <Bell size={16} color="var(--amber)" style={{ flexShrink: 0 }} /><span className="small"><b>{followUps.length}</b> application{followUps.length > 1 ? 's have' : ' has'} been quiet for a week. Open one and tap "Write it" for a follow-up email.</span>
        </div>
      )}
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
                      <div className="tiny dim ellipsis">{a.job.company} · {timeAgo(a.updatedAt)}{a.notes ? ' · 📝' : ''}{a.status === 'awaiting-you' && waitingCount(app, a) ? ` · waiting for your answer${waitingCount(app, a) > 1 ? 's' : ''} (${waitingCount(app, a)})` : ''}</div>
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
      {toolsSheet}
    </div>
  );
}
