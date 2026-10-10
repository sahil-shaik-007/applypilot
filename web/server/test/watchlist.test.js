// Cloud watchlist (opt-in plaintext queries + shared hourly scheduler) and the ghost-job history signal.
import test, { describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { startTestServer } from './helpers.js';
import { fingerprint } from '../history.js';

const job = (id, title, company = 'Acme', location = 'Berlin') => ({ id: `remotive:${id}`, source: 'remotive', title, company, location, description: 'd', url: `https://example.com/${id}` });

/** Aggregator whose results the test controls. */
function controllableAggregator(state) {
  return {
    listConnectors: () => [{ id: 'remotive', name: 'Remotive', requiresKeys: [], ready: true }],
    searchAll: async (params) => {
      state.calls.push(params);
      if (state.fail) return { jobs: [], stats: [{ id: 'remotive', name: 'Remotive', count: 0, ms: 1, error: 'HTTP 503' }] };
      return { jobs: state.jobs.map((j) => ({ ...j })), stats: [{ id: 'remotive', name: 'Remotive', count: state.jobs.length, ms: 1 }] };
    },
  };
}

describe('cloud watchlist', () => {
  let t; let state; let pushes; let sleeps;
  const due = () => t.ctx.repo.raw.prepare('UPDATE watch_queries SET next_run_at = 0').run();
  const add = (c, body) => c.post('/api/watchlist', { consent: true, ...body });

  before(async () => {
    state = { jobs: [], calls: [], fail: false };
    pushes = [];
    sleeps = [];
    t = await startTestServer({
      overrides: { limits: { searchCacheTtlMs: 1 }, rateLimits: { auth: [1000, 60000] } },
      deps: {
        aggregator: controllableAggregator(state),
        push: { publicKey: 'x', channels: {}, notifyUser: async (uid, n) => { pushes.push({ uid, n }); } },
        watchDeps: { sleep: async (ms) => { sleeps.push(ms); }, random: () => 0.5 },
      },
    });
  });
  after(async () => { await t.stop(); });
  beforeEach(() => { state.jobs = []; state.calls.length = 0; state.fail = false; pushes.length = 0; sleeps.length = 0; });

  test('requires auth and explicit consent; validates input', async () => {
    assert.equal((await t.client().get('/api/watchlist')).status, 401);
    const c = t.client();
    await c.devLogin('wl-validate@example.com');
    const noConsent = await c.post('/api/watchlist', { q: 'engineer' });
    assert.equal(noConsent.status, 400);
    assert.match(noConsent.json.privacy, /plain text/);
    assert.equal((await add(c, { q: 'engineer', remote: 'mars' })).status, 400);
    assert.equal((await add(c, { q: '   ' })).status, 400);
    assert.equal((await add(c, { q: ['a'] })).status, 400);
    assert.equal((await add(c, { q: 'x'.repeat(401) })).status, 400);
    assert.equal((await c.post('/api/watchlist', { q: 'engineer', consent: 'yes' })).status, 400);
  });

  test('add, list, de-duplicate by normalized query, max 10, delete', async () => {
    const c = t.client();
    await c.devLogin('wl-crud@example.com');
    const r = await add(c, { q: '  Data   ENGINEER ', location: 'Berlin', remote: 'remote' });
    assert.equal(r.status, 201);
    assert.equal(r.json.created, true);
    assert.deepEqual(Object.keys(r.json.item).sort(), ['createdAt', 'id', 'lastCount', 'lastRunAt', 'location', 'nextRunAt', 'q', 'remote']);
    assert.equal(r.json.item.q, 'data engineer');
    assert.equal(r.json.item.location, 'berlin');
    const dup = await add(c, { q: 'data engineer', location: 'BERLIN', remote: 'remote' });
    assert.equal(dup.status, 200);
    assert.equal(dup.json.item.id, r.json.item.id);
    const list = await c.get('/api/watchlist');
    assert.equal(list.json.items.length, 1);
    assert.equal(list.json.max, 10);
    assert.ok(list.json.privacy);
    for (let i = 1; i < 10; i++) assert.equal((await add(c, { q: `role ${i}` })).status, 201);
    const full = await add(c, { q: 'role 11' });
    assert.equal(full.status, 409);
    assert.match(full.json.error, /max 10/);
    assert.deepEqual((await c.del(`/api/watchlist/${r.json.item.id}`)).json, { ok: true });
    assert.equal((await c.del(`/api/watchlist/${r.json.item.id}`)).status, 404);
    assert.equal((await c.get('/api/watchlist')).json.items.length, 9);
    const all = await c.del('/api/watchlist');
    assert.deepEqual(all.json, { ok: true, removed: 9 });
    // Plaintext queries nobody subscribes to any more are deleted from the server.
    const left = t.ctx.repo.raw.prepare("SELECT COUNT(*) AS n FROM watch_queries WHERE q LIKE 'role %' OR q = 'data engineer'").get().n;
    assert.equal(left, 0);
  });

  test('another user cannot delete my watch', async () => {
    const a = t.client(); await a.devLogin('wl-owner@example.com');
    const b = t.client(); await b.devLogin('wl-other@example.com');
    const { item } = (await add(a, { q: 'owner role' })).json;
    assert.equal((await b.del(`/api/watchlist/${item.id}`)).status, 404);
    assert.equal((await a.get('/api/watchlist')).json.items.length, 1);
    await a.del('/api/watchlist');
  });

  test('scheduler: one shared search per distinct query, baseline first, then new jobs to every subscriber + push', async () => {
    const a = t.client(); const ua = await a.devLogin('wl-a@example.com');
    const b = t.client(); const ub = await b.devLogin('wl-b@example.com');
    const wa = (await add(a, { q: 'Platform Engineer' })).json.item;
    const wb = (await add(b, { q: '  platform   engineer' })).json.item;
    assert.equal(t.ctx.repo.raw.prepare("SELECT COUNT(*) AS n FROM watch_queries WHERE q = 'platform engineer'").get().n, 1, 'stored once');

    state.jobs = [job('p1', 'Platform Engineer'), job('p2', 'Platform Engineer II')];
    due();
    await t.ctx.watch.tick();
    assert.equal(state.calls.length, 1, 'one search for both users');
    assert.deepEqual(state.calls[0], { query: 'platform engineer', location: '', remote: 'any' });
    assert.deepEqual((await a.get('/api/watchlist/new')).json, { jobs: [], cursor: 0, more: false }, 'first run is the baseline');
    assert.equal(pushes.length, 0);
    const listed = (await a.get('/api/watchlist')).json.items[0];
    assert.equal(listed.lastCount, 2);
    assert.ok(listed.lastRunAt > 0);
    assert.ok(listed.nextRunAt >= listed.lastRunAt + 60 * 60 * 1000 - 1000, 'next run in ~60 min');

    // A new posting appears.
    state.jobs = [job('p1', 'Platform Engineer'), job('p2', 'Platform Engineer II'), job('p3', 'Staff Platform Engineer')];
    due();
    await t.ctx.watch.tick();
    const na = await a.get('/api/watchlist/new?cursor=0');
    assert.equal(na.json.jobs.length, 1);
    const [n] = na.json.jobs;
    assert.equal(n.id, 'remotive:p3');
    assert.equal(n.title, 'Staff Platform Engineer');
    assert.equal(n.watchId, wa.id);
    assert.equal(typeof n.firstSeen, 'number');
    assert.equal(na.json.cursor, n.seq);
    const nb = await b.get('/api/watchlist/new');
    assert.equal(nb.json.jobs[0].watchId, wb.id, 'second subscriber gets it too');
    assert.deepEqual(pushes.map((p) => [p.uid, p.n]).sort(), [[ua.id, 1], [ub.id, 1]].sort());

    // The cursor acknowledges; nothing new after it.
    assert.deepEqual((await a.get(`/api/watchlist/new?cursor=${na.json.cursor}`)).json, { jobs: [], cursor: na.json.cursor, more: false });
    assert.equal(t.ctx.repo.q.newUnseen.get(ua.id, ua.id).n, 0);
    assert.equal(t.ctx.repo.q.newUnseen.get(ub.id, ub.id).n, 1, 'b has not checked yet');

    // Another job within 30 min: listed, but no second push (throttle).
    state.jobs.push(job('p4', 'Platform Lead'));
    due();
    await t.ctx.watch.tick();
    assert.equal(pushes.length, 2, 'no extra pushes');
    assert.equal((await a.get(`/api/watchlist/new?cursor=${na.json.cursor}`)).json.jobs[0].id, 'remotive:p4');

    // Removing the watch removes its queued results.
    await a.del(`/api/watchlist/${wa.id}`);
    assert.deepEqual((await a.get('/api/watchlist/new')).json.jobs, []);
    await b.del('/api/watchlist');
  });

  test('cursor and limit validation, pagination', async () => {
    const c = t.client(); await c.devLogin('wl-page@example.com');
    await add(c, { q: 'pager role' });
    state.jobs = [];
    due(); await t.ctx.watch.tick();
    state.jobs = [1, 2, 3, 4, 5].map((i) => job(`pg${i}`, `Pager ${i}`));
    due(); await t.ctx.watch.tick();
    const p1 = await c.get('/api/watchlist/new?limit=2');
    assert.equal(p1.json.jobs.length, 2);
    assert.equal(p1.json.more, true);
    const p2 = await c.get(`/api/watchlist/new?cursor=${p1.json.cursor}&limit=200`);
    assert.equal(p2.json.jobs.length, 3);
    assert.equal(p2.json.more, false);
    for (const bad of ['cursor=-1', 'cursor=abc', 'limit=0', 'limit=201', 'cursor=1&cursor=2']) {
      assert.equal((await c.get(`/api/watchlist/new?${bad}`)).status, 400, bad);
    }
    await c.del('/api/watchlist');
  });

  test('shared queue: gap + jitter between searches, global hourly cap, failure backoff', async () => {
    const c = t.client(); await c.devLogin('wl-queue@example.com');
    for (const q of ['queue one', 'queue two', 'queue three']) await add(c, { q });
    state.jobs = [job('q1', 'Queue')];
    due();
    await t.ctx.watch.tick();
    assert.equal(state.calls.length, 3);
    assert.deepEqual(sleeps, [6000, 6000], 'watchGapMs 4000 + jitter 0.5 * 4000 between consecutive searches');

    // Failure: all sources errored → backoff 2 h, failures counted, nothing reported.
    state.fail = true;
    state.calls.length = 0;
    due();
    const before = Date.now();
    await t.ctx.watch.tick();
    const row = t.ctx.repo.raw.prepare("SELECT next_run_at, failures FROM watch_queries WHERE q = 'queue one'").get();
    assert.equal(row.failures, 1);
    assert.ok(row.next_run_at >= before + 2 * 3600e3 - 1000);
    await c.del('/api/watchlist');
  });

  test('hourly cap stops the queue; remaining queries stay due', async () => {
    const t2 = await startTestServer({
      overrides: { limits: { searchCacheTtlMs: 1, watchMaxRunsPerHour: 2 } },
      deps: { aggregator: controllableAggregator({ jobs: [], calls: [] }), push: null, watchDeps: { sleep: async () => {} } },
    });
    try {
      const c = t2.client(); await c.devLogin('cap@example.com');
      for (const q of ['cap one', 'cap two', 'cap three']) await c.post('/api/watchlist', { q, consent: true });
      t2.ctx.repo.raw.prepare('UPDATE watch_queries SET next_run_at = 0').run();
      await t2.ctx.watch.tick();
      assert.equal(t2.ctx.repo.raw.prepare('SELECT COUNT(*) AS n FROM watch_queries WHERE last_run_at IS NULL').get().n, 1);
    } finally { await t2.stop(); }
  });

  test('export lists watchlist; account deletion removes queries, queue and state', async () => {
    const c = t.client(); const u = await c.devLogin('wl-delete@example.com');
    await add(c, { q: 'very unique delete-me role' });
    const ex = await c.get('/api/account/export');
    assert.deepEqual(ex.json.watchlist.map((w) => w.q), ['very unique delete-me role']);
    assert.deepEqual(ex.json.push, []);
    await c.req('DELETE', '/api/account', { json: { confirm: 'DELETE' } });
    const db = t.rawDb();
    for (const table of ['watchlist', 'watch_new', 'watch_state', 'push_targets']) {
      assert.equal(db.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE user_id = ?`).get(u.id).n, 0, table);
    }
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM watch_queries WHERE q LIKE '%delete-me%'").get().n, 0);
    db.close();
  });

  test('watchlist writes are rate-limited per user', async () => {
    const t2 = await startTestServer({ overrides: { rateLimits: { watchlist: [2, 60000] } }, deps: { push: null } });
    try {
      const c = t2.client(); await c.devLogin('wl-rl@example.com');
      const s = [];
      for (let i = 0; i < 3; i++) s.push((await c.post('/api/watchlist', { q: `rl ${i}`, consent: true })).status);
      assert.deepEqual(s, [201, 201, 429]);
    } finally { await t2.stop(); }
  });
});

describe('ghost-job history', () => {
  let t; let c;
  before(async () => {
    t = await startTestServer({ overrides: { rateLimits: { search: [100, 60000], history: [5, 60000] } }, deps: { push: null } });
    c = t.client();
    await c.devLogin('history@example.com');
  });
  after(async () => { await t.stop(); });

  test('search results carry firstSeen; history returns first/last/timesSeen for known ids only', async () => {
    const before = Date.now();
    const r = await c.get('/api/jobs/search?q=history');
    assert.equal(r.status, 200);
    for (const j of r.json.jobs) assert.ok(j.firstSeen >= before && j.firstSeen <= Date.now(), j.id);
    const h = await c.get('/api/jobs/history?ids=remotive:1,arbeitnow:2,unknown:9');
    assert.equal(h.status, 200);
    assert.deepEqual(Object.keys(h.json).sort(), ['arbeitnow:2', 'remotive:1']);
    assert.deepEqual(Object.keys(h.json['remotive:1']).sort(), ['firstSeen', 'lastSeen', 'timesSeen']);
    assert.equal(h.json['remotive:1'].timesSeen, 1);
    // Cached search: same firstSeen.
    const again = await c.get('/api/jobs/search?q=history');
    assert.equal(again.json.cached, true);
    assert.equal(again.json.jobs[0].firstSeen, r.json.jobs[0].firstSeen);
  });

  test('timesSeen counts observations at least 30 min apart; firstSeen never moves', () => {
    const { history, repo } = t.ctx;
    const j = job('h1', 'Ghost Role', 'Phantom Inc');
    const t0 = 1_000_000_000_000;
    history.record([j, j], t0);
    history.record([j], t0 + 10 * 60e3);
    let v = history.lookup([j.id])[j.id];
    assert.deepEqual(v, { firstSeen: t0, lastSeen: t0 + 10 * 60e3, timesSeen: 1 });
    history.record([j], t0 + 45 * 60e3);
    v = history.lookup([j.id])[j.id];
    assert.equal(v.timesSeen, 2);
    assert.equal(v.firstSeen, t0);
    // Reposted under a new id: the fingerprint links it to the first sighting.
    const repost = { ...j, id: 'remotive:h1-repost' };
    history.record([repost], t0 + 40 * 24 * 3600e3);
    v = history.lookup([repost.id])[repost.id];
    assert.equal(v.firstSeen, t0 + 40 * 24 * 3600e3);
    assert.equal(v.repostFirstSeen, t0);
    assert.equal(v.repostIds, 2);
    assert.equal(fingerprint({ title: 'A', company: '' }), null);
    // Purge by age.
    // Purge by age (365-day retention): the original goes, the repost seen on day 40 stays until day 405.
    repo.purgeExpired(t0 + 400 * 24 * 3600e3, t.config.limits);
    assert.deepEqual(Object.keys(history.lookup([j.id, repost.id])), [repost.id]);
    repo.purgeExpired(t0 + 406 * 24 * 3600e3, t.config.limits);
    assert.deepEqual(Object.keys(history.lookup([j.id, repost.id])), []);
  });

  test('history stores no user data', () => {
    const cols = (tbl) => t.ctx.repo.raw.prepare(`PRAGMA table_info(${tbl})`).all().map((x) => x.name);
    assert.deepEqual(cols('job_history'), ['job_id', 'fp', 'first_seen', 'last_seen', 'times_seen']);
    assert.deepEqual(cols('job_fingerprints'), ['fp', 'first_seen', 'last_seen', 'ids']);
  });

  test('validation, POST variant for ids with commas, auth and rate limit', async () => {
    t.ctx.history.record([{ id: 'workable:https://x.example/a,b', title: 'T', company: 'C' }]);
    const p = await c.post('/api/jobs/history', { ids: ['workable:https://x.example/a,b'] });
    assert.equal(p.status, 200);
    assert.ok(p.json['workable:https://x.example/a,b']);
    assert.equal((await t.client().get('/api/jobs/history?ids=a')).status, 401);
    assert.equal((await c.get('/api/jobs/history')).status, 400);
    const many = Array.from({ length: 201 }, (_, i) => `x:${i}`).join(',');
    assert.equal((await c.get(`/api/jobs/history?ids=${many}`)).status, 400);
    assert.equal((await c.post('/api/jobs/history', { ids: ['bad id\n'] })).status, 400);
    let last;
    for (let i = 0; i < 4; i++) last = await c.get('/api/jobs/history?ids=a:1');
    assert.equal(last.status, 429);
  });
});
