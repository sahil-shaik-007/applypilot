import React, { useMemo, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ShieldCheck, Eye, EyeOff, Copy, Download, KeyRound, Lock, LogOut, Check, CircleAlert } from 'lucide-react';
import { createVault, rewrapVault, unlockVault, assertPassphraseStrength, normalizeRecoveryKey } from '@shared/vaultCrypto.js';
import { useApp } from '../lib/store.jsx';
import { api } from '../lib/api.js';
import { Button, Field, copyText, downloadFile } from '../components/ui.jsx';
import { Brand } from '../components/Brand.jsx';

// ---------------------------------------------------------------- passphrase strength
export function passphraseStrength(p) {
  if (!p) return { level: 0, label: '', ok: false, msg: '' };
  let ok = true; let msg = '';
  try { assertPassphraseStrength(p); } catch (e) { ok = false; msg = e.message; }
  let pool = 0;
  if (/[a-z]/.test(p)) pool += 26;
  if (/[A-Z]/.test(p)) pool += 26;
  if (/\d/.test(p)) pool += 10;
  if (/[^a-zA-Z0-9]/.test(p)) pool += 33;
  const unique = new Set(p).size;
  let bits = Math.log2(Math.max(pool, 2)) * p.length * Math.min(1, unique / Math.max(6, p.length * 0.5));
  if (/(.)\1{2,}/.test(p)) bits *= 0.8;
  const words = p.trim().split(/[\s\-_.]+/).filter((w) => w.length >= 3).length;
  if (words >= 4) bits = Math.max(bits, 70);
  const level = !ok ? 1 : bits < 50 ? 1 : bits < 65 ? 2 : bits < 85 ? 3 : 4;
  const label = ['', 'Weak', 'Fair', 'Good', 'Strong'][level];
  return { level, label, ok, msg, bits: Math.round(bits) };
}

function StrengthMeter({ value }) {
  const s = passphraseStrength(value);
  const color = ['', 'var(--red)', 'var(--amber)', 'var(--accent-2)', 'var(--green)'][s.level];
  return (
    <div aria-live="polite">
      <div className="strength">{[1, 2, 3, 4].map((i) => <div key={i} style={{ background: i <= s.level ? color : undefined }} />)}</div>
      <div className="row between tiny" style={{ marginTop: 5 }}>
        <span style={{ color }}>{value ? (s.ok ? s.label : s.msg) : 'At least 12 characters. A few random words work great.'}</span>
        {value && <span className="dim">{value.length} chars</span>}
      </div>
    </div>
  );
}

function PassInput({ value, onChange, placeholder, autoFocus, autoComplete = 'new-password', testId, label }) {
  const [show, setShow] = useState(false);
  return (
    <div className="row" style={{ gap: 6 }}>
      <input className="input grow" type={show ? 'text' : 'password'} value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder}
        autoFocus={autoFocus} autoComplete={autoComplete} autoCapitalize="off" autoCorrect="off" spellCheck={false} data-testid={testId} aria-label={label || placeholder} />
      <Button variant="outline" icon={show ? EyeOff : Eye} aria-label={show ? 'Hide passphrase' : 'Show passphrase'} onClick={() => setShow(!show)} />
    </div>
  );
}

