import React, { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Rocket, Plus, Search, FileText, ShieldCheck, Inbox } from 'lucide-react';
import { useApp, go } from '../lib/store.jsx';
import { Button, Empty, stagger } from '../components/ui.jsx';
import { CampaignCard, CampaignEditor } from '../components/campaigns.jsx';

export default function Campaigns({ params }) {
  const app = useApp();
  const [editing, setEditing] = useState(null);
  useEffect(() => { if (params.new) setEditing({}); }, [params.new]);
  const running = app.campaigns.filter((c) => c.status === 'running').length;
  const queued = app.applications.filter((a) => a.status === 'queued').length;
  return (
    <div className="col" style={{ gap: 14 }}>
      <div className="row between" style={{ gap: 8 }}>
        <div className="small muted grow">One campaign per role, each with its own resume and filters. {running ? `${running} running.` : ''}</div>
        <Button variant="primary" icon={Plus} onClick={() => setEditing({})} data-testid="campaign-new">New</Button>
      </div>
      {queued > 0 && (
        <button type="button" className="card pad row" style={{ color: 'inherit', textAlign: 'left', cursor: 'pointer', gap: 12, width: '100%' }} onClick={() => go('queue')} data-testid="queue-cta">
          <Inbox size={18} color="var(--accent-2)" />
          <div className="grow"><div style={{ fontWeight: 700 }}>{queued} match{queued > 1 ? 'es' : ''} waiting for review</div><div className="small muted">Approve in bulk or skip in the Review queue.</div></div>
        </button>
      )}
      {app.campaigns.length ? (
        <div className="col" style={{ gap: 12 }}><AnimatePresence>{app.campaigns.map((c, i) => <CampaignCard key={c.id} c={c} index={i} onEdit={setEditing} />)}</AnimatePresence></div>
      ) : (
        <Empty icon={Rocket} title="Launch your first campaign" action={<Button variant="primary" icon={Plus} onClick={() => setEditing({})}>Create campaign</Button>}>
          Tell ApplyPilot which roles you want. While the app is open it searches every source on a schedule, scores each job on this phone and queues the best ones for you.
        </Empty>
      )}
      <div className="col" style={{ gap: 10 }}>
        {[
          { icon: Search, t: 'Searches everywhere', d: 'Every role × location, on a schedule, whenever ApplyPilot is open (and from your desktop).' },
          { icon: FileText, t: 'Right resume, every time', d: 'Pin a resume per campaign or let ApplyPilot pick the best fit per job. Optional truthful tailoring.' },
          { icon: ShieldCheck, t: 'Safe by design', d: 'Daily caps, duplicate & per-company guards, scam and eligibility checks. Nothing is ever guessed.' },
        ].map((x, i) => (
          <motion.div key={x.t} {...stagger(i + 2)} className="card pad row" style={{ gap: 12, alignItems: 'flex-start' }}><x.icon size={18} color="var(--accent-2)" style={{ flexShrink: 0, marginTop: 2 }} /><div><div style={{ fontWeight: 700 }}>{x.t}</div><div className="small muted">{x.d}</div></div></motion.div>
        ))}
      </div>
      <CampaignEditor initial={editing} onClose={() => setEditing(null)} />
    </div>
  );
}
