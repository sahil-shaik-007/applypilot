import React, { useEffect, useState } from 'react';
import { Monitor, Link2, Trash2, KeyRound, Lock, Download, LogOut, ShieldAlert, RefreshCw, Copy, Laptop, UserX } from 'lucide-react';
import { rewrapVault } from '@shared/vaultCrypto.js';
import { useApp } from '../lib/store.jsx';
import { api, post } from '../lib/api.js';
import { Button, Sheet, Field, timeAgo, copyText, downloadFile } from '../components/ui.jsx';
import { useDevices } from './Home.jsx';
import { NewPassphraseFields, RecoveryKeyPanel, passphraseStrength } from './Vault.jsx';
import { ApplyingCard, BrowserHelperCard, CareerPagesCard } from '../components/settingsCards.jsx';

// The name shown in the portal. Editable here at any time (it is not the Google or sign-in email).
function PortalName() {
  const app = useApp();
  const [name, setName] = useState((app.user && app.user.displayName) || '');
  const [busy, setBusy] = useState(false);
  const clean = name.trim().replace(/\s+/g, ' ');
  const save = async (e) => {
    e && e.preventDefault();
    if (!clean) return app.toast('Enter the name you want to see in your portal.', 'error');
    setBusy(true);
    try { const r = await post('/me/display-name', { displayName: clean }); app.setUser(r.user); app.toast('Portal name saved', 'success'); } catch {} finally { setBusy(false); }
  };
  return (
    <form className="row" style={{ gap: 8 }} onSubmit={save}>
      <input className="input grow" value={name} onChange={(e) => setName(e.target.value)} maxLength={40} aria-label="Portal name" placeholder="Your name" />
      <Button size="sm" type="submit" loading={busy} disabled={!clean || clean === ((app.user && app.user.displayName) || '')}>Save name</Button>
    </form>
  );
}

function LinkCodeSheet({ code, onClose, onExpire }) {
  const app = useApp();
  const [now, setNow] = useState(Date.now());
  useEffect(() => { if (!code) return undefined; const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t); }, [code]);
  const left = code ? Math.max(0, Math.round((code.expiresAt - now) / 1000)) : 0;
  useEffect(() => { if (code && left === 0) onExpire(); }, [left]); // eslint-disable-line
  const pretty = code ? (code.code.length === 8 ? `${code.code.slice(0, 4)}-${code.code.slice(4)}` : code.code) : '';
  return (
    <Sheet open={!!code} onClose={onClose} title="Link your desktop app">
      {code && (
        <div className="col" style={{ gap: 16 }}>
          <div className="card pad premium premium-shimmer" style={{ textAlign: 'center' }}>
            <div style={{ position: 'relative', zIndex: 2 }}>
              <span className="label">One-time link code</span>
              <div className="link-code pixel" data-testid="link-code">{pretty}</div>
              <div className="small" style={{ color: left < 60 ? 'var(--amber)' : 'var(--muted)' }} data-testid="link-countdown">{left > 0 ? `Expires in ${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}` : 'Expired'}</div>
              <Button size="sm" variant="ghost" icon={Copy} style={{ marginTop: 6 }} onClick={async () => { await copyText(code.code); app.toast('Code copied', 'success'); }}>Copy code</Button>
            </div>
          </div>
          <ol className="small muted" style={{ margin: 0, paddingLeft: 20, lineHeight: 1.8 }}>
            <li>Open <b style={{ color: 'var(--fg)' }}>ApplyPilot</b> on your laptop.</li>
            <li>Go to <b style={{ color: 'var(--fg)' }}>Settings → Phone & web</b>.</li>
            <li>Enter this server address: <span className="kbd">{window.location.origin}</span></li>
            <li>Type the code above and your <b style={{ color: 'var(--fg)' }}>vault passphrase</b>.</li>
          </ol>
          <div className="tiny dim">The code works once and expires in 10 minutes. Your passphrase is entered only on the laptop; it never passes through our server.</div>
        </div>
      )}
    </Sheet>
  );
}

