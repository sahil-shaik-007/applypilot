// Test harness: real HTTP server on an ephemeral port, temp SQLite file, stubbed Google + job sources.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { loadConfig } from '../config.js';
import { startServer } from '../app.js';

export const ORIGIN = 'http://localhost:5174';
export const CLIENT_ID = 'test-client-id.apps.googleusercontent.com';

/** Stand-in for google-auth-library: tokens look like "good:<sub>:<email>" etc. */
export function fakeGoogleVerifier(calls = []) {
  return async (idToken, audience) => {
    calls.push({ idToken, audience });
    const [kind, sub, email, extra] = idToken.split(':');
    const base = { iss: 'https://accounts.google.com', aud: audience, sub, email, email_verified: true, name: 'Test User', picture: 'https://lh3.googleusercontent.com/a/x', exp: Math.floor(Date.now() / 1000) + 3600 };
    if (kind === 'good') return base;
    // "aud:<sub>:<email>:<audience>": a token minted for a specific OAuth client (e.g. the iOS app). Like the real
    // library, the verifier rejects it unless that audience is in the allow-list it was given.
    if (kind === 'aud') {
      const allowed = Array.isArray(audience) ? audience : [audience];
      if (!allowed.includes(extra)) throw new Error('Wrong recipient, payload audience != requiredAudience');
      return { ...base, aud: extra };
    }
    if (kind === 'unverified') return { ...base, email_verified: false };
    if (kind === 'wrongaud') return { ...base, aud: 'someone-else.apps.googleusercontent.com' };
    if (kind === 'wrongiss') return { ...base, iss: 'https://evil.example' };
    throw new Error('Invalid token signature');
  };
}

/** Stub of electron/connectors/index.js. */
export function fakeAggregator(calls = []) {
  return {
    listConnectors: () => [
      { id: 'remotive', name: 'Remotive', requiresKeys: [], ready: true },
      { id: 'arbeitnow', name: 'Arbeitnow', requiresKeys: [], ready: true },
      { id: 'adzuna', name: 'Adzuna', requiresKeys: ['adzunaAppId'], ready: false },
    ],
    searchAll: async (params, opts) => {
      calls.push({ params, opts });
      return {
        jobs: [
          { id: 'remotive:1', source: 'remotive', title: `${params.query || 'Any'} Engineer`, company: 'Acme', description: 'x'.repeat(10000), url: 'https://example.com/1' },
          { id: 'arbeitnow:2', source: 'arbeitnow', title: 'Data Analyst', company: 'Globex', description: 'short', url: 'https://example.com/2' },
        ],
        stats: [{ id: 'remotive', name: 'Remotive', count: 1, ms: 5 }, { id: 'arbeitnow', name: 'Arbeitnow', count: 1, ms: 7, error: 'HTTP 500' }],
      };
    },
  };
}

export function tempDbPath() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ap-cloud-test-'));
  return path.join(dir, 'test.db');
}

/**
 * @param {{ env?, overrides?, deps? }} opts
 */
export async function startTestServer({ env = {}, overrides = {}, deps = {} } = {}) {
  const dbPath = tempDbPath();
  const config = loadConfig({
    NODE_ENV: 'test', AP_DEV_LOGIN: '1', APP_ORIGIN: ORIGIN, GOOGLE_CLIENT_ID: CLIENT_ID, DATABASE_PATH: dbPath, PORT: '0', AP_WATCH_SCHEDULER: '0', ...env,
  }, { log: false, ...overrides });
  const googleCalls = [];
  const searchCalls = [];
  const running = await startServer(config, {
    googleVerifier: fakeGoogleVerifier(googleCalls),
    aggregator: fakeAggregator(searchCalls),
    ...deps,
  });
  const t = {
    ...running,
    config,
    dbPath,
    googleCalls,
    searchCalls,
    client: (o) => new Client(running.url, o),
    /** Separate read-only connection for asserting on stored rows. */
    rawDb: () => new DatabaseSync(dbPath, { readOnly: true }),
    async stop() {
      await running.close();
      try { fs.rmSync(path.dirname(dbPath), { recursive: true, force: true }); } catch { /* Windows file locks */ }
    },
  };
  return t;
}

/** Minimal browser-like client: cookie jar, Origin header and CSRF double-submit by default. */
export class Client {
  constructor(base, { origin = ORIGIN } = {}) {
    this.base = base;
    this.origin = origin;
    this.jar = new Map();
    this.bearer = null;
  }
  cookieHeader() { return [...this.jar].map(([k, v]) => `${k}=${v}`).join('; '); }
  absorb(res) {
    for (const line of res.headers.getSetCookie()) {
      const [pair, ...attrs] = line.split(';');
      const i = pair.indexOf('=');
      const name = pair.slice(0, i).trim();
      const value = pair.slice(i + 1).trim();
      const expired = attrs.some((a) => /^\s*expires=Thu, 01 Jan 1970/i.test(a)) || attrs.some((a) => /^\s*max-age=0\s*$/i.test(a)) || value === '';
      if (expired) this.jar.delete(name); else this.jar.set(name, value);
    }
  }
  async req(method, p, { json, body, headers = {}, csrf = true, origin = true, raw = false } = {}) {
    const h = { ...headers };
    if (this.jar.size) h.cookie = this.cookieHeader();
    if (this.bearer) h.authorization = `Bearer ${this.bearer}`;
    if (origin && this.origin && method !== 'GET') h.origin = this.origin;
    if (csrf && method !== 'GET' && this.jar.get('ap_csrf')) h['x-csrf-token'] = this.jar.get('ap_csrf');
    let payload = body;
    if (json !== undefined) { payload = JSON.stringify(json); h['content-type'] = 'application/json'; }
    const res = await fetch(this.base + p, { method, headers: h, body: payload });
    this.absorb(res);
    const buf = Buffer.from(await res.arrayBuffer());
    let data = null;
    if (!raw && (res.headers.get('content-type') || '').includes('application/json')) data = JSON.parse(buf.toString('utf8'));
    return { status: res.status, headers: res.headers, json: data, buf, setCookies: res.headers.getSetCookie() };
  }
  get(p, o) { return this.req('GET', p, o); }
  post(p, json, o = {}) { return this.req('POST', p, { json, ...o }); }
  put(p, json, o = {}) { return this.req('PUT', p, { json, ...o }); }
  del(p, o = {}) { return this.req('DELETE', p, o); }
  async devLogin(email = 'alice@example.com') {
    const r = await this.post('/api/auth/dev', { email });
    if (r.status !== 200) throw new Error(`dev login failed: ${r.status} ${JSON.stringify(r.json)}`);
    return r.json.user;
  }
}
