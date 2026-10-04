import React, { useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { SquareKanban, Download, ExternalLink, Image, Trash2, GraduationCap , Bell } from 'lucide-react';
import { useApp } from '../lib/store';
import { Button, Drawer, Logo, StatusBadge, Empty, Seg, Markdown, timeAgo, salary, STATUS } from '../components/ui';

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
  const [notes, setNotes] = useState(a ? a.notes || '' : '');
  const [prep, setPrep] = useState(null);
  const [busy, setBusy] = useState(false);
  React.useEffect(() => { setNotes(a ? a.notes || '' : ''); setPrep(null); }, [a && a.id]); // eslint-disable-line
  if (!a) return <Drawer open={false} onClose={onClose} />;
  const update = (patch, msg) => app.run('applications:update', [a.id, patch], msg);
  return (
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
            <Button size="sm" variant="ghost" icon={Trash2} onClick={async () => { await app.run('applications:delete', [a.id]); app.set((s) => ({ applications: s.applications.filter((x) => x.id !== a.id) })); onClose(); }} />
          </div>
        </div>
      </div>
    )}>
      <div className="col" style={{ gap: 16 }}>
        <div className="grid g3">
          <div className="card pad metric"><div className="k">Match</div><div className="v">{a.score ?? '—'}%</div></div>
          <div className="card pad metric"><div className="k">Resume</div><div className="v small ellipsis" style={{ fontSize: 14 }}>{a.resumeName || '—'}</div></div>
          <div className="card pad metric"><div className="k">Applied</div><div className="v small" style={{ fontSize: 14 }}>{a.appliedAt ? new Date(a.appliedAt).toLocaleDateString() : '—'}</div></div>
        </div>
        <div className="grid g2">
          <label className="field"><span className="field-label">Follow up on</span>
            <input type="date" className="input" value={(a.followUpAt || '').slice(0, 10)} onChange={(e) => update({ followUpAt: e.target.value ? new Date(e.target.value).toISOString() : null })} /></label>
          <label className="field"><span className="field-label">Interview date</span>
            <input type="datetime-local" className="input" value={(a.interviewAt || '').slice(0, 16)} onChange={(e) => update({ interviewAt: e.target.value })} /></label>
        </div>
        <label className="field"><span className="field-label">Notes</span>
          <textarea className="textarea" rows={4} value={notes} onChange={(e) => setNotes(e.target.value)} onBlur={() => notes !== (a.notes || '') && update({ notes })} placeholder="Recruiter name, salary discussed, next steps…" /></label>
        {a.unanswered && a.unanswered.length > 0 && (
          <div className="card pad"><div className="section-title">Unanswered questions</div>
            <ul className="small" style={{ margin: 0, paddingLeft: 18 }}>{a.unanswered.map((q, i) => <li key={i}>{q.question}{q.required ? ' *' : ''}</li>)}</ul>
          </div>
        )}
        {a.coverLetter && <div className="card pad"><div className="section-title">Cover letter sent</div><div className="small prewrap">{a.coverLetter}</div></div>}
        <div className="card pad">
          <div className="row between"><div className="section-title" style={{ margin: 0 }}>Interview prep</div>
            <Button size="sm" icon={GraduationCap} loading={busy} onClick={async () => { setBusy(true); try { setPrep(await app.run('ai:interviewPrep', [a.jobId, a.resumeId])); } catch {} finally { setBusy(false); } }}>Generate</Button></div>
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
  );
}

export default function Applications() {
  const app = useApp();
  const [view, setView] = useState('board');
  const [openId, setOpenId] = useState(null);
  const [dragOver, setDragOver] = useState(null);
  const [q, setQ] = useState('');
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
          <Button icon={Download} onClick={() => app.run('data:exportCsv', [], 'Exported')}>CSV</Button>
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
                <div className="kan-head"><span className="dot" style={{ color: col.color }} />{col.label}<span className="dim" style={{ marginLeft: 'auto' }}>{items.length}</span></div>
                {items.slice(0, 120).map((a) => (
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
              </div>
            );
          })}
        </div>
      ) : (
        <div className="card" style={{ overflow: 'hidden' }}>
          <table className="table">
            <thead><tr><th>Role</th><th>Status</th><th>Match</th><th>Resume</th><th>Campaign</th><th>Source</th><th>Updated</th></tr></thead>
            <tbody>
              {list.map((a) => (
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
        </div>
      )}
      <AppDrawer a={open} onClose={() => setOpenId(null)} />
    </div>
  );
}

