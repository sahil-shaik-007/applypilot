// Bridge to the native layer (src/native/index.js, owned by mobile-native; see docs/MOBILE.md).
// The module is loaded lazily through import.meta.glob so the PWA build never breaks while it doesn't
// exist yet, and every call has a browser fallback. Features call `nat()` and feature-check.
//
// Test hook: when the server runs with dev login (AP_DEV_LOGIN=1, never in production) an e2e test
// may install `window.__AP_NATIVE_STUB__` (same shape as the contract) to exercise the in-app apply
// flow without a phone. It is ignored otherwise.
import { useSyncExternalStore } from 'react';
import { downloadFile } from '../components/ui.jsx';
import { applyInBrowser, detectExtension, extReady, extSnapshot, subscribeExt } from '../native/webExt.js';

const loaders = import.meta.glob('../native/index.js');
let mod = null;
let loading = null;
let testMode = false;

export function setTestMode(on) { testMode = !!on; }
export function isTestMode() { return testMode; }

const FALLBACK = {
  isNative: false,
  platform: 'web',
  async applyInApp() { throw new Error('In-app auto-fill needs the ApplyPilot phone app.'); },
  notifications: { async requestPermission() { return false; }, async notify() {}, onTap() { return () => {}; } },
  background: { async register() {}, async lastRun() { return null; } },
  haptics: { tap() {}, success() {}, warning() {} },
  share: { onIncoming() { return () => {}; } },
  async openExternal(url) { if (url && /^https?:\/\//i.test(url)) window.open(url, '_blank', 'noopener,noreferrer'); },
  async saveFile({ name, bytes, mime }) { downloadFile(name, bytes, mime); },
};

/** Loads the native module once (no-op on the web). Safe to call many times. */
export function loadNative() {
  if (mod) return Promise.resolve(mod);
  if (!loading) {
    const load = loaders['../native/index.js'];
    loading = (load ? load().then((m) => m || {}, () => ({})) : Promise.resolve({})).then((m) => { mod = m; return m; });
  }
  return loading;
}
loadNative();

/** The native API merged over browser fallbacks (sync; before the module has loaded you get fallbacks). */
export function nat() {
  const stub = testMode && typeof window !== 'undefined' ? window.__AP_NATIVE_STUB__ : null;
  const m = stub || mod || {};
  // A desktop browser with the ApplyPilot extension connected fills forms through it ("Apply in browser").
  const viaExtension = !m.isNative && extReady() ? { applyInApp: applyInBrowser } : {};
  return {
    ...FALLBACK,
    ...m,
    ...viaExtension,
    notifications: { ...FALLBACK.notifications, ...(m.notifications || {}) },
    background: { ...FALLBACK.background, ...(m.background || {}) },
    haptics: { ...FALLBACK.haptics, ...(m.haptics || {}) },
    share: { ...FALLBACK.share, ...(m.share || {}) },
  };
}

/** True when jobs can be auto-filled from here: the phone app (or the e2e stub), or a desktop browser whose extension is connected. */
export function canApplyInApp() { const n = nat(); return !!((n.isNative || extReady()) && typeof n.applyInApp === 'function'); }

/** How applying works on this device: 'app' (phone app WebView), 'browser' (extension) or 'none' (send to the PC / copy fields). */
export function applyTarget() { const n = nat(); return n.isNative && typeof n.applyInApp === 'function' ? 'app' : extReady() ? 'browser' : 'none'; }

/** applyTarget() that re-renders when the extension is found or lost. */
export function useApplyTarget() {
  useSyncExternalStore(subscribeExt, extSnapshot, extSnapshot);
  return applyTarget();
}

export { detectExtension, extSnapshot, subscribeExt };

export async function notify(title, body, data) { try { await nat().notifications.notify({ title, body, data }); } catch { /* best effort */ } }
export function haptic(kind = 'tap') { try { const h = nat().haptics; (h[kind] || h.tap)(); } catch { /* ignore */ } }
export async function saveBytes(name, bytes, mime) { return nat().saveFile({ name, bytes, mime }); }
export async function openUrl(url) {
  if (!url || !/^https?:\/\//i.test(url)) return false;
  await nat().openExternal(url);
  return true;
}
