import React, { useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Inbox, Check, X, ExternalLink, Send, Zap, CircleAlert, MessageSquareText, RotateCw, Eraser } from 'lucide-react';
import { useApp } from '../lib/store';
import { Button, Logo, ScoreRing, Empty, Seg, timeAgo, salary } from '../components/ui';
import { JobDrawer, AUTO_ATS } from '../components/jobs';

// Normalised question text: the key that matches a card question with its Answer bank entry.
const normQ = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

// Word overlap between two questions (same rule the campaign engine uses to spot a question it already knows).
function wordsOf(s) { return new Set(String(s || '').toLowerCase().replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter((w) => w.length > 2)); }
function similarity(a, b) {
  const A = wordsOf(a); const B = wordsOf(b);
  if (!A.size || !B.size) return 0;
  let inter = 0; A.forEach((w) => B.has(w) && inter++);
  return inter / (A.size + B.size - inter);
}

// The questions an application still lists, one row per question text (same merge the apply engine does).
// Empty questions get a visible label, so no blank rows. The card count and the card list both come from here.
function questionsFor(a, bank, qa) {
  const seen = new Set();
  const out = [];
  for (const u of a.unanswered || []) {
    const raw = String((u && (u.question || u.name)) || '').trim();
    const key = normQ(raw);
    if (seen.has(key)) continue;
    seen.add(key);
    const exact = key ? bank.get(key) : null;
    // Prefer an answered bank entry: the exact text first, then a near-identical one; an empty entry only as a fallback.
    const answeredSimilar = raw ? qa.find((x) => x.answer && similarity(x.question, raw) >= 0.85) : null;
    const hit = exact && exact.answer ? exact : (answeredSimilar || exact || null);
    out.push({
      key, raw, bank: hit || null, answered: !!(hit && hit.answer),
      label: raw || 'Form field with no label (open the form to see it)',
      required: !!(u && u.required),
      hint: u && u.prefilled ? `Already filled with "${String(u.prefilled).slice(0, 60)}", which is not from your profile. Check it.` : '',
      options: (hit && hit.options) || [],
    });
  }
  return out;
}

