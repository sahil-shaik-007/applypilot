// App state: auth, vault session (DEK in memory only), encrypted sync, routing, toasts, confirms.
import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { unlockVault } from '@shared/vaultCrypto.js';
import { api, setUnauthorizedHandler } from './api.js';
import { Sync } from './sync.js';
import { setTestMode } from './bridge.js';

const Ctx = createContext(null);
export const useApp = () => useContext(Ctx);

export const AUTO_LOCK_MS = 15 * 60 * 1000;

// ---------------------------------------------------------------- hash router
function parseHash() {
  const h = window.location.hash.replace(/^#\/?/, '');
  const [path, qs] = h.split('?');
  return { page: path || 'home', params: Object.fromEntries(new URLSearchParams(qs || '')) };
}
export function useRoute() {
  const [route, setRoute] = useState(parseHash);
  useEffect(() => {
    const on = () => setRoute(parseHash());
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  return route;
}
export function go(page, params) {
  const qs = params && Object.keys(params).length ? `?${new URLSearchParams(params)}` : '';
  const next = `#/${page}${qs}`;
  if (window.location.hash !== next) window.location.hash = next;
  window.scrollTo({ top: 0, behavior: 'instant' });
}

// ---------------------------------------------------------------- provider
export function AppProvider({ children }) {
  const [phase, setPhase] = useState('loading'); // loading | landing | create-vault | unlock | app
  const [config, setConfig] = useState(null);
  const [user, setUser] = useState(null);
  const [vaultDoc, setVaultDoc] = useState(null); // { vault, version }
  const [rev, setRev] = useState(0);
  const [toasts, setToasts] = useState([]);
  const [confirmState, setConfirmState] = useState(null);
  const [lockReason, setLockReason] = useState('');
  const [syncState, setSyncState] = useState('idle'); // idle | syncing | error
  const syncRef = useRef(null);
  const userRef = useRef(null);
  userRef.current = user;

  const toast = useCallback((message, kind = 'info') => {
    const id = Math.random().toString(36).slice(2);
    setToasts((t) => [...t.slice(-2), { id, message, kind }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), kind === 'error' ? 6000 : 3200);
  }, []);

  const confirm = useCallback((opts) => new Promise((resolve) => setConfirmState({ ...opts, resolve })), []);
  const closeConfirm = (ok) => { if (confirmState) confirmState.resolve(ok); setConfirmState(null); };

  const endSync = useCallback(() => {
    if (syncRef.current) syncRef.current.close();
    syncRef.current = null;
    setRev((r) => r + 1);
  }, []);

  const lock = useCallback((reason = '') => {
    endSync();
    setLockReason(reason);
    if (userRef.current) setPhase((p) => (p === 'app' ? 'unlock' : p));
  }, [endSync]);

  const toLanding = useCallback(() => {
    endSync();
    setUser(null); setVaultDoc(null);
    setPhase('landing');
    if (window.location.hash && window.location.hash !== '#/') window.location.hash = '';
  }, [endSync]);

  // Fetch identity and vault status; decides which screen to show.
  const refreshMe = useCallback(async () => {
    try {
      const me = await api('/me');
      setUser(me.user);
      if (me.hasVault) {
        const v = await api('/vault');
        setVaultDoc(v);
        setPhase(syncRef.current ? 'app' : 'unlock');
      } else {
        setVaultDoc(null);
        setPhase('create-vault');
      }
      return me;
    } catch (e) {
      if (e.status === 401 || e.status === 403) { setUser(null); setPhase('landing'); return null; }
      throw e;
    }
  }, []);

  useEffect(() => {
    setUnauthorizedHandler(() => { if (userRef.current) { toast('Your session ended. Sign in again.', 'error'); toLanding(); } });
    (async () => {
      try { const c = await api('/config'); setTestMode(!!c.devLogin); setConfig(c); } catch { setConfig({ googleClientId: null, devLogin: false, offline: true }); }
      try { await refreshMe(); } catch { setPhase('landing'); }
    })();
  }, []); // eslint-disable-line

  /** Starts an unlocked session: DEK (non-extractable CryptoKey) is held only by the Sync object. */
  const startSession = useCallback(async (dek, u = userRef.current) => {
    const s = new Sync(u.id, dek);
    s.subscribe(() => setRev((r) => r + 1));
    await s.pull({ full: true });
    syncRef.current = s;
    setLockReason('');
    setRev((r) => r + 1);
    setPhase('app');
    if (s.undecryptable) toast(`${s.undecryptable} record(s) could not be decrypted and were skipped.`, 'error');
  }, [toast]);

  const unlock = useCallback(async (passphrase) => {
    const dek = await unlockVault(vaultDoc.vault, passphrase);
    await startSession(dek);
  }, [vaultDoc, startSession]);

  const logout = useCallback(async ({ everywhere = false } = {}) => {
    try { await api(everywhere ? '/auth/logout-all' : '/auth/logout', { method: 'POST' }); } catch { /* still clear locally */ }
    toLanding();
  }, [toLanding]);

  // ---------------- auto-lock: 15 min idle, or tab hidden > 15 min
  useEffect(() => {
    if (phase !== 'app') return undefined;
    let last = Date.now();
    let hiddenAt = null;
    const bump = () => { last = Date.now(); };
    const evs = ['pointerdown', 'keydown', 'touchstart', 'wheel', 'scroll'];
    evs.forEach((e) => window.addEventListener(e, bump, { passive: true, capture: true }));
    const onVis = () => {
      if (document.hidden) hiddenAt = Date.now();
      else {
        if (hiddenAt && Date.now() - hiddenAt > AUTO_LOCK_MS) lock('Locked after 15 minutes in the background.');
        else if (syncRef.current) syncRef.current.pull().catch(() => {});
        hiddenAt = null; bump();
      }
    };
    document.addEventListener('visibilitychange', onVis);
    const t = setInterval(() => { if (Date.now() - last > AUTO_LOCK_MS) lock('Locked after 15 minutes of inactivity.'); }, 15000);
    // Background pull every 60 s while visible (picks up desktop changes, e.g. outbox pickups).
    const p = setInterval(() => { if (!document.hidden && syncRef.current) syncRef.current.pull().catch(() => {}); }, 60000);
    return () => { evs.forEach((e) => window.removeEventListener(e, bump, { capture: true })); document.removeEventListener('visibilitychange', onVis); clearInterval(t); clearInterval(p); };
  }, [phase, lock]);

  // ---------------- derived decrypted data
  const data = useMemo(() => {
    const s = syncRef.current;
    if (!s) return { profile: {}, settings: {}, resumes: [], applications: [], qa: [], outbox: [], savedJobs: [], campaigns: [], networkMeta: null, careerPages: [] };
    const byDate = (k) => (a, b) => String(b[k] || '').localeCompare(String(a[k] || ''));
    return {
      profile: (s.get('profile', 'main') || {}).values || {},
      settings: s.get('settings', 'main') || {},
      resumes: s.list('resumes').sort(byDate('createdAt')),
      applications: s.list('applications').sort(byDate('updatedAt')),
      qa: s.list('qa').sort(byDate('updatedAt')),
      outbox: s.entries('outbox').map((r) => ({ ...r.data, id: r.id, pending: !!r.pending })).sort(byDate('createdAt')),
      savedJobs: s.entries('savedJobs').map((r) => ({ ...r.data, recordId: r.id })),
      campaigns: s.list('campaigns').sort((a, b) => String(a.createdAt || '').localeCompare(String(b.createdAt || ''))),
      networkMeta: s.get('network', 'meta') || null,
      careerPages: s.list('careerPages').sort(byDate('addedAt')),
    };
  }, [rev]);

  const sync = syncRef.current;
  const value = {
    phase, setPhase, config, user, setUser, vaultDoc, setVaultDoc, lockReason,
    toast, confirm, lock, logout, refreshMe, startSession, unlock, toLanding,
    sync, rev, syncState, setSyncState,
    ...data,
    async refresh() {
      if (!syncRef.current) return;
      setSyncState('syncing');
      try { await syncRef.current.pull(); setSyncState('idle'); } catch (e) { setSyncState('error'); toast(e.message, 'error'); }
    },
    put: (c, id, d, o) => syncRef.current.put(c, id, d, o),
    remove: (c, id) => syncRef.current.remove(c, id),
    async saveProfile(values) { return syncRef.current.put('profile', 'main', { values }); },
    async saveSettings(patch) {
      const cur = syncRef.current.get('settings', 'main') || {};
      return syncRef.current.put('settings', 'main', { ...cur, ...patch });
    },
  };

  return <Ctx.Provider value={value}>{children({ toasts, confirmState, closeConfirm })}</Ctx.Provider>;
}

/** Runs an async action with error → toast. Returns undefined on failure. */
export async function attempt(app, fn, okMsg) {
  try { const r = await fn(); if (okMsg) app.toast(okMsg, 'success'); return r; } catch (e) { app.toast(e.message || String(e), 'error'); return undefined; }
}
