// Thin fetch wrapper for the ApplyPilot API (docs/CLOUD.md).
// - Session auth is the HttpOnly `__Host-ap_session` cookie (sent automatically, same origin).
// - CSRF: double-submit token. The readable `ap_csrf` cookie is echoed as `X-CSRF-Token` on every
//   non-GET request.
// - Errors: the server returns `{ error }`; we throw an Error with `.status` and `.data`.

// [mobile-native] In the iOS/Android apps requests go to the configured cloud URL with a keystore-held
// bearer token instead of the cookie session (see src/native/secure.js, docs/MOBILE.md).
import { isNative as NATIVE, apiBase, authHeaders, auth as nativeAuth } from '../native/secure.js';
// [/mobile-native]

export const CSRF_COOKIE = 'ap_csrf';
export const CSRF_HEADER = 'X-CSRF-Token';

export function readCookie(name) {
  const m = document.cookie.match(new RegExp(`(?:^|;\\s*)${name.replace(/[-.]/g, '\\$&')}=([^;]*)`));
  return m ? decodeURIComponent(m[1]) : '';
}

export class ApiError extends Error {
  constructor(message, status, data) { super(message); this.status = status; this.data = data; }
}

let onUnauthorized = null;
export function setUnauthorizedHandler(fn) { onUnauthorized = fn; }

export async function api(path, { method = 'GET', body, raw = false, headers = {}, signal, binary = false } = {}) {
  const h = { Accept: binary ? 'application/octet-stream' : 'application/json', ...headers };
  const m = method.toUpperCase();
  if (m !== 'GET' && m !== 'HEAD') {
    const t = readCookie(CSRF_COOKIE);
    if (t) h[CSRF_HEADER] = t;
  }
  // [mobile-native] bearer auth; sign-in asks the server for a token instead of cookies
  let sendBody = body;
  if (NATIVE) {
    Object.assign(h, await authHeaders());
    if (m === 'POST' && /^\/auth\/(google|dev)$/.test(path) && body && typeof body === 'object') sendBody = { ...body, client: 'native' };
  }
  // [/mobile-native]
  let payload = sendBody;
  if (sendBody !== undefined && !raw) { h['Content-Type'] = 'application/json'; payload = JSON.stringify(sendBody); }
  if (raw) h['Content-Type'] = 'application/octet-stream';
  let res;
  try {
    res = await fetch(`${apiBase()}/api${path}`, { method: m, headers: h, body: payload, credentials: NATIVE ? 'omit' : 'same-origin', cache: 'no-store', signal }); // [mobile-native] apiBase() is '' on the web
  } catch (e) {
    if (e.name === 'AbortError') throw e;
    throw new ApiError('You appear to be offline. Check your connection and try again.', 0);
  }
  const ct = res.headers.get('content-type') || '';
  if (!res.ok) {
    let data = null;
    try { data = ct.includes('json') ? await res.json() : { error: await res.text() }; } catch { /* ignore */ }
    if (NATIVE && ((res.status === 401 && !path.startsWith('/auth/')) || /^\/auth\/logout/.test(path))) await nativeAuth.clearToken(); // [mobile-native]
    if (res.status === 401 && onUnauthorized && !path.startsWith('/auth/')) onUnauthorized();
    const msg = (data && data.error) || (res.status === 429 ? 'Too many requests. Wait a moment and try again.' : `Request failed (${res.status})`);
    throw new ApiError(String(msg).slice(0, 300), res.status, data);
  }
  if (binary) return new Uint8Array(await res.arrayBuffer());
  if (res.status === 204) return null;
  if (ct.includes('json')) {
    const data = await res.json();
    // [mobile-native] keep the native session token in the keystore; drop it on sign-out
    if (NATIVE && /^\/auth\/(google|dev)$/.test(path) && data && data.token) { await nativeAuth.setToken(data.token); delete data.token; }
    if (NATIVE && /^\/auth\/logout(-all)?$/.test(path)) await nativeAuth.clearToken();
    // [/mobile-native]
    return data;
  }
  return res.text();
}

export const get = (p, o) => api(p, { ...o, method: 'GET' });
export const post = (p, body, o) => api(p, { ...o, method: 'POST', body });
export const put = (p, body, o) => api(p, { ...o, method: 'PUT', body });
export const del = (p, body, o) => api(p, { ...o, method: 'DELETE', body });
