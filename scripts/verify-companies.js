#!/usr/bin/env node
// Discovers + verifies ATS job boards and writes electron/data/companies.json.
//
//   node scripts/verify-companies.js            # probe candidates + re-check existing list
//   node scripts/verify-companies.js --recheck  # only re-check the existing companies.json
//   node scripts/verify-companies.js --keep-empty  # also keep boards that respond 200 with 0 jobs
//   node scripts/verify-companies.js --candidates other.js --report r.json --no-write   # discovery dry run
//
// Every candidate slug (scripts/company-candidates.js) is probed against every supported ATS.
// A board is kept when the public endpoint answers 200 with a jobs array (and, by default, at
// least one job). For each candidate company only the board with the most jobs is kept.
// Concurrency is bounded per ATS host (default 16).

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'electron', 'data', 'companies.json');
const argVal = (n, d) => { const a = process.argv.slice(2); const i = a.indexOf(n); return i >= 0 ? a[i + 1] : d; };
const REPORT = path.resolve(argVal('--report', path.join(__dirname, 'verify-report.json')));
const CANDIDATES = path.resolve(argVal('--candidates', path.join(__dirname, 'company-candidates.js')));
const NO_WRITE = process.argv.includes('--no-write');
const CONCURRENCY = Number(process.env.VERIFY_CONCURRENCY || 16);
const args = new Set(process.argv.slice(2));
const KEEP_EMPTY = args.has('--keep-empty');
const RECHECK_ONLY = args.has('--recheck');

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36 ApplyPilot/1.0';
const ATS_ORDER = ['greenhouse', 'lever', 'ashby', 'workable', 'smartrecruiters', 'recruitee'];

// Workable and Recruitee rate-limit per client IP (across all tenants), so they get tiny pools
// plus a minimum gap between request starts, and only curated candidate lists are probed there.
const ATS_CONCURRENCY = { workable: 1, recruitee: 3 };
const HOST_GAP = [[/workable\.com/, 1100], [/recruitee\.com/, 300]];
const lastStart = new Map();
async function throttle(url) {
  const rule = HOST_GAP.find(([re]) => re.test(url));
  if (!rule) return;
  const key = String(rule[0]);
  for (;;) {
    const wait = (lastStart.get(key) || 0) + rule[1] - Date.now();
    if (wait <= 0) break;
    await new Promise((r) => setTimeout(r, wait));
  }
  lastStart.set(key, Date.now());
}

// Probe cache (outside the project) so iterative re-runs don't re-hit every endpoint.
const os = require('os');
const CACHE_FILE = path.join(os.tmpdir(), 'applypilot-verify-cache.json');
const CACHE_TTL = 12 * 3600 * 1000;
let cache = {};
try { if (!args.has('--no-cache')) cache = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8')); } catch { cache = {}; }

// Bump when a probe changes so stale cached results for that ATS are ignored.
const PROBE_VERSION = { greenhouse: 3 };

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function getJson(url, timeout = 20000) {
  let last = { status: 0 };
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      await throttle(url);
      const res = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/json' }, signal: AbortSignal.timeout(timeout) });
      if (res.status === 429 || res.status >= 500) {
        last = { status: res.status, transient: true };
        const ra = Number(res.headers.get('retry-after'));
        await sleep(ra > 0 ? Math.min(ra, 30) * 1000 : 1500 * 2 ** attempt);
        continue;
      }
      if (!res.ok) return { status: res.status };
      return { status: 200, body: await res.json() };
    } catch (e) {
      last = { status: 0, transient: true, error: e.message };
      await sleep(1000);
    }
  }
  return last;
}

class Transient extends Error {}
const must = (r) => { if (r.transient) throw new Transient(r.error || `HTTP ${r.status}`); return r; };

