import React, { useEffect, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { Search, Target, Smartphone, Laptop, ShieldCheck, Lock, KeyRound, Download, Zap, Mail, MapPin } from 'lucide-react';
import { useApp } from '../lib/store.jsx';
import { api } from '../lib/api.js';
import { Button, ScoreRing, Logo, stagger } from '../components/ui.jsx';
import { canInstall, onInstallable, promptInstall } from '../lib/pwa.js';
import { Brand } from '../components/Brand.jsx';

const GSI_SRC = 'https://accounts.google.com/gsi/client';
const SOURCES = ['LinkedIn*', 'Indeed*', 'Naukri', 'Greenhouse', 'Lever', 'Ashby', 'Workable', 'SmartRecruiters', 'Remote OK', 'We Work Remotely', 'Himalayas', 'Wellfound', 'Arbeitnow', 'The Muse', 'Adzuna', 'Jooble', 'Reed', 'USAJOBS', 'HN Who\'s Hiring', 'Recruitee'];

function loadGsi() {
  if (window.google && window.google.accounts && window.google.accounts.id) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const existing = document.querySelector(`script[src="${GSI_SRC}"]`);
    const s = existing || document.createElement('script');
    s.addEventListener('load', () => resolve());
    s.addEventListener('error', () => reject(new Error('Could not load Google Sign-In')));
    if (!existing) { s.src = GSI_SRC; s.async = true; s.defer = true; document.head.appendChild(s); }
  });
}

function GoogleButton({ clientId, onCredential }) {
  const ref = useRef(null);
  const [err, setErr] = useState('');
  useEffect(() => {
    if (!clientId) return undefined;
    let dead = false;
    loadGsi().then(() => {
      if (dead || !ref.current) return;
      window.google.accounts.id.initialize({ client_id: clientId, callback: (r) => onCredential(r.credential), ux_mode: 'popup', auto_select: false, itp_support: true, cancel_on_tap_outside: true });
      window.google.accounts.id.renderButton(ref.current, { type: 'standard', theme: 'filled_black', size: 'large', shape: 'pill', text: 'continue_with', logo_alignment: 'left', width: Math.max(220, Math.min(380, ref.current.offsetWidth || 320)) });
    }).catch((e) => !dead && setErr(e.message));
    return () => { dead = true; };
  }, [clientId]); // eslint-disable-line
  if (!clientId) return null;
  return <div><div ref={ref} className="gsi-slot" data-testid="gsi-button" />{err && <div className="small" style={{ color: 'var(--red)', textAlign: 'center', marginTop: 6 }}>{err}</div>}</div>;
}

function DemoCard() {
  return (
    <motion.div {...stagger(2)} className="card premium premium-shimmer" style={{ textAlign: 'left' }}>
      <div style={{ position: 'absolute', top: 0, right: 0, padding: '6px 8px', zIndex: 2 }}><span className="badge green"><Zap size={10} />auto-apply</span></div>
      <div style={{ padding: 16, position: 'relative', zIndex: 2 }}>
        <div className="row" style={{ alignItems: 'flex-start', gap: 12 }}>
          <Logo name="Razorpay" />
          <div className="grow">
            <div className="card-title" style={{ paddingRight: 86 }}>Senior Backend Engineer</div>
            <div className="row wrap" style={{ gap: 6, marginTop: 6 }}><span className="badge accent">Razorpay</span><span className="badge">Remote</span><span className="badge">Full-time</span></div>
          </div>
        </div>
      </div>
      <div style={{ borderTop: '1px solid var(--border)', padding: '12px 16px', display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 10, position: 'relative', zIndex: 2 }}>
        <div className="metric"><div className="k">Match</div><div className="v" style={{ color: 'var(--green)' }}>94%</div></div>
        <div className="metric"><div className="k">Salary</div><div className="v">₹45L</div></div>
        <div className="metric"><div className="k">Posted</div><div className="v">2h</div></div>
      </div>
    </motion.div>
  );
}

