// ApplyPilot native bridge (Capacitor 8). Contract: docs/MOBILE.md, "Contract: web/client/src/native/index.js".
// Every export is safe in a plain browser (PWA) and falls back to a web behaviour or a no-op there.
import { Capacitor } from '@capacitor/core';
import { App } from '@capacitor/app';
import { Browser } from '@capacitor/browser';
import { Filesystem, Directory } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';
import { Haptics, ImpactStyle, NotificationType } from '@capacitor/haptics';
import { LocalNotifications } from '@capacitor/local-notifications';
import { BackgroundRunner } from '@capacitor/background-runner';
import { isNative as IS_NATIVE, apiBase as _apiBase, authHeaders as _authHeaders, auth, biometric, setApiBase, loadConfig, DEFAULT_API_BASE } from './secure.js';
import { applyInApp as _applyInApp, cancelPendingSubmit } from './inapp.js';
import { parseIncoming } from './incoming.js';

export const isNative = IS_NATIVE;
export const platform = isNative ? Capacitor.getPlatform() : 'web';
export { auth, biometric, setApiBase, DEFAULT_API_BASE, cancelPendingSubmit, parseIncoming };
export { AUTO_SUBMIT_ATS, ASSISTED_ATS, detectAts, resolveApplyUrl, canAutoSubmit } from './ats.js';

/** '' on the web (same origin); the configured cloud URL in the apps. */
export function apiBase() { return _apiBase(); }
/** { Authorization: 'Bearer …' } in the apps (token from the keystore); {} on the web (cookie session). */
export async function authHeaders() { return _authHeaders(); }
export async function applyInApp(opts) { return _applyInApp(opts); }

const RUNNER_LABEL = 'com.applypilot.app.check';
const randId = () => (crypto.getRandomValues(new Uint32Array(1))[0] % 2000000000) + 1;
const swallow = (p) => Promise.resolve(p).catch(() => undefined);

// ---------------------------------------------------------------- init (call once before rendering)
let inited = null;
const incoming = { fns: new Set(), queue: [] };
export function initNative() {
  if (inited) return inited;
  inited = (async () => {
    if (!isNative) { captureWebShare(); return { isNative, platform }; }
    await loadConfig();
    try {
      const launch = await App.getLaunchUrl();
      if (launch && launch.url) deliverIncoming(launch.url);
    } catch { /* none */ }
    swallow(App.addListener('appUrlOpen', (e) => { if (e && e.url) deliverIncoming(e.url); }));
    // Android back button: walk the hash router back, minimise at the root.
    swallow(App.addListener('backButton', ({ canGoBack }) => {
      if (canGoBack && window.location.hash && window.location.hash !== '#/' && window.location.hash !== '#/home') window.history.back();
      else swallow(App.minimizeApp());
    }));
    return { isNative, platform };
  })();
  return inited;
}

// ---------------------------------------------------------------- share intents ("Share to ApplyPilot")
function deliverIncoming(raw) {
  const item = parseIncoming(raw);
  if (!item) return;
  if (!incoming.fns.size) { incoming.queue.push(item); return; }
  for (const fn of incoming.fns) { try { fn(item); } catch { /* listener error */ } }
}
function captureWebShare() {
  // PWA share_target / ?share_url= links: same shape as the native share.
  try {
    const p = new URLSearchParams(window.location.search);
    const url = p.get('share_url') || p.get('url'); const text = p.get('share_text') || p.get('text') || '';
    if (url || text) deliverIncoming(`applypilot://share?url=${encodeURIComponent(url || '')}&text=${encodeURIComponent(text)}`);
  } catch { /* */ }
}
export const share = {
  /** fn({ url, text }) for each "Share to ApplyPilot" (queued ones from a cold start are delivered first). */
  onIncoming(fn) {
    if (typeof fn !== 'function') return () => {};
    incoming.fns.add(fn);
    const q = incoming.queue.splice(0);
    setTimeout(() => q.forEach((i) => { try { fn(i); } catch { /* */ } }), 0);
    return () => incoming.fns.delete(fn);
  },
};

// ---------------------------------------------------------------- notifications
export const notifications = {
  async requestPermission() {
    if (isNative) {
      try {
        let p = await LocalNotifications.checkPermissions();
        if (p.display !== 'granted') p = await LocalNotifications.requestPermissions();
        return p.display === 'granted';
      } catch { return false; }
    }
    if (typeof Notification === 'undefined') return false;
    if (Notification.permission === 'granted') return true;
    try { return (await Notification.requestPermission()) === 'granted'; } catch { return false; }
  },
  async notify({ title, body = '', data = {} } = {}) {
    if (!title) return;
    if (isNative) {
      await swallow(LocalNotifications.schedule({ notifications: [{ id: randId(), title: String(title).slice(0, 120), body: String(body).slice(0, 400), extra: data || {} }] }));
      return;
    }
    try {
      if (typeof Notification !== 'undefined' && Notification.permission === 'granted' && document.hidden) {
        const n = new Notification(String(title), { body: String(body), icon: '/icons/icon-192.png', data });
        n.onclick = () => { window.focus(); webTapFns.forEach((f) => { try { f(data || {}); } catch { /* */ } }); n.close(); };
      }
    } catch { /* unsupported */ }
  },
  /** fn(data) when the user taps one of our notifications. Returns an unsubscribe function. */
  onTap(fn) {
    if (typeof fn !== 'function') return () => {};
    if (!isNative) { webTapFns.add(fn); return () => webTapFns.delete(fn); }
    const hs = [];
    swallow(LocalNotifications.addListener('localNotificationActionPerformed', (a) => fn((a && a.notification && a.notification.extra) || {}))).then((h) => h && hs.push(h));
    swallow(BackgroundRunner.addListener('backgroundRunnerNotificationReceived', (e) => fn({ source: 'background', type: 'campaign-matches', notificationId: e && e.notificationId }))).then((h) => h && hs.push(h));
    return () => hs.forEach((h) => swallow(h.remove()));
  },
};
const webTapFns = new Set();