// Each probe returns { count, apiName, eu? } or null when the board does not exist.
const PROBES = {
  // Greenhouse has a separate EU instance (boards.eu.greenhouse.io); tried when the US board is absent/empty.
  async greenhouse(slug) {
    const s = encodeURIComponent(slug);
    const hosts = [['https://boards-api.greenhouse.io', false], ['https://boards.eu.greenhouse.io', true]];
    // Some companies have boards on both instances (e.g. Groww): keep the one with more jobs.
    let best = null;
    for (const [host, eu] of hosts) {
      const r = must(await getJson(`${host}/v1/boards/${s}/jobs`));
      if (r.status !== 200 || !Array.isArray(r.body?.jobs)) continue;
      if (!best || r.body.jobs.length > best.count) best = { count: r.body.jobs.length, apiName: null, eu, host };
    }
    if (best && best.count) {
      const meta = await getJson(`${best.host}/v1/boards/${s}`);
      best.apiName = meta.body?.name || null;
    }
    if (best) delete best.host;
    return best;
  },
  async lever(slug) {
    let r = must(await getJson(`https://api.lever.co/v0/postings/${encodeURIComponent(slug)}?mode=json`));
    if (r.status === 200 && Array.isArray(r.body) && r.body.length) return { count: r.body.length, apiName: null };
    const eu = must(await getJson(`https://api.eu.lever.co/v0/postings/${encodeURIComponent(slug)}?mode=json`));
    if (eu.status === 200 && Array.isArray(eu.body) && eu.body.length) return { count: eu.body.length, apiName: null, eu: true };
    if (r.status === 200 && Array.isArray(r.body)) return { count: 0, apiName: null };
    if (eu.status === 200 && Array.isArray(eu.body)) return { count: 0, apiName: null, eu: true };
    return null;
  },
  async ashby(slug) {
    const r = must(await getJson(`https://api.ashbyhq.com/posting-api/job-board/${encodeURIComponent(slug)}`, 30000));
    if (r.status !== 200 || !Array.isArray(r.body?.jobs)) return null;
    return { count: r.body.jobs.filter((j) => j.isListed !== false).length, apiName: null };
  },
  async workable(slug) {
    const r = must(await getJson(`https://apply.workable.com/api/v1/widget/accounts/${encodeURIComponent(slug)}`));
    if (r.status !== 200 || !Array.isArray(r.body?.jobs)) return null;
    return { count: r.body.jobs.length, apiName: r.body.name || null };
  },
  async smartrecruiters(slug) {
    // SmartRecruiters answers 200 + empty list for ANY identifier, so require totalFound > 0.
    const r = must(await getJson(`https://api.smartrecruiters.com/v1/companies/${encodeURIComponent(slug)}/postings?limit=1`));
    if (r.status !== 200 || !Array.isArray(r.body?.content) || !r.body.totalFound) return null;
    return { count: r.body.totalFound, apiName: r.body.content[0]?.company?.name || null };
  },
  async recruitee(slug) {
    if (!/^[a-z0-9-]+$/i.test(slug)) return null;
    const r = must(await getJson(`https://${slug.toLowerCase()}.recruitee.com/api/offers/`));
    if (r.status !== 200 || !Array.isArray(r.body?.offers)) return null;
    return { count: r.body.offers.length, apiName: r.body.offers[0]?.company_name || null };
  },
};

// ATSes where every candidate slug is probed; workable/recruitee only get their curated lists.
// Per-ATS lists (module.exports.greenhouse / .lever / .ashby / .smartrecruiters / .workable /
// .recruitee) are probed ONLY on that ATS: use them for slugs harvested from real board URLs, so a
// generic slug cannot match an unrelated organisation on another ATS.
const BLIND_ATS = ['greenhouse', 'lever', 'ashby', 'smartrecruiters'];
function parseCandidates() {
  const mod = require(CANDIDATES);
  const parse = (line, ats) => {
    const [name, ...slugs] = line.split('|').map((s) => s.trim()).filter(Boolean);
    const derived = name.toLowerCase().replace(/[^a-z0-9]/g, '');
    return { name, slugs: [...new Set(slugs.length ? slugs : [derived])], ats };
  };
  return [
    ...mod.map((l) => parse(l, BLIND_ATS)),
    ...ATS_ORDER.flatMap((a) => (mod[a] || []).map((l) => parse(l, [a]))),
  ];
}

async function runPool(items, n, fn) {
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (i < items.length) { const idx = i++; try { await fn(items[idx]); } catch { /* ignore */ } }
  }));
}

