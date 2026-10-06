import test, { describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startTestServer } from './helpers.js';
import { createJobSearch, loadConnectorAggregator } from '../jobs.js';
import { DEFAULT_LIMITS } from '../config.js';

describe('job search (stubbed connectors)', () => {
  let t; let c;
  before(async () => {
    t = await startTestServer({ overrides: { rateLimits: { search: [10, 60000] } } });
    c = t.client();
    await c.devLogin('jobs@example.com');
  });
  after(async () => { await t.stop(); });

  test('requires auth', async () => {
    assert.equal((await t.client().get('/api/jobs/search?q=engineer')).status, 401);
  });

  test('returns jobs + stats, uses only free sources with no keys, truncates long descriptions', async () => {
    const r = await c.get('/api/jobs/search?q=Data%20Engineer&location=Berlin&remote=remote');
    assert.equal(r.status, 200);
    assert.equal(r.json.jobs.length, 2);
    assert.ok(r.json.jobs[0].description.length <= DEFAULT_LIMITS.searchMaxDescription + 1);
    assert.equal(r.json.stats[1].error, 'HTTP 500');
    const call = t.searchCalls.at(-1);
    assert.deepEqual(call.params, { query: 'data engineer', location: 'berlin', remote: 'remote' });
    assert.deepEqual(call.opts.keys, {});
    assert.deepEqual(call.opts.sources.sort(), ['arbeitnow', 'remotive'], 'key-requiring connectors excluded');
  });

  test('15-minute cache per normalized query', async () => {
    const before = t.searchCalls.length;
    const a = await c.get('/api/jobs/search?q=  DATA   engineer &location=BERLIN&remote=remote');
    assert.equal(a.json.cached, true);
    assert.equal(t.searchCalls.length, before, 'served from cache');
    await c.get('/api/jobs/search?q=data%20engineer&location=berlin&remote=onsite');
    assert.equal(t.searchCalls.length, before + 1, 'different remote filter = different cache key');
  });

  test('sources filter and validation', async () => {
    await c.get('/api/jobs/search?q=qa&sources=remotive,adzuna,unknown');
    assert.deepEqual(t.searchCalls.at(-1).opts.sources, ['remotive']);
    assert.equal((await c.get('/api/jobs/search?q=qa&sources=adzuna')).status, 400);
    assert.equal((await c.get('/api/jobs/search?q=qa&remote=mars')).status, 400);
    assert.equal((await c.get('/api/jobs/search?q=%20%20')).status, 400);
  });

  test('per-user rate limit', async () => {
    let last;
    for (let i = 0; i < 4; i++) last = await c.get(`/api/jobs/search?q=role${i}`);
    assert.equal(last.status, 429);
  });

  test('platform directory is public and complete', async () => {
    const r = await t.client().get('/api/jobs/platforms');
    assert.equal(r.status, 200);
    assert.ok(Array.isArray(r.json));
    assert.equal(r.json.length, 252);
    assert.ok(r.json[0].id && r.json[0].name && r.json[0].url);
  });
});

test('LRU cache evicts least recently used and de-duplicates in-flight searches', async () => {
  let calls = 0;
  const agg = {
    listConnectors: () => [{ id: 'remotive', name: 'R', requiresKeys: [], ready: true }],
    searchAll: async () => { calls++; await new Promise((r) => setTimeout(r, 20)); return { jobs: [], stats: [] }; },
  };
  const js = createJobSearch({ aggregator: agg, limits: { ...DEFAULT_LIMITS, searchCacheMax: 2 } });
  await Promise.all([js.search({ q: 'a' }), js.search({ q: 'a' }), js.search({ q: 'A ' })]);
  assert.equal(calls, 1, 'in-flight de-dup');
  await js.search({ q: 'b' });
  await js.search({ q: 'a' }); // refresh a
  await js.search({ q: 'c' }); // evicts b
  assert.equal(calls, 3);
  await js.search({ q: 'a' });
  assert.equal(calls, 3, 'a still cached');
  await js.search({ q: 'b' });
  assert.equal(calls, 4, 'b was evicted');
});

test('real connector module loads and exposes free sources', () => {
  const agg = loadConnectorAggregator();
  const free = agg.listConnectors({}).filter((x) => x.ready);
  assert.ok(free.length >= 5);
  assert.ok(free.every((x) => x.requiresKeys.length === 0));
});

test('LIVE smoke: real public job search (set LIVE=1)', { skip: process.env.LIVE !== '1' && 'set LIVE=1 to hit real job APIs' }, async () => {
  const t = await startTestServer({ deps: { aggregator: loadConnectorAggregator() } });
  try {
    const c = t.client();
    await c.devLogin('live@example.com');
    const r = await c.get('/api/jobs/search?q=software%20engineer&remote=remote&sources=remotive,remoteok,arbeitnow,himalayas');
    assert.equal(r.status, 200);
    assert.ok(Array.isArray(r.json.jobs));
    assert.ok(r.json.stats.length >= 1);
    console.log(`live search: ${r.json.jobs.length} jobs`, r.json.stats.map((s) => `${s.id}:${s.count}${s.error ? '!' : ''}`).join(' '));
  } finally { await t.stop(); }
});
