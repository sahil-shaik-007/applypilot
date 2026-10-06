import test, { describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig } from '../config.js';
import { createApp } from '../app.js';
import { sha256, csrfFor } from '../util.js';
import { startTestServer, Client, ORIGIN, CLIENT_ID, tempDbPath } from './helpers.js';

const SERVER_INDEX = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'index.js');

describe('dev login gating', () => {
  test('config refuses AP_DEV_LOGIN=1 with NODE_ENV=production', () => {
    assert.throws(() => loadConfig({ NODE_ENV: 'production', AP_DEV_LOGIN: '1', APP_ORIGIN: 'https://app.example.com' }), /AP_DEV_LOGIN/);
  });

  test('createApp refuses a hand-built production config with devLogin', () => {
    const config = loadConfig({ NODE_ENV: 'production', APP_ORIGIN: 'https://app.example.com', DATABASE_PATH: tempDbPath() }, { log: false });
    assert.throws(() => createApp({ ...config, devLogin: true }), /dev login/);
  });

  test('server process exits non-zero when started with dev login in production', () => {
    const r = spawnSync(process.execPath, [SERVER_INDEX], {
      env: { ...process.env, NODE_ENV: 'production', AP_DEV_LOGIN: '1', APP_ORIGIN: 'https://app.example.com', DATABASE_PATH: tempDbPath(), PORT: '0' },
      encoding: 'utf8', timeout: 20000,
    });
    assert.equal(r.status, 1);
    assert.match(r.stderr, /Refusing to start/);
  });

  test('production refuses non-https APP_ORIGIN', () => {
    assert.throws(() => loadConfig({ NODE_ENV: 'production', APP_ORIGIN: 'http://app.example.com' }), /https/);
  });

  test('/api/auth/dev is 404 when AP_DEV_LOGIN is not set', async () => {
    const t = await startTestServer({ env: { AP_DEV_LOGIN: '' } });
    try {
      const c = t.client();
      const r = await c.post('/api/auth/dev', { email: 'a@example.com' });
      assert.equal(r.status, 404);
      assert.equal((await c.get('/api/config')).json.devLogin, false);
    } finally { await t.stop(); }
  });

  test('/api/auth/dev is 404 in a production config', async () => {
    const t = await startTestServer({ env: { AP_DEV_LOGIN: '', NODE_ENV: 'production', APP_ORIGIN: 'https://app.example.com' } });
    try {
      const c = t.client({ origin: 'https://app.example.com' });
      assert.equal((await c.post('/api/auth/dev', { email: 'a@example.com' })).status, 404);
    } finally { await t.stop(); }
  });
});

