import React, { useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Send, CalendarCheck, TrendingUp, Trophy, Rocket, Check, Circle, Search, Zap, Lock, Activity, ArrowUpRight } from 'lucide-react';
import { useApp } from '../lib/store';
import { Button, CountUp, timeAgo, stagger } from '../components/ui';
import { profileCompletion } from './Profile';

const DAY = 86400000;
const isApplied = (a) => ['applied', 'interview', 'offer', 'rejected'].includes(a.status) && a.appliedAt;

function groupRate(apps, key) {
  const m = new Map();
  for (const a of apps.filter(isApplied)) {
    const k = key(a) || '—';
    const g = m.get(k) || { k, applied: 0, interviews: 0, offers: 0 };
    g.applied++;
    if (a.status === 'interview' || a.status === 'offer') g.interviews++;
    if (a.status === 'offer') g.offers++;
    m.set(k, g);
  }
  return [...m.values()].sort((a, b) => b.applied - a.applied).slice(0, 6);
}

function Spark({ data }) {
  const max = Math.max(1, ...data);
  return (
    <div className="row" style={{ alignItems: 'flex-end', gap: 3, height: 34, marginTop: 10 }}>
      {data.map((v, i) => <motion.div key={i} initial={{ height: 0 }} animate={{ height: `${Math.max(6, (v / max) * 100)}%` }} transition={{ delay: i * 0.03, duration: 0.4 }} style={{ flex: 1, borderRadius: 3, background: i === data.length - 1 ? 'var(--accent-2)' : 'rgba(129,140,248,.35)' }} title={`${v}`} />)}
    </div>
  );
}