// ---------------------------------------------------------------- background campaign checks
// Runs web/client/runners/background.js (event 'checkJobs') periodically. The runner only knows the
// campaign SEARCH QUERIES (role/location/remote; the server sees these anyway when it searches) and a
// bearer token. It cannot score: the profile is encrypted and the DEK never leaves app memory, so
// matches are scored when the app opens. See docs/MOBILE.md "Background checks".
async function runnerEvent(event, details = {}) {
  return BackgroundRunner.dispatchEvent({ label: RUNNER_LABEL, event, details });
}
async function backgroundToken() {
  const base = _apiBase();
  const h = await _authHeaders();
  if (!h.Authorization) return null;
  // Prefer a search-only token if the server issues one; fall back to the session token.
  try {
    const r = await fetch(`${base}/api/auth/background-token`, { method: 'POST', headers: { ...h, 'Content-Type': 'application/json', Accept: 'application/json' }, body: '{}' });
    if (r.ok) { const j = await r.json(); if (j && j.token) return { token: j.token, scoped: true }; }
  } catch { /* not supported */ }
  return { token: h.Authorization.slice(7), scoped: false };
}
export const background = {
  /**
   * Registers / refreshes the periodic check. `watchlist` = campaignWatchlist(campaigns) from
   * src/lib/campaigns.js: [{ q, location, remote, campaignId, minScore }] (or { campaigns: [...] }).
   * Without an argument it only refreshes the token. Resolves { ok, reason? }.
   */
  async register(watchlist) {
    if (!isNative) return { ok: false, reason: 'web' };
    const list = Array.isArray(watchlist) ? watchlist : watchlist && Array.isArray(watchlist.campaigns) ? watchlist.campaigns : null;
    const queries = list ? list.slice(0, 12).map((w) => ({
      q: String(w.q || w.role || '').slice(0, 120), location: String(w.location || '').slice(0, 120),
      remote: ['remote', 'onsite'].includes(w.remote) ? w.remote : 'any', campaignId: String(w.campaignId || w.id || ''),
      label: String(w.name || w.q || w.role || '').slice(0, 60),
    })).filter((w) => w.q) : undefined;
    try { await swallow(BackgroundRunner.requestPermissions({ apis: ['notifications'] })); } catch { /* */ }
    const tok = await backgroundToken();
    if (!tok) return { ok: false, reason: 'signed-out' };
    const res = await runnerEvent('configure', { apiBase: _apiBase(), token: tok.token, scoped: tok.scoped, ...(queries ? { queries } : {}) }).catch((e) => ({ ok: false, reason: String(e && e.message || e) }));
    return res && typeof res === 'object' ? res : { ok: true };
  },
  async lastRun() {
    if (!isNative) return null;
    try { const s = await runnerEvent('status'); return s && s.lastRun ? Number(s.lastRun) : null; } catch { return null; }
  },
  async status() { if (!isNative) return null; try { return await runnerEvent('status'); } catch { return null; } },
  /** New job ids found in the background since the last call: [{ campaignId, label, jobIds, at }]. */
  async consumePending() { if (!isNative) return []; try { const r = await runnerEvent('consumePending'); return (r && r.pending) || []; } catch { return []; } },
  async runNow() { if (!isNative) return null; try { return await runnerEvent('checkJobs', { manual: true }); } catch { return null; } },
  /** Call on sign-out: forgets the token and queries. */
  async unregister() { if (!isNative) return; await swallow(runnerEvent('clear')); },
};

// ---------------------------------------------------------------- haptics
const vib = (ms) => { try { if (navigator.vibrate) navigator.vibrate(ms); } catch { /* */ } };
export const haptics = {
  tap() { if (isNative) swallow(Haptics.impact({ style: ImpactStyle.Light })); else vib(8); },
  success() { if (isNative) swallow(Haptics.notification({ type: NotificationType.Success })); else vib([10, 40, 10]); },
  warning() { if (isNative) swallow(Haptics.notification({ type: NotificationType.Warning })); else vib([30, 60, 30]); },
};

// ---------------------------------------------------------------- external links + files
export async function openExternal(url) {
  if (!url || !/^https?:\/\//i.test(url)) return;
  if (isNative) { await Browser.open({ url, presentationStyle: 'popover' }); return; }
  window.open(url, '_blank', 'noopener,noreferrer');
}

function toB64(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(s);
}
/** Native: writes to the app cache and opens the share sheet (Save to Files / Drive / mail…). Web: download. */
export async function saveFile({ name, bytes, mime = 'application/octet-stream' } = {}) {
  const data = bytes instanceof Uint8Array ? bytes : typeof bytes === 'string' ? new TextEncoder().encode(bytes) : new Uint8Array(bytes || []);
  const safe = String(name || 'file').replace(/[\\/:*?"<>|\u0000-\u001f]+/g, '_').slice(0, 120) || 'file';
  if (isNative) {
    const w = await Filesystem.writeFile({ path: `exports/${safe}`, data: toB64(data), directory: Directory.Cache, recursive: true });
    try { await Share.share({ title: safe, files: [w.uri], dialogTitle: 'Save or share' }); } catch (e) {
      if (!/cancel/i.test(String(e && e.message || e))) throw e;
    }
    return;
  }
  const url = URL.createObjectURL(new Blob([data], { type: mime }));
  const a = document.createElement('a');
  a.href = url; a.download = safe; a.rel = 'noopener';
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}