describe('sessions, cookies, CSRF and Origin', () => {
  let t;
  before(async () => { t = await startTestServer(); });
  after(async () => { await t.stop(); });

  test('/api/config exposes client id and dev-login flag', async () => {
    const r = await t.client().get('/api/config');
    assert.deepEqual(r.json, { googleClientId: CLIENT_ID, devLogin: true, version: t.config.version });
  });

  test('dev login sets hardened cookies', async () => {
    const c = t.client();
    const r = await c.post('/api/auth/dev', { email: 'Cookie@Example.com' });
    assert.equal(r.status, 200);
    assert.equal(r.json.user.email, 'cookie@example.com');
    const session = r.setCookies.find((s) => s.startsWith('__Host-ap_session='));
    const csrf = r.setCookies.find((s) => s.startsWith('ap_csrf='));
    assert.ok(session && csrf);
    assert.match(session, /; HttpOnly/i);
    assert.match(session, /; Secure/i);
    assert.match(session, /; SameSite=Lax/i);
    assert.match(session, /; Path=\/(;|$)/);
    assert.doesNotMatch(session, /Domain=/i);
    assert.match(session, /Max-Age=2592000/);
    assert.doesNotMatch(csrf, /HttpOnly/i);
    assert.match(csrf, /; Secure/i);
    const token = c.jar.get('__Host-ap_session');
    assert.equal(Buffer.from(token, 'base64url').length, 32, '256-bit session token');
    assert.equal(c.jar.get('ap_csrf'), csrfFor(token));
    // Only the hash is stored.
    const db = t.rawDb();
    const rows = db.prepare('SELECT token_hash FROM sessions').all();
    db.close();
    assert.ok(rows.some((x) => x.token_hash === sha256(token)));
    assert.ok(!rows.some((x) => x.token_hash.includes(token)));
  });

  test('GET /api/me requires auth and returns the user', async () => {
    const anon = t.client();
    const r0 = await anon.get('/api/me');
    assert.equal(r0.status, 401);
    assert.deepEqual(Object.keys(r0.json), ['error']);
    const c = t.client();
    const user = await c.devLogin('me@example.com');
    const r = await c.get('/api/me');
    assert.equal(r.status, 200);
    assert.deepEqual(r.json, { user, hasVault: false });
    assert.match(user.id, /^[A-Za-z0-9_-]{22}$/);
  });

  test('state-changing requests without CSRF header are rejected', async () => {
    const c = t.client();
    await c.devLogin('csrf@example.com');
    const r1 = await c.put('/api/items/qa/x1', { ciphertext: 'v1.a.b', baseVersion: null }, { csrf: false });
    assert.equal(r1.status, 403);
    assert.match(r1.json.error, /CSRF/);
    const r2 = await c.put('/api/items/qa/x1', { ciphertext: 'v1.a.b', baseVersion: null }, { csrf: false, headers: { 'x-csrf-token': 'wrong' } });
    assert.equal(r2.status, 403);
    // A self-consistent but forged cookie/header pair (cookie injection) is rejected: CSRF is bound to the session.
    c.jar.set('ap_csrf', 'forged-value-123');
    const r3 = await c.put('/api/items/qa/x1', { ciphertext: 'v1.a.b', baseVersion: null });
    assert.equal(r3.status, 403);
    // Restored, it works.
    c.jar.set('ap_csrf', csrfFor(c.jar.get('__Host-ap_session')));
    const r4 = await c.put('/api/items/qa/x1', { ciphertext: 'v1.a.b', baseVersion: null });
    assert.equal(r4.status, 200);
  });

  test('Origin must match APP_ORIGIN on cookie-authenticated writes', async () => {
    const c = t.client();
    await c.devLogin('origin@example.com');
    const missing = await c.put('/api/items/qa/o1', { ciphertext: 'v1.a.b', baseVersion: null }, { origin: false });
    assert.equal(missing.status, 403);
    const evil = await c.put('/api/items/qa/o1', { ciphertext: 'v1.a.b', baseVersion: null }, { headers: { origin: 'https://evil.example' }, origin: false });
    assert.equal(evil.status, 403);
    const crossSite = await c.put('/api/items/qa/o1', { ciphertext: 'v1.a.b', baseVersion: null }, { headers: { 'sec-fetch-site': 'cross-site' } });
    assert.equal(crossSite.status, 403);
    const ok = await c.put('/api/items/qa/o1', { ciphertext: 'v1.a.b', baseVersion: null });
    assert.equal(ok.status, 200);
  });

  test('sign-in endpoints require the app Origin (login CSRF)', async () => {
    const c = new Client(t.url, { origin: 'https://evil.example' });
    assert.equal((await c.post('/api/auth/dev', { email: 'x@example.com' })).status, 403);
    assert.equal((await c.post('/api/auth/google', { credential: 'good:sub-1:g@example.com:padding' })).status, 403);
    const none = new Client(t.url, { origin: null });
    assert.equal((await none.post('/api/auth/dev', { email: 'x@example.com' })).status, 403);
  });

  test('Google sign-in: verified token creates user + session; repeated sign-in reuses the user', async () => {
    const c = t.client();
    const r = await c.post('/api/auth/google', { credential: 'good:google-sub-42:Gina@Example.com:pad' });
    assert.equal(r.status, 200);
    assert.equal(r.json.user.email, 'gina@example.com');
    assert.equal(r.json.user.name, 'Test User');
    assert.equal(t.googleCalls.at(-1).audience, CLIENT_ID);
    assert.ok(c.jar.get('__Host-ap_session'));
    const c2 = t.client();
    const r2 = await c2.post('/api/auth/google', { credential: 'good:google-sub-42:gina@example.com:pad' });
    assert.equal(r2.json.user.id, r.json.user.id);
  });

  test('Google sign-in rejects unverified email, wrong audience/issuer and bad signatures', async () => {
    for (const cred of ['unverified:s1:u@example.com:pad', 'wrongaud:s2:w@example.com:pad', 'wrongiss:s3:i@example.com:pad', 'forged:s4:f@example.com:padding']) {
      const c = t.client();
      const r = await c.post('/api/auth/google', { credential: cred });
      assert.equal(r.status, 401, cred);
      assert.equal(r.json.error, 'Google sign-in failed');
      assert.equal(c.jar.get('__Host-ap_session'), undefined);
    }
    const c = t.client();
    assert.equal((await c.post('/api/auth/google', {})).status, 400);
  });

  test('Google sign-in without GOOGLE_CLIENT_ID is 503', async () => {
    const t2 = await startTestServer({ env: { GOOGLE_CLIENT_ID: '' } });
    try {
      const r = await t2.client().post('/api/auth/google', { credential: 'good:s:e@example.com:pad' });
      assert.equal(r.status, 503);
      assert.equal((await t2.client().get('/api/config')).json.googleClientId, null);
    } finally { await t2.stop(); }
  });

  test('logout revokes only this session; old cookie no longer works', async () => {
    const a = t.client();
    const b = t.client();
    await a.devLogin('two@example.com');
    await b.devLogin('two@example.com');
    const stolen = a.jar.get('__Host-ap_session');
    const r = await a.post('/api/auth/logout', {});
    assert.equal(r.status, 200);
    assert.equal(a.jar.get('__Host-ap_session'), undefined, 'cookie cleared');
    a.jar.set('__Host-ap_session', stolen);
    assert.equal((await a.get('/api/me')).status, 401);
    assert.equal((await b.get('/api/me')).status, 200);
  });

  test('re-login rotates the session (old token revoked)', async () => {
    const c = t.client();
    await c.devLogin('rotate@example.com');
    const old = c.jar.get('__Host-ap_session');
    await c.devLogin('rotate@example.com');
    assert.notEqual(c.jar.get('__Host-ap_session'), old);
    const replay = new Client(t.url);
    replay.jar.set('__Host-ap_session', old);
    assert.equal((await replay.get('/api/me')).status, 401);
  });

  test('expired sessions are rejected and removed; sliding refresh extends active ones', async () => {
    const c = t.client();
    await c.devLogin('expiry@example.com');
    const hash = sha256(c.jar.get('__Host-ap_session'));
    const db = t.ctx.repo.raw;
    // Simulate an hour+ of inactivity: next request slides the expiry forward and re-sets cookies.
    db.prepare('UPDATE sessions SET last_seen_at = ?, expires_at = ? WHERE token_hash = ?').run(Date.now() - 2 * 3600e3, Date.now() + 1000e3, hash);
    const r = await c.get('/api/me');
    assert.equal(r.status, 200);
    assert.ok(r.setCookies.some((s) => s.startsWith('__Host-ap_session=')));
    const row = db.prepare('SELECT expires_at FROM sessions WHERE token_hash = ?').get(hash);
    assert.ok(row.expires_at > Date.now() + 29 * 24 * 3600e3);
    // Now expire it.
    db.prepare('UPDATE sessions SET expires_at = ? WHERE token_hash = ?').run(Date.now() - 1, hash);
    assert.equal((await c.get('/api/me')).status, 401);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM sessions WHERE token_hash = ?').get(hash).n, 0);
  });

  test('device bearer token cannot use session-only endpoints and garbage bearer is 401', async () => {
    const c = new Client(t.url);
    c.bearer = 'not-a-real-token-but-long-enough';
    assert.equal((await c.get('/api/me')).status, 401);
    const bad = await fetch(`${t.url}/api/me`, { headers: { authorization: 'Basic abc' } });
    assert.equal(bad.status, 401);
  });

  test('Origin default for APP_ORIGIN is the Vite dev server', () => {
    assert.equal(loadConfig({}).appOrigin, ORIGIN);
  });
});
