import test, { describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startTestServer, Client } from './helpers.js';

describe('account export and delete', () => {
  let t;
  before(async () => { t = await startTestServer(); });
  after(async () => { await t.stop(); });

  test('export returns vault, all items (incl. tombstones) and blob ids', async () => {
    const c = t.client();
    await c.devLogin('export@example.com');
    const vault = { v: 1, kdf: { alg: 'PBKDF2-SHA256' } };
    await c.put('/api/vault', { vault, baseVersion: null });
    await c.put('/api/items/profile/main', { ciphertext: 'v1.p.p', baseVersion: null });
    await c.put('/api/items/qa/q1', { ciphertext: 'v1.q.q', baseVersion: null });
    await c.del('/api/items/qa/q1');
    await c.req('PUT', '/api/blobs/resumeblob', { body: Buffer.from('enc'), headers: { 'content-type': 'application/octet-stream' } });
    const r = await c.get('/api/account/export');
    assert.equal(r.status, 200);
    assert.deepEqual(r.json.vault, vault);
    assert.deepEqual(r.json.items.map((i) => [i.collection, i.id, i.ciphertext, i.deleted]), [['profile', 'main', 'v1.p.p', false], ['qa', 'q1', null, true]]);
    assert.deepEqual(r.json.blobs, ['resumeblob']);
    assert.equal(r.headers.get('cache-control'), 'no-store');
  });

  test('delete account requires confirm and hard-deletes every row and blob', async () => {
    const c = t.client();
    const user = await c.devLogin('delete-me@example.com');
    await c.put('/api/vault', { vault: { v: 1 }, baseVersion: null });
    await c.put('/api/items/profile/main', { ciphertext: 'v1.secret.secret', baseVersion: null });
    await c.req('PUT', '/api/blobs/blobX', { body: Buffer.from('encrypted-bytes'), headers: { 'content-type': 'application/octet-stream' } });
    const { code } = (await c.post('/api/devices/link-code', {})).json;
    const token = (await new Client(t.url).post('/api/devices/redeem', { code, name: 'PC' })).json.deviceToken;
    await c.post('/api/devices/link-code', {}); // an outstanding code too

    const keep = t.client();
    const keeper = await keep.devLogin('keeper@example.com');
    await keep.put('/api/items/profile/main', { ciphertext: 'v1.keep.keep', baseVersion: null });

    assert.equal((await c.req('DELETE', '/api/account', { json: {} })).status, 400);
    assert.equal((await c.req('DELETE', '/api/account', { json: { confirm: 'delete' } })).status, 400);
    const r = await c.req('DELETE', '/api/account', { json: { confirm: 'DELETE' } });
    assert.equal(r.status, 200);
    assert.deepEqual(r.json, { ok: true });

    const db = t.rawDb();
    for (const table of ['items', 'blobs', 'vaults', 'sessions', 'devices', 'link_codes']) {
      assert.equal(db.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE user_id = ?`).get(user.id).n, 0, table);
    }
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM users WHERE id = ?').get(user.id).n, 0);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM items WHERE user_id = ?').get(keeper.id).n, 1, 'other users untouched');
    db.close();

    assert.equal((await c.get('/api/me')).status, 401);
    const d = new Client(t.url); d.bearer = token;
    assert.equal((await d.get('/api/me')).status, 401);
    // Signing in again creates a brand-new, empty account.
    const again = await c.devLogin('delete-me@example.com');
    assert.notEqual(again.id, user.id);
    assert.deepEqual((await c.get('/api/items')).json.items, []);
  });

  test('export and delete require a session', async () => {
    const anon = t.client();
    assert.equal((await anon.get('/api/account/export')).status, 401);
    assert.equal((await anon.req('DELETE', '/api/account', { json: { confirm: 'DELETE' } })).status, 401);
  });
});
