// Settings cards for phone parity: Applying (cancel window, caps, campaigns, notifications) and
// Career pages (synced, encrypted `careerPages` records watched by the desktop app).
import React, { useState } from 'react';
import { Zap, Globe, Trash2, Plus, ExternalLink, Bell } from 'lucide-react';
import { newId } from '@shared/vaultCrypto.js';
import { useApp } from '../lib/store.jsx';
import { Button, Sheet, Field, Switch, Seg, timeAgo } from './ui.jsx';
import { nat, openUrl } from '../lib/bridge.js';

export function ApplyingCard() {
  const app = useApp();
  const s = app.settings;
  const save = (patch, msg) => app.saveSettings(patch).then(() => msg && app.toast(msg, 'success')).catch((e) => app.toast(e.message, 'error'));
  const [delay, setDelay] = useState(s.submitDelaySeconds ?? 30);
  const [cap, setCap] = useState(s.dailyApplyLimit ?? 25);
  const [min, setMin] = useState(s.minMatchScore ?? 55);
  return (
    <div className="card pad col" style={{ gap: 12 }} data-testid="applying-card">
      <div className="section-title" style={{ margin: 0 }}><Zap size={14} />Applying</div>
      <div>
        <div className="row between"><span className="field-label">Cancel window before auto-submit</span><span className="small mono-num" data-testid="delay-value">{delay}s</span></div>
        <input type="range" className="range" min={0} max={120} step={5} value={delay} onChange={(e) => setDelay(+e.target.value)} onPointerUp={() => save({ submitDelaySeconds: delay }, 'Cancel window saved')} onKeyUp={() => save({ submitDelaySeconds: delay })} onBlur={() => delay !== (s.submitDelaySeconds ?? 30) && save({ submitDelaySeconds: delay })} aria-label="Cancel window seconds" data-testid="delay-range" />
        <div className="tiny dim">Autopilot waits this long (with Hold / Submit now) before every submit. 0 submits immediately.</div>
      </div>
      <div className="grid g2">
        <Field label="Max applications / day"><input className="input" type="number" inputMode="numeric" min={1} max={200} value={cap} onChange={(e) => setCap(e.target.value)} onBlur={() => save({ dailyApplyLimit: Math.max(1, Math.min(200, Number(cap) || 25)) })} /></Field>
        <Field label="Default min. match"><input className="input" type="number" inputMode="numeric" min={0} max={100} value={min} onChange={(e) => setMin(e.target.value)} onBlur={() => save({ minMatchScore: Math.max(0, Math.min(100, Number(min) || 55)) })} /></Field>
      </div>
      <div><span className="field-label">Default apply mode</span><Seg full value={s.defaultApplyMode === 'auto' ? 'auto' : 'review'} onChange={(v) => save({ defaultApplyMode: v })} options={[{ value: 'review', label: 'Fill, I submit' }, { value: 'auto', label: 'Autopilot' }]} /></div>
      {[
        ['campaignsOnPhone', 'Run campaigns on this phone', 'Searches due campaigns while ApplyPilot is open', true],
        ['aiAnswerQuestions', 'Let AI answer new form questions', 'Only when it is confident; otherwise the question goes to your Answer bank', false],
        ['notifyMatches', 'Notify me about new matches', 'Phone app only', true],
      ].map(([k, label, help, def]) => (
        <div key={k} className="row between" style={{ minHeight: 44, gap: 12 }}>
          <div><div className="small">{label}</div><div className="tiny dim">{help}</div></div>
          <Switch on={s[k] === undefined ? def : !!s[k]} onChange={(v) => { save({ [k]: v }); if (k === 'notifyMatches' && v) nat().notifications.requestPermission().catch(() => {}); }} label={label} />
        </div>
      ))}
      {nat().isNative && <Button size="sm" variant="ghost" icon={Bell} onClick={() => nat().notifications.requestPermission().then((ok) => app.toast(ok ? 'Notifications on' : 'Notifications are off in system settings', ok ? 'success' : 'info'))}>Allow notifications</Button>}
    </div>
  );
}

