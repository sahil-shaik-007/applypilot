import React, { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { Play, Pause, Pencil, Trash2, Zap, FileText, Clock, Loader2, RefreshCw, Inbox, Monitor, Smartphone } from 'lucide-react';
import { useApp, go } from '../lib/store.jsx';
import { Button, Sheet, Field, TagInput, Seg, Switch, Progress, timeAgo, stagger } from './ui.jsx';
import { MODES, INTERVALS, intervalLabel, blankCampaign, saveCampaign, deleteCampaign, setRunning, runCampaign, useCampaignRuntime, PHASE } from '../lib/campaigns.js';
import { attemptsToday } from '@shared/campaignRules.js';
import { getProfile, resumePool } from '../lib/profiles.js';

/** Create / edit a campaign (bottom sheet). `initial` = {} for new. */
export function CampaignEditor({ initial, onClose }) {
  const app = useApp();
  const open = !!initial;
  const [c, setC] = useState(() => blankCampaign(app));
  const [saving, setSaving] = useState(false);
  useEffect(() => { if (open) setC({ ...blankCampaign(app), ...(initial || {}) }); }, [open]); // eslint-disable-line
  const up = (k) => (v) => setC((x) => ({ ...x, [k]: v }));
  // Switching profile keeps the resume only when the new profile can use it (otherwise back to auto).
  const setProfile = (id) => setC((x) => {
    const usable = x.resumeId === 'auto' || resumePool(app, id).all.some((r) => r.id === x.resumeId);
    return { ...x, profileId: id, resumeId: usable ? x.resumeId : 'auto' };
  });
  const save = async (start) => {
    if (!c.roles.length) { app.toast('Add at least one job title', 'error'); return; }
    setSaving(true);
    try {
      const rec = await saveCampaign(app, c);
      if (start) {
        await setRunning(app, rec, true);
        app.toast('Campaign started. It searches now and then on its schedule while ApplyPilot is open.', 'success');
        runCampaign(app, { ...rec, status: 'running' }).then((r) => r && r.queued && app.toast(`${r.queued} new match${r.queued > 1 ? 'es' : ''} in your Review queue`, 'success')).catch((e) => app.toast(e.message, 'error'));
      } else app.toast(c.id ? 'Campaign saved' : 'Campaign created', 'success');
      onClose();
    } catch (e) { app.toast(e.message, 'error'); } finally { setSaving(false); }
  };
  const suggestions = ((getProfile(app, c.profileId).values || {}).desiredTitles || []).filter((t) => !c.roles.includes(t));
  return (
    <Sheet open={open} onClose={onClose} tall title={c.id ? 'Edit campaign' : 'New campaign'}
      footer={<>
        <Button size="lg" loading={saving} onClick={() => save(false)} data-testid="campaign-save">Save</Button>
        <Button size="lg" variant="primary" icon={Play} loading={saving} onClick={() => save(true)} data-testid="campaign-save-start">Save & start</Button>
      </>}>
      <div className="col" style={{ gap: 16 }} data-testid="campaign-editor">
        <Field label="Job titles to target" required help="Each title is searched separately. Add variants: 'Backend Engineer', 'Node.js Developer'…">
          <TagInput value={c.roles} onChange={up('roles')} placeholder="e.g. Data Analyst" label="Job titles" />
        </Field>
        {suggestions.length > 0 && <div className="chips">{suggestions.slice(0, 4).map((t) => <button type="button" key={t} className="chip" onClick={() => up('roles')([...c.roles, t])}>+ {t}</button>)}</div>}
        <Field label="Campaign name"><input className="input" value={c.name} onChange={(e) => up('name')(e.target.value)} placeholder={c.roles[0] || 'My campaign'} data-testid="campaign-name" /></Field>
        <Field label="Profile" help="Whose details, resumes and applications this campaign uses. Campaigns for different profiles can run side by side.">
          <select className="select" value={c.profileId || 'main'} onChange={(e) => setProfile(e.target.value)} aria-label="Campaign profile" data-testid="campaign-profile">
            {app.profiles.map((p) => <option key={p.id} value={p.id}>{p.label}{p.isDefault ? ' (default)' : ''}</option>)}
          </select>
        </Field>
        <Field label="Locations" help="Up to 3 are searched. Leave empty for anywhere."><TagInput value={c.locations} onChange={(v) => up('locations')(v.slice(0, 3))} placeholder="Bengaluru, Remote…" label="Locations" /></Field>
        <div><span className="field-label">Work mode</span><Seg full value={c.remote} onChange={up('remote')} options={[{ value: 'any', label: 'Any' }, { value: 'remote', label: 'Remote' }, { value: 'onsite', label: 'On-site' }]} /></div>
        <Field label="Resume for this campaign" help="Auto picks the best resume per job using role tags and skills. Shows this profile's resumes and shared ones.">
          <select className="select" value={c.resumeId} onChange={(e) => up('resumeId')(e.target.value)} aria-label="Campaign resume">
            <option value="auto">✨ Auto-pick best match per job</option>
            {resumePool(app, c.profileId).all.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
          </select>
        </Field>
        <div className="row between" style={{ minHeight: 44, gap: 12 }}>
          <div><div className="small">Tailor resume per job</div><div className="tiny dim">AI rewrites your resume for each job using only facts already in it; anything invented is removed. Needs your AI key.</div></div>
          <Switch on={!!c.tailorResume} onChange={up('tailorResume')} label="Tailor resume per job" />
        </div>
        <div><span className="field-label">Cover letters</span><Seg full value={c.coverLetter || 'ai'} onChange={up('coverLetter')} options={[{ value: 'ai', label: 'AI' }, { value: 'template', label: 'Template' }, { value: 'none', label: 'None' }]} /></div>
        <div>
          <span className="field-label">Apply mode</span>
          <div className="col" style={{ gap: 8 }}>
            {MODES.map((m) => (
              <button type="button" key={m.value} className={`card mode-card ${c.mode === m.value ? 'on' : ''}`} onClick={() => up('mode')(m.value)} aria-pressed={c.mode === m.value} data-mode={m.value}>
                <div className="row small" style={{ fontWeight: 700, gap: 6 }}>{m.value === 'auto' && <Zap size={13} color="var(--amber)" />}{m.label}</div>
                <div className="tiny muted" style={{ marginTop: 3 }}>{m.help}</div>
              </button>
            ))}
          </div>
        </div>
        <div>
          <div className="row between"><span className="field-label">Minimum match</span><span className="small mono-num">{c.minScore}%</span></div>
          <input type="range" className="range" min={30} max={95} step={5} value={c.minScore} onChange={(e) => up('minScore')(+e.target.value)} aria-label="Minimum match" data-testid="campaign-min" />
        </div>
        <div className="grid g2">
          <Field label="Max applies / day"><input className="input" type="number" inputMode="numeric" min={1} max={200} value={c.dailyLimit} onChange={(e) => up('dailyLimit')(+e.target.value)} /></Field>
          <Field label="Search again every">
            <select className="select" value={c.intervalMinutes} onChange={(e) => up('intervalMinutes')(+e.target.value)}>
              {INTERVALS.map((m) => <option key={m} value={m}>{intervalLabel(m)}</option>)}
            </select>
          </Field>
        </div>
        <Field label="Must contain any of"><TagInput value={c.includeKeywords} onChange={up('includeKeywords')} placeholder="python, fintech…" label="Must contain" /></Field>
        <Field label="Skip jobs containing"><TagInput value={c.excludeKeywords} onChange={up('excludeKeywords')} placeholder="senior, clearance…" label="Skip keywords" /></Field>
        <Field label="Skip companies"><TagInput value={c.excludeCompanies} onChange={up('excludeCompanies')} placeholder="Current employer…" label="Skip companies" /></Field>
        <div><span className="field-label">Runs on</span><Seg full value={c.runOn || 'both'} onChange={up('runOn')} options={[{ value: 'both', label: 'Phone + PC' }, { value: 'phone', label: 'Phone' }, { value: 'desktop', label: 'PC only' }]} />
          <div className="tiny dim" style={{ marginTop: 6 }}>Campaigns sync (encrypted) to your desktop app. Matches from either device land in the same Review queue, and the duplicate guard stops double applications.</div></div>
      </div>
    </Sheet>
  );
}

export function CampaignCard({ c, index = 0, onEdit }) {
  const app = useApp();
  const rt = useCampaignRuntime().get(c.id) || {};
  const [busy, setBusy] = useState(null);
  const running = c.status === 'running';
  const active = ['searching', 'scoring', 'queueing'].includes(rt.phase);
  const resume = app.resumes.find((r) => r.id === c.resumeId);
  const apps = app.applications.filter((a) => a.campaignId === c.id);
  const todayN = attemptsToday(apps, c.id);
  const queued = apps.filter((a) => a.status === 'queued').length;
  const toggle = async () => {
    setBusy('toggle');
    try {
      await setRunning(app, c, !running);
      app.toast(running ? 'Campaign paused' : 'Campaign started', 'success');
      if (!running) runCampaign(app, { ...c, status: 'running' }).then((r) => r && r.queued && app.toast(`${r.queued} new match${r.queued > 1 ? 'es' : ''} in your Review queue`, 'success')).catch((e) => app.toast(e.message, 'error'));
    } catch (e) { app.toast(e.message, 'error'); } finally { setBusy(null); }
  };
  const runNow = async () => {
    setBusy('run');
    try { const r = await runCampaign(app, c); app.toast(r.queued ? `${r.queued} new match${r.queued > 1 ? 'es' : ''} queued for review` : `Searched ${r.searched} jobs: no new matches ≥ ${c.minScore}%`, r.queued ? 'success' : 'info'); } catch (e) { app.toast(e.message, 'error'); } finally { setBusy(null); }
  };
  const del = async () => {
    if (!(await app.confirm({ title: 'Delete campaign?', message: `"${c.name}" stops on every device and is removed. Its applications stay in your tracker.` }))) return;
    try { await deleteCampaign(app, c.id); app.toast('Campaign deleted', 'success'); } catch (e) { app.toast(e.message, 'error'); }
  };
  const modeLabel = (MODES.find((m) => m.value === c.mode) || MODES[0]).label;
  return (
    <motion.div {...stagger(index)} className={`card ${running ? 'premium premium-shimmer' : ''}`} style={{ overflow: 'hidden' }} data-testid="campaign-card" data-status={c.status}>
      <div className="campaign-bar" style={{ background: c.color || 'var(--accent)' }} />
      <div style={{ padding: 14, position: 'relative', zIndex: 2 }} className="col">
        <div className="row" style={{ alignItems: 'flex-start', gap: 8 }}>
          <div className="grow" style={{ minWidth: 0 }}>
            <div className="row" style={{ gap: 8 }}>
              <span className={`dot ${running ? 'live' : ''}`} style={{ color: running ? 'var(--green)' : 'var(--muted-2)' }} />
              <div className="card-title ellipsis" data-testid="campaign-title">{c.name}</div>
            </div>
            <div className="chips" style={{ marginTop: 8 }}>
              {(c.roles || []).map((r) => <span key={r} className="badge accent">{r}</span>)}
              {(c.locations || []).map((l) => <span key={l} className="badge">{l}</span>)}
              {c.remote && c.remote !== 'any' && <span className="badge">{c.remote}</span>}
              {c.runOn === 'desktop' && <span className="badge"><Monitor size={10} />PC only</span>}
              {c.runOn === 'phone' && <span className="badge"><Smartphone size={10} />phone only</span>}
              {app.profiles.length > 1 && <span className="badge" data-testid="campaign-profile-badge">{getProfile(app, c.profileId).label}</span>}
            </div>
          </div>
          <Button size="sm" variant="ghost" icon={Pencil} aria-label={`Edit ${c.name}`} onClick={() => onEdit(c)} data-testid="campaign-edit" />
          <Button size="sm" variant="ghost" icon={Trash2} aria-label={`Delete ${c.name}`} onClick={del} data-testid="campaign-delete" />
        </div>
        <div style={{ minHeight: 30 }}>
          {active ? (
            <>
              <div className="row small" style={{ gap: 6 }}><Loader2 size={13} className="spin" />{PHASE[rt.phase]}{rt.phase === 'searching' && rt.progress ? ` · ${rt.progress.done}/${rt.progress.total} searches, ${rt.progress.found} jobs` : ''}</div>
              <div style={{ marginTop: 8 }}><Progress indeterminate /></div>
            </>
          ) : (
            <div className="small dim">
              {c.lastRunAt ? `Last run ${timeAgo(c.lastRunAt)}${c.lastRun ? ` · ${c.lastRun.searched} jobs, ${c.lastRun.queued} queued` : ''}` : 'Not run yet'}
              {running && c.nextRunAt && <> · <Clock size={11} style={{ verticalAlign: -1 }} /> next {timeAgo(c.nextRunAt)}</>}
              {(rt.error || c.lastError) && <div style={{ color: 'var(--amber)' }} className="break">⚠ {rt.error || c.lastError}</div>}
            </div>
          )}
        </div>
        <div className="grid g2">
          <Button variant={running ? 'outline' : 'primary'} icon={running ? Pause : Play} loading={busy === 'toggle'} onClick={toggle} data-testid="campaign-toggle">{running ? 'Pause' : 'Start'}</Button>
          <Button icon={RefreshCw} loading={busy === 'run' || active} disabled={active || c.runOn === 'desktop'} onClick={runNow} data-testid="campaign-run">Run now</Button>
        </div>
      </div>
      <div className="metric-row" style={{ borderTop: '1px solid var(--border)', padding: '10px 14px', position: 'relative', zIndex: 2 }}>
        <div className="metric"><div className="k">Found</div><div className="v">{(c.stats && c.stats.found) || 0}</div></div>
        <div className="metric"><div className="k">Queued</div><div className="v" data-testid="campaign-queued">{queued}</div></div>
        <div className="metric"><div className="k">Applied</div><div className="v" style={{ color: 'var(--green)' }}>{(c.stats && c.stats.applied) || apps.filter((a) => a.status === 'applied').length}</div></div>
        <div className="metric"><div className="k">Today</div><div className="v">{todayN}<span className="dim tiny">/{c.dailyLimit}</span></div></div>
      </div>
      <div className="row between tiny dim" style={{ padding: '0 14px 12px', position: 'relative', zIndex: 2, gap: 8 }}>
        <span className="ellipsis"><FileText size={11} style={{ verticalAlign: -1 }} /> {resume ? resume.name : 'Auto resume'} · {modeLabel} · ≥{c.minScore}%{c.tailorResume ? ' · tailored' : ''}</span>
        <a href="#/queue" className="tap row" style={{ flexShrink: 0, gap: 4 }} onClick={(e) => { e.preventDefault(); go('queue', { campaign: c.id }); }}><Inbox size={12} />Matches →</a>
      </div>
    </motion.div>
  );
}
