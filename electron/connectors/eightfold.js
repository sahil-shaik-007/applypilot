// Eightfold AI "Talent Intelligence" career sites (Microsoft, NVIDIA, Qualcomm, ...), via the public JSON
// the career site itself calls. Two API generations exist:
//   PCS-X (current): GET https://{host}/api/pcsx/search?domain={domain}&query=&location=&start=N&sort_by=relevance   (10/page)
//                    GET https://{host}/api/pcsx/position_details?position_id={id}&domain={domain}&hl=en
//   v2 (older):      GET https://{host}/api/apply/v2/jobs?domain={domain}&query=&location=&start=N&num=50
// v2 answers 403 "Not authorized for PCSX" on PCS-X sites, so PCS-X is tried first.
// Public, keyless. Board entries: { slug: "microsoft", name: "Microsoft", host: "apply.careers.microsoft.com", domain: "microsoft.com" }
// Eightfold rate-limits hard ("Please try again later"), so requests are sequential per board, retried
// with back-off, and only a few descriptions are fetched. The "Apply" button usually hands over to the
// employer's own ATS (Workday etc.) or an Eightfold form that needs an account: assisted-only.
const { fetchJson, htmlToText, matchesQuery, matchesLocation, makeJob, pool } = require('./_util');

const ATS = 'eightfold';
const TTL = 20 * 60 * 1000;
const FAIL_TTL = 5 * 60 * 1000;
const listCache = new Map();
const detailCache = new Map();
const modeCache = new Map(); // host -> 'pcsx' | 'v2'
const BROWSER_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function boardsFrom(ctx) {
  let list = ctx && ctx.companies && Array.isArray(ctx.companies[ATS]) ? ctx.companies[ATS] : null;
  if (!list) { try { list = require('../data/boards-extra.json')[ATS] || []; } catch { list = []; } }
  const seen = new Set();
  return list.map(normalizeBoard).filter((b) => b && !seen.has(b.key) && seen.add(b.key));
}

