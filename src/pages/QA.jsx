import React, { useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { MessageSquareText, Trash2, Plus, Bot, User, CircleHelp, Eraser, Users } from 'lucide-react';
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

// 'shared' is the answer bank's name for "no profileId": every profile may use the answer.
const SHARED = 'shared';
const scopeOf = (q) => q.profileId || SHARED;

function useProfileScopes() {
  const app = useApp();
  const profiles = app.profiles || [{ id: 'main', label: 'Main profile', isDefault: true }];
  const label = (id) => (id === SHARED ? 'Shared with all profiles' : (profiles.find((p) => p.id === id) || {}).label || 'Removed profile');
  // Scope controls only appear once there is more than one profile (or an answer already belongs to a profile other than main).
  const multi = profiles.length > 1 || app.qa.some((q) => q.profileId && q.profileId !== 'main');
  return { profiles, label, multi };
}

function QARow({ q }) {
  const app = useApp();
  const { profiles, label, multi } = useProfileScopes();
  const [answer, setAnswer] = useState(q.answer || '');
  const save = async (val = answer) => { if (val === (q.answer || '')) return; app.set({ qa: await app.run('qa:save', [{ id: q.id, question: q.question, answer: val }], 'Answer saved — used automatically from now on') }); };
  const del = async () => app.set({ qa: await app.run('qa:delete', [q.id]) });
  // Removes the saved answer but keeps the question: it goes back to "Needs answer" (and to the Review queue card).
  const clear = async () => { setAnswer(''); app.set({ qa: await app.run('qa:save', [{ id: q.id, question: q.question, answer: '' }], 'Answer cleared — the question is open again') }); };
  const setScope = async (scope) => {
    const profileId = scope === SHARED ? null : scope;
    app.set({ qa: await app.run('qa:save', [{ id: q.id, question: q.question, profileId }], profileId ? `Now used only for ${label(scope)}` : 'Now shared with every profile') });
  };
  const src = q.source === 'ai' ? { icon: Bot, label: 'AI answered', cls: 'accent' } : q.source === 'pending' ? { icon: CircleHelp, label: 'Needs answer', cls: 'amber' } : { icon: User, label: 'You', cls: 'green' };
  const scope = scopeOf(q);
  const known = scope === SHARED || profiles.some((p) => p.id === scope);
  return (
    <motion.div layout initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, x: 30 }} className="card pad" style={!q.answer ? { borderColor: 'rgba(251,191,36,.35)' } : null}>
      <div className="row between" style={{ alignItems: 'flex-start' }}>
        <div style={{ fontWeight: 700 }}>{q.question}</div>
        <div className="row" style={{ gap: 6, flexShrink: 0 }}>
          {multi && <span className={`badge ${scope === SHARED ? '' : 'blue'}`} title={scope === SHARED ? 'Every profile reuses this answer' : 'Only this profile reuses this answer'}><Users size={11} />{scope === SHARED ? 'Shared' : label(scope)}</span>}
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
      <div className="row between" style={{ marginTop: 6 }}>
        <div className="row tiny dim" style={{ gap: 10 }}>
          <span>Updated {timeAgo(q.updatedAt)}</span>
          {multi && (
            <label className="row" style={{ gap: 6 }}>
              Used by
              <select className="select" style={{ height: 26, fontSize: 12, width: 190 }} value={scope} onChange={(e) => setScope(e.target.value)}>
                <option value={SHARED}>All profiles (shared)</option>
                {profiles.map((p) => <option key={p.id} value={p.id}>{p.label} only</option>)}
                {!known && <option value={scope}>Removed profile</option>}
              </select>
            </label>
          )}
        </div>
        {q.answer && <Button size="sm" variant="ghost" icon={Eraser} onClick={clear}>Clear answer</Button>}
      </div>
    </motion.div>
  );
}

export default function QA() {
  const app = useApp();
  const { profiles, label, multi } = useProfileScopes();
  const [filter, setFilter] = useState(app.qa.some((q) => !q.answer) ? 'pending' : 'all');
  const [scope, setScope] = useState('all'); // 'all' | 'shared' | a profile id
  const [newQ, setNewQ] = useState('');
  const orphan = (q) => !!q.profileId && !profiles.some((p) => p.id === q.profileId);
  const inScope = (q) => scope === 'all' || (scope === 'removed' ? orphan(q) : scopeOf(q) === scope);
  const list = useMemo(() => app.qa.filter((q) => inScope(q) && (filter === 'all' || (filter === 'pending' ? !q.answer : q.source === filter))), [app.qa, filter, scope]); // eslint-disable-line
  const scoped = app.qa.filter(inScope);
  const add = async (question) => {
    if (!question.trim()) return;
    // A new question belongs to the scope being viewed (Shared when looking at "All").
    const profileId = scope === 'all' || scope === SHARED || scope === 'removed' ? null : scope;
    app.set({ qa: await app.run('qa:save', [{ question: question.trim(), answer: '', source: 'pending', profileId }]) });
    setNewQ('');
    setFilter('pending');
  };
  return (
    <div className="page" style={{ maxWidth: 980 }}>
      <div className="page-head">
        <div><h1>Answer bank</h1><p>Screening questions ApplyPilot met while applying. Answer once; it's reused on every future form. Nothing is ever guessed — unknown questions pause and land here.{multi ? ' Each answer is for one profile or shared with all of them; a profile never uses another profile\'s own answers.' : ''}</p></div>
      </div>
      <div className="row between" style={{ marginBottom: multi ? 10 : 16 }}>
        <Seg value={filter} onChange={setFilter} options={[{ value: 'pending', label: `Needs answer (${scoped.filter((q) => !q.answer).length})` }, { value: 'all', label: `All (${scoped.length})` }, { value: 'ai', label: 'AI answered' }, { value: 'you', label: 'Mine' }]} />
        <form className="row" onSubmit={(e) => { e.preventDefault(); add(newQ); }}>
          <input className="input" style={{ width: 320 }} value={newQ} onChange={(e) => setNewQ(e.target.value)} placeholder={scope === 'all' || scope === SHARED || scope === 'removed' ? 'Add a question you often get…' : `Add a question for ${label(scope)}…`} />
          <Button icon={Plus} type="submit">Add</Button>
        </form>
      </div>
      {multi && (
        <div className="row" style={{ marginBottom: 16, gap: 10 }}>
          <span className="small muted">Show</span>
          <select className="select" style={{ width: 260, height: 32 }} value={scope} onChange={(e) => setScope(e.target.value)}>
            <option value="all">All answers</option>
            <option value={SHARED}>Shared with every profile</option>
            {profiles.map((p) => <option key={p.id} value={p.id}>{p.label} only</option>)}
            {app.qa.some(orphan) && <option value="removed">Removed profiles</option>}
          </select>
        </div>
      )}
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
