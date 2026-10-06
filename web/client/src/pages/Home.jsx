import React, { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { Search, MapPin, Bookmark, Send, CalendarCheck, Laptop, Check, Circle, ArrowUpRight, Trash2, Monitor, FileText, Sparkles, User, Link2 } from 'lucide-react';
import { useApp, go } from '../lib/store.jsx';
import { api } from '../lib/api.js';
import { Button, CountUp, StatusBadge, Logo, timeAgo, stagger } from '../components/ui.jsx';
import { profileCompletion } from '../lib/profile.js';

export function useDevices() {
  const [devices, setDevices] = useState(null);
  const [error, setError] = useState('');
  const load = async () => { try { const r = await api('/devices'); setDevices(r.devices || []); setError(''); } catch (e) { setError(e.message); setDevices([]); } };
  useEffect(() => { load(); }, []);
  return { devices, error, reload: load, setDevices };
}

export default function Home() {
  const app = useApp();
  const p = app.profile || {};
  const [q, setQ] = useState((p.desiredTitles || [])[0] || '');
  const [loc, setLoc] = useState((p.preferredLocations || [])[0] || '');
  const { devices } = useDevices();
  const apps = app.applications;
  const applied = apps.filter((a) => ['applied', 'interview', 'offer', 'rejected'].includes(a.status)).length;
  const interviews = apps.filter((a) => a.status === 'interview' || a.status === 'offer').length;
  const saved = apps.filter((a) => a.status === 'saved').length;
  const completion = profileCompletion(p);
  const hour = new Date().getHours();
  const greet = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
  const first = p.firstName || (app.user && app.user.name ? app.user.name.split(' ')[0] : '');
  const steps = [
    { done: app.resumes.length > 0, label: 'Upload your resume', go: 'resumes', icon: FileText },
    { done: completion >= 70, label: `Complete your profile (${completion}%)`, go: 'profile', icon: User },
    { done: devices ? devices.length > 0 : true, label: 'Link your desktop app', go: 'settings', icon: Link2 },
    { done: !!app.settings.anthropicKey, label: 'Add an AI key for cover letters', go: 'ai', icon: Sparkles },
  ];
  const pending = steps.filter((s) => !s.done).length;

  const cancelOutbox = async (o) => {
    if (!(await app.confirm({ title: 'Remove from laptop queue?', message: `"${o.job.title}" won't be sent to your desktop app.`, confirmLabel: 'Remove' }))) return;
    try { await app.remove('outbox', o.id); app.toast('Removed from queue', 'success'); } catch (e) { app.toast(e.message, 'error'); }
  };

  return (
    <div className="col" style={{ gap: 16 }}>
      <div>
        <h2 style={{ margin: 0, fontSize: 24, letterSpacing: '-.02em' }} data-testid="greeting">{greet}{first ? `, ${first}` : ''} 👋</h2>
        <p className="small muted" style={{ margin: '4px 0 0' }}>{app.outbox.length ? `${app.outbox.length} job${app.outbox.length > 1 ? 's' : ''} waiting for your laptop.` : 'Find something great today.'}</p>
      </div>

      <form className="card pad col" style={{ gap: 8 }} onSubmit={(e) => { e.preventDefault(); if (q.trim()) go('jobs', { q: q.trim(), loc: loc.trim() }); }} data-testid="quick-search">
        <span className="label" style={{ margin: 0 }}>Quick search</span>
        <div className="search-wrap"><Search size={16} /><input className="input" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Job title" aria-label="Job title" enterKeyHint="search" /></div>
        <div className="row" style={{ gap: 8 }}>
          <div className="search-wrap grow"><MapPin size={16} /><input className="input" value={loc} onChange={(e) => setLoc(e.target.value)} placeholder="Anywhere" aria-label="Location" /></div>
          <Button type="submit" variant="primary" size="lg" icon={Search} aria-label="Search">Go</Button>
        </div>
      </form>

      <div className="grid g2">
        {[
          { icon: Send, k: 'Applied', v: applied, sub: `${apps.length} tracked` },
          { icon: CalendarCheck, k: 'Interviews', v: interviews, sub: `${apps.filter((a) => a.status === 'offer').length} offers` },
          { icon: Bookmark, k: 'Saved', v: saved, sub: 'ready to apply' },
          { icon: Laptop, k: 'To laptop', v: app.outbox.length, sub: 'in the queue' },
        ].map((x, i) => (
          <motion.div key={x.k} {...stagger(i)} className={`card stat-card ${i === 0 ? 'premium premium-shimmer' : ''}`}>
            <div style={{ position: 'relative', zIndex: 2 }}>
              <div className="row between"><span className="label" style={{ margin: 0 }}>{x.k}</span><x.icon size={14} className="dim" /></div>
              <div className="v"><CountUp value={x.v} /></div>
              <div className="sub">{x.sub}</div>
            </div>
          </motion.div>
        ))}
      </div>

      {pending > 0 && (
        <motion.div {...stagger(4)} className="card pad">
          <div className="row between"><div className="section-title" style={{ margin: 0 }}>Get set up · {steps.length - pending}/{steps.length}</div><div className="progress" style={{ width: 90 }}><div style={{ width: `${((steps.length - pending) / steps.length) * 100}%` }} /></div></div>
          <div className="list" style={{ marginTop: 6 }}>
            {steps.map((s) => (
              <button key={s.label} type="button" className="list-row" style={{ paddingLeft: 0, paddingRight: 0, color: s.done ? 'var(--muted-2)' : 'var(--fg)' }} onClick={() => go(s.go)}>
                {s.done ? <Check size={16} color="var(--green)" /> : <Circle size={16} />}
                <span className="grow" style={{ textDecoration: s.done ? 'line-through' : 'none' }}>{s.label}</span>
                {!s.done && <ArrowUpRight size={15} />}
              </button>
            ))}
          </div>
        </motion.div>
      )}

      <motion.div {...stagger(5)} className="card pad" data-testid="outbox-card">
        <div className="row between"><div className="section-title" style={{ margin: 0 }}><Laptop size={14} />Sent to your laptop</div><span className="badge blue">{app.outbox.length}</span></div>
        <div className="col" style={{ gap: 8, marginTop: 10 }}>
          {app.outbox.slice(0, 8).map((o) => (
            <div key={o.id} className="row" style={{ gap: 10 }} data-testid="outbox-item">
              <span className="dot live" style={{ color: 'var(--blue)' }} />
              <div className="grow"><div className="small ellipsis" style={{ fontWeight: 600 }}>{o.job.title}</div><div className="tiny dim ellipsis">{o.job.company} · {o.mode === 'auto' ? 'autopilot' : 'fill, you submit'} · {timeAgo(o.createdAt)}</div></div>
              <Button size="sm" variant="ghost" icon={Trash2} aria-label="Remove from queue" onClick={() => cancelOutbox(o)} />
            </div>
          ))}
          {!app.outbox.length && <div className="small dim">Jobs you send from your phone wait here until the ApplyPilot desktop app picks them up. It removes them once queued.</div>}
        </div>
      </motion.div>

      <motion.div {...stagger(6)} className="card pad">
        <div className="row between"><div className="section-title" style={{ margin: 0 }}>Recent applications</div><a href="#/applied" className="small muted" onClick={(e) => { e.preventDefault(); go('applied'); }}>All →</a></div>
        <div className="col" style={{ gap: 10, marginTop: 12 }}>
          {apps.filter((a) => a.status !== 'skipped').slice(0, 5).map((a) => (
            <button type="button" key={a.id} className="row" style={{ gap: 10, background: 'none', border: 0, color: 'inherit', padding: 0, textAlign: 'left', cursor: 'pointer', minHeight: 44 }} onClick={() => go('applied', { id: a.id })}>
              <Logo name={a.job.company} size="sm" />
              <div className="grow"><div className="small ellipsis" style={{ fontWeight: 600 }}>{a.job.title}</div><div className="tiny dim ellipsis">{a.job.company} · {timeAgo(a.updatedAt)}</div></div>
              <StatusBadge status={a.status} />
            </button>
          ))}
          {!apps.length && <div className="small dim">Nothing yet. Save or apply to a job and it shows up here.</div>}
        </div>
      </motion.div>

      <motion.div {...stagger(7)} className="card pad">
        <div className="row between"><div className="section-title" style={{ margin: 0 }}><Monitor size={14} />Linked devices</div><a href="#/settings" className="small muted" onClick={(e) => { e.preventDefault(); go('settings'); }}>Manage →</a></div>
        <div className="col" style={{ gap: 8, marginTop: 10 }}>
          {(devices || []).map((d) => (
            <div key={d.id} className="row small" style={{ gap: 10 }}>
              <span className={`dot ${d.lastSeenAt && Date.now() - d.lastSeenAt < 5 * 60000 ? 'live' : ''}`} style={{ color: d.lastSeenAt && Date.now() - d.lastSeenAt < 5 * 60000 ? 'var(--green)' : 'var(--muted-2)' }} />
              <span className="grow ellipsis">{d.name}</span><span className="tiny dim">{d.lastSeenAt ? `seen ${timeAgo(d.lastSeenAt)}` : 'never synced'}</span>
            </div>
          ))}
          {devices && !devices.length && <div className="small dim">No desktop linked yet. <a href="#/settings" onClick={(e) => { e.preventDefault(); go('settings'); }}>Link one</a> to send jobs from your phone.</div>}
          {!devices && <div className="skeleton" style={{ height: 20 }} />}
        </div>
      </motion.div>
    </div>
  );
}
