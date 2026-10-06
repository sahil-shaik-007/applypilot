// Server-side job search: reuses the desktop app's connectors (free, key-less public sources only),
// with a 15-minute LRU cache per normalized query and in-flight de-duplication.
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { REPO_DIR } from './config.js';
import { HttpError } from './util.js';

const require = createRequire(import.meta.url);

/** Loads the real connector aggregator (CommonJS) from electron/connectors. */
export function loadConnectorAggregator() {
  return require('../../electron/connectors/index.js');
}

let platformsCache = null;
export function loadPlatforms() {
  if (!platformsCache) {
    platformsCache = JSON.parse(fs.readFileSync(path.join(REPO_DIR, 'electron', 'data', 'platforms.json'), 'utf8'));
  }
  return platformsCache;
}

class LruCache {
  constructor(max, ttlMs) { this.max = max; this.ttlMs = ttlMs; this.map = new Map(); }
  get(key) {
    const hit = this.map.get(key);
    if (!hit) return undefined;
    if (hit.expires <= Date.now()) { this.map.delete(key); return undefined; }
    this.map.delete(key); this.map.set(key, hit); // refresh recency
    return hit.value;
  }
  set(key, value) {
    this.map.delete(key);
    this.map.set(key, { value, expires: Date.now() + this.ttlMs });
    while (this.map.size > this.max) this.map.delete(this.map.keys().next().value);
  }
  get size() { return this.map.size; }
}

const REMOTE = new Set(['any', 'remote', 'onsite']);
const norm = (s, max) => (typeof s === 'string' ? s : '').normalize('NFKC').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().toLowerCase().slice(0, max);

/**
 * @param {{ aggregator?: {searchAll, listConnectors}, limits }} opts
 */
export function createJobSearch({ aggregator, limits }) {
  const agg = aggregator || loadConnectorAggregator();
  const freeIds = new Set(agg.listConnectors({}).filter((c) => c.ready && !(c.requiresKeys || []).length).map((c) => c.id));
  const cache = new LruCache(limits.searchCacheMax, limits.searchCacheTtlMs);
  const inflight = new Map();

  function normalizeQuery(query) {
    const q = norm(query.q, 200);
    const location = norm(query.location, 120);
    const remote = REMOTE.has(query.remote) ? query.remote : (query.remote ? null : 'any');
    if (!remote) throw new HttpError(400, 'remote must be any, remote or onsite');
    if (!q && !location) throw new HttpError(400, 'Enter a job title, keyword or location');
    let sources = [];
    if (typeof query.sources === 'string' && query.sources.trim()) {
      sources = [...new Set(query.sources.split(',').map((s) => s.trim()).filter((s) => freeIds.has(s)))].sort();
      if (!sources.length) throw new HttpError(400, 'None of the requested sources are available');
    }
    return { q, location, remote, sources };
  }

  function shape(result) {
    const jobs = (result.jobs || []).slice(0, limits.searchMaxJobs).map((j) => (
      typeof j.description === 'string' && j.description.length > limits.searchMaxDescription
        ? { ...j, description: `${j.description.slice(0, limits.searchMaxDescription)}…` }
        : j));
    const stats = (result.stats || []).map(({ id, name, count, ms, error }) => ({ id, name, count, ms, ...(error ? { error: String(error).slice(0, 200) } : {}) }));
    return { jobs, stats };
  }

  async function search(rawQuery) {
    const nq = normalizeQuery(rawQuery);
    const key = JSON.stringify(nq);
    const hit = cache.get(key);
    if (hit) return { ...hit, cached: true };
    if (inflight.has(key)) return inflight.get(key);
    const p = (async () => {
      const sources = nq.sources.length ? nq.sources : [...freeIds];
      // keys: {} → only connectors that need no API key can run; the server never holds user keys.
      const result = await agg.searchAll(
        { query: nq.q, location: nq.location, remote: nq.remote },
        { keys: {}, sources, timeoutMs: limits.searchConnectorTimeoutMs, log: () => {} },
      );
      const shaped = shape(result);
      cache.set(key, shaped);
      return { ...shaped, cached: false };
    })();
    inflight.set(key, p);
    try { return await p; } finally { inflight.delete(key); }
  }

  return { search, normalizeQuery, freeSources: () => [...freeIds], cache };
}
