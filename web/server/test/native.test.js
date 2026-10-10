// Native app (Capacitor iOS/Android) support: bearer session tokens, Google audience allow-list, CORS.
import test, { describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { loadConfig } from '../config.js';
import { sha256 } from '../util.js';
import { profileFromPayload } from '../google.js';
import { startTestServer, Client, ORIGIN, CLIENT_ID } from './helpers.js';

const IOS_ID = 'ios-client.apps.googleusercontent.com';
const ANDROID_ID = 'android-client.apps.googleusercontent.com';

/** A native app client: no Origin (CapacitorHttp / native HTTP), bearer token, no cookies. */
function app(t, token) { const c = new Client(t.url, { origin: null }); c.bearer = token || null; return c; }

async function nativeLogin(t, email = 'phone@example.com', extra = {}) {
  const r = await app(t).post('/api/auth/dev', { email, client: 'native', ...extra });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  return r;
}

describe('native app sign-in and bearer sessions', () => {
  let t;
  before(async () => { t = await startTestServer({ env: { GOOGLE_CLIENT_IDS: `${IOS_ID},${ANDROID_ID}` }, overrides: { rateLimits: { auth: [1000, 60000] } } }); });
  after(async () => { await t.stop(); });

  test('dev login with client native returns an ap_s_ token, sets no cookies, stores only the hash', async () => {
    const r = await nativeLogin(t, 'Native@Example.com', { deviceName: 'Pixel 9\u0007', platform: 'android' });
    assert.match(r.json.token, /^ap_s_[A-Za-z0-9_-]{43}$/);
    assert.equal(Buffer.from(r.json.token.slice(5), 'base64url').length, 32, '256-bit');
    assert.equal(r.json.user.email, 'native@example.com');
    assert.deepEqual(r.setCookies, [], 'no cookies for native clients');
    assert.equal(r.json.session.name, 'Pixel 9');
    assert.equal(r.json.session.platform, 'android');
    assert.ok(r.json.session.expiresAt > Date.now() + 29 * 24 * 3600e3);
    const db = t.rawDb();
    const rows = db.prepare('SELECT token_hash, kind FROM sessions').all();
    db.close();
    assert.ok(rows.some((x) => x.token_hash === sha256(r.json.token) && x.kind === 'native'));
    assert.ok(!JSON.stringify(rows).includes(r.json.token.slice(5)));
  });

  test('bearer session: /me, session-level writes without CSRF, sync works', async () => {
    const { json } = await nativeLogin(t, 'bearer@example.com', { platform: 'ios' });
    const c = app(t, json.token);
    const me = await c.get('/api/me');
    assert.equal(me.status, 200);
    assert.equal(me.json.user.id, json.user.id);
    assert.equal(me.json.session.id, json.session.id);
    assert.equal(me.json.session.platform, 'ios');
    assert.equal(me.json.device, undefined);
    // Session-level endpoints (vault create, link code) work for the app, with no CSRF token.
    assert.equal((await c.put('/api/vault', { vault: { v: 1 }, baseVersion: null })).status, 200);
    assert.equal((await c.post('/api/devices/link-code', {})).status, 200);
    assert.equal((await c.put('/api/items/qa/n1', { ciphertext: 'v1.a.b', baseVersion: null })).status, 200);
    assert.equal((await c.get('/api/items')).json.items.length, 1);
  });

  test('native tokens are never accepted from a cookie; web cookie tokens are never accepted as bearer', async () => {
    const { json } = await nativeLogin(t, 'split@example.com');
    const viaCookie = new Client(t.url);
    viaCookie.jar.set('__Host-ap_session', json.token);
    assert.equal((await viaCookie.get('/api/me')).status, 401);
    viaCookie.jar.set('__Host-ap_session', json.token.slice(5));
    assert.equal((await viaCookie.get('/api/me')).status, 401);

    const web = t.client();
    await web.devLogin('split@example.com');
    const cookieToken = web.jar.get('__Host-ap_session');
    assert.equal((await app(t, cookieToken).get('/api/me')).status, 401);
    assert.equal((await app(t, `ap_s_${cookieToken}`).get('/api/me')).status, 401);
    assert.equal((await app(t, 'ap_s_short').get('/api/me')).status, 401);
  });

  test('cookies are ignored on requests from a native app origin (bearer only)', async () => {
    const web = t.client();
    await web.devLogin('cookie-on-app@example.com');
    assert.equal((await web.get('/api/me')).status, 200);
    assert.equal((await web.get('/api/me', { headers: { origin: 'capacitor://localhost' } })).status, 401);
  });

  test('sliding 30-day expiry, expiry, and revocation', async () => {
    const { json } = await nativeLogin(t, 'slide@example.com');
    const hash = sha256(json.token);
    const db = t.ctx.repo.raw;
    db.prepare('UPDATE sessions SET last_seen_at = ?, expires_at = ? WHERE token_hash = ?').run(Date.now() - 2 * 3600e3, Date.now() + 1000e3, hash);
    const c = app(t, json.token);
    assert.equal((await c.get('/api/me')).status, 200);
    assert.ok(db.prepare('SELECT expires_at FROM sessions WHERE token_hash = ?').get(hash).expires_at > Date.now() + 29 * 24 * 3600e3);
    db.prepare('UPDATE sessions SET expires_at = ? WHERE token_hash = ?').run(Date.now() - 1, hash);
    assert.equal((await c.get('/api/me')).status, 401);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM sessions WHERE token_hash = ?').get(hash).n, 0, 'expired row removed');
  });

  test('logout with the bearer token revokes it; re-login with a bearer rotates', async () => {
    const { json } = await nativeLogin(t, 'out@example.com');
    const c = app(t, json.token);
    const r = await c.post('/api/auth/logout', {});
    assert.deepEqual(r.json, { ok: true });
    assert.deepEqual(r.setCookies, []);
    assert.equal((await c.get('/api/me')).status, 401);

    const first = (await nativeLogin(t, 'rot@example.com')).json.token;
    const again = await app(t, first).post('/api/auth/dev', { email: 'rot@example.com', client: 'native' });
    assert.equal(again.status, 200);
    assert.equal((await app(t, first).get('/api/me')).status, 401, 'old token revoked on re-login');
    assert.equal((await app(t, again.json.token).get('/api/me')).status, 200);
  });

  test('apps are listed under devices and sessions, and revocable from the web', async () => {
    const web = t.client();
    await web.devLogin('list@example.com');
    const phone = (await nativeLogin(t, 'list@example.com', { deviceName: 'My iPhone', platform: 'ios' })).json;
    const d = await web.get('/api/devices');
    assert.deepEqual(d.json.devices, []);
    assert.equal(d.json.apps.length, 1);
    assert.deepEqual(Object.keys(d.json.apps[0]).sort(), ['createdAt', 'current', 'id', 'lastSeenAt', 'name', 'platform']);
    assert.equal(d.json.apps[0].name, 'My iPhone');
    assert.equal(d.json.apps[0].current, false);
    const s = await web.get('/api/sessions');
    assert.deepEqual(s.json.sessions.map((x) => x.kind).sort(), ['native', 'web']);
    assert.equal(s.json.sessions.find((x) => x.kind === 'web').current, true);
    assert.ok(!JSON.stringify(s.json).includes(phone.token), 'tokens never listed');
    // From the phone, its own entry is current.
    assert.equal((await app(t, phone.token).get('/api/devices')).json.apps[0].current, true);

    const mallory = t.client();
    await mallory.devLogin('mallory-native@example.com');
    assert.equal((await mallory.del(`/api/devices/${phone.session.id}`)).status, 404);
    assert.equal((await mallory.del(`/api/sessions/${phone.session.id}`)).status, 404);

    assert.deepEqual((await web.del(`/api/devices/${phone.session.id}`)).json, { ok: true });
    assert.equal((await app(t, phone.token).get('/api/me')).status, 401);
    // Web sessions can be revoked by id too.
    const phone2 = (await nativeLogin(t, 'list@example.com')).json;
    const webId = (await app(t, phone2.token).get('/api/sessions')).json.sessions.find((x) => x.kind === 'web').id;
    assert.deepEqual((await app(t, phone2.token).del(`/api/sessions/${webId}`)).json, { ok: true });
    assert.equal((await web.get('/api/me')).status, 401);
  });

  test('sign out everywhere from the app revokes web sessions, apps and devices', async () => {
    const web = t.client();
    await web.devLogin('everywhere@example.com');
    const { token } = (await nativeLogin(t, 'everywhere@example.com')).json;
    const other = (await nativeLogin(t, 'everywhere@example.com')).json.token;
    assert.deepEqual((await app(t, token).post('/api/auth/logout-all', {})).json, { ok: true });
    assert.equal((await web.get('/api/me')).status, 401);
    assert.equal((await app(t, other).get('/api/me')).status, 401);
    assert.equal((await app(t, token).get('/api/me')).status, 401);
  });

  test('native sign-in Origin rules: none, app origins and APP_ORIGIN pass; other origins fail', async () => {
    for (const origin of ['capacitor://localhost', 'https://localhost', 'http://localhost', ORIGIN]) {
      const c = new Client(t.url, { origin });
      assert.equal((await c.post('/api/auth/dev', { email: 'o@example.com', client: 'native' })).status, 200, origin);
    }
    const evil = new Client(t.url, { origin: 'https://evil.example' });
    assert.equal((await evil.post('/api/auth/dev', { email: 'o@example.com', client: 'native' })).status, 403);
    // Web sign-in (cookies) still requires exactly APP_ORIGIN.
    const capWeb = new Client(t.url, { origin: 'capacitor://localhost' });
    assert.equal((await capWeb.post('/api/auth/dev', { email: 'o@example.com' })).status, 403);
    assert.equal((await app(t).post('/api/auth/dev', { email: 'o@example.com' })).status, 403);
  });

  test('client / platform validation', async () => {
    assert.equal((await app(t).post('/api/auth/dev', { email: 'v@example.com', client: 'desktop' })).status, 400);
    assert.equal((await app(t).post('/api/auth/dev', { email: 'v@example.com', client: 'native', platform: 'windows' })).status, 400);
    const r = await app(t).post('/api/auth/dev', { email: 'v@example.com', client: 'native', deviceName: 'x'.repeat(500) });
    assert.equal(r.json.session.name.length, 64);
  });

  test('Google: web, iOS and Android audiences are accepted; others are not', async () => {
    const g = (cred) => app(t).post('/api/auth/google', { credential: cred, client: 'native', platform: 'ios' });
    const ios = await g(`aud:sub-ios:ios@example.com:${IOS_ID}`);
    assert.equal(ios.status, 200);
    assert.match(ios.json.token, /^ap_s_/);
    assert.deepEqual(t.googleCalls.at(-1).audience, [CLIENT_ID, IOS_ID, ANDROID_ID], 'verifier gets the whole allow-list');
    assert.equal((await g(`aud:sub-and:and@example.com:${ANDROID_ID}`)).status, 200);
    assert.equal((await g(`aud:sub-web:web@example.com:${CLIENT_ID}`)).status, 200);
    assert.equal((await g('aud:sub-x:x@example.com:someone-else.apps.googleusercontent.com')).status, 401);
    assert.equal((await g('wrongaud:sub-y:y@example.com:pad')).status, 401);
    // The web flow still works and returns cookies, not a token.
    const web = await t.client().post('/api/auth/google', { credential: `aud:sub-web2:w2@example.com:${CLIENT_ID}` });
    assert.equal(web.status, 200);
    assert.equal(web.json.token, undefined);
    assert.ok(web.setCookies.some((s) => s.startsWith('__Host-ap_session=')));
    // /api/config still returns the web client id.
    assert.equal((await t.client().get('/api/config')).json.googleClientId, CLIENT_ID);
  });
});

describe('CORS for Capacitor origins', () => {
  let t;
  before(async () => { t = await startTestServer(); });
  after(async () => { await t.stop(); });

  const preflight = (t, origin, method = 'POST', headers = 'authorization, content-type') => fetch(`${t.url}/api/watchlist`, {
    method: 'OPTIONS', headers: { origin, 'access-control-request-method': method, 'access-control-request-headers': headers },
  });

  test('preflight from each default app origin: allowed, no credentials, minimal headers', async () => {
    for (const origin of ['capacitor://localhost', 'https://localhost', 'http://localhost']) {
      const r = await preflight(t, origin);
      assert.equal(r.status, 204, origin);
      assert.equal(r.headers.get('access-control-allow-origin'), origin);
      assert.equal(r.headers.get('access-control-allow-credentials'), null);
      assert.equal(r.headers.get('access-control-allow-methods'), 'GET, POST, PUT, DELETE');
      assert.equal(r.headers.get('access-control-allow-headers'), 'Authorization, Content-Type');
      assert.equal(r.headers.get('access-control-max-age'), '600');
      assert.match(r.headers.get('vary') || '', /Origin/);
    }
  });

  test('preflight refuses other origins, cookie/CSRF headers and odd methods', async () => {
    const evil = await preflight(t, 'https://evil.example');
    assert.equal(evil.status, 403);
    assert.equal(evil.headers.get('access-control-allow-origin'), null);
    assert.equal((await preflight(t, 'capacitor://localhost', 'POST', 'x-csrf-token')).status, 403);
    assert.equal((await preflight(t, 'capacitor://localhost', 'PATCH')).status, 403);
    assert.equal((await preflight(t, 'capacitor://localhost:8080')).status, 403, 'exact origin match only');
  });

  test('actual requests: app origins get ACAO, web origin and others do not', async () => {
    const { token } = (await new Client(t.url, { origin: null }).post('/api/auth/dev', { email: 'cors@example.com', client: 'native' })).json;
    const r = await fetch(`${t.url}/api/me`, { headers: { origin: 'capacitor://localhost', authorization: `Bearer ${token}` } });
    assert.equal(r.status, 200);
    assert.equal(r.headers.get('access-control-allow-origin'), 'capacitor://localhost');
    assert.equal(r.headers.get('access-control-allow-credentials'), null);
    assert.match(r.headers.get('access-control-expose-headers'), /RateLimit/);
    const e = await fetch(`${t.url}/api/health`, { headers: { origin: 'https://evil.example' } });
    assert.equal(e.headers.get('access-control-allow-origin'), null);
    const w = await fetch(`${t.url}/api/health`, { headers: { origin: ORIGIN } });
    assert.equal(w.headers.get('access-control-allow-origin'), null, 'web origin behaviour unchanged (same-origin, no CORS)');
    // A cookie-authenticated write coming from an app origin is refused (cookies ignored → 401).
    const web = t.client();
    await web.devLogin('cors-web@example.com');
    const x = await web.put('/api/items/qa/c1', { ciphertext: 'v1.a.b', baseVersion: null }, { origin: false, headers: { origin: 'capacitor://localhost' } });
    assert.equal(x.status, 401);
  });

  test('APP_NATIVE_ORIGINS overrides the allow-list and is validated', async () => {
    const t2 = await startTestServer({ env: { APP_NATIVE_ORIGINS: 'capacitor://localhost' } });
    try {
      assert.equal((await preflight(t2, 'capacitor://localhost')).status, 204);
      assert.equal((await preflight(t2, 'https://localhost')).status, 403);
    } finally { await t2.stop(); }
    assert.throws(() => loadConfig({ APP_NATIVE_ORIGINS: 'capacitor://localhost/path' }), /APP_NATIVE_ORIGINS/);
    assert.throws(() => loadConfig({ APP_NATIVE_ORIGINS: '*' }), /APP_NATIVE_ORIGINS/);
    assert.throws(() => loadConfig({ APP_ORIGIN: 'https://localhost', APP_NATIVE_ORIGINS: 'https://localhost' }), /must not contain APP_ORIGIN/);
    assert.deepEqual(loadConfig({}).nativeOrigins, ['capacitor://localhost', 'https://localhost', 'http://localhost']);
  });
});

test('GOOGLE_CLIENT_IDS parsing and audience re-check', () => {
  const c = loadConfig({ GOOGLE_CLIENT_ID: 'web.apps.googleusercontent.com', GOOGLE_CLIENT_IDS: ' ios.apps.googleusercontent.com,web.apps.googleusercontent.com ,' });
  assert.deepEqual(c.googleClientIds, ['web.apps.googleusercontent.com', 'ios.apps.googleusercontent.com']);
  assert.equal(c.googleClientId, 'web.apps.googleusercontent.com');
  assert.equal(loadConfig({ GOOGLE_CLIENT_IDS: 'a.apps.googleusercontent.com' }).googleClientId, 'a.apps.googleusercontent.com');
  assert.throws(() => loadConfig({ GOOGLE_CLIENT_IDS: 'bad id with spaces' }), /client id/);
  const p = { iss: 'accounts.google.com', sub: 's', email: 'e@x.com', email_verified: true, exp: Date.now() / 1000 + 60 };
  assert.equal(profileFromPayload({ ...p, aud: 'ios' }, ['web', 'ios']).sub, 's');
  assert.throws(() => profileFromPayload({ ...p, aud: 'other' }, ['web', 'ios']), /audience/);
  assert.throws(() => profileFromPayload({ ...p, aud: ['web', 'other'] }, ['web', 'ios']), /audience/);
  assert.throws(() => profileFromPayload({ ...p, aud: [] }, ['web']), /audience/);
});
