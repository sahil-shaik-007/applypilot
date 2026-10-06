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
};

function bool(v) { return v === '1' || v === 'true'; }

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
  const config = {
    production,
    devLogin: devLoginRequested && !production,
    port,
    appOrigin,
    googleClientId: env.GOOGLE_CLIENT_ID || '',
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
