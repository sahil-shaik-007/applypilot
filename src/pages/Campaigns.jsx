import React, { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Rocket, Play, Pause, Pencil, Trash2, Plus, Loader2, FileText, Clock, Zap, Search as SearchIcon } from 'lucide-react';
import { useApp } from '../lib/store';
import { Button, Modal, Field, TagInput, Seg, MultiChips, Empty, Progress, PeriodPicker, periodLabel, timeAgo, stagger } from '../components/ui';

const PHASE = { searching: 'Searching all sources', scoring: 'Scoring matches', applying: 'Applying', sleeping: 'Waiting for next run', idle: 'Idle' };
const MODES = [
  { value: 'queue', label: 'Review queue', help: 'Finds & ranks matches; you approve each one. Safest.' },
  { value: 'review', label: 'Fill, I submit', help: 'Opens each application pre-filled; you click submit.' },
  { value: 'auto', label: 'Full autopilot', help: 'Submits Greenhouse/Lever/Ashby/Workable forms automatically when every answer is known. Others are pre-filled for you.' },
];
const COLORS = ['#6366f1', '#22d3ee', '#f472b6', '#f59e0b', '#10b981', '#a78bfa', '#fb7185'];

export function CampaignEditor({ open, onClose, initial }) {
  const app = useApp();
  const profile = app.profile.values || {};
  const blank = { name: '', roles: [], locations: profile.preferredLocations || [], remote: 'any', resumeId: 'auto', mode: 'queue', minScore: app.settings.minMatchScore || 55, dailyLimit: 25, intervalMinutes: 60, coverLetter: 'ai', sources: [], includeKeywords: [], excludeKeywords: [], excludeCompanies: [], countries: [], postedWithinHours: 0, postedMonths: [] };
  const [c, setC] = useState(blank);
  const [saving, setSaving] = useState(false);
  useEffect(() => { if (open) setC({ ...blank, ...(initial || {}) }); }, [open]); // eslint-disable-line
  const up = (k) => (v) => setC((x) => ({ ...x, [k]: v }));

  const save = async (start) => {
    if (!c.roles.length) return app.toast('Add at least one job title', 'error');
    setSaving(true);
    try {
      const saved = await app.run('campaigns:save', [{ ...c, name: c.name || c.roles[0], color: c.color || COLORS[app.campaigns.length % COLORS.length] }]);
      if (start) await app.run('campaigns:start', [saved.id], 'Campaign started — it runs in parallel with your others');
      onClose();
    } catch {} finally { setSaving(false); }
  };

  const ready = app.connectors.filter((x) => x.ready);
  return (
    <Modal open={open} onClose={onClose} title={c.id ? 'Edit campaign' : 'New campaign'} wide footer={<>
      <Button variant="ghost" onClick={onClose}>Cancel</Button>
      <Button onClick={() => save(false)} loading={saving}>Save</Button>
      <Button variant="primary" icon={Play} onClick={() => save(true)} loading={saving}>Save & start</Button>
    </>}>
      <div className="col" style={{ gap: 18 }}>
        <div className="grid g2">
          <Field label="Job titles to target" required help="Each title is searched separately. Add variants: 'Backend Engineer', 'Node.js Developer'…">
            <TagInput value={c.roles} onChange={up('roles')} placeholder="e.g. Data Analyst" suggestions={profile.desiredTitles} />
          </Field>
          <Field label="Campaign name"><input className="input" value={c.name} onChange={(e) => up('name')(e.target.value)} placeholder={c.roles[0] || 'My campaign'} /></Field>
        </div>
        <div className="grid g2">
          <Field label="Locations" help="Up to 3 are searched. Leave empty for anywhere."><TagInput value={c.locations} onChange={up('locations')} placeholder="Bengaluru, Remote…" /></Field>
          <Field label="Work mode"><Seg value={c.remote} onChange={up('remote')} options={[{ value: 'any', label: 'Any' }, { value: 'remote', label: 'Remote only' }, { value: 'onsite', label: 'On-site' }]} /></Field>
        </div>
        <div className="grid g2">
          <Field label="Countries" help="Only jobs located in the countries you pick. Leave empty for any country.">
            <MultiChips value={c.countries || []} options={app.countries || []} onChange={up('countries')} />
          </Field>
          <div className="col" style={{ gap: 14 }}>
            <Field label="Posted within" help="Only jobs posted in this period. Choose a preset or a custom number of hours, days, weeks or months.">
              <PeriodPicker value={c.postedWithinHours ?? (c.postedWithinDays || 0) * 24} onChange={up('postedWithinHours')} />
            </Field>
            <Field label="Only in these months" help="Jobs posted in the months you pick. Empty = any month.">
              <MultiChips value={(c.postedMonths || []).map((n) => MONTHS[n - 1])} options={MONTHS} onChange={(v) => up('postedMonths')(v.map((m) => MONTHS.indexOf(m) + 1))} />
            </Field>
          </div>
        </div>
        <div className="grid g2">
          <Field label="Resume for this campaign" help="Auto picks the best resume per job using role tags and skills.">
            <select className="select" value={c.resumeId} onChange={(e) => up('resumeId')(e.target.value)}>
              <option value="auto">✨ Auto-pick best match per job</option>
              {app.resumes.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
            </select>
          </Field>
          <Field label="Tailor resume per job" help="AI rewrites your resume for each job using only facts already in it; anything it invents is removed automatically.">
            <Seg value={c.tailorResume ? 'on' : 'off'} onChange={(v) => up('tailorResume')(v === 'on')} options={[{ value: 'off', label: 'Use as-is' }, { value: 'on', label: 'AI-tailor (needs key)' }]} />
          </Field>
          <Field label="Cover letters">
            <Seg value={c.coverLetter} onChange={up('coverLetter')} options={[{ value: 'ai', label: 'AI-personalised' }, { value: 'template', label: 'My template' }, { value: 'none', label: 'None' }]} />
          </Field>
        </div>
        <div>
          <span className="field-label">Apply mode</span>
          <div className="grid g3">
            {MODES.map((m) => (
              <div key={m.value} className={`card pad clickable ${c.mode === m.value ? 'premium' : ''}`} style={{ padding: 14, borderColor: c.mode === m.value ? 'rgba(129,140,248,.6)' : undefined }} onClick={() => up('mode')(m.value)}>
                <div className="row" style={{ fontWeight: 700 }}>{m.value === 'auto' && <Zap size={14} color="var(--amber)" />}{m.label}</div>
                <div className="small muted" style={{ marginTop: 4 }}>{m.help}</div>
                {m.value === 'auto' && !app.plan.autoSubmit && <span className="badge amber" style={{ marginTop: 8 }}>Pro — falls back to "Fill, I submit"</span>}
              </div>
            ))}
          </div>
        </div>
        <div className="grid g3">
          <Field label={`Minimum match: ${c.minScore}%`}><input type="range" className="range" min={30} max={95} step={5} value={c.minScore} onChange={(e) => up('minScore')(+e.target.value)} /></Field>
          <Field label="Max applications / day"><input className="input" type="number" min={1} max={200} value={c.dailyLimit} onChange={(e) => up('dailyLimit')(+e.target.value)} /></Field>
          <Field label="Search again every">
            <select className="select" value={c.intervalMinutes} onChange={(e) => up('intervalMinutes')(+e.target.value)}>
              {[30, 60, 120, 240, 480, 1440].map((m) => <option key={m} value={m}>{m < 60 ? `${m} minutes` : m === 1440 ? 'day' : `${m / 60} hour${m > 60 ? 's' : ''}`}</option>)}
            </select>
          </Field>
        </div>
        <div className="grid g3">
          <Field label="Must contain any of"><TagInput value={c.includeKeywords} onChange={up('includeKeywords')} placeholder="python, fintech…" /></Field>
          <Field label="Skip jobs containing"><TagInput value={c.excludeKeywords} onChange={up('excludeKeywords')} placeholder="senior, clearance…" /></Field>
          <Field label="Skip companies"><TagInput value={c.excludeCompanies} onChange={up('excludeCompanies')} placeholder="Current employer…" /></Field>
        </div>
        <Field label="Sources" help={c.sources.length ? `${c.sources.length} selected` : `All ${ready.length} connected sources (add more API keys in Settings → Sources)`}>
          <MultiChips value={c.sources} options={ready.map((x) => x.id)} onChange={up('sources')} />
        </Field>
      </div>
    </Modal>
  );
}

function CampaignCard({ c, index, onEdit, onDetails }) {
  const app = useApp();
  const [busy, setBusy] = useState(false);
  const running = c.status === 'running';
  const setDetails = (tab) => onDetails(c, tab);
  const resume = app.resumes.find((r) => r.id === c.resumeId);
  const apps = app.applications.filter((a) => a.campaignId === c.id);
  const today = new Date().toISOString().slice(0, 10);
  const todayCount = apps.filter((a) => a.attemptedAt && a.attemptedAt.startsWith(today)).length;
  const toggle = async () => {
    setBusy(true);
    try { await app.run(running ? 'campaigns:stop' : 'campaigns:start', [c.id], running ? 'Campaign paused' : 'Campaign started'); } catch {} finally { setBusy(false); }
  };
  const del = async () => { if (await app.confirm({ title: 'Delete campaign?', message: `"${c.name}" will stop and be removed. Its applications stay in your tracker.` })) { const list = await app.run('campaigns:delete', [c.id]); app.set({ campaigns: list }); } };
  return (
    <motion.div {...stagger(index)} layout className={`card ${running ? 'premium premium-shimmer' : ''}`} style={{ overflow: 'hidden' }}>
      <div style={{ height: 3, background: c.color || 'var(--accent)' }} />
      <div style={{ padding: 18, position: 'relative', zIndex: 2 }}>
        <div className="row between" style={{ alignItems: 'flex-start' }}>
          <div className="grow">
            <div className="row" style={{ gap: 8 }}>
              <span className={`dot ${running ? 'live' : ''}`} style={{ color: running ? 'var(--green)' : 'var(--muted-2)' }} />
              <div className="card-title ellipsis">{c.name}</div>
            </div>
            <div className="chips" style={{ marginTop: 8 }}>
              {(c.roles || []).map((r) => <span key={r} className="badge accent">{r}</span>)}
              {(c.locations || []).map((l) => <span key={l} className="badge">{l}</span>)}
              {c.remote !== 'any' && <span className="badge">{c.remote}</span>}
            </div>
          </div>
          <div className="row" style={{ gap: 4 }}>
            <Button size="sm" variant={running ? 'outline' : 'primary'} icon={running ? Pause : Play} loading={busy} onClick={toggle}>{running ? 'Pause' : 'Start'}</Button>
            <Button size="sm" variant="ghost" icon={Pencil} onClick={() => onEdit(c)} />
            <Button size="sm" variant="ghost" icon={Trash2} onClick={del} />
          </div>
        </div>

        <div style={{ marginTop: 14, minHeight: 34 }}>
          {running ? (
            <>
              <div className="row between small">
                <span className="row" style={{ gap: 6 }}>{c.phase !== 'sleeping' && <Loader2 size={13} className="spin" />}{PHASE[c.phase] || 'Starting…'}{c.phase === 'searching' && c.progress ? ` · ${c.progress.sources} sources, ${c.progress.found} jobs` : ''}</span>
                {c.phase === 'sleeping' && c.nextRunAt && <span className="dim"><Clock size={12} style={{ verticalAlign: -2 }} /> next {timeAgo(c.nextRunAt)}</span>}
              </div>
              <div style={{ marginTop: 8 }}><Progress indeterminate={c.phase !== 'sleeping'} value={c.phase === 'sleeping' ? 100 : 0} /></div>
            </>
          ) : (
            <div className="small dim">{c.lastRunAt ? `Last run ${timeAgo(c.lastRunAt)}` : 'Not started yet'}{c.lastError ? ` · ⚠ ${c.lastError}` : ''}</div>
          )}
        </div>
      </div>
      <div style={{ borderTop: '1px solid var(--border)', padding: '12px 18px', display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8, position: 'relative', zIndex: 2 }}>
        <div className="metric" role="button" tabIndex={0} style={{ cursor: 'pointer' }} title="See where these jobs came from" onClick={() => setDetails('sources')}><div className="k">Found</div><div className="v">{c.stats?.found || 0}</div></div>
        <div className="metric" role="button" tabIndex={0} style={{ cursor: 'pointer' }} title="See the applications and their sources" onClick={() => setDetails('applied')}><div className="k">Applied</div><div className="v" style={{ color: 'var(--green)' }}>{c.stats?.applied || 0}</div></div>
        <div className="metric"><div className="k">Today</div><div className="v">{todayCount}<span className="dim tiny">/{c.dailyLimit}</span></div></div>
        <div className="metric" role="button" tabIndex={0} style={{ cursor: 'pointer' }} title="See queued jobs" onClick={() => setDetails('queued')}><div className="k">Queued</div><div className="v">{apps.filter((a) => a.status === 'queued').length}</div></div>
      </div>
      <div className="row between tiny dim" style={{ padding: '0 18px 12px', position: 'relative', zIndex: 2 }}>
        <span><FileText size={11} style={{ verticalAlign: -1 }} /> {resume ? resume.name : 'Auto resume'} · {MODES.find((m) => m.value === c.mode)?.label} · ≥{c.minScore}%{(c.countries || []).length ? ` · ${c.countries.join(', ')}` : ''}{(c.postedWithinHours || c.postedWithinDays) ? ` · posted ${periodLabel(c.postedWithinHours ?? c.postedWithinDays * 24).toLowerCase()}` : ''}{c.stats?.currentEmployerSkipped ? ` · ${c.stats.currentEmployerSkipped} skipped (current employer)` : ''}</span>
        <a href="#" onClick={(e) => { e.preventDefault(); app.go('queue'); }}>View matches →</a>
      </div>
    </motion.div>
  );
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// Where a campaign's jobs came from (sources), and the applications it made.
function CampaignDetails({ c, tab, onClose }) {
  const app = useApp();
  const [view, setView] = useState(tab || 'applied');
  const nameOf = (id) => (app.connectors.find((x) => x.id === id) || {}).name || id;
  const apps = app.applications.filter((a) => a.campaignId === c.id);
  const applied = apps.filter((a) => a.status === 'applied');
  const queued = apps.filter((a) => a.status === 'queued');
  const rows = view === 'applied' ? applied : view === 'queued' ? queued : apps;
  const sources = c.lastSourceStats || [];
  const bySource = (list) => list.reduce((m, a) => { const k = a.job.source || 'unknown'; m[k] = (m[k] || 0) + 1; return m; }, {});
  const appliedBy = bySource(applied);
  const queuedBy = bySource(queued);
  const sourceIds = [...new Set([...sources.map((s) => s.id), ...Object.keys(appliedBy), ...Object.keys(queuedBy)])];
  const sourceRow = (id) => sources.find((s) => s.id === id) || {};
  return (
    <Modal open onClose={onClose} title={`${c.name} — details`} wide>
      <div className="col" style={{ gap: 16 }}>
        <Seg value={view} onChange={setView} options={[
          { value: 'applied', label: `Applied (${applied.length})` },
          { value: 'queued', label: `Queued (${queued.length})` },
          { value: 'sources', label: 'Sources' },
          { value: 'all', label: `All (${apps.length})` },
        ]} />
        {view === 'sources' ? (
          <div className="col" style={{ gap: 10 }}>
            <p className="small muted" style={{ margin: 0 }}>Where this campaign looked, and where its applications came from. "Found" is from the last run.</p>
            {sourceIds.length ? (
              <table className="table">
                <thead><tr><th>Source</th><th>Found (last run)</th><th>Applied</th><th>Queued</th><th>Status</th></tr></thead>
                <tbody>
                  {sourceIds.map((id) => {
                    const s = sourceRow(id);
                    return (
                      <tr key={id}>
                        <td>{nameOf(id)}</td>
                        <td>{s.count ?? '—'}</td>
                        <td style={{ color: 'var(--green)' }}>{appliedBy[id] || 0}</td>
                        <td>{queuedBy[id] || 0}</td>
                        <td className="small">{s.error ? <span style={{ color: 'var(--red, #f87171)' }} title={s.error}>Error — {s.error.slice(0, 60)}</span> : s.id ? 'OK' : 'Applied earlier'}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            ) : <div className="small dim">No searches have run yet. Start the campaign to see its sources.</div>}
            {c.stats?.currentEmployerSkipped ? <div className="small dim">{c.stats.currentEmployerSkipped} job(s) skipped because they are at your current employer.</div> : null}
          </div>
        ) : rows.length ? (
          <div style={{ maxHeight: 420, overflow: 'auto' }}>
            <table className="table">
              <thead><tr><th>Company</th><th>Role</th><th>Source</th><th>Status</th><th>When</th></tr></thead>
              <tbody>
                {rows.map((a) => (
                  <tr key={a.id}>
                    <td>{a.job.company}</td>
                    <td>{a.job.applyUrl || a.job.url ? <a href="#" onClick={(e) => { e.preventDefault(); app.run('shell:open', [a.job.applyUrl || a.job.url]); }}>{a.job.title}</a> : a.job.title}</td>
                    <td><span className="badge">{nameOf(a.job.source || 'unknown')}</span></td>
                    <td className="small">{a.status}</td>
                    <td className="small dim">{new Date(a.attemptedAt || a.createdAt).toLocaleDateString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <div className="small dim">Nothing here yet.</div>}
      </div>
    </Modal>
  );
}

export default function Campaigns({ params }) {
  const app = useApp();
  const [details, setDetails] = useState(null); // { c, tab }: the drill-down opens at page level
  const [editing, setEditing] = useState(null);
  useEffect(() => { if (params.draft) setEditing(params.draft); }, [params.draft]);
  const running = app.campaigns.filter((c) => c.status === 'running').length;
  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Campaigns</h1>
          <p>One campaign per role. They all run in parallel — each with its own resume, filters and schedule.</p>
        </div>
        <div className="row">
          <span className="badge">{running}/{app.plan.campaigns} running on {app.plan.label}</span>
          <Button variant="primary" icon={Plus} onClick={() => setEditing({})}>New campaign</Button>
        </div>
      </div>
      {app.campaigns.length ? (
        <div className="grid g2"><AnimatePresence>{app.campaigns.map((c, i) => <CampaignCard key={c.id} c={c} index={i} onEdit={setEditing} onDetails={(camp, tab) => setDetails({ c: camp, tab })} />)}</AnimatePresence></div>
      ) : (
        <Empty icon={Rocket} title="Launch your first campaign" action={<Button variant="primary" icon={Plus} onClick={() => setEditing({})}>Create campaign</Button>}>
          Tell ApplyPilot which roles you want. It searches every source on a schedule, scores each job against your resume and queues or applies to the best ones.
        </Empty>
      )}
      <div className="grid g3" style={{ marginTop: 28 }}>
        {[
          { icon: SearchIcon, t: 'Searches everywhere', d: 'Remote boards, job APIs and company career pages — every hour.' },
          { icon: FileText, t: 'Right resume, every time', d: 'Pin a resume per campaign or let ApplyPilot pick the best fit per job.' },
          { icon: Zap, t: 'Safe by design', d: 'Daily caps, duplicate & per-company guards, and nothing is ever guessed.' },
        ].map((x, i) => (
          <motion.div key={x.t} {...stagger(i + 3)} className="card pad"><x.icon size={18} color="var(--accent-2)" /><div style={{ fontWeight: 700, marginTop: 8 }}>{x.t}</div><div className="small muted">{x.d}</div></motion.div>
        ))}
      </div>
      <CampaignEditor open={!!editing} initial={editing} onClose={() => setEditing(null)} />
      {details && <CampaignDetails c={details.c} tab={details.tab} onClose={() => setDetails(null)} />}
    </div>
  );
}
