// Loads every connector module in this folder and fans a search out to all enabled ones in parallel.
const fs = require('fs');
const path = require('path');

let cache = null;
function loadConnectors() {
  if (cache) return cache;
  cache = fs.readdirSync(__dirname)
    .filter((f) => f.endsWith('.js') && f !== 'index.js' && !f.startsWith('_'))
    .map((f) => {
      try {
        const m = require(path.join(__dirname, f));
        return m && m.id && typeof m.search === 'function' ? m : null;
      } catch (e) {
        console.error(`connector ${f} failed to load:`, e.message);
        return null;
      }
    })
    .filter(Boolean);
  return cache;
}

function listConnectors(keys = {}) {
  return loadConnectors().map((c) => ({
    id: c.id,
    name: c.name,
    kind: c.kind || 'api',
    homepage: c.homepage || null,
    description: c.description || '',
    regions: c.regions || ['global'],
    requiresKeys: c.requiresKeys || [],
    optionalKeys: c.optionalKeys || [],
    ready: (c.requiresKeys || []).every((k) => !!keys[k]),
  }));
}

function normKey(job) {
  const t = (job.title || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  const co = (job.company || '').toLowerCase().replace(/\b(inc|llc|ltd|gmbh|pvt|private|limited|corp|co)\b|[^a-z0-9]+/g, '');
  return `${co}|${t}`;
}

// Prefer the copy that points straight at an ATS form (auto-apply capable), then the one with more detail.
function better(a, b) {
  const atsRank = (j) => (['greenhouse', 'lever', 'ashby', 'workable', 'smartrecruiters', 'recruitee'].includes(j.ats) ? 2 : j.ats ? 1 : 0);
  if (atsRank(a) !== atsRank(b)) return atsRank(a) > atsRank(b) ? a : b;
  return (a.description || '').length >= (b.description || '').length ? a : b;
}

/**
 * @param params {query, location, remote, limit}
 * @param opts {sources?: string[], keys, companies, log, onProgress}
 */
async function searchAll(params, opts = {}) {
  const keys = opts.keys || {};
  const all = loadConnectors().filter((c) => (c.requiresKeys || []).every((k) => !!keys[k]));
  const selected = opts.sources && opts.sources.length ? all.filter((c) => opts.sources.includes(c.id)) : all;
  const stats = [];
  const results = await Promise.all(selected.map(async (c) => {
    const t0 = Date.now();
    try {
      const jobs = await Promise.race([
        c.search({ limit: 60, ...params }, { keys, companies: opts.companies, log: opts.log || (() => {}) }),
        new Promise((_, rej) => setTimeout(() => rej(new Error('timed out')), opts.timeoutMs || 90000)),
      ]);
      const list = (jobs || []).filter((j) => j && j.title);
      stats.push({ id: c.id, name: c.name, count: list.length, ms: Date.now() - t0 });
      opts.onProgress && opts.onProgress({ source: c.id, name: c.name, count: list.length });
      return list;
    } catch (e) {
      stats.push({ id: c.id, name: c.name, count: 0, ms: Date.now() - t0, error: e.message });
      opts.onProgress && opts.onProgress({ source: c.id, name: c.name, count: 0, error: e.message });
      return [];
    }
  }));
  const byKey = new Map();
  for (const job of results.flat()) {
    const k = normKey(job);
    const prev = byKey.get(k);
    if (!prev) byKey.set(k, { ...job, alsoOn: [] });
    else {
      const keep = better(prev, job);
      const other = keep === prev ? job : prev;
      byKey.set(k, { ...keep, alsoOn: [...new Set([...(prev.alsoOn || []), other.source])].filter((s) => s !== keep.source) });
    }
  }
  return { jobs: [...byKey.values()], stats };
}

module.exports = { loadConnectors, listConnectors, searchAll };
