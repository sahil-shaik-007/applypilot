import React, { useEffect, useState } from 'react';
import { FileText, MessageSquareText, Sparkles, Globe, Settings as Cog, ChevronRight, Download, Lock, LogOut, ShieldCheck } from 'lucide-react';
import { useApp, go } from '../lib/store.jsx';
import { Logo, stagger } from '../components/ui.jsx';
import { motion } from 'framer-motion';
import { canInstall, onInstallable, promptInstall, isStandalone } from '../lib/pwa.js';

export default function More() {
  const app = useApp();
  const [installable, setInstallable] = useState(canInstall());
  useEffect(() => onInstallable(setInstallable), []);
  const items = [
    { id: 'resumes', icon: FileText, label: 'Resumes', sub: `${app.resumes.length} uploaded` },
    { id: 'answers', icon: MessageSquareText, label: 'Answer bank', sub: `${app.qa.length} saved answers` },
    { id: 'ai', icon: Sparkles, label: 'AI studio', sub: app.settings.anthropicKey ? 'Key added' : 'Add your Anthropic key' },
    { id: 'platforms', icon: Globe, label: 'Job platforms', sub: '250+ boards, deep-linked' },
    { id: 'settings', icon: Cog, label: 'Settings', sub: 'Devices, security, account' },
  ];
  const u = app.user || {};
  return (
    <div className="col" style={{ gap: 14 }}>
      <div className="card pad row" style={{ gap: 12 }}>
        <Logo name={u.name || u.email || '?'} />
        <div className="grow"><div style={{ fontWeight: 700 }} className="ellipsis">{u.name || 'Signed in'}</div><div className="small muted ellipsis">{u.email}</div></div>
        <span className="badge green"><ShieldCheck size={11} />Unlocked</span>
      </div>
      <div className="card list">
        {items.map((it, i) => (
          <motion.button key={it.id} {...stagger(i)} type="button" className="list-row" onClick={() => go(it.id)} data-nav={it.id}>
            <span className="ico"><it.icon size={16} /></span>
            <span className="grow"><span style={{ display: 'block', fontWeight: 600 }}>{it.label}</span><span className="tiny dim">{it.sub}</span></span>
            <ChevronRight size={16} className="dim" />
          </motion.button>
        ))}
      </div>
      <div className="card list">
        {installable && !isStandalone() && <button type="button" className="list-row" onClick={promptInstall}><span className="ico"><Download size={16} /></span><span className="grow">Install ApplyPilot</span></button>}
        <button type="button" className="list-row" onClick={() => app.lock('Vault locked.')}><span className="ico"><Lock size={16} /></span><span className="grow">Lock vault</span></button>
        <button type="button" className="list-row" onClick={() => app.logout()}><span className="ico"><LogOut size={16} /></span><span className="grow">Sign out</span></button>
      </div>
      <div className="tiny dim" style={{ textAlign: 'center' }}>ApplyPilot · zero-knowledge sync · auto-locks after 15 min idle</div>
    </div>
  );
}
