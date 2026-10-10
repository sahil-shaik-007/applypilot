// Secrets on the device. Everything secret lives in the platform keystore through
// @capgo/capacitor-native-biometric (Android Keystore / iOS Keychain), never in Preferences or localStorage:
//   - the native session token (Authorization: Bearer ...), stored without a biometric gate so the app
//     can talk to the server at launch;
//   - the vault DEK for "biometric unlock", stored with AccessControl.BIOMETRY_CURRENT_SET so the
//     keystore itself refuses to release it without a live biometric check (invalidated when the
//     enrolled biometrics change).
// Preferences only ever holds non-secret settings (the API base URL, a "biometric enabled" flag).
import { Capacitor } from '@capacitor/core';
import { Preferences } from '@capacitor/preferences';
import { NativeBiometric, AccessControl } from '@capgo/capacitor-native-biometric';

export const isNative = Capacitor.isNativePlatform();
const APP_ID = 'com.applypilot.app';
const TOKEN_SERVER = `${APP_ID}.session`;
const DEK_SERVER = `${APP_ID}.dek`;
const PREF_API = 'ap.apiBase';
const PREF_BIO = 'ap.biometric';

/** Production cloud URL used by the apps unless changed in Settings (or VITE_AP_API_BASE at build time). */
export const DEFAULT_API_BASE = (import.meta.env && import.meta.env.VITE_AP_API_BASE) || 'https://app.applypilot.app';

let apiBaseCache = isNative ? DEFAULT_API_BASE : '';
let tokenCache; // undefined = not loaded yet, null = none
let tokenLoading = null;

const b64 = (bytes) => { let s = ''; for (const x of bytes) s += String.fromCharCode(x); return btoa(s); };
const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

// ---------------------------------------------------------------- API base
export function apiBase() { return isNative ? apiBaseCache : ''; }

export async function setApiBase(url) {
  if (!isNative) return '';
  const u = String(url || '').trim().replace(/\/+$/, '');
  if (u && !/^https:\/\/[^/\s]+$/.test(u) && !/^http:\/\/(localhost|127\.0\.0\.1|10\.0\.2\.2|192\.168\.\d+\.\d+)(:\d+)?$/.test(u)) {
    throw new Error('Server URL must be an https:// origin (http:// is allowed only for a local dev server).');
  }
  apiBaseCache = u || DEFAULT_API_BASE;
  await Preferences.set({ key: PREF_API, value: apiBaseCache });
  return apiBaseCache;
}

export async function loadConfig() {
  if (!isNative) return;
  try { const { value } = await Preferences.get({ key: PREF_API }); if (value) apiBaseCache = value; } catch { /* default */ }
  await loadToken();
}

// ---------------------------------------------------------------- session token
async function loadToken() {
  if (!isNative) return null;
  if (tokenCache !== undefined) return tokenCache;
  if (!tokenLoading) {
    tokenLoading = (async () => {
      try {
        const { isSaved } = await NativeBiometric.isCredentialsSaved({ server: TOKEN_SERVER });
        if (!isSaved) return null;
        const c = await NativeBiometric.getCredentials({ server: TOKEN_SERVER });
        return c && c.password ? c.password : null;
      } catch { return null; }
    })().then((t) => { tokenCache = t; tokenLoading = null; return t; });
  }
  return tokenLoading;
}

export const auth = {
  async getToken() { return loadToken(); },
  async setToken(token) {
    if (!isNative) return;
    if (!/^[A-Za-z0-9_-]{20,200}$/.test(String(token || ''))) throw new Error('Invalid session token');
    await NativeBiometric.setCredentials({ username: 'session', password: token, server: TOKEN_SERVER, accessControl: AccessControl.NONE });
    tokenCache = token;
  },
  async clearToken() {
    tokenCache = null;
    if (!isNative) return;
    try { await NativeBiometric.deleteCredentials({ server: TOKEN_SERVER }); } catch { /* nothing saved */ }
  },
};

export async function authHeaders() {
  if (!isNative) return {};
  const t = await loadToken();
  return t ? { Authorization: `Bearer ${t}` } : {};
}

// ---------------------------------------------------------------- biometric unlock (DEK in keystore)
export const biometric = {
  async available() {
    if (!isNative) return false;
    try { const r = await NativeBiometric.isAvailable({ useFallback: false }); return !!(r && r.isAvailable); } catch { return false; }
  },
  async isEnabled() {
    if (!isNative) return false;
    try {
      const [{ value }, { isSaved }] = await Promise.all([Preferences.get({ key: PREF_BIO }), NativeBiometric.isCredentialsSaved({ server: DEK_SERVER })]);
      return value === '1' && isSaved;
    } catch { return false; }
  },
  /** Stores the raw 32-byte DEK behind a biometric-bound keystore key. `userId` binds it to one account. */
  async enable(dekRawBytes, { userId = '' } = {}) {
    if (!isNative) return false;
    const raw = dekRawBytes instanceof Uint8Array ? dekRawBytes : new Uint8Array(dekRawBytes || []);
    if (raw.length !== 32) throw new Error('Expected the 32-byte vault key');
    if (!(await biometric.available())) throw new Error('Biometric unlock is not available on this device.');
    await NativeBiometric.setCredentials({
      username: String(userId || 'vault'), password: b64(raw), server: DEK_SERVER,
      accessControl: AccessControl.BIOMETRY_CURRENT_SET, authValidityDuration: 0,
      title: 'Turn on biometric unlock', negativeButtonText: 'Cancel',
    });
    raw.fill(0);
    await Preferences.set({ key: PREF_BIO, value: '1' });
    return true;
  },
  /** Prompts for biometrics and returns the DEK bytes, or null (cancelled, changed biometrics, not set up). */
  async unlock({ userId } = {}) {
    if (!isNative) return null;
    try {
      const c = await NativeBiometric.getSecureCredentials({ server: DEK_SERVER, reason: 'Unlock your ApplyPilot vault', title: 'Unlock ApplyPilot', negativeButtonText: 'Use passphrase' });
      if (!c || !c.password) return null;
      if (userId && c.username && c.username !== String(userId)) return null;
      const bytes = unb64(c.password);
      return bytes.length === 32 ? bytes : null;
    } catch (e) {
      // Biometrics changed / key invalidated: forget the stale entry so the user re-enables it.
      if (/invalid|permanently|KeyPermanentlyInvalidated|not found/i.test(String(e && (e.message || e.code)))) await biometric.disable();
      return null;
    }
  },
  async disable() {
    if (!isNative) return;
    try { await NativeBiometric.deleteCredentials({ server: DEK_SERVER }); } catch { /* none */ }
    try { await Preferences.remove({ key: PREF_BIO }); } catch { /* */ }
  },
};
