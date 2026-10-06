import test, { describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { sha256, LINK_ALPHABET } from '../util.js';
import { startTestServer, Client } from './helpers.js';

const desktop = (t, token) => { const d = new Client(t.url, { origin: null }); d.bearer = token; return d; };

describe('device linking', () => {
  let t; let web; let user;
  before(async () => {
    t = await startTestServer({ overrides: { limits: { linkCodeTtlMs: 400 } } });
    web = t.client();
    user = await web.devLogin('devices@example.com');
  });
  after(async () => { await t.stop(); });

  test('link code: 8 chars from the unambiguous alphabet, 10-minute style TTL, stored hashed', async () => {
    const r = await web.post('/api/devices/link-code', {});
    assert.equal(r.status, 200);
    assert.match(r.json.code, /^[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{8}$/);
    for (const ch of '01OIL') assert.ok(!LINK_ALPHABET.includes(ch));
    assert.ok(r.json.expiresAt > Date.now());
    const db = t.rawDb();
    const rows = db.prepare('SELECT code_hash FROM link_codes').all();
    db.close();
    assert.deepEqual(rows.map((x) => x.code_hash), [sha256(r.json.code)]);
  });

  test('default TTL is 10 minutes', async () => {
    const { DEFAULT_LIMITS } = await import('../config.js');
    assert.equal(DEFAULT_LIMITS.linkCodeTtlMs, 10 * 60 * 1000);
  });

  test('link-code requires a web session with CSRF (not a device)', async () => {
    assert.equal((await t.client().post('/api/devices/link-code', {})).status, 401);
    assert.equal((await web.post('/api/devices/link-code', {}, { csrf: false })).status, 403);
  });

  test('redeem → device token works as bearer (no CSRF needed), single use, revocable', async () => {
    const { code } = (await web.post('/api/devices/link-code', {})).json;
    const anon = new Client(t.url, { origin: null });
    const r = await anon.post('/api/devices/redeem', { code: `${code.slice(0, 4).toLowerCase()}-${code.slice(4)}`, name: 'Work laptop\u0007' });
    assert.equal(r.status, 200);
    assert.match(r.json.deviceToken, /^apd_[A-Za-z0-9_-]{43}$/);
    assert.deepEqual(r.json.user, user);
    assert.equal(r.json.device.name, 'Work laptop');
    const again = await anon.post('/api/devices/redeem', { code, name: 'Thief' });
    assert.equal(again.status, 400, 'single use');

    const d = desktop(t, r.json.deviceToken);
    const me = await d.get('/api/me');
    assert.equal(me.status, 200);
    assert.deepEqual(me.json.device, { id: r.json.device.id, name: 'Work laptop' });
    // Bearer writes need no CSRF/Origin.
    const w = await d.put('/api/items/outbox/o1', { ciphertext: 'v1.a.b', baseVersion: null });
    assert.equal(w.status, 200);
    const blob = await d.req('PUT', '/api/blobs/b1', { body: Buffer.from([1, 2, 3]), headers: { 'content-type': 'application/octet-stream' } });
    assert.equal(blob.status, 200);
    // Session-only endpoints are refused for devices.
    for (const [m, p] of [['GET', '/api/devices'], ['POST', '/api/devices/link-code'], ['GET', '/api/account/export'], ['POST', '/api/auth/logout-all']]) {
      assert.equal((await d.req(m, p, { json: m === 'GET' ? undefined : {} })).status, 403, `${m} ${p}`);
    }
    assert.equal((await d.put('/api/vault', { vault: { v: 1 }, baseVersion: null })).status, 403);

    // Token stored only as a hash.
    const db = t.rawDb();
    const rows = db.prepare('SELECT token_hash FROM devices').all();
    db.close();
    assert.ok(rows.some((x) => x.token_hash === sha256(r.json.deviceToken)));
    assert.ok(!JSON.stringify(rows).includes(r.json.deviceToken));

    const list = await web.get('/api/devices');
    assert.equal(list.json.devices.length, 1);
    assert.deepEqual(Object.keys(list.json.devices[0]).sort(), ['createdAt', 'id', 'lastSeenAt', 'name']);
    const rev = await web.del(`/api/devices/${r.json.device.id}`);
    assert.deepEqual(rev.json, { ok: true });
    assert.equal((await d.get('/api/me')).status, 401);
    assert.equal((await web.del(`/api/devices/${r.json.device.id}`)).status, 404);
  });

  test('a device cannot be revoked by another user', async () => {
    const { code } = (await web.post('/api/devices/link-code', {})).json;
    const r = await new Client(t.url).post('/api/devices/redeem', { code, name: 'Desk' });
    const mallory = t.client();
    await mallory.devLogin('mallory@example.com');
    assert.equal((await mallory.del(`/api/devices/${r.json.device.id}`)).status, 404);
    assert.equal((await desktop(t, r.json.deviceToken).get('/api/me')).status, 200);
  });

  test('expired and malformed codes are rejected; a new code invalidates the previous one', async () => {
    const { code } = (await web.post('/api/devices/link-code', {})).json;
    await new Promise((res) => setTimeout(res, 500));
    assert.equal((await new Client(t.url).post('/api/devices/redeem', { code, name: 'Late' })).status, 400);
    const first = (await web.post('/api/devices/link-code', {})).json.code;
    const second = (await web.post('/api/devices/link-code', {})).json.code;
    assert.equal((await new Client(t.url).post('/api/devices/redeem', { code: first })).status, 400);
    assert.equal((await new Client(t.url).post('/api/devices/redeem', { code: 'O0I1L!!!' })).status, 400);
    assert.equal((await new Client(t.url).post('/api/devices/redeem', {})).status, 400);
    assert.equal((await new Client(t.url).post('/api/devices/redeem', { code: second })).status, 200);
  });

  test('logout-all revokes every session and every device', async () => {
    const { code } = (await web.post('/api/devices/link-code', {})).json;
    const token = (await new Client(t.url).post('/api/devices/redeem', { code, name: 'Home PC' })).json.deviceToken;
    const other = t.client();
    await other.devLogin('devices@example.com');
    assert.equal((await desktop(t, token).get('/api/me')).status, 200);
    const r = await web.post('/api/auth/logout-all', {});
    assert.equal(r.status, 200);
    assert.equal((await desktop(t, token).get('/api/me')).status, 401);
    assert.equal((await other.get('/api/me')).status, 401);
    assert.equal((await web.get('/api/me')).status, 401);
  });
});

describe('redeem rate limiting', () => {
  test('per-IP attempts are limited', async () => {
    const t = await startTestServer({ overrides: { rateLimits: { redeem: [3, 60000] } } });
    try {
      const statuses = [];
      for (let i = 0; i < 5; i++) statuses.push((await new Client(t.url).post('/api/devices/redeem', { code: 'ABCDEFGH' })).status);
      assert.deepEqual(statuses, [400, 400, 400, 429, 429]);
    } finally { await t.stop(); }
  });

  test('global cap stops distributed guessing', async () => {
    const t = await startTestServer({ overrides: { rateLimits: { redeemGlobal: [2, 60000] } } });
    try {
      const statuses = [];
      for (let i = 0; i < 3; i++) statuses.push((await new Client(t.url).post('/api/devices/redeem', { code: 'ABCDEFGH' })).status);
      assert.deepEqual(statuses, [400, 400, 429]);
    } finally { await t.stop(); }
  });
});
