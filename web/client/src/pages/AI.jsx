import React, { useMemo, useState } from 'react';
import { KeyRound, Sparkles, FileText, Trash2, Check, Eye, EyeOff, ShieldCheck } from 'lucide-react';
import { useApp } from '../lib/store.jsx';
import { Button, Field } from '../components/ui.jsx';
import { MODELS, DEFAULT_MODEL, testKey, aiError, coverLetter, tailorResume, forgetClient } from '../lib/ai.js';
import { ResumeSelect, TailorResult, TextResult } from '../components/jobs.jsx';
import { pickResume } from '../lib/apply.js';

export default function AI() {
  const app = useApp();
  const s = app.settings;
  const [key, setKey] = useState('');
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(null);
  const [source, setSource] = useState('');
  const [paste, setPaste] = useState({ title: '', company: '', description: '' });
  const [resumeId, setResumeId] = useState('auto');
  const [out, setOut] = useState({});
  const model = s.aiModel || DEFAULT_MODEL;

  const jobs = useMemo(() => {
    const seen = new Map();
    for (const a of app.applications) if (a.status !== 'skipped') seen.set(a.jobId, { ...a.job, id: a.jobId });
    for (const j of app.savedJobs) if (!seen.has(j.id)) seen.set(j.id, j);
    return [...seen.values()];
  }, [app.applications, app.savedJobs]);
  const job = source === 'paste' ? { ...paste, id: 'pasted' } : jobs.find((j) => j.id === source);

  const saveKey = async () => {
    const k = key.trim();
    if (!/^sk-ant-/.test(k)) { app.toast('That doesn\'t look like an Anthropic API key (sk-ant-…).', 'error'); return; }
    setBusy('key');
    try {
      await testKey({ apiKey: k, model: 'claude-haiku-4-5' });
      await app.saveSettings({ anthropicKey: k, aiModel: model });
      setKey('');
      app.toast('Key verified and saved (encrypted)', 'success');
    } catch (e) { app.toast(aiError(e), 'error'); } finally { setBusy(null); }
  };
  const removeKey = async () => {
    if (!(await app.confirm({ title: 'Remove API key?', message: 'AI features stop working on every device until you add a key again.', confirmLabel: 'Remove' }))) return;
    try { await app.saveSettings({ anthropicKey: '' }); forgetClient(); app.toast('Key removed', 'success'); } catch (e) { app.toast(e.message, 'error'); }
  };
  const run = async (k, fn) => {
    if (!job || !(job.description || '').trim()) { app.toast('Pick a job or paste a job description first.', 'error'); return; }
    const resume = pickResume(app.resumes, job, resumeId);
    setBusy(k);
    try { const r = await fn({ apiKey: s.anthropicKey, model, profile: app.profile, resumeText: resume ? resume.text : '', job }); setOut((o) => ({ ...o, [k]: r })); } catch (e) { app.toast(aiError(e), 'error'); } finally { setBusy(null); }
  };

  return (
    <div className="col" style={{ gap: 14 }}>
      <div className={`card pad col ${s.anthropicKey ? '' : 'premium premium-shimmer'}`} style={{ gap: 12 }}>
        <div style={{ position: 'relative', zIndex: 2 }} className="col">
          <div className="section-title" style={{ margin: 0 }}><KeyRound size={14} />Anthropic API key</div>
          {s.anthropicKey ? (
            <div className="row" style={{ gap: 10 }}>
              <span className="badge green"><Check size={11} />Key saved</span>
              <span className="small dim grow ellipsis mono-num">sk-ant-…{s.anthropicKey.slice(-4)}</span>
              <Button size="sm" variant="danger" icon={Trash2} onClick={removeKey}>Remove</Button>
            </div>
          ) : (
            <>
              <div className="row" style={{ gap: 6 }}>
                <input className="input grow" type={show ? 'text' : 'password'} value={key} onChange={(e) => setKey(e.target.value)} placeholder="sk-ant-…" autoComplete="off" spellCheck={false} aria-label="Anthropic API key" />
                <Button icon={show ? EyeOff : Eye} aria-label={show ? 'Hide key' : 'Show key'} onClick={() => setShow(!show)} />
              </div>
              <Button variant="primary" loading={busy === 'key'} disabled={!key.trim()} onClick={saveKey}>Verify & save</Button>
            </>
          )}
          <div className="tiny dim row" style={{ alignItems: 'flex-start' }}><ShieldCheck size={12} style={{ flexShrink: 0, marginTop: 2 }} />Stored inside your encrypted vault and synced to your devices. Requests go straight from this device to Anthropic; our server never sees your key or prompts.</div>
          <Field label="Model">
            <select className="select" value={model} onChange={(e) => app.saveSettings({ aiModel: e.target.value }).catch((er) => app.toast(er.message, 'error'))}>
              {MODELS.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
            </select>
          </Field>
        </div>
      </div>

      <div className="card pad col" style={{ gap: 12 }}>
        <div className="section-title" style={{ margin: 0 }}><Sparkles size={14} />Tailor for a job</div>
        <Field label="Job">
          <select className="select" value={source} onChange={(e) => { setSource(e.target.value); setOut({}); }}>
            <option value="">Choose a saved job…</option>
            {jobs.map((j) => <option key={j.id} value={j.id}>{j.title} · {j.company}</option>)}
            <option value="paste">Paste a job description…</option>
          </select>
        </Field>
        {source === 'paste' && (
          <div className="col" style={{ gap: 8 }}>
            <div className="grid g2"><input className="input" placeholder="Job title" value={paste.title} onChange={(e) => setPaste({ ...paste, title: e.target.value })} /><input className="input" placeholder="Company" value={paste.company} onChange={(e) => setPaste({ ...paste, company: e.target.value })} /></div>
            <textarea className="textarea" rows={6} placeholder="Paste the job description" value={paste.description} onChange={(e) => setPaste({ ...paste, description: e.target.value })} />
          </div>
        )}
        <Field label="Resume"><ResumeSelect value={resumeId} onChange={setResumeId} /></Field>
        <div className="grid g2">
          <Button icon={Sparkles} loading={busy === 'tailor'} disabled={!s.anthropicKey || !job} onClick={() => run('tailor', tailorResume)}>ATS check</Button>
          <Button icon={FileText} loading={busy === 'cover'} disabled={!s.anthropicKey || !job} onClick={() => run('cover', coverLetter)}>Cover letter</Button>
        </div>
        {!s.anthropicKey && <div className="tiny dim">Add your key above to enable AI tools.</div>}
      </div>
      {out.tailor && <TailorResult r={out.tailor} />}
      {out.cover && <TextResult title="Cover letter" text={out.cover} />}
    </div>
  );
}
