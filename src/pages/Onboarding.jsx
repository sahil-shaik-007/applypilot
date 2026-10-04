import React, { useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Star, ArrowRight, ArrowLeft, Rocket, ShieldCheck, Zap, FileText, Globe, Sparkles, Check } from 'lucide-react';
import { useApp } from '../lib/store';
import { Button, Field, TagInput, MultiChips, Seg } from '../components/ui';
import { Dropzone, mergeProfile } from './Resumes';
import { withDefaults } from './Profile';

const STEPS = ['Welcome', 'Resume', 'About you', 'What you want', 'Launch'];

export default function Onboarding() {
  const app = useApp();
  const [step, setStep] = useState(0);
  const [dir, setDir] = useState(1);
  const [v, setV] = useState(() => withDefaults(app.profileSchema, app.profile.values));
  const [trial, setTrial] = useState(!app.plan.licensed && !app.plan.trialUsed);
  const [busy, setBusy] = useState(false);
  const up = (k) => (val) => setV((x) => ({ ...x, [k]: val }));
  const go = (n) => { setDir(n > step ? 1 : -1); setStep(n); };

  const saveProfile = async () => { const saved = await app.run('profile:save', [v]); app.set({ profile: saved }); };
  const next = async () => {
    if (step === 2 && (!v.firstName || !v.email)) return app.toast('Name and email are needed for applications', 'error');
    if (step === 3 && !(v.desiredTitles || []).length) return app.toast('Add at least one job title you want', 'error');
    if (step >= 2) await saveProfile();
    go(step + 1);
  };
  const finish = async () => {
    setBusy(true);
    try {
      await saveProfile();
      if ((v.desiredTitles || []).length && !app.campaigns.length) {
        const c = await app.run('campaigns:save', [{ name: v.desiredTitles[0], roles: v.desiredTitles.slice(0, 3), locations: (v.preferredLocations || []).slice(0, 3), remote: (v.workModes || []).length === 1 && v.workModes[0] === 'Remote' ? 'remote' : 'any', mode: 'queue', color: '#6366f1' }]);
        app.set((s) => ({ campaigns: [...s.campaigns.filter((x) => x.id !== c.id), c] }));
      }
      if (trial) app.set({ plan: await app.run('license:startTrial') });
      app.set({ settings: await app.run('settings:update', [{ onboarded: true }]) });
      app.go('dashboard');
      app.toast('You\'re all set — your first campaign is ready to start 🚀', 'success');
    } catch {} finally { setBusy(false); }
  };

  return (
    <div style={{ height: '100vh', overflowY: 'auto', position: 'relative' }}>
      <div className="glow" style={{ top: -250, left: '50%', transform: 'translateX(-50%)', width: 900, height: 900 }} />
      <div style={{ maxWidth: 760, margin: '0 auto', padding: '64px 24px', position: 'relative' }}>
        <div className="row" style={{ justifyContent: 'center', gap: 8, marginBottom: 34 }}>
          {STEPS.map((s, i) => (
            <div key={s} className="row" style={{ gap: 8 }}>
              <motion.div animate={{ background: i <= step ? 'var(--accent)' : 'rgba(255,255,255,.08)', scale: i === step ? 1.1 : 1 }} style={{ width: 26, height: 26, borderRadius: 99, display: 'grid', placeItems: 'center', fontSize: 12, fontWeight: 700 }}>{i < step ? <Check size={13} /> : i + 1}</motion.div>
              <span className="small" style={{ color: i === step ? 'var(--fg)' : 'var(--muted-2)' }}>{s}</span>
              {i < STEPS.length - 1 && <div style={{ width: 22, height: 1, background: 'var(--border-strong)' }} />}
            </div>
          ))}
        </div>

        <AnimatePresence mode="wait" custom={dir}>
          <motion.div key={step} custom={dir} initial={{ opacity: 0, x: 40 * dir }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -40 * dir }} transition={{ duration: 0.25, ease: [0.4, 0, 0.2, 1] }}>
            {step === 0 && (
              <div style={{ textAlign: 'center' }}>
                <motion.div initial={{ scale: 0.6, rotate: -30, opacity: 0 }} animate={{ scale: 1, rotate: 0, opacity: 1 }} transition={{ type: 'spring', stiffness: 200, damping: 12 }}>
                  <Star size={46} fill="currentColor" style={{ color: 'var(--accent)', filter: 'drop-shadow(0 0 24px rgba(99,102,241,.8))' }} />
                </motion.div>
                <h1 style={{ fontSize: 48, margin: '18px 0 12px', lineHeight: 1.1 }}>Your job hunt,<br />on autopilot.</h1>
                <p className="muted" style={{ fontSize: 16, maxWidth: 560, margin: '0 auto', lineHeight: 1.7 }}>ApplyPilot searches 25+ job sources and 250 platforms, ranks every job against your resume, and fills applications for you — several roles in parallel, each with the right resume.</p>
                <div className="grid g2" style={{ marginTop: 34, textAlign: 'left' }}>
                  {[
                    [Globe, 'Every board, one search', 'Remote boards, APIs and 700+ company career pages.'],
                    [FileText, 'Right resume per role', 'Upload versions; we pick the best for each job.'],
                    [Zap, 'Parallel campaigns', 'Hunt for several roles at once, every hour.'],
                    [ShieldCheck, 'You stay in control', 'Review queue, no guessing, 100% local data.'],
                  ].map(([I, t, d], i) => (
                    <motion.div key={t} className="card pad" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 + i * 0.08 }}>
                      <I size={18} color="var(--accent-2)" /><div style={{ fontWeight: 700, marginTop: 8 }}>{t}</div><div className="small muted">{d}</div>
                    </motion.div>
                  ))}
                </div>
                <Button variant="gradient" className="btn-gradient" size="lg" style={{ marginTop: 34 }} onClick={() => go(1)}>Get started — 3 minutes <ArrowRight size={16} /></Button>
              </div>
            )}

            {step === 1 && (
              <div>
                <h2 style={{ fontSize: 30, margin: '0 0 8px' }}>Upload your resume</h2>
                <p className="muted" style={{ marginTop: 0 }}>We'll read it and pre-fill your profile. You can add more versions (e.g. one for "Data Analyst", one for "BI Developer") anytime.</p>
                <Dropzone onDone={(results) => setV((cur) => results.reduce((acc, r) => mergeProfile(acc, r.guessed), cur))} />
                {app.resumes.length > 0 && <div className="chips" style={{ marginTop: 14 }}>{app.resumes.map((r) => <span key={r.id} className="badge green"><Check size={11} />{r.fileName}</span>)}</div>}
              </div>
            )}

            {step === 2 && (
              <div>
                <h2 style={{ fontSize: 30, margin: '0 0 8px' }}>About you</h2>
                <p className="muted" style={{ marginTop: 0 }}>Used on every application form. Stored only on this PC.</p>
                <div className="grid g2" style={{ gap: 16 }}>
                  <Field label="First name" required><input className="input" value={v.firstName || ''} onChange={(e) => up('firstName')(e.target.value)} /></Field>
                  <Field label="Last name" required><input className="input" value={v.lastName || ''} onChange={(e) => up('lastName')(e.target.value)} /></Field>
                  <Field label="Email" required><input className="input" value={v.email || ''} onChange={(e) => up('email')(e.target.value)} /></Field>
                  <Field label="Phone" required>
                    <div className="row" style={{ gap: 6 }}><input className="input" style={{ width: 80 }} value={v.phoneCountryCode || ''} placeholder="+91" onChange={(e) => up('phoneCountryCode')(e.target.value)} /><input className="input" value={v.phone || ''} onChange={(e) => up('phone')(e.target.value)} /></div>
                  </Field>
                  <Field label="City" required><input className="input" value={v.city || ''} onChange={(e) => up('city')(e.target.value)} /></Field>
                  <Field label="Country" required><input className="input" value={v.country || ''} onChange={(e) => up('country')(e.target.value)} /></Field>
                  <Field label="LinkedIn URL"><input className="input" value={v.linkedin || ''} onChange={(e) => up('linkedin')(e.target.value)} /></Field>
                  <Field label="GitHub / portfolio"><input className="input" value={v.github || v.portfolio || ''} onChange={(e) => up(v.github ? 'github' : 'portfolio')(e.target.value)} /></Field>
                </div>
              </div>
            )}

            {step === 3 && (
              <div>
                <h2 style={{ fontSize: 30, margin: '0 0 8px' }}>What are you looking for?</h2>
                <div className="col" style={{ gap: 16, marginTop: 18 }}>
                  <Field label="Job titles you want" required help="Each becomes a parallel search. Add variations."><TagInput value={v.desiredTitles || []} onChange={up('desiredTitles')} placeholder="Software Engineer, Backend Developer…" /></Field>
                  <div className="grid g2">
                    <Field label="Years of experience" required><input className="input" type="number" value={v.totalYearsExperience ?? ''} onChange={(e) => up('totalYearsExperience')(e.target.value === '' ? '' : +e.target.value)} /></Field>
                    <Field label="Notice period (days)"><input className="input" type="number" value={v.noticePeriodDays ?? ''} onChange={(e) => up('noticePeriodDays')(+e.target.value)} /></Field>
                  </div>
                  <Field label="Key skills"><TagInput value={v.skills || []} onChange={up('skills')} /></Field>
                  <div className="grid g2">
                    <Field label="Work mode"><MultiChips value={v.workModes || []} options={['Remote', 'Hybrid', 'On-site']} onChange={up('workModes')} /></Field>
                    <Field label="Need visa sponsorship?"><Seg value={v.needsSponsorship || ''} onChange={up('needsSponsorship')} options={['Yes', 'No']} /></Field>
                  </div>
                  <Field label="Preferred locations"><TagInput value={v.preferredLocations || []} onChange={up('preferredLocations')} placeholder="Bengaluru, Hyderabad, Remote…" /></Field>
                  <div className="grid g3">
                    <Field label="Currency"><select className="select" value={v.salaryCurrency || ''} onChange={(e) => up('salaryCurrency')(e.target.value)}><option value="">—</option>{['INR', 'USD', 'EUR', 'GBP', 'CAD', 'AUD', 'SGD', 'AED'].map((c) => <option key={c}>{c}</option>)}</select></Field>
                    <Field label="Expected salary (min)"><input className="input" type="number" value={v.expectedSalaryMin ?? ''} onChange={(e) => up('expectedSalaryMin')(+e.target.value)} /></Field>
                    <Field label="Current salary"><input className="input" type="number" value={v.currentSalary ?? ''} onChange={(e) => up('currentSalary')(+e.target.value)} /></Field>
                  </div>
                </div>
              </div>
            )}

            {step === 4 && (
              <div style={{ textAlign: 'center' }}>
                <motion.div initial={{ y: 20, opacity: 0 }} animate={{ y: [20, -8, 0], opacity: 1 }} transition={{ duration: 0.8 }}><Rocket size={48} color="var(--accent-2)" /></motion.div>
                <h2 style={{ fontSize: 34, margin: '16px 0 8px' }}>Ready for launch</h2>
                <p className="muted" style={{ maxWidth: 540, margin: '0 auto' }}>We'll create a campaign for <b style={{ color: 'var(--fg)' }}>{(v.desiredTitles || []).slice(0, 3).join(', ')}</b> in safe "Review queue" mode. Start it from the Campaigns tab whenever you like.</p>
                {!app.plan.licensed && !app.plan.trialUsed && (
                  <div className="card pad premium premium-shimmer row between" style={{ marginTop: 26, textAlign: 'left' }}>
                    <div style={{ position: 'relative', zIndex: 2 }}><div style={{ fontWeight: 700 }}><Sparkles size={15} style={{ verticalAlign: -2 }} /> Start a free 7-day Pro trial</div><div className="small muted">10 parallel campaigns, full autopilot, unlimited AI. No card needed.</div></div>
                    <input type="checkbox" checked={trial} onChange={(e) => setTrial(e.target.checked)} style={{ width: 20, height: 20, accentColor: 'var(--accent)', position: 'relative', zIndex: 2 }} />
                  </div>
                )}
                <Button variant="gradient" className="btn-gradient" size="lg" style={{ marginTop: 28 }} loading={busy} onClick={finish}>Open my dashboard <ArrowRight size={16} /></Button>
              </div>
            )}
          </motion.div>
        </AnimatePresence>

        {step > 0 && step < 4 && (
          <div className="row between" style={{ marginTop: 34 }}>
            <Button variant="ghost" icon={ArrowLeft} onClick={() => go(step - 1)}>Back</Button>
            <div className="row">
              {step === 1 && <Button variant="ghost" onClick={() => go(2)}>Skip for now</Button>}
              <Button variant="primary" onClick={next}>Continue <ArrowRight size={15} /></Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
