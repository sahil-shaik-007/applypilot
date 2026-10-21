import React, { useEffect, useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { Search, MapPin, Send, CalendarCheck, Laptop, Check, Circle, ArrowUpRight, Trash2, Monitor, FileText, Sparkles, User, Link2, TrendingUp, Trophy, Rocket, Activity, Inbox, Sun, Bell, CircleAlert } from 'lucide-react';
import { useApp, go } from '../lib/store.jsx';
import { api } from '../lib/api.js';
import { Button, CountUp, StatusBadge, Logo, timeAgo, stagger } from '../components/ui.jsx';
import { profileCompletion } from '../lib/profile.js';
import { dashboardStats, groupRate, digest, activityFeed } from '@shared/campaignRules.js';
import { useCampaignRuntime } from '../lib/campaigns.js';

export function useDevices() {
  const [devices, setDevices] = useState(null);
  const [error, setError] = useState('');
  const load = async () => { try { const r = await api('/devices'); setDevices(r.devices || []); setError(''); } catch (e) { setError(e.message); setDevices([]); } };
  useEffect(() => { load(); }, []);
  return { devices, error, reload: load, setDevices };
}

function Spark({ data }) {
  const max = Math.max(1, ...data);
  return (
    <div className="spark" aria-hidden="true">
      {data.map((v, i) => <motion.div key={i} initial={{ height: 0 }} animate={{ height: `${Math.max(8, (v / max) * 100)}%` }} transition={{ delay: i * 0.03, duration: 0.4 }} style={{ background: i === data.length - 1 ? 'var(--accent-2)' : 'rgba(129,140,248,.35)' }} />)}
    </div>
  );
}

const FUNNEL_COLORS = ['#22d3ee', '#22d3ee', '#4ade80', '#f472b6', '#fbbf24'];

export default function Home() {
  const app = useApp();
  const p = app.profile || {};
  const [q, setQ] = useState((p.desiredTitles || [])[0] || '');
  const [loc, setLoc] = useState((p.preferredLocations || [])[0] || '');
  const { devices } = useDevices();
  const rt = useCampaignRuntime();
  const apps = app.applications;
  const s = useMemo(() => dashboardStats(apps, app.campaigns), [apps, app.campaigns]);
  const d = useMemo(() => digest(apps), [apps]);
  const feed = useMemo(() => activityFeed(apps, 12), [apps]);
  const completion = profileCompletion(p);
  const hour = new Date().getHours();
  const greet = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
  const first = p.firstName || (app.user && (app.user.displayName || app.user.name) ? (app.user.displayName || app.user.name).split(' ')[0] : '');
  const running = app.campaigns.filter((c) => c.status === 'running');
  const steps = [
    { done: app.resumes.length > 0, label: 'Upload your resume', go: 'resumes', icon: FileText },
    { done: completion >= 70, label: `Complete your profile (${completion}%)`, go: 'profile', icon: User },
    { done: app.campaigns.length > 0, label: 'Create your first campaign', go: 'campaigns', params: { new: '1' }, icon: Rocket },
    { done: devices ? devices.length > 0 : true, label: 'Link your desktop app', go: 'settings', icon: Link2 },
    { done: !!app.settings.anthropicKey, label: 'Add an AI key for tailored applications', go: 'ai', icon: Sparkles },
  ];
  const pending = steps.filter((x) => !x.done).length;
  const fmax = Math.max(1, s.funnel[0].v);
  const digestLines = [
    d.newMatches > 0 && { k: 'queue', icon: Inbox, text: `${d.newMatches} new match${d.newMatches > 1 ? 'es' : ''} from your campaigns`, go: 'queue' },
    d.needsYou > 0 && { k: 'needs', icon: CircleAlert, text: `${d.needsYou} application${d.needsYou > 1 ? 's need' : ' needs'} you to finish`, go: 'queue' },
    d.interviewsToday.length > 0 && { k: 'iv', icon: CalendarCheck, text: `Interview today: ${d.interviewsToday.map((a) => a.job.company).join(', ')}`, go: 'applied', params: { id: d.interviewsToday[0].id } },
    d.followUps.length > 0 && { k: 'fu', icon: Bell, text: `${d.followUps.length} follow-up${d.followUps.length > 1 ? 's' : ''} due`, go: 'applied', params: { id: d.followUps[0].id } },
    d.appliedRecently > 0 && { k: 'ap', icon: Send, text: `${d.appliedRecently} application${d.appliedRecently > 1 ? 's' : ''} sent in the last 24h`, go: 'applied' },
  ].filter(Boolean);

  const cancelOutbox = async (o) => {
    if (!(await app.confirm({ title: 'Remove from laptop queue?', message: `"${o.job.title}" won't be sent to your desktop app.`, confirmLabel: 'Remove' }))) return;
    try { await app.remove('outbox', o.id); app.toast('Removed from queue', 'success'); } catch (e) { app.toast(e.message, 'error'); }
  };

  return (
    <div className="col" style={{ gap: 16 }}>
      <div>
        <h2 style={{ margin: 0, fontSize: 24, letterSpacing: '-.02em' }} data-testid="greeting">{greet}{first ? `, ${first}` : ''} 👋</h2>
        <p className="small muted" style={{ margin: '4px 0 0' }}>{running.length ? `${running.length} campaign${running.length > 1 ? 's are' : ' is'} hunting for you.` : app.outbox.length ? `${app.outbox.length} job${app.outbox.length > 1 ? 's' : ''} waiting for your laptop.` : 'Start a campaign and let ApplyPilot hunt for you.'}</p>
      </div>

      <motion.div {...stagger(0)} className="card pad digest premium premium-shimmer" data-testid="digest">
        <div style={{ position: 'relative', zIndex: 2 }}>
          <div className="section-title" style={{ margin: 0 }}><Sun size={14} />{hour < 12 ? 'Morning digest' : 'Your digest'}</div>
          {digestLines.length ? (
            <div className="col" style={{ gap: 2, marginTop: 6 }}>
              {digestLines.map((l) => (
                <button key={l.k} type="button" className="list-row" style={{ padding: '0', minHeight: 40 }} onClick={() => go(l.go, l.params)}>
                  <l.icon size={15} color="var(--accent-2)" /><span className="grow small">{l.text}</span><ArrowUpRight size={14} className="dim" />
                </button>
              ))}
            </div>
          ) : <div className="small muted" style={{ marginTop: 6 }}>All caught up. {app.campaigns.length ? 'Your campaigns will queue new matches here.' : 'Create a campaign to get matches every day.'}</div>}
        </div>
      </motion.div>

      <form className="card pad col" style={{ gap: 8 }} onSubmit={(e) => { e.preventDefault(); if (q.trim()) go('jobs', { q: q.trim(), loc: loc.trim() }); }} data-testid="quick-search">
        <span className="label" style={{ margin: 0 }}>Quick search</span>
        <div className="search-wrap"><Search size={16} /><input className="input" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Job title" aria-label="Job title" enterKeyHint="search" /></div>
        <div className="row" style={{ gap: 8 }}>
          <div className="search-wrap grow"><MapPin size={16} /><input className="input" value={loc} onChange={(e) => setLoc(e.target.value)} placeholder="Anywhere" aria-label="Location" /></div>
          <Button type="submit" variant="primary" size="lg" icon={Search} aria-label="Search">Go</Button>
        </div>
      </form>

      <div className="grid g2" data-testid="stats">
        {[
          { icon: Send, k: 'Applied today', v: s.today, sub: `${s.week} this week`, spark: true },
          { icon: CalendarCheck, k: 'Interviews', v: s.interviews, sub: `${s.offers} offer${s.offers === 1 ? '' : 's'}` },
          { icon: TrendingUp, k: 'Response rate', v: s.responseRate, suffix: '%', sub: 'industry avg ≈ 3–8%' },
          { icon: Trophy, k: 'Total applied', v: s.total, sub: `${apps.filter((a) => a.status === 'queued').length} in queue` },
        ].map((x, i) => (
          <motion.div key={x.k} {...stagger(i + 1)} className={`card stat-card ${i === 0 ? 'premium premium-shimmer' : ''}`}>
            <div style={{ position: 'relative', zIndex: 2 }}>
              <div className="row between"><span className="label" style={{ margin: 0 }}>{x.k}</span><x.icon size={14} className="dim" /></div>
              <div className="v"><CountUp value={x.v} />{x.suffix}</div>
              <div className="sub">{x.sub}</div>
              {x.spark && <Spark data={s.days} />}
            </div>
          </motion.div>
        ))}
      </div>

      {pending > 0 && (
        <motion.div {...stagger(5)} className="card pad">
          <div className="row between"><div className="section-title" style={{ margin: 0 }}>Get set up · {steps.length - pending}/{steps.length}</div><div className="progress" style={{ width: 90 }}><div style={{ width: `${((steps.length - pending) / steps.length) * 100}%` }} /></div></div>
          <div className="list" style={{ marginTop: 6 }}>
            {steps.map((st) => (
              <button key={st.label} type="button" className="list-row" style={{ paddingLeft: 0, paddingRight: 0, color: st.done ? 'var(--muted-2)' : 'var(--fg)' }} onClick={() => go(st.go, st.params)}>
                {st.done ? <Check size={16} color="var(--green)" /> : <Circle size={16} />}
                <span className="grow" style={{ textDecoration: st.done ? 'line-through' : 'none' }}>{st.label}</span>
                {!st.done && <ArrowUpRight size={15} />}
              </button>
            ))}
          </div>
        </motion.div>
      )}

      <motion.div {...stagger(6)} className="card pad" data-testid="pipeline">
        <div className="section-title">Your pipeline</div>
        <div className="col" style={{ gap: 9 }}>
          {s.funnel.map((f, i) => (
            <div key={f.label} className="funnel-row">
              <span className="small muted ellipsis">{f.label}</span>
              <div className="funnel-track"><motion.div initial={{ width: 0 }} animate={{ width: `${Math.max(f.v ? 3 : 0, (f.v / fmax) * 100)}%` }} transition={{ delay: 0.2 + i * 0.08, duration: 0.7, ease: [0.4, 0, 0.2, 1] }} style={{ background: `linear-gradient(90deg, var(--accent), ${FUNNEL_COLORS[i]})` }} /></div>
              <span className="mono-num small" style={{ textAlign: 'right', fontWeight: 700 }}>{f.v.toLocaleString()}</span>
            </div>
          ))}
        </div>
      </motion.div>

      <motion.div {...stagger(7)} className="card pad" data-testid="whats-working">
        <div className="section-title">What's working <span className="badge accent">reply rate</span></div>
        <div className="grid g2-md" style={{ gap: 14 }}>
          {[['By resume', (a) => a.resumeName], ['By source', (a) => (a.job.source === 'import' ? 'Imported' : a.job.source)]].map(([title, fn]) => {
            const rows = groupRate(apps, fn);
            return (
              <div key={title}>
                <div className="label">{title}</div>
                {rows.map((g) => (
                  <div key={g.k} className="rate-row"><span>{g.k}</span><span className="mono-num" style={{ flexShrink: 0 }}><span className="dim">{g.applied} sent · </span><b style={{ color: g.interviews ? 'var(--green)' : undefined }}>{Math.round((g.interviews / g.applied) * 100)}%</b></span></div>
                ))}
                {!rows.length && <div className="small dim">Appears after your first applications.</div>}
              </div>
            );
          })}
        </div>
      </motion.div>

      <motion.div {...stagger(8)} className="card pad" data-testid="home-campaigns">
        <div className="row between"><div className="section-title" style={{ margin: 0 }}><Rocket size={14} />Campaigns</div><a href="#/campaigns" className="small muted tap row" onClick={(e) => { e.preventDefault(); go('campaigns'); }}>All →</a></div>
        <div className="col" style={{ gap: 8, marginTop: 8 }}>
          {app.campaigns.slice(0, 5).map((c) => {
            const r = rt.get(c.id) || {};
            const busy = ['searching', 'scoring', 'queueing'].includes(r.phase);
            return (
              <button key={c.id} type="button" className="row" style={{ gap: 10, background: 'none', border: 0, color: 'inherit', padding: 0, minHeight: 40, textAlign: 'left', cursor: 'pointer' }} onClick={() => go('campaigns')}>
                <span className={`dot ${c.status === 'running' ? 'live' : ''}`} style={{ color: c.status === 'running' ? 'var(--green)' : 'var(--muted-2)' }} />
                <span className="grow ellipsis small">{c.name}</span>
                <span className="tiny dim">{busy ? r.phase : c.status === 'running' ? 'running' : 'paused'}</span>
                <span className="badge blue">{apps.filter((a) => a.campaignId === c.id && a.status === 'queued').length} queued</span>
              </button>
            );
          })}
          {!app.campaigns.length && <div className="small dim">No campaigns yet. <a href="#/campaigns" onClick={(e) => { e.preventDefault(); go('campaigns', { new: '1' }); }}>Create one</a> per role you want.</div>}
        </div>
      </motion.div>

      <motion.div {...stagger(9)} className="card pad" data-testid="outbox-card">
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

      <motion.div {...stagger(10)} className="card pad" data-testid="activity">
        <div className="row between"><div className="section-title" style={{ margin: 0 }}><Activity size={14} />Activity</div><a href="#/applied" className="small muted tap row" onClick={(e) => { e.preventDefault(); go('applied'); }}>Tracker →</a></div>
        <div className="col" style={{ gap: 0, marginTop: 6 }}>
          {feed.map((e) => (
            <button key={e.id} type="button" className="row small" style={{ alignItems: 'flex-start', padding: '7px 0', borderBottom: '1px solid var(--border)', background: 'none', border: 0, borderBottomStyle: 'solid', color: 'inherit', textAlign: 'left', cursor: 'pointer', gap: 8 }} onClick={() => go('applied', { id: e.appId })}>
              <span className="dot" style={{ marginTop: 7, flexShrink: 0, color: e.type === 'submitted' || /applied/i.test(e.message) ? 'var(--green)' : e.type === 'error' || e.type === 'failed' ? 'var(--red)' : 'var(--accent-2)' }} />
              <span className="grow break">{e.message}</span>
              <span className="tiny dim" style={{ flexShrink: 0 }}>{timeAgo(e.t)}</span>
            </button>
          ))}
          {!feed.length && <div className="small dim">Nothing yet. Save or apply to a job and it shows up here.</div>}
        </div>
      </motion.div>

      <motion.div {...stagger(11)} className="card pad">
        <div className="row between"><div className="section-title" style={{ margin: 0 }}>Recent applications</div><a href="#/applied" className="small muted tap row" onClick={(e) => { e.preventDefault(); go('applied'); }}>All →</a></div>
        <div className="col" style={{ gap: 10, marginTop: 12 }}>
          {apps.filter((a) => !['skipped', 'queued'].includes(a.status)).slice(0, 5).map((a) => (
            <button type="button" key={a.id} className="row" style={{ gap: 10, background: 'none', border: 0, color: 'inherit', padding: 0, textAlign: 'left', cursor: 'pointer', minHeight: 44 }} onClick={() => go('applied', { id: a.id })}>
              <Logo name={a.job.company} size="sm" />
              <div className="grow"><div className="small ellipsis" style={{ fontWeight: 600 }}>{a.job.title}</div><div className="tiny dim ellipsis">{a.job.company} · {timeAgo(a.updatedAt)}</div></div>
              <StatusBadge status={a.status} />
            </button>
          ))}
          {!apps.length && <div className="small dim">Nothing yet.</div>}
        </div>
      </motion.div>

      <motion.div {...stagger(12)} className="card pad">
        <div className="row between"><div className="section-title" style={{ margin: 0 }}><Monitor size={14} />Linked devices</div><a href="#/settings" className="small muted tap row" onClick={(e) => { e.preventDefault(); go('settings'); }}>Manage →</a></div>
        <div className="col" style={{ gap: 8, marginTop: 10 }}>
          {(devices || []).map((dv) => (
            <div key={dv.id} className="row small" style={{ gap: 10 }}>
              <span className={`dot ${dv.lastSeenAt && Date.now() - dv.lastSeenAt < 5 * 60000 ? 'live' : ''}`} style={{ color: dv.lastSeenAt && Date.now() - dv.lastSeenAt < 5 * 60000 ? 'var(--green)' : 'var(--muted-2)' }} />
              <span className="grow ellipsis">{dv.name}</span><span className="tiny dim">{dv.lastSeenAt ? `seen ${timeAgo(dv.lastSeenAt)}` : 'never synced'}</span>
            </div>
          ))}
          {devices && !devices.length && <div className="small dim">No desktop linked yet. <a href="#/settings" onClick={(e) => { e.preventDefault(); go('settings'); }}>Link one</a> to send jobs from your phone.</div>}
          {!devices && <div className="skeleton" style={{ height: 20 }} />}
        </div>
      </motion.div>
    </div>
  );
}