async function main() {
  const t0 = Date.now();
  let existing = {};
  try { existing = JSON.parse(fs.readFileSync(OUT, 'utf8')); } catch { /* none yet */ }

  // Build per-ATS probe queues: slug -> result
  const queues = Object.fromEntries(ATS_ORDER.map((a) => [a, new Set()]));
  const candidates = RECHECK_ONLY ? [] : parseCandidates();
  for (const c of candidates) for (const s of c.slugs) for (const a of c.ats) queues[a].add(s);
  for (const a of ATS_ORDER) for (const e of existing[a] || []) queues[a].add(e.slug);

  const results = Object.fromEntries(ATS_ORDER.map((a) => [a, new Map()]));
  let done = 0;
  const total = ATS_ORDER.reduce((n, a) => n + queues[a].size, 0);
  const left = () => ATS_ORDER.map((a) => `${a}:${queues[a].size - results[a].size}`).join(' ');
  const saveCache = () => { try { fs.writeFileSync(CACHE_FILE, JSON.stringify(cache)); } catch { /* ignore */ } };
  let ticks = 0;
  const tick = setInterval(() => {
    console.log(`  probed ${done}/${total} (${((Date.now() - t0) / 1000).toFixed(0)}s) remaining ${left()}`);
    if (++ticks % 3 === 0) saveCache();
  }, 10000);
  let transient = 0;
  const blocked = new Set();
  const unknown = new Set(); // ats:slug probes that could not be completed
  const streak = Object.fromEntries(ATS_ORDER.map((a) => [a, 0]));
  await Promise.all(ATS_ORDER.map((ats) => runPool([...queues[ats]], ATS_CONCURRENCY[ats] || CONCURRENCY, async (slug) => {
    const key = `${ats}:${slug}`;
    const ck = `${ats}${PROBE_VERSION[ats] ? `@${PROBE_VERSION[ats]}` : ''}:${slug}`;
    const hit = cache[ck];
    if (hit && Date.now() - hit.t < CACHE_TTL) { results[ats].set(slug, hit.r); done++; return; }
    if (blocked.has(ats)) { transient++; unknown.add(key); results[ats].set(slug, null); done++; return; }
    try {
      const r = await PROBES[ats](slug);
      results[ats].set(slug, r);
      cache[ck] = { t: Date.now(), r };
      streak[ats] = 0;
    } catch (e) {
      transient++;
      unknown.add(key);
      results[ats].set(slug, null); // unknown (rate-limited / network); not cached so a re-run retries it
      // An ATS that keeps answering 429 has blocked this IP for a while: stop probing it this run.
      if (++streak[ats] >= 4 && !blocked.has(ats)) { blocked.add(ats); console.log(`  ${ats}: rate-limited/blocked, skipping the rest of its queue this run`); }
    }
    done++;
  })));
  clearInterval(tick);
  saveCache();
  if (transient) console.log(`  ${transient} probes failed transiently (re-run later to retry them; existing entries for those boards are kept)`);

  const ok = (r) => r && (KEEP_EMPTY || r.count > 0);
  const out = Object.fromEntries(ATS_ORDER.map((a) => [a, []]));
  const seen = new Set();
  const report = { generatedAt: new Date().toISOString(), kept: [], missing: [] };
  const cand = require(CANDIDATES);
  const exclude = new Set((cand.exclude || []).map((k) => k.toLowerCase()));
  const rename = Object.fromEntries(Object.entries(cand.rename || {}).map(([k, v]) => [k.toLowerCase(), v]));
  const push = (ats, slug, name, r) => {
    const key = `${ats}:${slug.toLowerCase()}`;
    if (seen.has(key) || exclude.has(key)) return false;
    name = rename[key] || name;
    seen.add(key);
    const entry = { slug, name };
    if (r.eu) entry.region = 'eu';
    out[ats].push(entry);
    report.kept.push({ ats, slug, name, apiName: r.apiName, jobs: r.count });
  };

  // Existing entries (user-curated or previous run) that still verify are always kept.
  for (const a of ATS_ORDER) for (const e of existing[a] || []) {
    const r = results[a].get(e.slug);
    if (ok(r)) push(a, e.slug, e.name, r);
    else if (unknown.has(`${a}:${e.slug}`)) push(a, e.slug, e.name, { count: null, eu: e.region === 'eu', unverified: true });
  }
  // Candidates: keep the single best board per company (and one board per company name).
  const keptNames = new Set();
  for (const c of candidates) {
    let best = null;
    for (const s of c.slugs) for (const a of c.ats) {
      const r = results[a].get(s);
      if (ok(r) && !exclude.has(`${a}:${s.toLowerCase()}`) && (!best || r.count > best.r.count)) best = { a, s, r };
    }
    const norm = c.name.toLowerCase().replace(/\(.*?\)/g, '').replace(/[^a-z0-9]/g, '');
    if (best && keptNames.has(norm)) continue;
    if (best) { keptNames.add(norm); push(best.a, best.s, c.name, best.r); }
    else report.missing.push(c.name);
  }

  for (const a of ATS_ORDER) out[a].sort((x, y) => x.name.localeCompare(y.name));
  if (!NO_WRITE) {
    fs.mkdirSync(path.dirname(OUT), { recursive: true });
    fs.writeFileSync(OUT, JSON.stringify(out, null, 2) + '\n');
  }
  fs.writeFileSync(REPORT, JSON.stringify(report, null, 2) + '\n');

  const counts = ATS_ORDER.map((a) => `${a}=${out[a].length}`).join(' ');
  console.log(`Verified ${report.kept.length} boards (${counts}) in ${((Date.now() - t0) / 1000).toFixed(0)}s`);
  console.log(`${NO_WRITE ? 'Dry run (companies.json untouched)' : `Wrote ${path.relative(ROOT, OUT)}`}; details in ${REPORT}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
