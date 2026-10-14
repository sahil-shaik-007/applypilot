import React, { useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { MessageSquareText, Plus, Pencil, Trash2, Search, Bot, User, CircleHelp, Copy, Users } from 'lucide-react';
import { newId } from '@shared/vaultCrypto.js';
import { useApp } from '../lib/store.jsx';
import { Button, Empty, Sheet, Seg, Field, timeAgo, copyText } from '../components/ui.jsx';
import { allProfiles } from '../lib/profiles.js';
import { qaScope, qaScopeLabel } from '../lib/answers.js';

const COMMON = [
  'Why do you want to work at this company?',
  'What are your salary expectations?',
  'What is your notice period?',
  'Describe a challenging project you worked on.',
  'What is your current CTC?',
  'What is your expected CTC?',
  'Are you willing to work from the office 3 days a week?',
  'Are you comfortable working in rotational / night shifts?',
  'What is your biggest professional achievement?',
  'Are you open to contract roles?',
];

function Editor({ state, onClose }) {
  const app = useApp();
  const profiles = allProfiles(app);
  const [scope, setScope] = useState(state ? qaScope(state) || '' : '');
  const [q, setQ] = useState(state ? state.question || '' : '');
  const [a, setA] = useState(state ? state.answer || '' : '');
  const [busy, setBusy] = useState(false);
  const isNew = state && !state.id;
  const save = async () => {
    if (!q.trim()) return;
    setBusy(true);
    try {
      const id = state.id || newId();
      await app.put('qa', id, { ...(state.id ? state : {}), id, question: q.trim(), answer: a, source: state.source && state.source !== 'pending' ? state.source : (a ? 'user' : 'pending'), profileId: scope || null, uses: state.uses || 0, updatedAt: new Date().toISOString() });
      app.toast(isNew ? 'Answer added' : 'Answer saved', 'success');
      onClose();
    } catch (e) { app.toast(e.message, 'error'); } finally { setBusy(false); }
  };
  return (
    <Sheet open={!!state} onClose={onClose} title={isNew ? 'Add an answer' : 'Edit answer'}
      footer={<><Button size="lg" variant="ghost" onClick={onClose}>Cancel</Button><Button size="lg" variant="primary" loading={busy} disabled={!q.trim()} onClick={save} data-testid="qa-save">Save</Button></>}>
      <div className="col" style={{ gap: 14 }}>
        <Field label="Question"><textarea className="textarea" rows={2} value={q} onChange={(e) => setQ(e.target.value)} placeholder="e.g. What is your notice period?" data-testid="qa-question" /></Field>
        {isNew && !q && <div className="chips">{COMMON.filter((c) => !app.qa.some((x) => x.question === c)).slice(0, 6).map((c) => <button type="button" key={c} className="chip" onClick={() => setQ(c)}>+ {c}</button>)}</div>}
        <Field label="Used by" help={scope ? 'Only this profile uses this answer. A shared answer is used by every profile that has no answer of its own.' : 'Every profile uses this answer unless it has its own answer to the same question.'}>
          <select className="select" value={scope} onChange={(e) => setScope(e.target.value)} aria-label="Used by" data-testid="qa-scope">
            <option value="">All profiles (shared)</option>
            {profiles.map((p) => <option key={p.id} value={p.id}>{p.label}{p.isDefault ? ' (default)' : ''}</option>)}
            {scope && !profiles.some((p) => p.id === scope) && <option value={scope}>Removed profile</option>}
          </select>
        </Field>
        <Field label="Your answer" help="Reused by quick-fill on your phone and by the desktop app on every form that asks this."><textarea className="textarea" rows={5} value={a} onChange={(e) => setA(e.target.value)} placeholder="Type your answer once" data-testid="qa-answer" /></Field>
      </div>
    </Sheet>
  );
}

export default function Answers() {
  const app = useApp();
  const [edit, setEdit] = useState(null);
  const [text, setText] = useState('');
  const [filter, setFilter] = useState('all');
  const [scope, setScope] = useState('all'); // 'all' | 'shared' | a profile id (its own answers and the shared ones)
  const profiles = allProfiles(app);
  const scoped = useMemo(() => app.qa.filter((q) => scope === 'all' || (scope === 'shared' ? !q.profileId : (!q.profileId || q.profileId === scope))), [app.qa, scope]);
  const list = useMemo(() => {
    const t = text.toLowerCase();
    return scoped.filter((q) => (filter === 'all' || (filter === 'pending' ? !q.answer : !!q.answer)) && (!t || `${q.question} ${q.answer}`.toLowerCase().includes(t)));
  }, [scoped, text, filter]);
  const pending = scoped.filter((q) => !q.answer).length;
  const scopeProfile = profiles.find((p) => p.id === scope);
  const showScope = profiles.length > 1 || app.qa.some((q) => q.profileId && q.profileId !== 'main');
  const del = async (q) => {
    if (!(await app.confirm({ title: 'Delete answer?', message: `"${q.question}" will be removed from your answer bank on every device.` }))) return;
    try { await app.remove('qa', q.id); app.toast('Answer deleted', 'success'); } catch (e) { app.toast(e.message, 'error'); }
  };
  return (
    <div className="col" style={{ gap: 14 }}>
      <div className="row" style={{ gap: 8 }}>
        <div className="search-wrap grow"><Search size={16} /><input className="input" style={{ height: 44 }} value={text} onChange={(e) => setText(e.target.value)} placeholder="Search answers" aria-label="Search answers" /></div>
        <Button variant="primary" icon={Plus} onClick={() => setEdit(scope !== 'all' && scope !== 'shared' ? { profileId: scope } : {})} data-testid="qa-add">Add</Button>
      </div>
      {showScope && (
        <div className="col" style={{ gap: 4 }}>
          <select className="select" value={scope} onChange={(e) => setScope(e.target.value)} aria-label="Show answers for" data-testid="qa-scope-filter">
            <option value="all">All answers ({app.qa.length})</option>
            <option value="shared">Shared with all profiles ({app.qa.filter((q) => !q.profileId).length})</option>
            {profiles.map((p) => <option key={p.id} value={p.id}>{p.label}{p.isDefault ? ' (default)' : ''} ({app.qa.filter((q) => !q.profileId || q.profileId === p.id).length})</option>)}
          </select>
          {scopeProfile && <div className="tiny dim">Showing what {scopeProfile.label} uses: its own answers first, then the shared ones.</div>}
        </div>
      )}
      {(pending > 0 || filter !== 'all') && <Seg value={filter} onChange={setFilter} options={[{ value: 'all', label: 'All' }, { value: 'pending', label: `Needs answer · ${pending}` }, { value: 'done', label: 'Answered' }]} />}
      <AnimatePresence initial={false}>
        {list.map((q) => {
          const src = q.source === 'ai' ? { icon: Bot, label: 'AI', cls: 'accent' } : !q.answer ? { icon: CircleHelp, label: 'Needs answer', cls: 'amber' } : { icon: User, label: 'You', cls: 'green' };
          return (
            <motion.div key={q.id} layout initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, x: 30 }} className="card pad" style={!q.answer ? { borderColor: 'rgba(251,191,36,.35)' } : null} data-testid="qa-card">
              <div className="row between" style={{ alignItems: 'flex-start' }}>
                <div style={{ fontWeight: 700 }} className="break grow">{q.question}</div>
                <span className="row" style={{ gap: 4, flexShrink: 0 }}>
                  {showScope && <span className="badge" data-testid="qa-scope-badge">{q.profileId ? <User size={11} /> : <Users size={11} />}{qaScopeLabel(app, q)}</span>}
                  <span className={`badge ${src.cls}`}><src.icon size={11} />{src.label}</span>
                </span>
              </div>
              {q.answer ? <div className="small muted prewrap" style={{ marginTop: 8, maxHeight: 140, overflow: 'hidden' }}>{q.answer}</div> : <div className="small dim" style={{ marginTop: 8 }}>No answer yet. The desktop app asked this on a form.</div>}
              <div className="row between" style={{ marginTop: 10 }}>
                <span className="tiny dim">{q.uses ? `used ${q.uses}× · ` : ''}{timeAgo(q.updatedAt)}</span>
                <div className="row" style={{ gap: 4 }}>
                  {q.answer && <Button size="sm" variant="ghost" icon={Copy} aria-label="Copy answer" onClick={async () => { await copyText(q.answer); app.toast('Copied', 'success'); }} />}
                  <Button size="sm" variant="ghost" icon={Pencil} aria-label="Edit answer" onClick={() => setEdit(q)} data-testid="qa-edit" />
                  <Button size="sm" variant="ghost" icon={Trash2} aria-label="Delete answer" onClick={() => del(q)} data-testid="qa-delete" />
                </div>
              </div>
            </motion.div>
          );
        })}
      </AnimatePresence>
      {!app.qa.length && <Empty icon={MessageSquareText} title="Your answer bank is empty" action={<Button icon={Plus} onClick={() => setEdit({})}>Add your first answer</Button>}>Answer common screening questions once. They show up in quick-fill and the desktop app reuses them.</Empty>}
      {app.qa.length > 0 && !list.length && <Empty icon={Search} title="No matches">{scope !== 'all' && !text && filter === 'all' ? 'No answers in this view yet.' : 'Try another search.'}</Empty>}
      <Editor key={edit ? edit.id || 'new' : 'none'} state={edit} onClose={() => setEdit(null)} />
    </div>
  );
}
