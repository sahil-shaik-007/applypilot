import React, { useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { MessageSquareText, Trash2, Plus, Bot, User, CircleHelp } from 'lucide-react';
import { useApp } from '../lib/store';
import { Button, Seg, Empty, timeAgo } from '../components/ui';

const COMMON = [
  'Why do you want to work at this company?',
  'What are your salary expectations?',
  'Are you comfortable working in rotational / night shifts?',
  'Describe a challenging project you worked on.',
  'What is your current CTC?',
  'What is your expected CTC?',
  'Are you willing to work from the office 3 days a week?',
  'Do you have experience working with remote / distributed teams?',
  'What is your biggest professional achievement?',
  'Are you open to contract roles?',
];

function QARow({ q }) {
  const app = useApp();
  const [answer, setAnswer] = useState(q.answer || '');
  const save = async (val = answer) => { if (val === (q.answer || '')) return; app.set({ qa: await app.run('qa:save', [{ ...q, answer: val }], 'Answer saved — used automatically from now on') }); };
  const del = async () => app.set({ qa: await app.run('qa:delete', [q.id]) });
  const src = q.source === 'ai' ? { icon: Bot, label: 'AI answered', cls: 'accent' } : q.source === 'pending' ? { icon: CircleHelp, label: 'Needs answer', cls: 'amber' } : { icon: User, label: 'You', cls: 'green' };
  return (
    <motion.div layout initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, x: 30 }} className="card pad" style={!q.answer ? { borderColor: 'rgba(251,191,36,.35)' } : null}>
      <div className="row between" style={{ alignItems: 'flex-start' }}>
        <div style={{ fontWeight: 700 }}>{q.question}</div>
        <div className="row" style={{ gap: 6, flexShrink: 0 }}>
          <span className={`badge ${src.cls}`}><src.icon size={11} />{src.label}</span>
          {q.uses > 0 && <span className="badge">used {q.uses}×</span>}
          <Button size="sm" variant="ghost" icon={Trash2} onClick={del} />
        </div>
      </div>
      <div style={{ marginTop: 10 }}>
        {q.options && q.options.length ? (
          <select className="select" value={answer} onChange={(e) => { setAnswer(e.target.value); save(e.target.value); }}>
            <option value="">Choose the answer…</option>
            {q.options.map((o) => <option key={o} value={o}>{o}</option>)}
          </select>
        ) : (
          <textarea className="textarea" rows={answer.length > 120 ? 4 : 2} value={answer} placeholder="Type your answer once — ApplyPilot reuses it on every form that asks this." onChange={(e) => setAnswer(e.target.value)} onBlur={() => save()} />
        )}
      </div>
      <div className="tiny dim" style={{ marginTop: 6 }}>Updated {timeAgo(q.updatedAt)}</div>
    </motion.div>
  );
}

export default function QA() {
  const app = useApp();
  const [filter, setFilter] = useState(app.qa.some((q) => !q.answer) ? 'pending' : 'all');
  const [newQ, setNewQ] = useState('');
  const list = useMemo(() => app.qa.filter((q) => filter === 'all' || (filter === 'pending' ? !q.answer : q.source === filter)), [app.qa, filter]);
  const add = async (question) => {
    if (!question.trim()) return;
    app.set({ qa: await app.run('qa:save', [{ question: question.trim(), answer: '', source: 'pending' }]) });
    setNewQ('');
    setFilter('pending');
  };
  return (
    <div className="page" style={{ maxWidth: 980 }}>
      <div className="page-head">
        <div><h1>Answer bank</h1><p>Screening questions ApplyPilot met while applying. Answer once; it's reused on every future form. Nothing is ever guessed — unknown questions pause and land here.</p></div>
      </div>
      <div className="row between" style={{ marginBottom: 16 }}>
        <Seg value={filter} onChange={setFilter} options={[{ value: 'pending', label: `Needs answer (${app.qa.filter((q) => !q.answer).length})` }, { value: 'all', label: `All (${app.qa.length})` }, { value: 'ai', label: 'AI answered' }, { value: 'you', label: 'Mine' }]} />
        <form className="row" onSubmit={(e) => { e.preventDefault(); add(newQ); }}>
          <input className="input" style={{ width: 320 }} value={newQ} onChange={(e) => setNewQ(e.target.value)} placeholder="Add a question you often get…" />
          <Button icon={Plus} type="submit">Add</Button>
        </form>
      </div>
      <div className="chips" style={{ marginBottom: 20 }}>
        {COMMON.filter((c) => !app.qa.some((q) => q.question === c)).slice(0, 6).map((c) => <span key={c} className="chip" onClick={() => add(c)}>+ {c}</span>)}
      </div>
      {list.length ? (
        <div className="col" style={{ gap: 12 }}><AnimatePresence>{list.map((q) => <QARow key={q.id} q={q} />)}</AnimatePresence></div>
      ) : (
        <Empty icon={MessageSquareText} title={filter === 'pending' ? 'All caught up 🎉' : 'No answers yet'}>Questions appear here as campaigns run. Add common ones above to get ahead.</Empty>
      )}
    </div>
  );
}