// One open or answered question on a Review queue card: answer it, change the saved answer, clear it, or dismiss it.
function QuestionRow({ appId, q }) {
  const app = useApp();
  const saved = (q.bank && q.bank.answer) || '';
  const [draft, setDraft] = useState(saved);
  React.useEffect(() => { setDraft(saved); }, [saved]);
  const canSave = !!q.raw && !!draft.trim() && draft.trim() !== saved.trim();
  const save = async () => {
    if (!canSave) return;
    const val = draft.trim();
    const item = q.bank ? { id: q.bank.id, question: q.bank.question, answer: val } : { question: q.raw, answer: val };
    try { app.set({ qa: await app.run('qa:save', [item], 'Answer saved — reused on every form that asks this') }); } catch { /* the toast explains */ }
  };
  const clear = async () => {
    if (!q.bank) return;
    try { app.set({ qa: await app.run('qa:save', [{ id: q.bank.id, question: q.bank.question, answer: '' }], 'Answer cleared — the question is open again') }); } catch { /* the toast explains */ }
  };
  const dismiss = async () => {
    try { await app.run('applications:dismissQuestion', [appId, q.raw], 'Question dismissed from this application'); } catch { /* the toast explains */ }
  };
  const opts = saved && !q.options.includes(saved) ? [saved, ...q.options] : q.options;
  return (
    <div style={{ borderLeft: `3px solid ${q.answered ? 'var(--green)' : 'var(--amber)'}`, paddingLeft: 12 }}>
      <div className="row between" style={{ alignItems: 'flex-start', gap: 10 }}>
        <div style={{ fontWeight: 600 }}>{q.label}{q.required && <span className="muted"> *</span>}</div>
        <span className={`badge ${q.answered ? 'green' : 'amber'}`}>{q.answered ? 'Answered · in your Answer bank' : 'Open'}</span>
      </div>
      {q.hint && <div className="tiny muted" style={{ marginTop: 4 }}>{q.hint}</div>}
      {!q.raw && <div className="tiny muted" style={{ marginTop: 4 }}>ApplyPilot did not record this field's question. Answer it on the form, then dismiss it here.</div>}
      <div className="row" style={{ marginTop: 8, gap: 8, flexWrap: 'wrap' }}>
        {opts.length ? (
          <select className="select" style={{ width: 280 }} value={draft} onChange={(e) => setDraft(e.target.value)}>
            <option value="">Choose the answer…</option>
            {opts.map((o) => <option key={o} value={o}>{o}</option>)}
          </select>
        ) : (
          <input className="input" style={{ flex: 1, minWidth: 220 }} value={draft} disabled={!q.raw} placeholder="Type your answer once — ApplyPilot reuses it on every form that asks this" onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') save(); }} />
        )}
        <Button size="sm" variant="primary" icon={Check} disabled={!canSave} onClick={save}>Save answer</Button>
        {q.answered
          ? <Button size="sm" variant="ghost" icon={Eraser} onClick={clear}>Clear answer</Button>
          : <Button size="sm" variant="ghost" icon={X} title="Hide this question from this application" onClick={dismiss}>Dismiss</Button>}
      </div>
    </div>
  );
}

export default function ReviewQueue() {
  const app = useApp();
  const [sel, setSel] = useState(new Set());
  const [mode, setMode] = useState(app.plan.autoSubmit ? 'auto' : 'review');
  const [open, setOpen] = useState(null);
  const needs = useMemo(() => app.applications.filter((a) => a.status === 'awaiting-you'), [app.applications]);
  const [camp, setCamp] = useState('all');
  const [limit, setLimit] = useState(100);
  const queued = useMemo(() => app.applications.filter((a) => a.status === 'queued' && (camp === 'all' || a.campaignId === camp)).sort((a, b) => (b.score || 0) - (a.score || 0)), [app.applications, camp]);
  const queuedCampaigns = useMemo(() => [...new Set(app.applications.filter((a) => a.status === 'queued').map((a) => a.campaignId))].map((id) => app.campaigns.find((c) => c.id === id) || { id, name: 'Manual' }), [app.applications, app.campaigns]);
  const pendingQ = app.qa.filter((q) => !q.answer).length;
  // Answer bank by normalised question text; a saved answer wins over an empty entry for the same question.
  const bank = useMemo(() => {
    const m = new Map();
    for (const q of app.qa) {
      const k = normQ(q.question);
      if (k && (!m.has(k) || (!m.get(k).answer && q.answer))) m.set(k, q);
    }
    return m;
  }, [app.qa]);
  const [qOpen, setQOpen] = useState(new Set());
  const [, tick] = useState(0);
  const submitting = app.applications.filter((a) => a.pendingSubmitUntil && new Date(a.pendingSubmitUntil) > new Date());
  React.useEffect(() => { if (!submitting.length) return undefined; const t = setInterval(() => tick((n) => n + 1), 1000); return () => clearInterval(t); }, [submitting.length]);

  const toggle = (id) => setSel((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const approve = async (ids) => {
    if (!ids.length) return;
    await app.run('applications:approve', [ids, mode], `Applying to ${ids.length} job${ids.length > 1 ? 's' : ''}…`);
    setSel(new Set());
  };
  const skip = async (ids) => { for (const id of ids) await app.run('applications:update', [id, { status: 'skipped' }]); setSel(new Set()); };
  const mark = (id, status) => app.run('applications:update', [id, { status }], status === 'applied' ? 'Marked as applied ✓' : undefined);
  const setResume = (id, resumeId) => app.run('applications:update', [id, { resumeId }]);

  return (
    <div className="page">
      <div className="page-head">
        <div><h1>Review queue</h1><p>You stay in control: approve matches in bulk, and finish anything ApplyPilot couldn't answer with certainty.</p></div>
      </div>

      {pendingQ > 0 && (
        <motion.div className="card pad row between" style={{ marginBottom: 20, borderColor: 'rgba(129,140,248,.4)' }} initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
          <div className="row"><MessageSquareText size={18} color="var(--accent-2)" /><span><b>{pendingQ} new screening question{pendingQ > 1 ? 's' : ''}</b> <span className="muted">— answer once and ApplyPilot remembers forever.</span></span></div>
          <Button size="sm" variant="primary" onClick={() => app.go('qa')}>Answer now</Button>
        </motion.div>
      )}

      {submitting.length > 0 && (
        <section style={{ marginBottom: 28 }}>
          <div className="section-title"><Zap size={14} color="var(--green)" />About to submit ({submitting.length})</div>
          <div className="col">
            {submitting.map((a) => (
              <motion.div key={a.id} layout className="card pad row premium premium-shimmer" style={{ gap: 14 }}>
                <Logo name={a.job.company} src={a.job.companyLogo} size="sm" />
                <div className="grow" style={{ position: 'relative', zIndex: 2 }}>
                  <div style={{ fontWeight: 700 }} className="ellipsis">{a.job.title} <span className="muted" style={{ fontWeight: 400 }}>· {a.job.company}</span></div>
                  <div className="small muted">Every field is filled. Submitting in <b style={{ color: 'var(--fg)' }}>{Math.max(0, Math.ceil((new Date(a.pendingSubmitUntil) - Date.now()) / 1000))}s</b></div>
                </div>
                <Button size="sm" style={{ position: 'relative', zIndex: 2 }} onClick={() => app.run('applications:hold', [a.id], "Held — it's waiting for you in the browser")}>Hold, I'll review</Button>
                <Button size="sm" variant="primary" style={{ position: 'relative', zIndex: 2 }} onClick={() => app.run('applications:submitNow', [a.id])}>Submit now</Button>
              </motion.div>
            ))}
          </div>
        </section>
      )}

      {needs.length > 0 && (
        <section style={{ marginBottom: 32 }}>
          <div className="section-title"><CircleAlert size={14} color="var(--amber)" />Needs you ({needs.length})</div>
          <div className="col">
            <AnimatePresence>
              {needs.slice(0, 100).map((a) => {
                const qs = questionsFor(a, bank, app.qa);
                const openN = qs.filter((q) => !q.answered).length;
                const expanded = qOpen.has(a.id);
                const toggleQ = () => setQOpen((s) => { const n = new Set(s); if (n.has(a.id)) n.delete(a.id); else n.add(a.id); return n; });
                return (
                  <motion.div key={a.id} layout initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, x: 40 }} className="card pad">
                    <div className="row" style={{ gap: 14 }}>
                      <Logo name={a.job.company} src={a.job.companyLogo} size="sm" />
                      <div className="grow">
                        <div style={{ fontWeight: 700 }} className="ellipsis">{a.job.title} <span className="muted" style={{ fontWeight: 400 }}>· {a.job.company}</span></div>
                        <div className="small muted ellipsis">{(a.events || []).slice(-1)[0]?.message || 'Review and submit'}{qs.length ? (openN ? ` · ${openN} unanswered question(s)` : ` · all ${qs.length} questions answered`) : ''}</div>
                      </div>
                      {qs.length > 0 && <Button size="sm" variant="ghost" icon={MessageSquareText} onClick={toggleQ}>{expanded ? 'Hide questions' : `Answer${openN ? ` (${openN})` : ''}`}</Button>}
                      <Button size="sm" icon={ExternalLink} onClick={() => app.run('browser:open', [a.job.applyUrl || a.job.url])}>Open & finish</Button>
                      <Button size="sm" icon={RotateCw} onClick={() => approve([a.id])}>Retry</Button>
                      <Button size="sm" variant="primary" icon={Check} onClick={() => mark(a.id, 'applied')}>I submitted it</Button>
                      <Button size="sm" variant="ghost" icon={X} title="Skip this job" onClick={() => mark(a.id, 'skipped')} />
                    </div>
                    {expanded && qs.length > 0 && (
                      <div className="col" style={{ gap: 12, marginTop: 14, paddingTop: 14, borderTop: '1px solid var(--border)' }}>
                        {qs.map((q) => <QuestionRow key={q.key || 'blank'} appId={a.id} q={q} />)}
                      </div>
                    )}
                  </motion.div>
                );
              })}
            </AnimatePresence>
          </div>
        </section>
      )}

      <section>
        <div className="row between" style={{ marginBottom: 12 }}>
          <div className="section-title" style={{ margin: 0 }}><Inbox size={14} />Ready for approval ({queued.length})</div>
          {(queued.length > 0 || camp !== 'all') && (
            <div className="row">
              {queuedCampaigns.length > 1 && (
                <select className="select" style={{ width: 190, height: 32 }} value={camp} onChange={(e) => { setCamp(e.target.value); setSel(new Set()); }}>
                  <option value="all">All campaigns</option>
                  {queuedCampaigns.map((c) => <option key={c.id || 'manual'} value={c.id}>{c.name}</option>)}
                </select>
              )}
              <Seg value={mode} onChange={setMode} options={[{ value: 'review', label: 'Fill, I submit' }, { value: 'auto', label: 'Autopilot' }]} />
              <Button size="sm" variant="ghost" onClick={() => { const vis = queued.slice(0, limit); setSel(sel.size === vis.length ? new Set() : new Set(vis.map((a) => a.id))); }}>{sel.size && sel.size === Math.min(limit, queued.length) ? 'Clear' : 'Select all'}</Button>
              <Button size="sm" icon={X} disabled={!sel.size} onClick={() => skip([...sel])}>Skip</Button>
              <Button size="sm" variant="primary" icon={Send} disabled={!sel.size} onClick={() => approve([...sel])}>Apply to {sel.size || ''} selected</Button>
            </div>
          )}
        </div>
        {queued.length ? (
          <div className="card" style={{ overflow: 'hidden' }}>
            <table className="table">
              <thead><tr><th style={{ width: 36 }} /><th>Match</th><th>Role</th><th>Salary</th><th>Campaign</th><th>Source</th><th>Resume</th><th>Found</th><th /></tr></thead>
              <tbody>
                <AnimatePresence>
                  {queued.slice(0, limit).map((a) => (
                    <motion.tr key={a.id} layout initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                      <td><input type="checkbox" checked={sel.has(a.id)} onChange={() => toggle(a.id)} style={{ accentColor: 'var(--accent)', width: 16, height: 16 }} /></td>
                      <td><ScoreRing score={a.score || 0} size={38} stroke={3.5} /></td>
                      <td style={{ maxWidth: 340, cursor: 'pointer' }} onClick={() => setOpen({ id: a.jobId, ...a.job, match: a.match })}>
                        <div className="ellipsis" style={{ fontWeight: 600 }}>{a.job.title}</div>
                        <div className="small muted ellipsis">{a.job.company} · {a.job.location || (a.job.remote ? 'Remote' : '')} {AUTO_ATS.includes(a.job.ats) && <Zap size={11} color="var(--green)" />}</div>
                      </td>
                      <td className="small">{salary(a.job)}</td>
                      <td className="small muted">{a.campaignName}</td>
                      <td className="small"><span className="badge" title={`Found on ${(app.connectors.find((c) => c.id === a.job.source) || {}).name || a.job.source || 'an unknown source'}`}>{(app.connectors.find((c) => c.id === a.job.source) || {}).name || a.job.source || 'Other'}</span></td>
                      <td>
                        <select className="select" style={{ height: 30, fontSize: 13, width: 170 }} value={a.resumeId || ''} onChange={(e) => setResume(a.id, e.target.value)}>
                          {app.resumes.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
                        </select>
                      </td>
                      <td className="small dim">{timeAgo(a.createdAt)}</td>
                      <td><div className="row" style={{ gap: 2 }}><Button size="sm" variant="ghost" icon={X} title="Skip" onClick={() => skip([a.id])} /><Button size="sm" icon={Send} title="Apply to this job" onClick={() => approve([a.id])} /></div></td>
                    </motion.tr>
                  ))}
                </AnimatePresence>
              </tbody>
            </table>
            {queued.length > limit && <div style={{ textAlign: 'center', padding: 12 }}><Button size="sm" onClick={() => setLimit(limit + 100)}>Show more ({queued.length - limit} left)</Button></div>}
          </div>
        ) : (
          <Empty icon={Inbox} title="Queue is empty" action={<Button variant="primary" onClick={() => app.go('campaigns')}>Go to campaigns</Button>}>
            Campaigns in "Review queue" mode drop their best matches here for one-click approval.
          </Empty>
        )}
      </section>
      <JobDrawer job={open} onClose={() => setOpen(null)} />
    </div>
  );
}
