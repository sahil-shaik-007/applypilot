// Security review regressions for the native/watchlist/push additions.
import test, { describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { openDb } from '../db.js';
import { sha256 } from '../util.js';
import { startTestServer, Client, tempDbPath } from './helpers.js';

test('migration: a database from v1.0 (sessions without id/kind) opens and keeps its sessions', () => {
  const file = tempDbPath();
  const old = new DatabaseSync(file);
  old.exec(`CREATE TABLE users (id TEXT PRIMARY KEY, google_sub TEXT NOT NULL UNIQUE, email TEXT NOT NULL, name TEXT, picture TEXT, created_at INTEGER NOT NULL);
    CREATE TABLE sessions (token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, created_at INTEGER NOT NULL, last_seen_at INTEGER NOT NULL, expires_at INTEGER NOT NULL);
    CREATE INDEX sessions_user ON sessions(user_id);
    INSERT INTO users VALUES ('u1', 'dev:a', 'a@example.com', 'a', '', 1);
    INSERT INTO sessions VALUES ('${sha256('tok')}', 'u1', 1, 1, 9999999999999);`);
  old.close();
  const repo = openDb(file);
  const row = repo.q.sessionByHash.get(sha256('tok'));
  assert.equal(row.kind, 'web');
  assert.match(row.id, /^[0-9a-f]{32}$/);
  repo.close();
  const again = openDb(file); // idempotent
  assert.equal(again.q.sessionByHash.get(sha256('tok')).id, row.id);
  again.close();
});

describe('review: limits, rotation isolation, logging', () => {
  let t;
  before(async () => { t = await startTestServer({ deps: { push: null } }); });
  after(async () => { await t.stop(); });

  test('small JSON body limit (16 KB) on auth, watchlist, push and history endpoints; sync keeps 300 KB', async () => {
    const c = t.client();
    await c.devLogin('limits-review@example.com');
    const big = 'x'.repeat(20 * 1024);
    for (const [m, p, body] of [
      ['POST', '/api/watchlist', { consent: true, q: 'a', pad: big }],
      ['POST', '/api/push/subscribe', { pad: big }],
      ['POST', '/api/push/native', { pad: big }],
      ['POST', '/api/jobs/history', { ids: ['a:1'], pad: big }],
      ['POST', '/api/auth/dev', { email: 'x@example.com', pad: big }],
    ]) {
      assert.equal((await c.req(m, p, { json: body })).status, 413, p);
    }
    assert.equal((await c.put('/api/items/qa/big', { ciphertext: 'x'.repeat(200 * 1024), baseVersion: null })).status, 200);
  });

  test('a native sign-in from the web origin does not revoke the browser session (and vice versa)', async () => {
    const web = t.client();
    await web.devLogin('iso@example.com');
    const r = await web.post('/api/auth/dev', { email: 'iso@example.com', client: 'native' });
    assert.equal(r.status, 200);
    assert.deepEqual(r.setCookies, []);
    assert.equal((await web.get('/api/me')).status, 200, 'cookie session survives');
    const appC = new Client(t.url, { origin: null }); appC.bearer = r.json.token;
    assert.equal((await appC.get('/api/me')).status, 200);
  });

  test('push config without a push service reports nothing available', async () => {
    assert.deepEqual((await t.client().get('/api/push/config')).json, { webPush: null, native: { fcm: false, apns: false } });
    const c = t.client(); await c.devLogin('nopush@example.com');
    assert.equal((await c.post('/api/push/test', {})).status, 503);
  });

  test('logs never contain bearer tokens, watch queries or job ids', async () => {
    const lines = [];
    const orig = console.log;
    t.config.log = true;
    console.log = (...a) => lines.push(a.join(' '));
    let token;
    try {
      token = (await new Client(t.url, { origin: null }).post('/api/auth/dev', { email: 'logs-native@example.com', client: 'native' })).json.token;
      const c = new Client(t.url, { origin: null }); c.bearer = token;
      await c.post('/api/watchlist', { consent: true, q: 'secret-role-name', location: 'secret-town' });
      await c.get('/api/jobs/history?ids=remotive:secret-job-id');
      await c.get('/api/watchlist/new?cursor=0');
    } finally { console.log = orig; t.config.log = false; }
    const text = lines.join('\n');
    assert.match(text, /POST \/api\/watchlist 201/);
    assert.doesNotMatch(text, /secret-|ap_s_|logs-native|ids=|cursor=/);
    assert.ok(!text.includes(token));
  });
});
