import React, { useEffect, useState } from 'react';
import { Laptop, Zap, CircleAlert, Check } from 'lucide-react';
import { useApp } from '../lib/store.jsx';
import { Button, Sheet, Field, Seg } from './ui.jsx';
import { sendToLaptop, AUTO_ATS } from '../lib/apply.js';
import { IDENTITY_FIELDS, readiness, addressLine } from '../lib/applyReadiness.js';
import { allProfiles, getProfile, pickResumeFor, resumePool, profileIdForJob } from '../lib/profiles.js';

// Before anything is sent to the laptop: choose the profile (the person the application is for), show what
// will be filled from that profile, ask for what is missing (and save it to that profile), choose the resume,
// and only then send when the candidate confirms.
export function ApplyCheck({ open, job, resumeId = 'auto', mode = 'review', profileId, onClose, onSent }) {
  const app = useApp();
  const [draft, setDraft] = useState({});
  const [chosen, setChosen] = useState(null); // resume id picked here; null = the automatic choice
  const [pick, setPick] = useState(null); // profile picked here; null = the job's profile
  const [sendMode, setSendMode] = useState(mode);
  const [busy, setBusy] = useState(null);
  useEffect(() => { setDraft({}); setChosen(null); setPick(null); }, [job && job.id, open]); // eslint-disable-line
  if (!job) return null;

  const who = getProfile(app, pick || profileId || profileIdForJob(app, job));
  const possessive = who.isDefault ? 'your' : `${who.label}'s`;
  const pool = resumePool(app, who.id).all;
  const merged = { ...who.values, ...draft };
  const autoPick = pickResumeFor(app, job, resumeId, who.id);
  const resume = chosen ? (app.resumes.find((r) => r.id === chosen) || autoPick) : autoPick;
  const { missing, ready } = readiness(merged, resume);
  const canAuto = AUTO_ATS.includes(job.ats);
  const effectiveMode = sendMode === 'auto' && canAuto ? 'auto' : 'review';
  const shown = IDENTITY_FIELDS.filter((f) => String(merged[f.key] || '').trim());
  const resumeOptions = resume && !pool.some((r) => r.id === resume.id) ? [...pool, resume] : pool;

  const switchProfile = (id) => { setPick(id); setDraft({}); setChosen(null); };

  const saveDetails = async () => {
    setBusy('save');
    try { await app.saveProfileTo(who.id, merged); setDraft({}); app.toast(`Saved to ${possessive} profile`, 'success'); }
    catch (e) { app.toast(e.message, 'error'); } finally { setBusy(null); }
  };

  const confirm = async () => {
    if (!ready) return;
    setBusy('send');
    try {
      if (Object.keys(draft).length) await app.saveProfileTo(who.id, merged); // the laptop reads the profile from sync
      const item = await sendToLaptop(app, job, { resumeId: resume.id, mode: effectiveMode, profileId: who.id });
      app.toast(effectiveMode === 'auto' ? 'Sent. Your laptop applies after the cancel window.' : 'Sent. Your laptop fills the form and waits for you to submit.', 'success');
      onSent && onSent(item);
      onClose && onClose();
    } catch (e) { app.toast(e.message, 'error'); } finally { setBusy(null); }
  };

  return (
    <Sheet open={open} onClose={onClose} label="Check before applying" title="Check before applying"
      footer={(
        <div className="col" style={{ gap: 8, width: '100%' }}>
          {!ready && <div className="tiny" style={{ color: 'var(--amber, #fbbf24)', textAlign: 'center' }}>{missing.length ? `Add ${missing.map((m) => m.label.toLowerCase()).join(', ')} to continue.` : 'Choose a resume to continue.'}</div>}
          <div className="grid g2" style={{ gap: 8 }}>
            <Button onClick={onClose}>Cancel</Button>
            <Button variant="primary" icon={Laptop} loading={busy === 'send'} disabled={!ready || !!busy} onClick={confirm} data-testid="confirm-apply">Confirm and apply</Button>
          </div>
        </div>
      )}>
      <div className="col" style={{ gap: 16 }}>
        <div>
          <div style={{ fontWeight: 700 }}>{job.title}</div>
          <div className="small muted">{job.company}{job.location ? ` · ${job.location}` : ''}</div>
        </div>

        <div className="col" style={{ gap: 6 }}>
          <span className="field-label">Profile</span>
          <select className="select" value={who.id} onChange={(e) => switchProfile(e.target.value)} aria-label="Profile" data-testid="apply-profile">
            {allProfiles(app).map((p) => <option key={p.id} value={p.id}>{p.label}{p.isDefault ? ' (default)' : ''}</option>)}
          </select>
          <div className="tiny dim">The details, resume and saved answers for this application come from this profile.</div>
        </div>

        <div className="col" style={{ gap: 6 }}>
          <span className="field-label">Filled from {possessive} profile</span>
          {shown.length ? shown.map((f) => (
            <div key={f.key} className="row between small" style={{ borderBottom: '1px solid var(--border)', paddingBottom: 6 }}>
              <span className="muted">{f.label}</span><span>{merged[f.key]}</span>
            </div>
          )) : <div className="small dim">Nothing yet.</div>}
          {addressLine(merged) && <div className="row between small"><span className="muted">Address</span><span>{addressLine(merged)}</span></div>}
        </div>

        {missing.length > 0 && (
          <div className="col" style={{ gap: 10 }}>
            <span className="field-label"><CircleAlert size={12} style={{ verticalAlign: -2 }} /> Still needed</span>
            {missing.map((f) => (
              <Field key={f.key} label={f.label} required>
                <input className="input" type={f.type || 'text'} value={draft[f.key] || ''} onChange={(e) => setDraft({ ...draft, [f.key]: e.target.value })} aria-label={f.label} />
              </Field>
            ))}
            <Button size="sm" icon={Check} loading={busy === 'save'} disabled={!Object.keys(draft).length} onClick={saveDetails}>{who.isDefault ? 'Save to my profile' : `Save to ${who.label}'s profile`}</Button>
          </div>
        )}

        <div className="col" style={{ gap: 6 }}>
          <span className="field-label">Resume attached to this application</span>
          {resumeOptions.length ? (
            <select className="select" value={resume ? resume.id : ''} onChange={(e) => setChosen(e.target.value)} aria-label="Resume" data-testid="apply-resume">
              {resumeOptions.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
            </select>
          ) : <div className="small" style={{ color: 'var(--red, #f87171)' }}>{app.resumes.length ? `${who.label} has no resume yet. Upload one for this profile, or share one with every profile (Resumes tab).` : 'Upload a resume first (Resumes tab). It is attached to the application.'}</div>}
        </div>

        <div className="col" style={{ gap: 6 }}>
          <span className="field-label">When the laptop has filled the form</span>
          <Seg value={effectiveMode} onChange={setSendMode} options={[
            { value: 'review', label: 'I press submit' },
            { value: 'auto', label: canAuto ? 'Submit after 30s' : 'Submit (not on this site)' },
          ]} />
          {!canAuto && <div className="tiny dim">Automatic submit works on Greenhouse, Lever, Ashby, Workable, SmartRecruiters and Recruitee. This job is filled for you to submit.</div>}
          <div className="tiny dim"><Zap size={10} style={{ verticalAlign: -1 }} /> Your Windows PC applies when it is on and ApplyPilot is open.</div>
        </div>
      </div>
    </Sheet>
  );
}