export default function Dashboard() {
  const app = useApp();
  const apps = app.applications;
  const p = app.profile.values || {};
  const now = Date.now();
  const startToday = new Date(); startToday.setHours(0, 0, 0, 0);

  const s = useMemo(() => {
    const applied = apps.filter(isApplied);
    const today = applied.filter((a) => new Date(a.appliedAt) >= startToday).length;
    const week = applied.filter((a) => now - new Date(a.appliedAt) < 7 * DAY).length;
    const interviews = apps.filter((a) => a.status === 'interview' || a.status === 'offer').length;
    const offers = apps.filter((a) => a.status === 'offer').length;
    const responded = apps.filter((a) => ['interview', 'offer', 'rejected'].includes(a.status)).length;
    const days = Array.from({ length: 14 }, (_, i) => {
      const d0 = new Date(startToday.getTime() - (13 - i) * DAY);
      const d1 = new Date(d0.getTime() + DAY);
      return applied.filter((a) => new Date(a.appliedAt) >= d0 && new Date(a.appliedAt) < d1).length;
    });
    const found = app.campaigns.reduce((n, c) => n + (c.stats?.found || 0), 0);
    return { total: applied.length, today, week, interviews, offers, responseRate: applied.length ? Math.round((responded / applied.length) * 100) : 0, days, found };
  }, [apps, app.campaigns]); // eslint-disable-line

  const completion = profileCompletion(app.profileSchema, p);
  const steps = [
    { done: app.resumes.length > 0, label: 'Upload your resume', go: 'resumes' },
    { done: completion >= 70, label: `Complete your profile (${completion}%)`, go: 'profile' },
    { done: app.campaigns.length > 0, label: 'Create your first campaign', go: 'campaigns' },
    { done: !!app.settings.keys.anthropic, label: 'Add an AI key for tailored applications', go: 'settings', params: { tab: 'ai' } },
    { done: app.connectors.some((c) => c.requiresKeys.length && c.ready), label: 'Connect a premium source (LinkedIn/Indeed via JSearch, Adzuna…)', go: 'settings', params: { tab: 'sources' } },
  ];
  const pending = steps.filter((x) => !x.done).length;
  const hour = new Date().getHours();
  const greet = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
  const running = app.campaigns.filter((c) => c.status === 'running');

  const funnel = [
    { label: 'Jobs scanned', v: Math.max(s.found, apps.length) },
    { label: 'Matched & queued', v: apps.length },
    { label: 'Applied', v: s.total },
    { label: 'Interviews', v: s.interviews },
    { label: 'Offers', v: s.offers },
  ];
  const fmax = Math.max(1, funnel[0].v);

  return (
    <div className="page" style={{ position: 'relative' }}>
      <div className="glow" style={{ top: -280, right: -200 }} />
      <div className="page-head" style={{ position: 'relative' }}>
        <div>
          <h1>{greet}{p.firstName ? `, ${p.firstName}` : ''} 👋</h1>
          <p>{running.length ? `${running.length} campaign${running.length > 1 ? 's are' : ' is'} hunting for you right now.` : 'Start a campaign and let ApplyPilot hunt while you prepare for interviews.'}</p>
        </div>
        <div className="row">
          <Button icon={Search} onClick={() => app.go('jobs')}>Find jobs</Button>
          <Button variant="primary" icon={Rocket} onClick={() => app.go('campaigns', { draft: {} })}>New campaign</Button>
        </div>
      </div>

      <div className="grid g4" style={{ marginBottom: 20 }}>
        {[
          { icon: Send, k: 'Applied today', v: s.today, sub: `${s.week} this week`, spark: true },
          { icon: CalendarCheck, k: 'Interviews', v: s.interviews, sub: `${s.offers} offer${s.offers === 1 ? '' : 's'}` },
          { icon: TrendingUp, k: 'Response rate', v: s.responseRate, suffix: '%', sub: 'industry avg ≈ 3–8%' },
          { icon: Trophy, k: 'Total applications', v: s.total, sub: `${apps.filter((a) => a.status === 'queued').length} waiting in queue` },
        ].map((x, i) => (
          <motion.div key={x.k} {...stagger(i)} className={`card stat-card ${i === 0 ? 'premium premium-shimmer' : ''}`}>
            <div style={{ position: 'relative', zIndex: 2 }}>
              <div className="row between"><span className="label" style={{ margin: 0 }}>{x.k}</span><x.icon size={15} className="dim" /></div>
              <div className="v"><CountUp value={x.v} />{x.suffix}</div>
              <div className="sub">{x.sub}</div>
              {x.spark && <Spark data={s.days} />}
            </div>
          </motion.div>
        ))}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1.35fr 1fr', gap: 20, alignItems: 'start' }}>
        <div className="col" style={{ gap: 20 }}>
          {pending > 0 && (
            <motion.div {...stagger(4)} className="card pad">
              <div className="row between"><div className="section-title" style={{ margin: 0 }}>Get set up · {steps.length - pending}/{steps.length}</div><div className="progress" style={{ width: 140 }}><div style={{ width: `${((steps.length - pending) / steps.length) * 100}%` }} /></div></div>
              <div className="col" style={{ gap: 2, marginTop: 12 }}>
                {steps.map((st) => (
                  <button key={st.label} className="nav-item" onClick={() => app.go(st.go, st.params)} style={{ color: st.done ? 'var(--muted-2)' : 'var(--fg)' }}>
                    {st.done ? <Check size={15} color="var(--green)" /> : <Circle size={15} />}<span style={{ textDecoration: st.done ? 'line-through' : 'none' }}>{st.label}</span>{!st.done && <ArrowUpRight size={14} style={{ marginLeft: 'auto' }} />}
                  </button>
                ))}
              </div>
            </motion.div>
          )}

          <motion.div {...stagger(5)} className="card pad">
            <div className="section-title">Your pipeline</div>
            <div className="col" style={{ gap: 10 }}>
              {funnel.map((f, i) => (
                <div key={f.label} className="row" style={{ gap: 12 }}>
                  <span className="small muted" style={{ width: 130 }}>{f.label}</span>
                  <div className="grow" style={{ height: 22, background: 'rgba(255,255,255,.04)', borderRadius: 6, overflow: 'hidden' }}>
                    <motion.div initial={{ width: 0 }} animate={{ width: `${Math.max(f.v ? 3 : 0, (f.v / fmax) * 100)}%` }} transition={{ delay: 0.2 + i * 0.08, duration: 0.7, ease: [0.4, 0, 0.2, 1] }}
                      style={{ height: '100%', borderRadius: 6, background: `linear-gradient(90deg, var(--accent), ${['#22d3ee', '#22d3ee', '#4ade80', '#f472b6', '#fbbf24'][i]})` }} />
                  </div>
                  <span className="mono-num" style={{ width: 54, textAlign: 'right', fontWeight: 700 }}>{f.v.toLocaleString()}</span>
                </div>
              ))}
            </div>
          </motion.div>

          <motion.div {...stagger(6)} className="card pad" style={{ position: 'relative', overflow: 'hidden' }}>
            <div className="section-title">What's working <span className="badge accent">resume A/B testing</span></div>
            <div style={{ filter: app.plan.analytics ? 'none' : 'blur(5px)', pointerEvents: app.plan.analytics ? 'auto' : 'none' }}>
              <div className="grid g2">
                {[['By resume', (a) => a.resumeName], ['By source', (a) => a.job.source]].map(([title, fn]) => (
                  <div key={title}>
                    <div className="label">{title}</div>
                    {groupRate(apps, fn).map((g) => (
                      <div key={g.k} className="row between small" style={{ padding: '5px 0', borderBottom: '1px solid var(--border)' }}>
                        <span className="ellipsis" style={{ maxWidth: 170 }}>{g.k}</span>
                        <span className="mono-num"><span className="dim">{g.applied} sent · </span><b style={{ color: g.interviews ? 'var(--green)' : undefined }}>{Math.round((g.interviews / g.applied) * 100)}%</b></span>
                      </div>
                    ))}
                    {!groupRate(apps, fn).length && <div className="small dim">Data appears after your first applications.</div>}
                  </div>
                ))}
              </div>
            </div>
            {!app.plan.analytics && (
              <div style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', background: 'rgba(10,10,10,.35)' }}>
                <div style={{ textAlign: 'center' }}><Lock size={20} /><div style={{ fontWeight: 700, margin: '6px 0' }}>See which resume gets interviews</div><Button size="sm" className="btn-gradient" variant="gradient" onClick={() => app.go('settings', { tab: 'plan' })}>Unlock with Pro</Button></div>
              </div>
            )}
          </motion.div>
        </div>

        <div className="col" style={{ gap: 20 }}>
          <motion.div {...stagger(5)} className="card pad">
            <div className="row between"><div className="section-title" style={{ margin: 0 }}><Zap size={14} />Campaigns</div><a href="#" className="small muted" onClick={(e) => { e.preventDefault(); app.go('campaigns'); }}>All →</a></div>
            <div className="col" style={{ gap: 8, marginTop: 12 }}>
              {app.campaigns.slice(0, 5).map((c) => (
                <div key={c.id} className="row" style={{ gap: 10 }}>
                  <span className={`dot ${c.status === 'running' ? 'live' : ''}`} style={{ color: c.status === 'running' ? 'var(--green)' : 'var(--muted-2)' }} />
                  <span className="grow ellipsis small">{c.name}</span>
                  <span className="tiny dim">{c.status === 'running' ? (c.phase || 'running') : 'paused'}</span>
                  <span className="badge green">{c.stats?.applied || 0} sent</span>
                </div>
              ))}
              {!app.campaigns.length && <div className="small dim">No campaigns yet.</div>}
            </div>
          </motion.div>

          <motion.div {...stagger(6)} className="card pad">
            <div className="section-title"><Activity size={14} />Live activity</div>
            <div className="col" style={{ gap: 2, maxHeight: 460, overflowY: 'auto' }}>
              <AnimatePresence initial={false}>
                {app.activity.slice(0, 40).map((a) => (
                  <motion.div key={a.id} layout initial={{ opacity: 0, x: -10, height: 0 }} animate={{ opacity: 1, x: 0, height: 'auto' }} className="row small" style={{ alignItems: 'flex-start', padding: '6px 0', borderBottom: '1px solid var(--border)' }}>
                    <span className="dot" style={{ marginTop: 7, flexShrink: 0, color: a.type === 'applied' ? 'var(--green)' : a.type === 'error' ? 'var(--red)' : a.type === 'review' ? 'var(--amber)' : 'var(--accent-2)' }} />
                    <span className="grow">{a.message}</span>
                    <span className="tiny dim" style={{ flexShrink: 0 }}>{timeAgo(a.t)}</span>
                  </motion.div>
                ))}
              </AnimatePresence>
              {!app.activity.length && <div className="small dim">Activity from your campaigns shows up here in real time.</div>}
            </div>
          </motion.div>
        </div>
      </div>

      <div className="marquee" style={{ marginTop: 34 }}>
        <div className="marquee-inner">
          {[...app.connectors, ...app.connectors].map((c, i) => <span key={i} className="badge" style={{ padding: '4px 12px', fontSize: 12 }}>{c.name}</span>)}
        </div>
      </div>
    </div>
  );
}
