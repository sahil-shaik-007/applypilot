import React from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import {
  LayoutDashboard, Search, Rocket, Inbox, SquareKanban, FileText, UserRound, MessageSquareText, Globe, Wand2, Settings as SettingsIcon, Star, Crown, Loader2,
} from 'lucide-react';
import { useApp } from './lib/store';
import markUrl from './assets/mark.svg';
import { Toasts, ConfirmDialog } from './components/ui';
import Dashboard from './pages/Dashboard';
import Jobs from './pages/Jobs';
import Campaigns from './pages/Campaigns';
import ReviewQueue from './pages/ReviewQueue';
import Applications from './pages/Applications';
import Resumes from './pages/Resumes';
import Profile from './pages/Profile';
import QA from './pages/QA';
import Platforms from './pages/Platforms';
import AIStudio from './pages/AIStudio';
import Settings from './pages/Settings';
import Onboarding from './pages/Onboarding';

const NAV = [
  { group: 'Hunt' },
  { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard, el: Dashboard },
  { id: 'jobs', label: 'Find jobs', icon: Search, el: Jobs },
  { id: 'campaigns', label: 'Campaigns', icon: Rocket, el: Campaigns },
  { id: 'queue', label: 'Review queue', icon: Inbox, el: ReviewQueue, count: (s) => s.applications.filter((a) => a.status === 'queued' || a.status === 'awaiting-you').length },
  { id: 'applications', label: 'Applications', icon: SquareKanban, el: Applications },
  { group: 'You' },
  { id: 'resumes', label: 'Resumes', icon: FileText, el: Resumes },
  { id: 'profile', label: 'Profile', icon: UserRound, el: Profile },
  { id: 'qa', label: 'Answer bank', icon: MessageSquareText, el: QA, count: (s) => s.qa.filter((q) => !q.answer).length },
  { group: 'Tools' },
  { id: 'platforms', label: 'Job platforms', icon: Globe, el: Platforms },
  { id: 'ai', label: 'AI studio', icon: Wand2, el: AIStudio },
  { id: 'settings', label: 'Settings', icon: SettingsIcon, el: Settings },
];

export default function App() {
  const app = useApp();
  if (app.error) return <div className="page"><h1>Something went wrong</h1><p className="muted">{app.error}</p></div>;
  if (!app.ready) return <div style={{ display: 'grid', placeItems: 'center', height: '100vh' }}><Loader2 className="spin" /></div>;
  if (!app.settings.onboarded) return <><div className="titlebar" /><Onboarding /><Toasts toasts={app.toasts} /><ConfirmDialog state={app.confirmState} onClose={app.closeConfirm} /></>;

  const current = NAV.find((n) => n.id === app.route.page) || NAV[1];
  const Page = current.el;
  const plan = app.plan;
  const running = app.campaigns.filter((c) => c.status === 'running').length;

  return (
    <div className="app">
      <div className="titlebar" />
      <aside className="sidebar">
        <div className="brand">
          <img src={markUrl} alt="" width={28} height={28} className="brand-mark" />
          <div>ApplyPilot<small>autopilot for job hunting</small></div>
        </div>
        {NAV.map((n, i) => (n.group ? <div className="nav-label" key={i}>{n.group}</div> : (
          <button key={n.id} title={n.label} className={`nav-item ${current.id === n.id ? 'active' : ''}`} onClick={() => app.go(n.id)}>
            {current.id === n.id && <motion.div layoutId="nav-bg" className="nav-bg" transition={{ type: 'spring', stiffness: 500, damping: 38 }} />}
            <n.icon size={16} />
            <span>{n.label}</span>
            {n.count && n.count(app) > 0 && <span className="count">{n.count(app)}</span>}
          </button>
        )))}
        <div className="sidebar-foot">
          {running > 0 && (
            <div className="card pad" style={{ padding: 12, marginBottom: 10 }}>
              <div className="row small"><span className="dot live" style={{ color: 'var(--green)' }} /> {running} campaign{running > 1 ? 's' : ''} running</div>
            </div>
          )}
          <div className={`card ${plan.licensed ? '' : 'premium premium-shimmer'}`} style={{ padding: 12 }}>
            <div className="row between">
              <span className="small" style={{ fontWeight: 700 }}><Crown size={13} style={{ verticalAlign: -2, marginRight: 6, color: 'var(--amber)' }} />{plan.label}</span>
              {plan.trialDaysLeft && <span className="badge amber">{plan.trialDaysLeft}d left</span>}
            </div>
            {!plan.licensed && (
              <button className="btn btn-gradient btn-sm" style={{ width: '100%', marginTop: 10 }} onClick={() => app.go('settings', { tab: 'plan' })}>Upgrade to Pro</button>
            )}
          </div>
        </div>
      </aside>
      <main className="main" id="main-scroll">
        <AnimatePresence mode="wait">
          <motion.div key={current.id} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} transition={{ duration: 0.2, ease: [0.4, 0, 0.2, 1] }}>
            <Page params={app.route.params} />
          </motion.div>
        </AnimatePresence>
      </main>
      <Toasts toasts={app.toasts} />
      <ConfirmDialog state={app.confirmState} onClose={app.closeConfirm} />
    </div>
  );
}