/** Sets a new passphrase (twice) with strength meter. Used by create + recovery + change. */
export function NewPassphraseFields({ pass, setPass, confirm, setConfirm, autoFocus }) {
  return (
    <div className="col" style={{ gap: 14 }}>
      <Field label="Vault passphrase">
        <PassInput value={pass} onChange={setPass} placeholder="e.g. copper-river-tiger-lantern" autoFocus={autoFocus} testId="new-pass" label="New passphrase" />
        <StrengthMeter value={pass} />
      </Field>
      <Field label="Confirm passphrase">
        <PassInput value={confirm} onChange={setConfirm} placeholder="Type it again" testId="new-pass-confirm" label="Confirm passphrase" />
        {confirm && confirm !== pass && <span className="help" style={{ color: 'var(--red)' }}>Passphrases don't match</span>}
      </Field>
    </div>
  );
}

export function RecoveryKeyPanel({ recoveryKey, email, onDone, doneLabel = 'Continue' }) {
  const app = useApp();
  const [typed, setTyped] = useState('');
  const [copied, setCopied] = useState(false);
  const last4 = normalizeRecoveryKey(recoveryKey).slice(-4);
  const ok = normalizeRecoveryKey(typed) === last4;
  const download = () => downloadFile('ApplyPilot-recovery-key.txt', [
    'ApplyPilot vault recovery key',
    '==============================',
    '',
    recoveryKey,
    '',
    `Account: ${email || ''}`,
    `Created: ${new Date().toISOString()}`,
    '',
    'Keep this somewhere safe and offline (password manager, printed copy).',
    'It unlocks your encrypted vault if you forget your passphrase.',
    'ApplyPilot does not have a copy and cannot recover your data without it.',
  ].join('\r\n'), 'text/plain;charset=utf-8');
  return (
    <div className="col" style={{ gap: 14 }}>
      <div className="card pad premium premium-shimmer">
        <div style={{ position: 'relative', zIndex: 2 }}>
          <div className="section-title"><KeyRound size={14} />Your recovery key</div>
          <div className="recovery-key pixel" data-testid="recovery-key">{recoveryKey}</div>
          <div className="grid g2" style={{ marginTop: 12 }}>
            <Button icon={copied ? Check : Copy} onClick={async () => { setCopied(await copyText(recoveryKey)); app.toast('Recovery key copied', 'success'); }}>{copied ? 'Copied' : 'Copy'}</Button>
            <Button icon={Download} onClick={download}>Download .txt</Button>
          </div>
        </div>
      </div>
      <div className="card pad small" style={{ borderColor: 'rgba(251,191,36,.35)' }}>
        <div className="row" style={{ alignItems: 'flex-start', color: 'var(--amber)' }}><CircleAlert size={16} style={{ flexShrink: 0, marginTop: 2 }} /><span>This is shown <b>once</b>. We never store it. If you lose both your passphrase and this key, your data is gone for good.</span></div>
      </div>
      <Field label="I saved it. Type the last 4 characters to confirm">
        <input className="input" value={typed} onChange={(e) => setTyped(e.target.value)} maxLength={6} autoCapitalize="characters" autoComplete="off" spellCheck={false} placeholder="••••" data-testid="recovery-last4" style={{ letterSpacing: '.3em', textTransform: 'uppercase' }} />
      </Field>
      <Button variant="primary" size="lg" block disabled={!ok} onClick={onDone} data-testid="recovery-saved">{ok ? doneLabel : 'I saved my recovery key'}</Button>
    </div>
  );
}

function VaultFrame({ children, title, sub, icon: Icon = ShieldCheck }) {
  const app = useApp();
  return (
    <div className="glow-wrap" style={{ minHeight: '100dvh' }}>
      <div className="glow" style={{ top: -300, left: '50%', transform: 'translateX(-50%)' }} />
      <div className="content" style={{ maxWidth: 480, paddingTop: 'calc(16px + var(--safe-top))', paddingBottom: 'calc(40px + var(--safe-bottom))', position: 'relative' }}>
        <div className="row between" style={{ marginBottom: 26 }}>
          <Brand />
          <Button variant="ghost" size="sm" icon={LogOut} onClick={() => app.logout()}>Sign out</Button>
        </div>
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>
          <div className="row" style={{ gap: 12, marginBottom: 6 }}>
            <span className="feature"><span className="ico"><Icon size={18} /></span></span>
            <h1 style={{ margin: 0, fontSize: 24, letterSpacing: '-.02em' }}>{title}</h1>
          </div>
          {sub && <p className="muted small" style={{ marginTop: 6, lineHeight: 1.6 }}>{sub}</p>}
          <div style={{ marginTop: 18 }}>{children}</div>
        </motion.div>
      </div>
    </div>
  );
}

export function CreateVault() {
  const app = useApp();
  const [pass, setPass] = useState('');
  const [confirm, setConfirm] = useState('');
  const [ack, setAck] = useState(false);
  const [busy, setBusy] = useState(false);
  const [recoveryKey, setRecoveryKey] = useState(null);
  const dekRef = useRef(null); // held in memory only until the session starts
  const s = useMemo(() => passphraseStrength(pass), [pass]);
  const can = s.ok && pass === confirm && ack;

  const create = async () => {
    setBusy(true);
    try {
      const { vault, dek, recoveryKey: rk } = await createVault(pass);
      const res = await api('/vault', { method: 'PUT', body: { vault, baseVersion: null } });
      app.setVaultDoc({ vault, version: res && res.version != null ? res.version : 1 });
      dekRef.current = dek;
      setPass(''); setConfirm('');
      setRecoveryKey(rk);
    } catch (e) { app.toast(e.message, 'error'); } finally { setBusy(false); }
  };

  if (recoveryKey) {
    return (
      <VaultFrame title="Save your recovery key" icon={KeyRound} sub="If you ever forget your passphrase, this key is the only way back into your vault.">
        <RecoveryKeyPanel recoveryKey={recoveryKey} email={app.user && app.user.email} doneLabel="Open ApplyPilot" onDone={async () => {
          const dek = dekRef.current; dekRef.current = null;
          setRecoveryKey(null);
          try { await app.startSession(dek); } catch (e) { app.toast(e.message, 'error'); }
        }} />
      </VaultFrame>
    );
  }

  return (
    <VaultFrame title="Create your vault" sub={`Signed in as ${app.user ? app.user.email : ''}. Your vault passphrase encrypts everything on this device before it's synced. We never see it.`}>
      <div className="col" style={{ gap: 16 }}>
        <div className="card pad small col" style={{ gap: 8 }}>
          {[
            'Profile, resumes, answers, applications and your AI key are encrypted with AES-256-GCM before upload.',
            'The key is derived from your passphrase with 600,000 PBKDF2 rounds, right here.',
            'The server stores only ciphertext. Even we can\'t read it.',
          ].map((t) => <div key={t} className="row" style={{ alignItems: 'flex-start' }}><Check size={14} color="var(--green)" style={{ flexShrink: 0, marginTop: 3 }} /><span className="muted">{t}</span></div>)}
        </div>
        <NewPassphraseFields pass={pass} setPass={setPass} confirm={confirm} setConfirm={setConfirm} autoFocus />
        <label className="row small" style={{ alignItems: 'flex-start', cursor: 'pointer', minHeight: 44 }}>
          <input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} style={{ width: 22, height: 22, accentColor: 'var(--accent)', flexShrink: 0 }} data-testid="vault-ack" />
          <span className="muted">I understand: if I lose both my passphrase and my recovery key, nobody can recover my data.</span>
        </label>
        <Button variant="primary" size="lg" block disabled={!can} loading={busy} onClick={create} data-testid="create-vault">{busy ? 'Deriving keys…' : 'Create encrypted vault'}</Button>
      </div>
    </VaultFrame>
  );
}

