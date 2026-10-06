import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';

export const api = {
  call: (channel, ...args) => (window.api ? window.api.call(channel, ...args) : Promise.reject(new Error('ApplyPilot must run inside the desktop app'))),
  on: (fn) => (window.api ? window.api.on(fn) : () => {}),
  pathForFile: (f) => (window.api ? window.api.pathForFile(f) : null),
};

const Ctx = createContext(null);

function upsert(list, item) {
  const i = list.findIndex((x) => x.id === item.id);
  if (i === -1) return [item, ...list];
  const next = list.slice();
  next[i] = item;
  return next;
}

export function AppProvider({ children }) {
  const [state, setState] = useState(null);
  const [error, setError] = useState(null);
  const [toasts, setToasts] = useState([]);
  const [route, setRoute] = useState({ page: 'dashboard', params: {} });
  const [confirmState, setConfirmState] = useState(null);
  const searchProgress = useRef(new Set());
  const [, force] = useState(0);

  const toast = useCallback((message, kind = 'info') => {
    const id = Math.random().toString(36).slice(2);
    setToasts((t) => [...t, { id, message, kind }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), kind === 'error' ? 6500 : 3800);
  }, []);

  const reload = useCallback(async () => {
    try { setState(await api.call('app:bootstrap')); } catch (e) { setError(e.message); }
  }, []);

  useEffect(() => { reload(); }, [reload]);

  useEffect(() => api.on((channel, payload) => {
    if (channel === 'search:progress') { searchProgress.current.forEach((fn) => fn(payload)); return; }
    setState((s) => {
      if (!s) return s;
      switch (channel) {
        case 'campaign:update': return { ...s, campaigns: upsert(s.campaigns, payload) };
        case 'application:update': return { ...s, applications: upsert(s.applications, payload) };
        case 'activity': return { ...s, activity: [payload, ...s.activity].slice(0, 300) };
        case 'plan': return { ...s, plan: payload };
        default: return s;
      }
    });
    if (channel === 'cloud:pulled') api.call('app:bootstrap').then((b) => setState((s) => ({ ...s, profile: b.profile, qa: b.qa, applications: b.applications, resumes: b.resumes })));
    if (channel === 'resumes:changed') api.call('resumes:list').then((resumes) => setState((s) => ({ ...s, resumes })));
    if (channel === 'qa:pending') api.call('qa:list').then((qa) => setState((s) => ({ ...s, qa })));
  }), []);

  // In-app replacement for window.confirm: await app.confirm({ title, message, confirmLabel, danger })
  const confirm = useCallback((opts) => new Promise((resolve) => {
    setConfirmState({ ...(typeof opts === 'string' ? { message: opts } : opts), resolve });
  }), []);
  const closeConfirm = useCallback((answer) => {
    setConfirmState((c) => { if (c) c.resolve(answer); return null; });
  }, []);

  const set = useCallback((patch) => setState((s) => ({ ...s, ...(typeof patch === 'function' ? patch(s) : patch) })), []);
  const go = useCallback((page, params = {}) => setRoute({ page, params }), []);
  const onSearchProgress = useCallback((fn) => { searchProgress.current.add(fn); return () => searchProgress.current.delete(fn); }, []);

  // Helper: run an API call, toast errors, optionally toast success.
  const run = useCallback(async (channel, args = [], okMsg) => {
    try {
      const r = await api.call(channel, ...args);
      if (okMsg) toast(okMsg, 'success');
      return r;
    } catch (e) {
      toast(e.message, 'error');
      throw e;
    }
  }, [toast]);

  const value = useMemo(() => ({ ...(state || {}), ready: !!state, error, set, reload, toast, toasts, route, go, run, onSearchProgress, confirm, confirmState, closeConfirm, force: () => force((n) => n + 1) }),
    [state, error, set, reload, toast, toasts, route, go, run, onSearchProgress, confirm, confirmState, closeConfirm]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export const useApp = () => useContext(Ctx);