function AddCareerPage({ open, onClose }) {
  const app = useApp();
  const [url, setUrl] = useState('');
  const [company, setCompany] = useState('');
  const [busy, setBusy] = useState(false);
  const add = async () => {
    let u;
    try { u = new URL(url.trim()); } catch { app.toast('Paste a full careers page link, e.g. https://company.com/careers', 'error'); return; }
    if (!/^https?:$/.test(u.protocol)) { app.toast('Only http(s) links are supported.', 'error'); return; }
    if (app.careerPages.some((p) => p.url === u.href)) { app.toast('This careers page is already being watched.', 'error'); return; }
    setBusy(true);
    try {
      const id = newId();
      await app.put('careerPages', id, { id, url: u.href, company: company.trim() || u.hostname.replace(/^(www|careers|jobs)\./, ''), enabled: true, kind: 'pending', addedAt: new Date().toISOString(), lastChecked: null, jobCount: 0, from: 'web' });
      app.toast('Added. Your desktop app works out how to read it on its next sync.', 'success');
      setUrl(''); setCompany(''); onClose();
    } catch (e) { app.toast(e.message, 'error'); } finally { setBusy(false); }
  };
  return (
    <Sheet open={open} onClose={onClose} title="Watch a careers page"
      footer={<><Button size="lg" variant="ghost" onClick={onClose}>Cancel</Button><Button size="lg" variant="primary" loading={busy} disabled={!url.trim()} onClick={add} data-testid="career-save">Add</Button></>}>
      <div className="col" style={{ gap: 12 }}>
        <Field label="Careers page link" required><input className="input" type="url" inputMode="url" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://company.com/careers" data-testid="career-url" /></Field>
        <Field label="Company"><input className="input" value={company} onChange={(e) => setCompany(e.target.value)} placeholder="Optional" /></Field>
        <div className="tiny dim">Greenhouse, Lever, Ashby, Workable, SmartRecruiters, Recruitee and Workday pages are read through their public APIs; other sites through their job listings.</div>
      </div>
    </Sheet>
  );
}

export function CareerPagesCard() {
  const app = useApp();
  const [add, setAdd] = useState(false);
  const pages = app.careerPages;
  const toggle = async (p, enabled) => { try { await app.put('careerPages', p.id, { ...p, enabled }); } catch (e) { app.toast(e.message, 'error'); } };
  const del = async (p) => {
    if (!(await app.confirm({ title: 'Stop watching this page?', message: `${p.company || p.url} is removed on every device. Jobs already found stay in your tracker.`, confirmLabel: 'Remove' }))) return;
    try { await app.remove('careerPages', p.id); app.toast('Careers page removed', 'success'); } catch (e) { app.toast(e.message, 'error'); }
  };
  return (
    <div className="card pad col" style={{ gap: 10 }} data-testid="career-pages">
      <div className="row between"><div className="section-title" style={{ margin: 0 }}><Globe size={14} />Career pages</div><Button size="sm" icon={Plus} onClick={() => setAdd(true)} data-testid="career-add">Add</Button></div>
      <div className="tiny dim">Company careers pages your desktop app watches and includes in every search and campaign.</div>
      {pages.map((p) => (
        <div key={p.id} className="person-row" data-testid="career-row">
          <div className="grow">
            <div className="small ellipsis" style={{ fontWeight: 600 }}>{p.company || p.url}</div>
            <div className="tiny dim ellipsis">{p.kind === 'pending' ? 'waiting for your desktop to inspect' : `${p.ats || p.kind || 'site'} · ${p.jobCount || 0} jobs`}{p.lastChecked ? ` · checked ${timeAgo(p.lastChecked)}` : ''}{p.lastError ? ' · ⚠ error' : ''}</div>
          </div>
          <Button size="sm" variant="ghost" icon={ExternalLink} aria-label={`Open ${p.company || 'careers page'}`} onClick={() => openUrl(p.url)} />
          <Switch on={p.enabled !== false} onChange={(v) => toggle(p, v)} label={`Watch ${p.company || p.url}`} />
          <Button size="sm" variant="ghost" icon={Trash2} aria-label={`Remove ${p.company || p.url}`} onClick={() => del(p)} data-testid="career-remove" />
        </div>
      ))}
      {!pages.length && <div className="small dim">No careers pages yet. Add one here or in the desktop app (Settings → Sources).</div>}
      <AddCareerPage open={add} onClose={() => setAdd(false)} />
    </div>
  );
}