export function Unlock() {
  const app = useApp();
  const [mode, setMode] = useState('pass'); // pass | recovery
  const [pass, setPass] = useState('');
  const [rk, setRk] = useState('');
  const [newPass, setNewPass] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const unlock = async (e) => {
    e && e.preventDefault();
    if (!pass) return;
    setBusy(true); setErr('');
    try { await app.unlock(pass); } catch (e2) { setErr(e2.message === 'Wrong passphrase' ? 'Wrong passphrase. Try again or use your recovery key.' : e2.message); } finally { setBusy(false); }
  };

  const recover = async () => {
    setBusy(true); setErr('');
    try {
      const { vault, version } = app.vaultDoc;
      const next = await rewrapVault(vault, { recoveryKey: rk }, newPass);
      const res = await api('/vault', { method: 'PUT', body: { vault: next.vault, baseVersion: version } });
      app.setVaultDoc({ vault: next.vault, version: res && res.version != null ? res.version : version + 1 });
      const dek = await unlockVault(next.vault, newPass);
      setRk(''); setNewPass(''); setConfirm('');
      await app.startSession(dek);
      app.toast('New passphrase set. Your recovery key still works.', 'success');
    } catch (e) { setErr(e.message); } finally { setBusy(false); }
  };

  const s = passphraseStrength(newPass);
  return (
    <VaultFrame icon={Lock} title={mode === 'pass' ? 'Unlock your vault' : 'Recover with your key'}
      sub={mode === 'pass' ? (app.lockReason || `Welcome back${app.user && app.user.name ? `, ${app.user.name.split(' ')[0]}` : ''}. Enter your vault passphrase to decrypt your data on this device.`) : 'Enter your recovery key, then choose a new passphrase. Your data stays encrypted with the same key.'}>
      <AnimatePresence mode="wait">
        {mode === 'pass' ? (
          <motion.form key="pass" className="col" style={{ gap: 14 }} onSubmit={unlock} initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 10 }}>
            <Field label="Vault passphrase"><PassInput value={pass} onChange={setPass} placeholder="Your passphrase" autoFocus autoComplete="current-password" testId="unlock-pass" /></Field>
            {err && <div className="small" style={{ color: 'var(--red)' }} role="alert">{err}</div>}
            <Button type="submit" variant="primary" size="lg" block loading={busy} disabled={!pass} data-testid="unlock">{busy ? 'Decrypting…' : 'Unlock'}</Button>
            <Button variant="ghost" block icon={KeyRound} onClick={() => { setErr(''); setMode('recovery'); }}>Use recovery key</Button>
          </motion.form>
        ) : (
          <motion.div key="rec" className="col" style={{ gap: 14 }} initial={{ opacity: 0, x: 10 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -10 }}>
            <Field label="Recovery key"><input className="input" value={rk} onChange={(e) => setRk(e.target.value)} placeholder="XXXX-XXXX-XXXX-…" autoCapitalize="characters" autoComplete="off" spellCheck={false} data-testid="recovery-input" /></Field>
            <div className="label" style={{ marginTop: 4 }}>New passphrase (required)</div>
            <NewPassphraseFields pass={newPass} setPass={setNewPass} confirm={confirm} setConfirm={setConfirm} />
            {err && <div className="small" style={{ color: 'var(--red)' }} role="alert">{err}</div>}
            <Button variant="primary" size="lg" block loading={busy} disabled={!rk.trim() || !s.ok || newPass !== confirm} onClick={recover} data-testid="recover">Recover & set passphrase</Button>
            <Button variant="ghost" block onClick={() => { setErr(''); setMode('pass'); }}>Back to passphrase</Button>
          </motion.div>
        )}
      </AnimatePresence>
    </VaultFrame>
  );
}
