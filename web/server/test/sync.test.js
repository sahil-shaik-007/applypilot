import test, { describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { startTestServer } from './helpers.js';

const KB = 1024;

describe('vault, items and blobs', () => {
  let t; let c; let user;
  before(async () => {
    t = await startTestServer({ overrides: { limits: { blob: 4 * KB, quota: 16 * KB, record: 2 * KB, vaultDoc: 1 * KB } } });
    c = t.client();
    user = await c.devLogin('sync@example.com');
  });
  after(async () => { await t.stop(); });

  test('vault: 404 before creation, create, 409 on stale/duplicate create, update', async () => {
    assert.equal((await c.get('/api/vault')).status, 404);
    const doc = { v: 1, kdf: { alg: 'PBKDF2-SHA256', iterations: 600000, salt: 'abc' }, wrapped: { iv: 'i', ct: 'c' }, recovery: { alg: 'HKDF-SHA256', salt: 's', wrapped: { iv: 'i', ct: 'c' } } };
    const r1 = await c.put('/api/vault', { vault: doc, baseVersion: null });
    assert.equal(r1.status, 200);
    assert.deepEqual(r1.json, { version: 1 });
    const dup = await c.put('/api/vault', { vault: doc, baseVersion: null });
    assert.equal(dup.status, 409);
    assert.equal(dup.json.version, 1);
    const r2 = await c.put('/api/vault', { vault: { ...doc, updatedAt: 'x' }, baseVersion: 1 });
    assert.deepEqual(r2.json, { version: 2 });
    const stale = await c.put('/api/vault', { vault: doc, baseVersion: 1 });
    assert.equal(stale.status, 409);
    assert.equal(stale.json.version, 2);
    const g = await c.get('/api/vault');
    assert.deepEqual(g.json, { vault: { ...doc, updatedAt: 'x' }, version: 2 });
    assert.equal((await c.get('/api/me')).json.hasVault, true);
    assert.equal((await c.put('/api/vault', { vault: 'nope', baseVersion: 2 })).status, 400);
    assert.equal((await c.put('/api/vault', { vault: doc, baseVersion: 'x' })).status, 400);
    assert.equal((await c.put('/api/vault', { vault: { big: 'x'.repeat(2 * KB) }, baseVersion: 2 })).status, 413);
  });

  test('items: create, update with versions, conflict returns current, tombstone, since filtering', async () => {
    const r0 = await c.get('/api/items');
    assert.deepEqual(r0.json.items, []);
    const cursor0 = r0.json.now;
    assert.equal(typeof cursor0, 'number');

    const a1 = await c.put('/api/items/applications/app1', { ciphertext: 'v1.iv.AAA', baseVersion: null });
    assert.equal(a1.status, 200);
    assert.equal(a1.json.version, 1);
    assert.ok(a1.json.updatedAt > cursor0);

    const dupCreate = await c.put('/api/items/applications/app1', { ciphertext: 'v1.iv.ZZZ', baseVersion: null });
    assert.equal(dupCreate.status, 409);
    assert.equal(dupCreate.json.current.ciphertext, 'v1.iv.AAA');

    const a2 = await c.put('/api/items/applications/app1', { ciphertext: 'v1.iv.BBB', baseVersion: 1 });
    assert.equal(a2.json.version, 2);
    const conflict = await c.put('/api/items/applications/app1', { ciphertext: 'v1.iv.CCC', baseVersion: 1 });
    assert.equal(conflict.status, 409);
    assert.equal(conflict.json.error, 'Version conflict');
    assert.deepEqual(conflict.json.current, { collection: 'applications', id: 'app1', ciphertext: 'v1.iv.BBB', version: 2, updatedAt: a2.json.updatedAt, deleted: false });
    const missing = await c.put('/api/items/applications/nope', { ciphertext: 'v1.iv.X', baseVersion: 3 });
    assert.equal(missing.status, 409);
    assert.equal(missing.json.current, null);

    await c.put('/api/items/qa/q1', { ciphertext: 'v1.iv.QQQ', baseVersion: null });
    const all = await c.get(`/api/items?since=${cursor0}`);
    assert.equal(all.json.items.length, 2);
    const cursor1 = all.json.now;
    assert.deepEqual((await c.get(`/api/items?since=${cursor1}`)).json.items, []);
    const onlyQa = await c.get('/api/items?collection=qa');
    assert.deepEqual(onlyQa.json.items.map((i) => i.id), ['q1']);

    const d = await c.del('/api/items/applications/app1');
    assert.equal(d.status, 200);
    assert.deepEqual(d.json, { version: 3 });
    const again = await c.del('/api/items/applications/app1');
    assert.deepEqual(again.json, { version: 3 }, 'idempotent');
    const changed = await c.get(`/api/items?since=${cursor1}`);
    assert.equal(changed.json.items.length, 1);
    assert.deepEqual({ ...changed.json.items[0], updatedAt: 0 }, { collection: 'applications', id: 'app1', ciphertext: null, version: 3, updatedAt: 0, deleted: true });
    // Ciphertext really removed from storage.
    const db = t.rawDb();
    const row = db.prepare('SELECT ciphertext, deleted, size FROM items WHERE id = ?').get('app1');
    db.close();
    assert.deepEqual({ ...row }, { ciphertext: null, deleted: 1, size: 0 });
    // Re-create over a tombstone with baseVersion null.
    const re = await c.put('/api/items/applications/app1', { ciphertext: 'v1.iv.NEW', baseVersion: null });
    assert.equal(re.json.version, 4);
    assert.equal((await c.del('/api/items/applications/never')).status, 404);
    // Conditional delete.
    const cd = await c.del('/api/items/applications/app1?baseVersion=1');
    assert.equal(cd.status, 409);
    assert.equal(cd.json.current.version, 4);
  });

  test('since cursor never misses writes made in the same millisecond', async () => {
    let cursor = (await c.get('/api/items')).json.now;
    const seen = new Set();
    for (let i = 0; i < 15; i++) {
      await c.put(`/api/items/savedJobs/burst${i}`, { ciphertext: `v1.iv.${i}`, baseVersion: null });
      const r = await c.get(`/api/items?since=${cursor}`);
      for (const it of r.json.items) seen.add(it.id);
      cursor = r.json.now;
    }
    for (let i = 0; i < 15; i++) assert.ok(seen.has(`burst${i}`));
  });

  test('server stores ciphertext opaquely (any string, never parsed or validated as crypto)', async () => {
    const weird = '{"not":"really ciphertext"} é中 <script>';
    const r = await c.put('/api/items/settings/main', { ciphertext: weird, baseVersion: null });
    assert.equal(r.status, 200);
    const g = await c.get('/api/items?collection=settings');
    assert.equal(g.json.items[0].ciphertext, weird);
  });

  test('path and input validation', async () => {
    for (const p of ['/api/items/bad.coll/x', '/api/items/qa/' + 'a'.repeat(65), '/api/items/qa/a%20b', '/api/items/qa/a%2Fb']) {
      const r = await c.put(p, { ciphertext: 'v1.x.y', baseVersion: null });
      assert.equal(r.status, 400, p);
    }
    assert.equal((await c.get('/api/items?collection=a.b')).status, 400);
    assert.equal((await c.get('/api/items?since=abc')).status, 400);
    assert.equal((await c.put('/api/items/qa/ok', { ciphertext: '', baseVersion: null })).status, 400);
    assert.equal((await c.put('/api/items/qa/ok', { ciphertext: 123, baseVersion: null })).status, 400);
    assert.equal((await c.put('/api/items/qa/ok', { ciphertext: 'x', baseVersion: 0 })).status, 400);
    assert.equal((await c.put('/api/items/qa/ok', { ciphertext: 'x'.repeat(3 * KB), baseVersion: null })).status, 413);
    assert.equal((await c.put('/api/blobs/bad.id', null, { body: Buffer.from('x'), headers: { 'content-type': 'application/octet-stream' } })).status, 400);
    assert.equal((await c.del('/api/devices/bad.id')).status, 400);
  });

  test('blobs: raw octet-stream round trip, content-type, size limit, quota', async () => {
    const bytes = crypto.randomBytes(3 * KB);
    const up = await c.req('PUT', '/api/blobs/blob1', { body: bytes, headers: { 'content-type': 'application/octet-stream' } });
    assert.equal(up.status, 200);
    assert.deepEqual(up.json, { size: bytes.length });
    const down = await c.req('GET', '/api/blobs/blob1', { raw: true });
    assert.equal(down.status, 200);
    assert.equal(down.headers.get('content-type'), 'application/octet-stream');
    assert.ok(down.buf.equals(bytes));
    assert.equal((await c.req('PUT', '/api/blobs/blob2', { body: bytes, headers: { 'content-type': 'text/plain' } })).status, 415);
    assert.equal((await c.req('PUT', '/api/blobs/blob2', { body: Buffer.alloc(0), headers: { 'content-type': 'application/octet-stream' } })).status, 400);
    const tooBig = await c.req('PUT', '/api/blobs/blob2', { body: crypto.randomBytes(5 * KB), headers: { 'content-type': 'application/octet-stream' } });
    assert.equal(tooBig.status, 413);
    // Fill up the 16 KB quota with 1.5 KB blobs until one is refused.
    let status = 200; let n = 0;
    while (status === 200 && n < 20) {
      status = (await c.req('PUT', `/api/blobs/fill${n}`, { body: crypto.randomBytes(1.5 * KB), headers: { 'content-type': 'application/octet-stream' } })).status;
      n++;
    }
    assert.equal(status, 413);
    assert.ok(n >= 5, `quota reached after ${n} blobs`);
    const usage = t.ctx.repo.usage(user.id);
    assert.ok(usage <= 16 * KB && usage > 16 * KB - 1.5 * KB, `usage ${usage} close to quota`);
    // Items also count toward the quota.
    const rec = await c.put('/api/items/qa/quota', { ciphertext: 'q'.repeat(16 * KB - usage + 1), baseVersion: null });
    assert.equal(rec.status, 413);
    assert.match(rec.json.error, /quota/i);
    // Overwriting a blob with the same size is allowed even when full (net delta 0).
    assert.equal((await c.req('PUT', '/api/blobs/blob1', { body: crypto.randomBytes(3 * KB), headers: { 'content-type': 'application/octet-stream' } })).status, 200);
    assert.deepEqual((await c.del('/api/blobs/blob1')).json, { ok: true });
    assert.equal((await c.get('/api/blobs/blob1')).status, 404);
    assert.equal((await c.del('/api/blobs/blob1')).status, 404);
  });

  test('users are isolated from each other', async () => {
    const other = t.client();
    await other.devLogin('other@example.com');
    assert.deepEqual((await other.get('/api/items')).json.items, []);
    assert.equal((await other.get('/api/vault')).status, 404);
    assert.equal((await other.get('/api/blobs/fill0')).status, 404);
    // Same collection/id as another user's record does not conflict.
    assert.equal((await other.put('/api/items/settings/main', { ciphertext: 'mine', baseVersion: null })).status, 200);
    assert.notEqual((await c.get('/api/items?collection=settings')).json.items[0].ciphertext, 'mine');
  });
});
