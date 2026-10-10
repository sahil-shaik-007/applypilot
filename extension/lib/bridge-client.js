// Talks to the ApplyPilot desktop bridge on http://127.0.0.1:47823-47833 (see electron/bridge.js).
// Loaded by the service worker with importScripts(). The token lives only in chrome.storage.local.
/* global chrome */
'use strict';

const AP_PORTS = Array.from({ length: 11 }, (_, i) => 47823 + i);

const apStore = {
  async get() { return (await chrome.storage.local.get(['pairing'])).pairing || null; },
  async set(p) { await chrome.storage.local.set({ pairing: p }); },
  async clear() { await chrome.storage.local.remove(['pairing']); },
};

class BridgeError extends Error {
  constructor(message, { status = 0, code = '' } = {}) { super(message); this.status = status; this.code = code; }
}

// Always POST with a JSON body: Chrome only sends the Origin header (which the bridge requires) on non-GET
// requests from an extension, so read-only endpoints are called as POST too (the bridge accepts both).
async function apFetch(port, path, { method = 'POST', body = {}, token, timeout = 6000 } = {}) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeout);
  try {
    const res = await fetch(`http://127.0.0.1:${port}${path}`, {
      method,
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify(body || {}),
      signal: ctl.signal,
      cache: 'no-store',
      credentials: 'omit',
    });
    let data = null;
    try { data = await res.json(); } catch { data = null; }
    return { status: res.status, data };
  } finally { clearTimeout(t); }
}

// Finds the port the desktop app is listening on (an ApplyPilot bridge answers /status, 401 when unpaired).
async function apDiscover(preferred) {
  const order = preferred ? [preferred, ...AP_PORTS.filter((p) => p !== preferred)] : AP_PORTS;
  for (const port of order) {
    try {
      const r = await apFetch(port, '/status', { timeout: 900 });
      if (r.data && r.data.app === 'ApplyPilot') return port;
    } catch { /* closed port */ }
  }
  return null;
}

async function apPair(code) {
  const port = await apDiscover();
  if (!port) throw new BridgeError('ApplyPilot desktop app is not running. Open it, then try again.', { code: 'offline' });
  const ua = navigator.userAgent;
  const browser = /Edg\//.test(ua) ? `Microsoft Edge ${(ua.match(/Edg\/(\d+)/) || [])[1] || ''}` : `Chrome ${(ua.match(/Chrome\/(\d+)/) || [])[1] || ''}`;
  const r = await apFetch(port, '/pair', { method: 'POST', body: { code: String(code || '').trim(), name: 'ApplyPilot extension', browser: browser.trim() } });
  if (r.status !== 200 || !r.data || !r.data.token) throw new BridgeError((r.data && r.data.error) || `Pairing failed (HTTP ${r.status})`, { status: r.status, code: 'pair' });
  const p = { token: r.data.token, port, pairedAt: new Date().toISOString(), appVersion: r.data.version || '' };
  await apStore.set(p);
  return p;
}

// Authenticated call; rediscovers the port if the app restarted on another one.
async function apCall(path, opts = {}) {
  const p = await apStore.get();
  if (!p || !p.token) throw new BridgeError('Not paired with ApplyPilot yet. Open the extension options to pair.', { code: 'unpaired' });
  let r;
  try { r = await apFetch(p.port, path, { ...opts, token: p.token }); } catch {
    const port = await apDiscover(p.port);
    if (!port) throw new BridgeError('ApplyPilot desktop app is not running. Open it and try again.', { code: 'offline' });
    if (port !== p.port) await apStore.set({ ...p, port });
    r = await apFetch(port, path, { ...opts, token: p.token });
  }
  if (r.status === 401) {
    await apStore.clear();
    throw new BridgeError('ApplyPilot no longer recognises this browser. Pair again from the extension options.', { status: 401, code: 'unpaired' });
  }
  if (r.status !== 200) throw new BridgeError((r.data && r.data.error) || `ApplyPilot error (HTTP ${r.status})`, { status: r.status });
  return r.data;
}

self.ApBridge = { apPair, apCall, apDiscover, apStore, BridgeError, AP_PORTS };
