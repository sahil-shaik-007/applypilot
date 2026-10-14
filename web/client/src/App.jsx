import React, { useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Home as HomeIcon, Search, SquareKanban, Inbox, LayoutGrid, Lock, RefreshCw, ChevronLeft } from 'lucide-react';
import { AppProvider, useApp, useRoute, go } from './lib/store.jsx';
import { Toasts, ConfirmSheet, Button } from './components/ui.jsx';
import { Brand, Mark } from './components/Brand.jsx';
import { ApplyHost, CampaignScheduler } from './components/apply.jsx';
import { openQuestions } from './lib/applyFlow.js';
import { profileIdOfApplication } from './lib/profiles.js';
import Landing from './pages/Landing.jsx';
import { CreateVault, Unlock, AskName } from './pages/Vault.jsx';
import Home from './pages/Home.jsx';
import Jobs from './pages/Jobs.jsx';
import Applied from './pages/Applied.jsx';
import Profile from './pages/Profile.jsx';
import More from './pages/More.jsx';
import Resumes from './pages/Resumes.jsx';
import Answers from './pages/Answers.jsx';
import AI from './pages/AI.jsx';
import Settings from './pages/Settings.jsx';
import Platforms from './pages/Platforms.jsx';
import Campaigns from './pages/Campaigns.jsx';
import Queue from './pages/Queue.jsx';
import Network from './pages/Network.jsx';

const TABS = [
  { id: 'home', label: 'Home', icon: HomeIcon },
  { id: 'jobs', label: 'Jobs', icon: Search },
  { id: 'queue', label: 'Queue', icon: Inbox },
  { id: 'applied', label: 'Applied', icon: SquareKanban },
  { id: 'more', label: 'More', icon: LayoutGrid },
];
const PAGES = {
  home: { C: Home, title: 'Home' },
  jobs: { C: Jobs, title: 'Find jobs' },
  applied: { C: Applied, title: 'Applications' },
  queue: { C: Queue, title: 'Review queue' },
  profile: { C: Profile, title: 'Your profile', parent: 'more' },
  campaigns: { C: Campaigns, title: 'Campaigns', parent: 'more' },
  network: { C: Network, title: 'Referrals', parent: 'more' },
  more: { C: More, title: 'More' },
  resumes: { C: Resumes, title: 'Resumes', parent: 'more' },
  answers: { C: Answers, title: 'Answer bank', parent: 'more' },
  ai: { C: AI, title: 'AI studio', parent: 'more' },
  settings: { C: Settings, title: 'Settings', parent: 'more' },
  platforms: { C: Platforms, title: 'Job platforms', parent: 'more' },
};

function Shell() {
  const app = useApp();
  const { page, params } = useRoute();
  const def = PAGES[page] || PAGES.home;
  const active = def.parent || (PAGES[page] ? page : 'home');
  const needsYou = app.applications.filter((a) => a.status === 'awaiting-you' || a.status === 'queued').length;
  const waiting = app.applications.filter((a) => a.status === 'awaiting-you' && openQuestions(app.qa, a.unanswered, profileIdOfApplication(app, a)).some((i) => !i.answerRec)).length;
  useEffect(() => { document.title = `${def.title} · ApplyPilot`; }, [def.title]);
  const Page = def.C;
  return (
    <div className="shell has-rail">
      <div className="rail-brand"><Brand /></div>
      <CampaignScheduler />
      <ApplyHost />
      <header className="topbar">
        {def.parent ? <Button variant="ghost" icon={ChevronLeft} aria-label="Back" onClick={() => go(def.parent)} /> : <span style={{ display: 'grid', width: 44, placeItems: 'center' }}><Mark size={24} /></span>}
        <h1 className="grow">{def.title}</h1>
        <Button variant="ghost" icon={RefreshCw} aria-label="Sync now" className={app.syncState === 'syncing' ? 'syncing' : ''} onClick={() => app.refresh()} />
        <Button variant="ghost" icon={Lock} aria-label="Lock vault" data-testid="lock" onClick={() => app.lock('Vault locked.')} />
      </header>
      <main className="content">
        <AnimatePresence mode="wait">
          <motion.div key={page} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.18 }}>
            <Page params={params} />
          </motion.div>
        </AnimatePresence>
      </main>
      <nav className="tabbar" aria-label="Main">
        {TABS.map((t) => (
          <button key={t.id} type="button" className={`tab ${active === t.id ? 'on' : ''}`} aria-current={active === t.id ? 'page' : undefined} data-tab={t.id} onClick={() => go(t.id)}>
            {active === t.id && <motion.span layoutId="tab-bg" className="tab-bg" transition={{ type: 'spring', stiffness: 500, damping: 38 }} />}
            <t.icon size={20} />
            <span>{t.label}</span>
            {t.id === 'queue' && needsYou > 0 && <span className="count" data-testid="queue-count" title={waiting ? `${waiting} waiting for your answers` : undefined}>{needsYou > 99 ? '99+' : needsYou}</span>}
          </button>
        ))}
      </nav>
    </div>
  );
}

function Splash() {
  return (
    <div style={{ minHeight: '100dvh', display: 'grid', placeItems: 'center' }}>
      <motion.div initial={{ opacity: 0, scale: 0.96 }} animate={{ opacity: 1, scale: 1 }}><Brand /></motion.div>
    </div>
  );
}

function Screens() {
  const app = useApp();
  switch (app.phase) {
    case 'loading': return <Splash />;
    case 'landing': return <Landing />;
    case 'create-vault': return <CreateVault />;
    case 'unlock': return <Unlock />;
    case 'name': return <AskName />;
    default: return <Shell />;
  }
}

export default function App() {
  return (
    <AppProvider>
      {({ toasts, confirmState, closeConfirm }) => (
        <>
          <Screens />
          <ConfirmSheet state={confirmState} onClose={closeConfirm} />
          <Toasts toasts={toasts} />
        </>
      )}
    </AppProvider>
  );
}