function normalizeBoard(b) {
  if (!b || !b.host) return null;
  const host = String(b.host).replace(/^https?:\/\//, '').replace(/\/.*$/, '').toLowerCase();
  const domain = b.domain || `${(b.slug || host.split('.')[0])}.com`;
  return { ...b, host, domain, key: `${host}|${domain}`, name: b.name || b.slug || host };
}

function cached(map, key, loader) {
  const hit = map.get(key);
  if (hit && Date.now() - hit.t < hit.ttl) return hit.promise;
  const entry = { t: Date.now(), ttl: TTL, promise: null };
  entry.promise = loader().catch((e) => { entry.ttl = FAIL_TTL; throw e; });
  map.set(key, entry);
  return entry.promise;
}

async function get(url) {
  for (let attempt = 0; ; attempt++) {
    try {
      return await fetchJson(url, { timeout: 25000, headers: { 'User-Agent': BROWSER_UA } });
    } catch (e) {
      // rate limiting shows up as HTTP 429 or a 200 plain-text "Please try again later" (JSON parse error)
      const retry = /HTTP (429|5\d\d)|JSON|Unexpected token/i.test(e.message);
      if (!retry || attempt >= 3) throw e;
      await sleep(1500 * 2 ** attempt);
    }
  }
}

const qs = (o) => Object.entries(o).filter(([, v]) => v !== '' && v != null).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&');

function normalize(b, p, mode) {
  const locs = p.locations && p.locations.length ? p.locations : [p.location].filter(Boolean);
  const location = [...new Set(locs)].join(' / ');
  const rel = p.positionUrl || (p.canonicalPositionUrl ? null : `/careers/job/${p.id}`);
  const url = p.canonicalPositionUrl || `https://${b.host}${rel}`;
  const wlo = String(p.workLocationOption || p.work_location_option || '');
  const posted = p.postedTs || p.t_create || p.creationTs;
  return makeJob(ATS, {
    externalId: `${b.host}:${p.id}`,
    title: p.name || p.posting_name,
    company: b.name,
    location,
    remote: /remote/i.test(`${wlo} ${location}`),
    description: htmlToText(p.job_description || ''),
    url,
    applyUrl: url,
    ats: ATS,
    atsMeta: { host: b.host, domain: b.domain, positionId: p.id, atsJobId: p.atsJobId || p.ats_job_id || p.displayJobId || null, mode, assistedOnly: true },
    tags: [p.department, /hybrid/i.test(wlo) ? 'hybrid' : null].filter(Boolean),
    postedAt: posted ? new Date(posted * 1000).toISOString() : null,
  });
}

async function searchPcsx(b, { query, location, max }) {
  const jobs = [];
  let count = 0;
  for (let start = 0; start < max; start += 10) {
    const d = await get(`https://${b.host}/api/pcsx/search?${qs({ domain: b.domain, query, location, start, sort_by: 'relevance' })}`);
    if (!d || !d.data || !Array.isArray(d.data.positions)) throw new Error('unexpected Eightfold response');
    if (start === 0) count = d.data.count || 0;
    for (const p of d.data.positions) jobs.push(normalize(b, p, 'pcsx'));
    if (d.data.positions.length < 10 || start + 10 >= count) break;
    await sleep(350);
  }
  return { total: count, jobs };
}

async function searchV2(b, { query, location, max }) {
  const jobs = [];
  let count = 0;
  for (let start = 0; start < max; start += 50) {
    const d = await get(`https://${b.host}/api/apply/v2/jobs?${qs({ domain: b.domain, query, location, start, num: 50, sort_by: 'relevance' })}`);
    const list = (d && d.positions) || [];
    if (start === 0) count = d.count || list.length;
    for (const p of list) jobs.push(normalize(b, p, 'v2'));
    if (list.length < 50 || start + 50 >= count) break;
    await sleep(350);
  }
  return { total: count, jobs };
}

/** Server-side search of one Eightfold site. Exported for scripts. */
async function fetchBoard(board, { query = '', location = '', max = 40 } = {}) {
  const b = normalizeBoard(board);
  if (!b) throw new Error('eightfold board needs host (and domain)');
  return cached(listCache, `${b.key}|${String(query).toLowerCase()}|${String(location).toLowerCase()}|${max}`, async () => {
    const mode = b.mode || modeCache.get(b.host);
    if (mode === 'v2') return searchV2(b, { query, location, max });
    try {
      const r = await searchPcsx(b, { query, location, max });
      modeCache.set(b.host, 'pcsx');
      return r;
    } catch (e) {
      if (mode === 'pcsx') throw e;
      const r = await searchV2(b, { query, location, max });
      modeCache.set(b.host, 'v2');
      return r;
    }
  });
}

async function enrich(job) {
  const { host, domain, positionId, mode } = job.atsMeta;
  if (mode !== 'pcsx' || job.description) return job;
  try {
    const d = await cached(detailCache, `${host}:${positionId}`, () => get(`https://${host}/api/pcsx/position_details?${qs({ position_id: positionId, domain, hl: 'en' })}`));
    const p = (d && d.data) || {};
    return p.jobDescription ? { ...job, description: htmlToText(p.jobDescription).slice(0, 12000) } : job;
  } catch {
    return job;
  }
}

module.exports = {
  id: ATS,
  name: 'Eightfold',
  kind: 'ats',
  requiresKeys: [],
  homepage: 'https://eightfold.ai',
  regions: ['global'],
  description: 'Eightfold-powered career sites of large employers (Microsoft, NVIDIA, Qualcomm, ...). Assisted applications only.',
  fetchBoard,
  normalizeBoard,
  async probe(board) { const { total, jobs } = await fetchBoard(board, { max: 10 }); return { count: total || jobs.length }; },
  async search({ query, location, remote, limit } = {}, ctx = {}) {
    const max = limit || 100;
    const boards = boardsFrom(ctx);
    const loc = String(location || '').trim();
    const serverLoc = loc && !/^(remote|anywhere|worldwide|any)$/i.test(loc) && !/[,/]/.test(loc) ? loc : '';
    let failed = 0;
    const lists = await pool(boards, 4, async (b) => {
      try { return (await fetchBoard(b, { query: query || '', location: serverLoc, max: 40 })).jobs; } catch (e) { failed++; throw e; }
    });
    if (failed && ctx.log) ctx.log(`eightfold: ${failed}/${boards.length} boards failed to load`);
    const matched = lists.flat().filter(Boolean)
      .filter((j) => matchesQuery(j, query) && (serverLoc ? matchesLocation(j, '', remote) : matchesLocation(j, location, remote)))
      .sort((a, b) => (b.postedAt || '').localeCompare(a.postedAt || ''))
      .slice(0, max);
    // Descriptions only for the first few (one at a time) to stay under Eightfold's rate limit.
    const head = await pool(matched.slice(0, 12), 1, enrich);
    return [...head.map((j, i) => j || matched[i]), ...matched.slice(12)];
  },
};
