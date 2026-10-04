import React, { useState } from 'react';
import { Sparkles, FileText, GraduationCap, KeyRound, Wand2 } from 'lucide-react';
import { useApp } from '../lib/store';
import { Button, Seg, Markdown } from '../components/ui';
import { TailorResult, TextResult } from '../components/jobs';

export default function AIStudio() {
  const app = useApp();
  const [source, setSource] = useState(app.applications.length ? 'saved' : 'paste');
  const [jobId, setJobId] = useState(app.applications[0] ? app.applications[0].jobId : '');
  const [jd, setJd] = useState('');
  const [resumeId, setResumeId] = useState('auto');
  const [busy, setBusy] = useState(null);
  const [out, setOut] = useState({});
  const hasKey = !!app.settings.keys.anthropic;

  const runAi = async (kind) => {
    setBusy(kind);
    try {
      let r;
      if (source === 'paste') {
        if (jd.trim().length < 80) { app.toast('Paste the full job description first', 'error'); return; }
        r = await app.run('ai:customJob', [kind, jd, resumeId]);
      } else {
        if (!jobId) { app.toast('Pick a job first', 'error'); return; }
        r = await app.run({ tailor: 'ai:tailor', coverLetter: 'ai:coverLetter', interviewPrep: 'ai:interviewPrep' }[kind], [jobId, resumeId]);
      }
      setOut({ [kind]: r });
    } catch {} finally { setBusy(null); }
  };

  return (
    <div className="page" style={{ maxWidth: 1100 }}>
      <div className="hero" style={{ paddingTop: 8 }}>
        <h1 style={{ fontSize: 38 }}><Wand2 size={30} style={{ verticalAlign: -3, color: 'var(--accent-2)' }} /> AI studio</h1>
        <p>Beat the ATS: score your resume against any job, get missing keywords and truthful bullet rewrites, write a tailored cover letter, and prep for the interview — powered by Claude with your own key.</p>
      </div>
      {!hasKey && (
        <div className="card pad row between premium premium-shimmer" style={{ marginBottom: 20 }}>
          <div className="row" style={{ position: 'relative', zIndex: 2 }}><KeyRound size={18} /><span>Add your Anthropic API key to use AI. Typical cost: about $0.02–0.05 per tailored application.</span></div>
          <Button variant="primary" style={{ position: 'relative', zIndex: 2 }} onClick={() => app.go('settings', { tab: 'ai' })}>Add key</Button>
        </div>
      )}
      <div className="card pad col" style={{ gap: 16 }}>
        <div className="row between wrap">
          <Seg value={source} onChange={setSource} options={[{ value: 'saved', label: 'From my applications' }, { value: 'paste', label: 'Paste a job description' }]} />
          <select className="select" style={{ width: 260 }} value={resumeId} onChange={(e) => setResumeId(e.target.value)}>
            <option value="auto">✨ Best-matching resume</option>
            {app.resumes.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
          </select>
        </div>
        {source === 'saved' ? (
          <select className="select" value={jobId} onChange={(e) => setJobId(e.target.value)}>
            {!app.applications.length && <option value="">No saved jobs yet — save one from Find jobs</option>}
            {app.applications.map((a) => <option key={a.id} value={a.jobId}>{a.job.title} — {a.job.company}</option>)}
          </select>
        ) : (
          <textarea className="textarea" rows={8} value={jd} onChange={(e) => setJd(e.target.value)} placeholder="Paste the job description from LinkedIn, Naukri, Indeed, a company site…" />
        )}
        <div className="grid g3">
          <Button variant="primary" icon={Sparkles} loading={busy === 'tailor'} onClick={() => runAi('tailor')}>ATS score & tailor</Button>
          <Button icon={FileText} loading={busy === 'coverLetter'} onClick={() => runAi('coverLetter')}>Cover letter</Button>
          <Button icon={GraduationCap} loading={busy === 'interviewPrep'} onClick={() => runAi('interviewPrep')}>Interview prep</Button>
        </div>
      </div>
      <div style={{ marginTop: 20 }} className="col">
        {out.tailor && <TailorResult r={out.tailor} />}
        {out.coverLetter && <TextResult title="Cover letter" text={out.coverLetter} />}
        {out.interviewPrep && <div className="card pad"><Markdown text={out.interviewPrep} /></div>}
      </div>
    </div>
  );
}
