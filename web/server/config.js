// Configuration from environment variables, with hard safety assertions.
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
export const SERVER_DIR = here;
export const WEB_DIR = path.resolve(here, '..');
export const REPO_DIR = path.resolve(here, '..', '..');

const pkg = JSON.parse(fs.readFileSync(path.join(WEB_DIR, 'package.json'), 'utf8'));
export const VERSION = pkg.version;

const KB = 1024;
const MB = 1024 * KB;

/** Fixed limits from docs/CLOUD.md. Tests may override some of them. */
export const DEFAULT_LIMITS = {
  jsonBody: 300 * KB, // max JSON request body
  record: 256 * KB, // max item ciphertext length
  vaultDoc: 64 * KB, // max serialized vault document
  blob: 6 * MB, // max single blob
  quota: 60 * MB, // per-user total (vault + items + blobs)
  sessionTtlMs: 30 * 24 * 3600 * 1000, // 30-day sliding expiry
  sessionRefreshMs: 60 * 60 * 1000, // extend the sliding window at most once an hour
  deviceIdleTtlMs: 180 * 24 * 3600 * 1000, // device tokens unused for 180 days stop working
  linkCodeTtlMs: 10 * 60 * 1000, // 10 minutes
  searchCacheTtlMs: 15 * 60 * 1000,
  searchCacheMax: 300,
  searchConnectorTimeoutMs: 25000,
  searchMaxJobs: 500,
  searchMaxDescription: 8000,
  smallJsonBody: 16 * KB, // max JSON body for auth, devices, watchlist, push and history endpoints
  // Cloud watchlist (opt-in plaintext job queries; see docs/CLOUD.md "Cloud watchlist").
  watchMaxPerUser: 10,
  watchIntervalMs: 60 * 60 * 1000, // each distinct query runs once an hour
  watchIntervalJitterMs: 5 * 60 * 1000, // +0..5 min so queries spread out instead of firing together
  watchTickMs: 60 * 1000, // how often the scheduler looks for due queries
  watchGapMs: 4000, // minimum pause between two scheduled searches (shared queue, all users)
  watchGapJitterMs: 4000, // +0..4 s random extra pause
  watchMaxRunsPerHour: 120, // global cap on scheduled searches per rolling hour (source politeness)
  watchFailureBackoffMs: 2 * 60 * 60 * 1000, // a query whose sources all failed waits 2 h
  watchNewPerUserMax: 500, // keep at most this many "new" rows per user
  watchNewTtlMs: 14 * 24 * 3600 * 1000, // and drop them after 14 days
  watchNewPerRunMax: 50, // at most this many new jobs per query run per user
  watchSeenTtlMs: 45 * 24 * 3600 * 1000, // per-query "already reported" memory
  historyTtlMs: 365 * 24 * 3600 * 1000, // job first-seen history (public ids only)
  historyMaxIds: 200, // ids per GET /api/jobs/history request
  historyObservationGapMs: 30 * 60 * 1000, // timesSeen counts observations at least 30 min apart
  // Push.
  pushMaxPerUser: 10, // web push subscriptions + native tokens per user
  pushMinIntervalMs: 30 * 60 * 1000, // at most one "new matches" push per user per 30 min
  pushTimeoutMs: 10000,
};

/** Rate limits: [max requests, window ms]. */
export const DEFAULT_RATE_LIMITS = {
  api: [3000, 5 * 60 * 1000], // per IP, whole API
  auth: [20, 15 * 60 * 1000], // per IP, sign-in endpoints
  linkCode: [10, 60 * 60 * 1000], // per user
  redeem: [10, 15 * 60 * 1000], // per IP
  redeemGlobal: [300, 15 * 60 * 1000], // all IPs together: caps distributed guessing
  search: [20, 60 * 1000], // per user
  writes: [1200, 60 * 1000], // per user (initial desktop sync pushes many records)
  watchlist: [60, 15 * 60 * 1000], // per user, watchlist writes
  history: [60, 60 * 1000], // per user, ghost-job history lookups
  push: [30, 15 * 60 * 1000], // per user, push (un)subscribe
};

/** Capacitor WebView origins (iOS, Android https scheme, Android http scheme in dev). */
export const DEFAULT_NATIVE_ORIGINS = ['capacitor://localhost', 'https://localhost', 'http://localhost'];

