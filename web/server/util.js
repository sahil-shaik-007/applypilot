// Small security-sensitive helpers: random tokens, hashing, constant-time comparison, cookies,
// input validation and a monotonic clock for sync cursors.
import crypto from 'node:crypto';

export const NAME_RE = /^[a-zA-Z0-9_-]{1,64}$/;
export const LINK_ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ'; // no 0/O, 1/I/L
export const LINK_CODE_LENGTH = 8;

export class HttpError extends Error {
  constructor(status, message, extra) {
    super(message);
    this.status = status;
    this.extra = extra;
  }
}

export const b64u = (buf) => Buffer.from(buf).toString('base64url');
/** 256-bit random token, base64url. */
export const randomToken = () => b64u(crypto.randomBytes(32));
/** 128-bit random id, base64url (22 chars, matches NAME_RE). */
export const randomId = () => b64u(crypto.randomBytes(16));
/** SHA-256 hex digest of a token; the only form in which secrets are stored. */
export const sha256 = (s) => crypto.createHash('sha256').update(String(s), 'utf8').digest('hex');

/** Constant-time string equality (hashes both sides first so lengths never leak). */
export function safeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const ha = crypto.createHash('sha256').update(a).digest();
  const hb = crypto.createHash('sha256').update(b).digest();
  return crypto.timingSafeEqual(ha, hb) && a.length === b.length;
}

/** CSRF token derived from (and bound to) the session token; cannot be inverted to the session token. */
export const csrfFor = (sessionToken) => b64u(crypto.createHash('sha256').update(`ap-csrf-v1:${sessionToken}`).digest());

export function newLinkCode() {
  let out = '';
  for (let i = 0; i < LINK_CODE_LENGTH; i++) out += LINK_ALPHABET[crypto.randomInt(LINK_ALPHABET.length)];
  return out;
}
/** Accepts "abcd-efgh", " ABCD EFGH " etc. Returns the canonical code or null if malformed. */
export function normalizeLinkCode(input) {
  if (typeof input !== 'string' || input.length > 32) return null;
  const c = input.toUpperCase().replace(/[\s-]/g, '');
  if (c.length !== LINK_CODE_LENGTH) return null;
  for (const ch of c) if (!LINK_ALPHABET.includes(ch)) return null;
  return c;
}

export function parseCookies(header) {
  const out = Object.create(null);
  if (!header) return out;
  for (const part of String(header).split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    const k = part.slice(0, i).trim();
    if (!k || k in out) continue; // first occurrence wins (most specific path)
    let v = part.slice(i + 1).trim();
    if (v.startsWith('"') && v.endsWith('"')) v = v.slice(1, -1);
    try { out[k] = decodeURIComponent(v); } catch { out[k] = v; }
  }
  return out;
}

export function assertName(value, what) {
  if (typeof value !== 'string' || !NAME_RE.test(value)) throw new HttpError(400, `Invalid ${what}`);
  return value;
}

export function isPlainObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v) && (Object.getPrototypeOf(v) === Object.prototype || Object.getPrototypeOf(v) === null);
}

/** Strips control characters and trims; returns '' for non-strings. */
export function cleanText(v, max) {
  if (typeof v !== 'string') return '';
  return v.replace(CONTROL_CHARS, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
}
// C0 controls, DEL, and the JS line/paragraph separators (U+2028/2029).
// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = new RegExp(`[\\x00-\\x1f\\x7f${String.fromCharCode(0x2028, 0x2029)}]`, 'g');

/**
 * Monotonic millisecond clock for sync cursors. Every write gets a timestamp strictly greater than any
 * cursor previously handed out, so `GET /api/items?since=<now>` never misses a write (single process).
 */
export function createClock(nowFn = Date.now) {
  let last = 0;
  return {
    peek() { last = Math.max(nowFn(), last); return last; },
    tick() { last = Math.max(nowFn(), last + 1); return last; },
  };
}