export default function Landing() {
  const app = useApp();
  const cfg = app.config || {};
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [installable, setInstallable] = useState(canInstall());
  useEffect(() => onInstallable(setInstallable), []);

  const signIn = async (path, body) => {
    setBusy(true);
    try { await api(path, { method: 'POST', body }); await app.refreshMe(); } catch (e) { app.toast(e.message, 'error'); } finally { setBusy(false); }
  };

  const features = [
    { icon: Search, t: 'Search every job board', d: 'One search across 25+ live sources and hundreds of company career pages, de-duplicated.' },
    { icon: Target, t: 'Ranked to your resume', d: 'Explainable match score (title, skills, experience, location, freshness), computed on your phone.' },
    { icon: Smartphone, t: 'Apply from your phone', d: 'Open the job and fill it with one-tap copy for every profile field, saved answer and an AI cover letter.' },
    { icon: Laptop, t: 'Or send it to your laptop', d: 'Queue jobs for the ApplyPilot desktop app: approve them there in one click, or let autopilot apply when it\'s next online.' },
    { icon: ShieldCheck, t: 'Zero-knowledge encryption', d: 'Everything is encrypted on your device with a key only your passphrase unlocks. We can\'t read it. Nobody can.' },
  ];

  return (
    <div className="glow-wrap" style={{ minHeight: '100dvh' }}>
      <div className="glow" style={{ top: -260, left: '50%', transform: 'translateX(-50%)' }} />
      <div className="content" style={{ paddingTop: 'calc(16px + var(--safe-top))', paddingBottom: 'calc(40px + var(--safe-bottom))', position: 'relative' }}>
        <div className="row between" style={{ marginBottom: 26 }}>
          <Brand />
          {installable && <Button size="sm" icon={Download} onClick={promptInstall}>Install app</Button>}
        </div>

        <motion.div className="hero" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4 }}>
          <span className="badge accent" style={{ marginBottom: 14 }}><Lock size={11} />End-to-end encrypted</span>
          <h1>Every job board.<br />One search.<br /><span className="pixel" style={{ color: 'var(--accent-2)' }}>On your phone.</span></h1>
          <p>ApplyPilot searches every board at once, ranks each job against your resume, and lets you apply right from your phone or send it to your laptop to fill in.</p>
        </motion.div>

        <motion.div {...stagger(1)} className="card pad" style={{ margin: '24px auto 0', maxWidth: 440, position: 'relative', zIndex: 1 }}>
          <div className="col" style={{ gap: 12 }}>
            {cfg.googleClientId ? <GoogleButton clientId={cfg.googleClientId} onCredential={(credential) => signIn('/auth/google', { credential })} />
              : !cfg.devLogin && <div className="small muted" style={{ textAlign: 'center' }}>{cfg.offline ? 'Can\'t reach the ApplyPilot server right now.' : 'Google Sign-In is not configured on this server.'}</div>}
            {cfg.devLogin && (
              <form className="col" style={{ gap: 8 }} onSubmit={(e) => { e.preventDefault(); if (email.trim()) signIn('/auth/dev', { email: email.trim() }); }} data-testid="dev-login">
                {cfg.googleClientId && <div className="row" style={{ gap: 10 }}><hr className="hr grow" /><span className="tiny dim">or dev login</span><hr className="hr grow" /></div>}
                <span className="label" style={{ margin: 0 }}>Developer sign-in (local only)</span>
                <div className="search-wrap"><Mail size={16} /><input className="input" type="email" inputMode="email" autoComplete="email" placeholder="you@example.com" value={email} onChange={(e) => setEmail(e.target.value)} aria-label="Email" /></div>
                <Button type="submit" variant="primary" size="lg" loading={busy} block>Continue with email</Button>
              </form>
            )}
            <div className="tiny dim" style={{ textAlign: 'center', lineHeight: 1.6 }}>We only receive your Google name, email and picture. Your profile, resumes and applications are encrypted before they leave your device.</div>
          </div>
        </motion.div>

        <div style={{ maxWidth: 520, margin: '30px auto 0', position: 'relative', zIndex: 1 }}><DemoCard /></div>

        <div className="marquee" style={{ margin: '26px 0 6px' }}>
          <div className="marquee-inner">{[...SOURCES, ...SOURCES].map((s, i) => <span key={i} className="badge" style={{ padding: '4px 12px', fontSize: 12 }}>{s}</span>)}</div>
        </div>
        <div className="tiny dim" style={{ textAlign: 'center' }}>* via the desktop app or optional keyed sources</div>

        <div className="col" style={{ gap: 10, marginTop: 28 }}>
          {features.map((f, i) => (
            <motion.div key={f.t} {...stagger(i + 3)} className={`card pad feature ${i === 4 ? 'premium premium-shimmer' : ''}`}>
              <span className="ico" style={{ position: 'relative', zIndex: 2 }}><f.icon size={18} /></span>
              <div style={{ position: 'relative', zIndex: 2 }} className="grow"><div style={{ fontWeight: 700 }}>{f.t}</div><div className="small muted" style={{ marginTop: 2 }}>{f.d}</div></div>
            </motion.div>
          ))}
        </div>

        <div className="card pad" style={{ marginTop: 18 }}>
          <div className="section-title"><KeyRound size={14} />How zero-knowledge works</div>
          <ol className="small muted" style={{ margin: 0, paddingLeft: 18, lineHeight: 1.7 }}>
            <li>You choose a vault passphrase. It never leaves this device.</li>
            <li>A random 256-bit key encrypts every record with AES-256-GCM, on your phone.</li>
            <li>Our server only stores ciphertext. A full database leak exposes no profile, resume or application.</li>
            <li>You get a one-time recovery key in case you forget the passphrase. Lose both and nobody, including us, can recover your data.</li>
          </ol>
        </div>
        <div className="row" style={{ justifyContent: 'center', gap: 14, marginTop: 22 }}>
          <ScoreRing score={94} size={40} />
          <span className="small muted"><MapPin size={12} style={{ verticalAlign: -1 }} /> Scoring runs on your device. Searches use no personal data.</span>
        </div>
      </div>
    </div>
  );
}