/** Hosts a Web Push endpoint may point at (the server POSTs to it, so this is an SSRF guard). */
export const DEFAULT_PUSH_HOSTS = [
  'fcm.googleapis.com', 'android.googleapis.com', // Chrome, Edge (FCM), Samsung, Opera
  '*.push.services.mozilla.com', // Firefox
  '*.push.apple.com', // Safari / iOS PWA
  '*.notify.windows.com', // legacy Edge / WNS
];

function bool(v) { return v === '1' || v === 'true'; }

const list = (v) => (typeof v === 'string' ? v.split(',').map((x) => x.trim()).filter(Boolean) : []);
const CLIENT_ID_RE = /^[A-Za-z0-9._-]{1,200}$/;

/** Reads a secret that may be given inline or as a path to a file (e.g. a mounted secret). */
function inlineOrFile(v) {
  if (!v) return '';
  const t = v.trim();
  if (t.startsWith('{')) return t; // inline JSON (its own "\n" escapes are handled by JSON.parse)
  if (t.startsWith('-----BEGIN')) return t.replace(/\\n/g, '\n'); // PEM squeezed onto one env line
  try { return fs.readFileSync(t, 'utf8').trim(); } catch { throw new Error('Secret env var is neither inline content nor a readable file path'); }
}

function parseOrigins(raw) {
  const out = [];
  for (const o of raw) {
    const v = o.replace(/\/+$/, '');
    if (!/^(capacitor|ionic|https?):\/\/[A-Za-z0-9.-]+(:\d{1,5})?$/.test(v)) throw new Error(`APP_NATIVE_ORIGINS: invalid origin ${JSON.stringify(o)}`);
    out.push(v);
  }
  return [...new Set(out)];
}

function pushConfig(env) {
  const vapid = (env.VAPID_PUBLIC_KEY || env.VAPID_PRIVATE_KEY)
    ? { publicKey: env.VAPID_PUBLIC_KEY || '', privateKey: env.VAPID_PRIVATE_KEY || '' }
    : null;
  if (vapid && (!vapid.publicKey || !vapid.privateKey)) throw new Error('Set both VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY (or neither to auto-generate)');
  const subject = env.VAPID_SUBJECT || '';
  if (subject && !/^(mailto:[^\s@]+@[^\s@]+|https:\/\/\S+)$/.test(subject)) throw new Error('VAPID_SUBJECT must be a mailto: address or https: URL');
  let fcm = null;
  if (env.FCM_SERVICE_ACCOUNT) {
    let sa;
    try { sa = JSON.parse(inlineOrFile(env.FCM_SERVICE_ACCOUNT)); } catch { throw new Error('FCM_SERVICE_ACCOUNT is not valid service-account JSON'); } // never echo the secret
    if (!sa.client_email || !sa.private_key) throw new Error('FCM_SERVICE_ACCOUNT must contain client_email and private_key');
    const projectId = env.FCM_PROJECT_ID || sa.project_id;
    if (!projectId || !/^[a-z0-9-]{4,63}$/.test(projectId)) throw new Error('FCM project id missing or invalid (set FCM_PROJECT_ID)');
    fcm = { serviceAccount: sa, projectId };
  }
  let apns = null;
  if (env.APNS_KEY_ID || env.APNS_PRIVATE_KEY) {
    const keyId = env.APNS_KEY_ID || '';
    const teamId = env.APNS_TEAM_ID || '';
    const bundleId = env.APNS_BUNDLE_ID || '';
    const privateKey = inlineOrFile(env.APNS_PRIVATE_KEY);
    if (!/^[A-Z0-9]{10}$/.test(keyId) || !/^[A-Z0-9]{10}$/.test(teamId)) throw new Error('APNS_KEY_ID and APNS_TEAM_ID must be 10-character Apple ids');
    if (!/^[A-Za-z0-9.-]{3,155}$/.test(bundleId)) throw new Error('APNS_BUNDLE_ID is required (e.g. app.applypilot.mobile)');
    if (!privateKey.includes('PRIVATE KEY')) throw new Error('APNS_PRIVATE_KEY must be the .p8 key (PEM content or file path)');
    apns = { keyId, teamId, bundleId, privateKey, production: bool(env.APNS_PRODUCTION) };
  }
  return { vapid, subject, fcm, apns, hosts: env.PUSH_ENDPOINT_HOSTS ? list(env.PUSH_ENDPOINT_HOSTS) : [...DEFAULT_PUSH_HOSTS] };
}

