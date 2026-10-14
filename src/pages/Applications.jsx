import React, { useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { SquareKanban, Download, ExternalLink, Image, Trash2, GraduationCap, Bell, Send, Eraser, Mail, Upload, FileText, CalendarPlus } from 'lucide-react';
import { useApp } from '../lib/store';
import { Button, Drawer, Logo, StatusBadge, Empty, Seg, Markdown, timeAgo, salary, STATUS } from '../components/ui';
import { useDetailsCheck } from '../components/DetailsCheck';

const COLS = [
  { id: 'saved', label: 'Saved', statuses: ['saved'], color: 'var(--muted)' },
  { id: 'queued', label: 'Queued', statuses: ['queued', 'in-progress'], color: 'var(--blue)' },
  { id: 'awaiting-you', label: 'Needs you', statuses: ['awaiting-you'], color: 'var(--amber)' },
  { id: 'applied', label: 'Applied', statuses: ['applied'], color: 'var(--green)' },
  { id: 'interview', label: 'Interview', statuses: ['interview'], color: 'var(--accent-2)' },
  { id: 'offer', label: 'Offer', statuses: ['offer'], color: '#f472b6' },
  { id: 'rejected', label: 'Closed', statuses: ['rejected', 'failed', 'skipped'], color: 'var(--red)' },
];

function AppDrawer({ a, onClose }) {
  const app = useApp();
  const { ensure: ensureDetails, dialog: detailsDialog } = useDetailsCheck();
  const [notes, setNotes] = useState(a ? a.notes || '' : '');
  const [prep, setPrep] = useState(null);
  const [follow, setFollow] = useState(null);
  const [busy, setBusy] = useState(false);
  React.useEffect(() => { setNotes(a ? a.notes || '' : ''); setPrep(null); setFollow(null); }, [a && a.id]); // eslint-disable-line
  if (!a) return <Drawer open={false} onClose={onClose} />;
  const update = (patch, msg) => app.run('applications:update', [a.id, patch], msg);
  return (
    <>
    <Drawer open onClose={onClose} header={(
      <div className="row" style={{ gap: 14, alignItems: 'flex-start', paddingRight: 40 }}>
        <Logo name={a.job.company} src={a.job.companyLogo} />
        <div className="grow">
          <h2 style={{ margin: 0, fontSize: 21 }}>{a.job.title}</h2>
          <div className="small muted" style={{ marginTop: 4 }}>{a.job.company} · {a.job.location || (a.job.remote ? 'Remote' : '')} · {salary(a.job)}</div>
          <div className="row wrap" style={{ marginTop: 12, gap: 8 }}>
            <StatusBadge status={a.status} />
            <select className="select" style={{ width: 180, height: 30, fontSize: 13 }} value={a.status} onChange={(e) => update({ status: e.target.value }, 'Status updated')}>
              {Object.entries(STATUS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
            </select>
            <Button size="sm" icon={ExternalLink} onClick={() => app.run('shell:open', [a.job.applyUrl || a.job.url])}>Open</Button>
            {a.screenshotPath && <Button size="sm" icon={Image} onClick={() => app.run('applications:openScreenshot', [a.id])}>Proof</Button>}
            <Button size="sm" variant="ghost" icon={Trash2} title="Delete from tracker" onClick={async () => {
              if (!(await app.confirm({ title: 'Delete application?', message: `"${a.job.title}" at ${a.job.company} will be removed from your tracker (the employer is not notified).` }))) return;
              await app.run('applications:delete', [a.id]); app.set((s) => ({ applications: s.applications.filter((x) => x.id !== a.id) })); onClose();
            }} />
          </div>
        </div>
      </div>
    )}>
      <div className="col" style={{ gap: 16 }}>
        {['saved', 'queued', 'failed', 'skipped', 'awaiting-you'].includes(a.status) && (
          <div className="card pad row wrap" style={{ gap: 10 }}>
            <span className="small grow">{a.status === 'awaiting-you' ? 'Finish it in the browser, or run it again after answering the open questions.' : a.status === 'failed' ? 'This attempt failed — try again.' : 'Ready when you are.'}</span>
            <select className="select" style={{ width: 200, height: 32 }} value={a.resumeId || ''} onChange={(e) => update({ resumeId: e.target.value }, 'Resume updated')} title="Resume to send">
              {!app.resumes.some((r) => r.id === a.resumeId) && <option value="">✨ Best-matching resume</option>}
              {app.resumes.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
            </select>
            <Button size="sm" variant="ghost" onClick={async () => { if (await ensureDetails(a.profileId || 'main')) app.run('applications:approve', [[a.id], 'review'], 'Opening the pre-filled form…'); }}>Fill, I submit</Button>
            <Button size="sm" variant="primary" icon={Send} disabled={!app.resumes.length} onClick={async () => { if (await ensureDetails(a.profileId || 'main')) app.run('applications:approve', [[a.id], app.plan.autoSubmit ? 'auto' : 'review'], 'Applying…'); }}>{app.plan.autoSubmit ? 'Apply now' : 'Apply'}</Button>
          </div>
        )}
        <div className="grid g3">
          <div className="card pad metric"><div className="k">Match</div><div className="v">{a.score ?? '—'}%</div></div>
          <div className="card pad metric"><div className="k">Resume</div><div className="v small ellipsis" style={{ fontSize: 14 }}>{a.resumeName || '—'}</div></div>
          <div className="card pad metric"><div className="k">Applied</div><div className="v small" style={{ fontSize: 14 }}>{a.appliedAt ? new Date(a.appliedAt).toLocaleDateString() : '—'}</div></div>
        </div>
        <div className="grid g2">
          <label className="field"><span className="field-label">Follow up on</span>
            <input type="date" className="input" value={(a.followUpAt || '').slice(0, 10)} onChange={(e) => update({ followUpAt: e.target.value ? new Date(e.target.value).toISOString() : null })} /></label>
          <label className="field"><span className="field-label">Interview date</span>
            <div className="row" style={{ gap: 6 }}>
              <input type="datetime-local" className="input" value={(a.interviewAt || '').slice(0, 16)} onChange={(e) => update({ interviewAt: e.target.value })} />
              <Button size="sm" icon={CalendarPlus} title="Add to calendar (.ics)" disabled={!a.interviewAt} onClick={() => app.run('applications:exportIcs', [a.id])} />
            </div></label>
        </div>
        <label className="field"><span className="field-label">Notes</span>
          <textarea className="textarea" rows={4} value={notes} onChange={(e) => setNotes(e.target.value)} onBlur={() => notes !== (a.notes || '') && update({ notes })} placeholder="Recruiter name, salary discussed, next steps…" /></label>
        {a.unanswered && a.unanswered.length > 0 && (
          <div className="card pad"><div className="section-title">Unanswered questions</div>
            <ul className="small" style={{ margin: 0, paddingLeft: 18 }}>{a.unanswered.map((q, i) => <li key={i}>{q.question}{q.required ? ' *' : ''}</li>)}</ul>
          </div>
        )}
        {a.tailored && (
          <div className="card pad row between">
            <div><div className="section-title" style={{ margin: 0 }}>Tailored resume</div><div className="small muted">{a.tailored.fileName}{a.tailored.removed && a.tailored.removed.length ? ` · ${a.tailored.removed.length} unsupported claim(s) removed` : ''}</div></div>
            <Button size="sm" icon={ExternalLink} onClick={() => app.run('shell:openPath', [a.tailored.path])}>Open PDF</Button>
          </div>
        )}
        {a.coverLetter && <div className="card pad"><div className="section-title">Cover letter sent</div><div className="small prewrap">{a.coverLetter}</div></div>}
        {['applied', 'interview'].includes(a.status) && (
          <div className="card pad">
            <div className="row between"><div className="section-title" style={{ margin: 0 }}>Follow-up email</div>
              <Button size="sm" icon={Mail} loading={busy === 'follow'} onClick={async () => { setBusy('follow'); try { setFollow(await app.run('ai:followUp', [a.id])); } catch {} finally { setBusy(false); } }}>{follow ? 'Rewrite' : 'Write it for me'}</Button></div>
            {follow && <><div className="small prewrap" style={{ marginTop: 10 }}>{follow}</div><Button size="sm" variant="ghost" style={{ marginTop: 8 }} onClick={() => { navigator.clipboard.writeText(follow); app.toast('Copied', 'success'); }}>Copy</Button></>}
            {!follow && <div className="small dim" style={{ marginTop: 6 }}>A short, polite nudge after ~7 days roughly doubles reply rates.</div>}
          </div>
        )}
        <div className="card pad">
          <div className="row between"><div className="section-title" style={{ margin: 0 }}>Interview prep</div>
            <Button size="sm" icon={GraduationCap} loading={busy === 'prep'} onClick={async () => { setBusy('prep'); try { setPrep(await app.run('ai:interviewPrep', [a.jobId, a.resumeId])); } catch {} finally { setBusy(false); } }}>Generate</Button></div>
          {prep && <div style={{ marginTop: 10 }}><Markdown text={prep} /></div>}
        </div>
        <div className="card pad">
          <div className="section-title">Timeline</div>
          <div className="col" style={{ gap: 8 }}>
            {(a.events || []).slice().reverse().map((e, i) => (
              <div key={i} className="row small" style={{ alignItems: 'flex-start' }}>
                <span className="dot" style={{ marginTop: 7, color: e.type === 'error' || e.type === 'failed' ? 'var(--red)' : e.type === 'submitted' ? 'var(--green)' : 'var(--accent-2)' }} />
                <span className="dim mono-num" style={{ width: 120, flexShrink: 0 }}>{new Date(e.t).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</span>
                <span>{e.message}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </Drawer>
    {detailsDialog}
    </>
  );
}

export default function Applications() {
  const app = useApp();
  const [view, setView] = useState('board');
  const [openId, setOpenId] = useState(null);
  const [dragOver, setDragOver] = useState(null);
  const [q, setQ] = useState('');
  const [colLimit, setColLimit] = useState({});
  const [tableLimit, setTableLimit] = useState(200);
  const clearClosed = async (items) => {
    if (!(await app.confirm({ title: 'Clear closed applications?', message: `${items.length} rejected, failed or skipped application(s) will be removed from your tracker. Jobs you skipped may show up again in future searches.`, confirmLabel: 'Clear' }))) return;
    await app.run('applications:deleteMany', [items.map((a) => a.id)], 'Cleared');
    app.set((s) => ({ applications: s.applications.filter((x) => !items.some((i) => i.id === x.id)) }));
  };
  const list = useMemo(() => app.applications.filter((a) => !q || `${a.job.title} ${a.job.company}`.toLowerCase().includes(q.toLowerCase())), [app.applications, q]);
  const open = app.applications.find((a) => a.id === openId);
  const followUps = app.applications.filter((a) => a.status === 'applied' && a.followUpAt && new Date(a.followUpAt) < new Date());

  const drop = (col, e) => {
    e.preventDefault();
    setDragOver(null);
    const id = e.dataTransfer.getData('text/plain');
    const a = app.applications.find((x) => x.id === id);
    if (a && !col.statuses.includes(a.status)) app.run('applications:update', [id, { status: col.statuses[0] }]);
  };

  return (
    <div className="page" style={{ maxWidth: 1600 }}>
      <div className="page-head">
        <div><h1>Applications</h1><p>Every application, its resume, answers and proof — drag cards as recruiters reply.</p></div>
        <div className="row">
          <input className="input" style={{ width: 220 }} placeholder="Filter…" value={q} onChange={(e) => setQ(e.target.value)} />
          <Seg value={view} onChange={setView} options={[{ value: 'board', label: 'Board' }, { value: 'table', label: 'Table' }]} />
          <Button icon={Upload} title="Import from Teal, Huntr, Simplify or any spreadsheet CSV" onClick={async () => { try { const r = await app.run('applications:import'); if (r) { app.set({ applications: r.applications }); app.toast(`Imported ${r.added} application(s)${r.skipped ? `, ${r.skipped} duplicate(s) skipped` : ''}`, 'success'); } } catch {} }}>Import</Button>
          <Button icon={Download} onClick={() => app.run('data:exportCsv', [], 'Exported')}>CSV</Button>
          <Button icon={FileText} title="Dated log of every application (e.g. for unemployment-benefit work-search requirements)" onClick={async () => { const r = await app.run('data:exportWorkLog', [null]); if (r) app.toast(`Work-search log saved (${r.count} applications, last 4 weeks)`, 'success'); }}>Work log</Button>
        </div>
      </div>
      {followUps.length > 0 && (
        <div className="card pad row" style={{ marginBottom: 16, borderColor: 'rgba(251,191,36,.35)' }}>
          <Bell size={16} color="var(--amber)" /><span className="small"><b>{followUps.length}</b> application{followUps.length > 1 ? 's have' : ' has'} been quiet for a week. A short follow-up email doubles reply rates.</span>
        </div>
      )}
      {!app.applications.length ? (
        <Empty icon={SquareKanban} title="No applications yet" action={<Button variant="primary" onClick={() => app.go('jobs')}>Find jobs</Button>}>Save or apply to a job and it appears here.</Empty>
      ) : view === 'board' ? (
        <div className="kanban">
          {COLS.map((col) => {
            const items = list.filter((a) => col.statuses.includes(a.status));
            return (
              <div key={col.id} className={`kan-col ${dragOver === col.id ? 'drop' : ''}`} onDragOver={(e) => { e.preventDefault(); setDragOver(col.id); }} onDragLeave={() => setDragOver(null)} onDrop={(e) => drop(col, e)}>
                <div className="kan-head"><span className="dot" style={{ color: col.color }} />{col.label}<span className="dim" style={{ marginLeft: 'auto' }}>{items.length}</span>
                  {col.id === 'rejected' && items.length > 0 && <button className="chip-x" style={{ width: 22, height: 22 }} title="Clear closed applications" onClick={() => clearClosed(items)}><Eraser size={12} /></button>}
                </div>
                {items.slice(0, colLimit[col.id] || 60).map((a) => (
                  <motion.div layout layoutId={a.id} key={a.id} className="kan-card" draggable onDragStart={(e) => e.dataTransfer.setData('text/plain', a.id)} onClick={() => setOpenId(a.id)}>
                    <div className="row" style={{ gap: 8 }}>
                      <Logo name={a.job.company} src={a.job.companyLogo} size="sm" />
                      <div className="grow" style={{ minWidth: 0 }}>
                        <div className="small ellipsis" style={{ fontWeight: 700 }}>{a.job.title}</div>
                        <div className="tiny muted ellipsis">{a.job.company}</div>
                      </div>
                    </div>
                    <div className="row between tiny dim" style={{ marginTop: 8 }}>
                      <span>{a.score != null ? `${a.score}% · ` : ''}{a.resumeName || ''}</span>
                      <span>{timeAgo(a.appliedAt || a.updatedAt)}</span>
                    </div>
                  </motion.div>
                ))}
                {items.length > (colLimit[col.id] || 60) && <button className="btn btn-ghost btn-sm" onClick={() => setColLimit((l) => ({ ...l, [col.id]: (l[col.id] || 60) + 100 }))}>Show {Math.min(100, items.length - (colLimit[col.id] || 60))} more</button>}
              </div>
            );
          })}
        </div>
      ) : (
        <div className="card" style={{ overflow: 'hidden' }}>
          <table className="table">
            <thead><tr><th>Role</th><th>Status</th><th>Match</th><th>Resume</th><th>Campaign</th><th>Source</th><th>Updated</th></tr></thead>
            <tbody>
              {list.slice(0, tableLimit).map((a) => (
                <tr key={a.id} style={{ cursor: 'pointer' }} onClick={() => setOpenId(a.id)}>
                  <td><div style={{ fontWeight: 600 }}>{a.job.title}</div><div className="small muted">{a.job.company}</div></td>
                  <td><StatusBadge status={a.status} /></td>
                  <td>{a.score ?? '—'}</td>
                  <td className="small">{a.resumeName}</td>
                  <td className="small muted">{a.campaignName}</td>
                  <td className="small muted">{a.job.source}</td>
                  <td className="small dim">{timeAgo(a.updatedAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {list.length > tableLimit && <div style={{ textAlign: 'center', padding: 12 }}><Button size="sm" onClick={() => setTableLimit(tableLimit + 200)}>Show more ({list.length - tableLimit} left)</Button></div>}
        </div>
      )}
      <AppDrawer a={open} onClose={() => setOpenId(null)} />
    </div>
  );
}