function ChangePassphrase({ open, onClose, rotateRecovery }) {
  const app = useApp();
  const [cur, setCur] = useState('');
  const [pass, setPass] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [newKey, setNewKey] = useState(null);
  const [err, setErr] = useState('');
  useEffect(() => { if (open) { setCur(''); setPass(''); setConfirm(''); setNewKey(null); setErr(''); } }, [open]);
  const go = async () => {
    setBusy(true); setErr('');
    try {
      const { vault, version } = app.vaultDoc;
      const nextPass = rotateRecovery ? cur : pass;
      const next = await rewrapVault(vault, { passphrase: cur }, nextPass, { newRecoveryKey: !!rotateRecovery });
      let res;
      try { res = await api('/vault', { method: 'PUT', body: { vault: next.vault, baseVersion: version } }); } catch (e) {
        if (e.status === 409) { const fresh = await api('/vault'); app.setVaultDoc(fresh); throw new Error('Your vault changed on another device. Try again.'); }
        throw e;
      }
      app.setVaultDoc({ vault: next.vault, version: res && res.version != null ? res.version : version + 1 });
      setCur(''); setPass(''); setConfirm('');
      if (rotateRecovery) setNewKey(next.recoveryKey);
      else { app.toast('Passphrase changed. Linked desktops keep working.', 'success'); onClose(); }
    } catch (e) { setErr(e.message === 'Wrong passphrase' ? 'Current passphrase is wrong.' : e.message); } finally { setBusy(false); }
  };
  const ok = cur && (rotateRecovery || (passphraseStrength(pass).ok && pass === confirm));
  return (
    <Sheet open={open} onClose={onClose} title={rotateRecovery ? 'New recovery key' : 'Change passphrase'}
      footer={!newKey && <><Button size="lg" variant="ghost" onClick={onClose}>Cancel</Button><Button size="lg" variant="primary" loading={busy} disabled={!ok} onClick={go}>{rotateRecovery ? 'Generate' : 'Change'}</Button></>}>
      {newKey ? <RecoveryKeyPanel recoveryKey={newKey} email={app.user && app.user.email} doneLabel="Done" onDone={() => { setNewKey(null); onClose(); app.toast('New recovery key active. The old one no longer works.', 'success'); }} /> : (
        <div className="col" style={{ gap: 14 }}>
          {rotateRecovery && <p className="small muted" style={{ margin: 0 }}>Your old recovery key stops working. You'll see the new one once.</p>}
          <Field label="Current passphrase"><input className="input" type="password" value={cur} onChange={(e) => setCur(e.target.value)} autoComplete="current-password" /></Field>
          {!rotateRecovery && <NewPassphraseFields pass={pass} setPass={setPass} confirm={confirm} setConfirm={setConfirm} />}
          {err && <div className="small" style={{ color: 'var(--red)' }} role="alert">{err}</div>}
        </div>
      )}
    </Sheet>
  );
}

export default function Settings() {
  const app = useApp();
  const { devices, reload, error } = useDevices();
  const [code, setCode] = useState(null);
  const [busy, setBusy] = useState(null);
  const [pw, setPw] = useState(null); // 'change' | 'recovery'

  const linkCode = async () => {
    setBusy('link');
    try {
      const r = await api('/devices/link-code', { method: 'POST' });
      const exp = typeof r.expiresAt === 'number' ? r.expiresAt : new Date(r.expiresAt).getTime();
      setCode({ code: r.code, expiresAt: exp || Date.now() + 600000 });
    } catch (e) { app.toast(e.message, 'error'); } finally { setBusy(null); }
  };
  const revoke = async (d) => {
    if (!(await app.confirm({ title: 'Unlink device?', message: `"${d.name}" will stop syncing immediately and must be linked again with a new code.`, confirmLabel: 'Unlink' }))) return;
    try { await api(`/devices/${encodeURIComponent(d.id)}`, { method: 'DELETE' }); app.toast('Device unlinked', 'success'); reload(); } catch (e) { app.toast(e.message, 'error'); }
  };
  const exportData = async () => {
    setBusy('export');
    try {
      const data = await api('/account/export');
      downloadFile(`applypilot-export-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify({ exportedAt: new Date().toISOString(), note: 'All records are end-to-end encrypted. Decrypt them with your vault passphrase in ApplyPilot.', ...data }, null, 2), 'application/json');
      app.toast('Encrypted export downloaded', 'success');
    } catch (e) { app.toast(e.message, 'error'); } finally { setBusy(null); }
  };
  const logoutAll = async () => {
    if (!(await app.confirm({ title: 'Sign out everywhere?', message: 'Every browser session and every linked desktop app is signed out and unlinked.', confirmLabel: 'Sign out everywhere' }))) return;
    await app.logout({ everywhere: true });
  };
  const deleteAccount = async () => {
    if (!(await app.confirm({ title: 'Delete your account?', message: 'This permanently deletes your vault, every encrypted record and file, all sessions and linked devices. It cannot be undone. Export first if you want a copy.', confirmLabel: 'Delete forever', typed: 'DELETE' }))) return;
    try { await api('/account', { method: 'DELETE', body: { confirm: 'DELETE' } }); app.toast('Account deleted', 'success'); app.toLanding(); } catch (e) { app.toast(e.message, 'error'); }
  };

  return (
    <div className="col" style={{ gap: 14 }}>
      <div className="card pad col" style={{ gap: 12 }}>
        <div className="row between"><div className="section-title" style={{ margin: 0 }}><Monitor size={14} />Devices</div><Button size="sm" variant="ghost" icon={RefreshCw} aria-label="Refresh devices" onClick={reload} /></div>
        <Button variant="primary" icon={Link2} loading={busy === 'link'} onClick={linkCode} data-testid="link-desktop">Link desktop app</Button>
        <div className="col" style={{ gap: 4 }}>
          {(devices || []).map((d) => (
            <div key={d.id} className="row" style={{ gap: 10, minHeight: 48 }} data-testid="device-row">
              <Laptop size={16} className="dim" />
              <div className="grow"><div className="small ellipsis" style={{ fontWeight: 600 }}>{d.name}</div><div className="tiny dim">linked {timeAgo(d.createdAt)} · {d.lastSeenAt ? `seen ${timeAgo(d.lastSeenAt)}` : 'never synced'}</div></div>
              <Button size="sm" variant="ghost" icon={Trash2} aria-label={`Unlink ${d.name}`} onClick={() => revoke(d)} />
            </div>
          ))}
          {devices && !devices.length && <div className="small dim">No linked devices yet.</div>}
          {error && <div className="small" style={{ color: 'var(--red)' }}>{error}</div>}
        </div>
      </div>

      <ApplyingCard />
      <BrowserHelperCard />
      <CareerPagesCard />

      <div className="card pad col" style={{ gap: 10 }}>
        <div className="section-title" style={{ margin: 0 }}><KeyRound size={14} />Vault security</div>
        <div className="tiny dim">Zero-knowledge: your passphrase and recovery key never leave your devices. Auto-locks after 15 minutes idle.</div>
        <Button icon={KeyRound} onClick={() => setPw('change')}>Change passphrase</Button>
        <Button icon={RefreshCw} onClick={() => setPw('recovery')}>Generate a new recovery key</Button>
        <Button icon={Lock} onClick={() => app.lock('Vault locked.')}>Lock now</Button>
      </div>

      <div className="card pad col" style={{ gap: 10 }}>
        <div className="section-title" style={{ margin: 0 }}><Download size={14} />Your data</div>
        <Button icon={Download} loading={busy === 'export'} onClick={exportData}>Export (encrypted JSON)</Button>
      </div>

      <div className="card pad col" style={{ gap: 10 }}>
        <div className="section-title" style={{ margin: 0 }}><ShieldAlert size={14} />Account</div>
        <PortalName />
        <div className="small muted ellipsis">Signed in as {app.user && app.user.email}</div>
        <Button icon={LogOut} onClick={() => app.logout()}>Sign out</Button>
        <Button icon={LogOut} onClick={logoutAll}>Sign out everywhere</Button>
        <Button variant="danger" icon={UserX} onClick={deleteAccount} data-testid="delete-account">Delete account</Button>
      </div>

      <LinkCodeSheet code={code} onClose={() => { setCode(null); reload(); }} onExpire={() => {}} />
      <ChangePassphrase open={!!pw} rotateRecovery={pw === 'recovery'} onClose={() => setPw(null)} />
    </div>
  );
}