/**
 * Builds the config object. Throws on unsafe combinations, most importantly dev login in production.
 * @param {Record<string,string|undefined>} env
 */
export function loadConfig(env = process.env, overrides = {}) {
  const production = env.NODE_ENV === 'production';
  const devLoginRequested = bool(env.AP_DEV_LOGIN);
  if (production && devLoginRequested) {
    throw new Error('Refusing to start: AP_DEV_LOGIN must never be enabled when NODE_ENV=production');
  }
  const appOrigin = (env.APP_ORIGIN || (production ? '' : 'http://localhost:5174')).replace(/\/+$/, '');
  if (production) {
    if (!appOrigin) throw new Error('Refusing to start: APP_ORIGIN is required in production');
    if (!/^https:\/\/[^/]+$/.test(appOrigin)) throw new Error('Refusing to start: APP_ORIGIN must be an https:// origin in production');
  } else if (!/^https?:\/\/[^/]+$/.test(appOrigin)) {
    throw new Error('APP_ORIGIN must be an origin like http://localhost:5174 (no path)');
  }
  const port = Number(env.PORT || 8787);
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('Invalid PORT');
  const trustProxy = env.TRUST_PROXY !== undefined ? Number(env.TRUST_PROXY) : (production ? 1 : 0);
  // GOOGLE_CLIENT_ID is the web client (returned by /api/config). GOOGLE_CLIENT_IDS adds more accepted
  // ID-token audiences (Android / iOS OAuth clients). Every entry is an exact-match allow-list item.
  const googleClientIds = [...new Set([env.GOOGLE_CLIENT_ID || '', ...list(env.GOOGLE_CLIENT_IDS)].filter(Boolean))];
  for (const id of googleClientIds) if (!CLIENT_ID_RE.test(id)) throw new Error('GOOGLE_CLIENT_ID(S): invalid client id');
  if (googleClientIds.length > 10) throw new Error('GOOGLE_CLIENT_IDS: at most 10 client ids');
  const nativeOrigins = parseOrigins(env.APP_NATIVE_ORIGINS !== undefined ? list(env.APP_NATIVE_ORIGINS) : DEFAULT_NATIVE_ORIGINS);
  if (nativeOrigins.includes(appOrigin)) throw new Error('APP_NATIVE_ORIGINS must not contain APP_ORIGIN');
  const config = {
    production,
    devLogin: devLoginRequested && !production,
    port,
    appOrigin,
    googleClientId: googleClientIds[0] || '',
    googleClientIds,
    nativeOrigins,
    push: pushConfig(env),
    watchEnabled: env.AP_WATCH_SCHEDULER !== '0',
    databasePath: path.resolve(env.DATABASE_PATH || path.join(SERVER_DIR, 'data', 'applypilot.db')),
    clientDist: path.resolve(env.CLIENT_DIST || path.join(WEB_DIR, 'client', 'dist')),
    trustProxy: Number.isFinite(trustProxy) ? trustProxy : 0,
    version: VERSION,
    log: true,
    limits: { ...DEFAULT_LIMITS },
    rateLimits: { ...DEFAULT_RATE_LIMITS },
    ...overrides,
  };
  if (overrides.limits) config.limits = { ...DEFAULT_LIMITS, ...overrides.limits };
  if (overrides.rateLimits) config.rateLimits = { ...DEFAULT_RATE_LIMITS, ...overrides.rateLimits };
  assertConfigSafe(config);
  return config;
}

/** Re-checked by createApp so a hand-built config can't sneak dev login into production. */
export function assertConfigSafe(config) {
  if (config.production && config.devLogin) {
    throw new Error('Refusing to start: dev login cannot be enabled in production');
  }
  if (process.env.NODE_ENV === 'production' && config.devLogin) {
    throw new Error('Refusing to start: dev login cannot be enabled when NODE_ENV=production');
  }
}
