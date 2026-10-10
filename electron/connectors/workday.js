// Workday career sites (*.myworkdayjobs.com) through Workday's public "CXS" JSON endpoints.
// Public, keyless. Board entries (boards-extra.json / companies.json under "workday"):
//   { slug: "<tenant>/<site>", name, host: "nvidia.wd5.myworkdayjobs.com", tenant: "nvidia", site: "NVIDIAExternalCareerSite" }
//
//   list:   POST https://{host}/wday/cxs/{tenant}/{site}/jobs   {appliedFacets:{}, limit:20, offset, searchText}
//   detail: GET  https://{host}/wday/cxs/{tenant}/{site}{externalPath}
//
// Workday searches server-side, so every board is queried with the user's search text (cached per
// board + query for 20 min), then title/location filtered and the returned jobs enriched with the
// detail endpoint (description, all locations, time type). Workday applications need a candidate
// account, so the engine treats these jobs as assisted-only (never auto-submitted).
const { fetchJson, htmlToText, matchesQuery, matchesLocation, makeJob, pool } = require('./_util');

const ATS = 'workday';
const TTL = 20 * 60 * 1000;
const FAIL_TTL = 5 * 60 * 1000;
const PAGE = 20; // Workday rejects limit > 20
const listCache = new Map();
const detailCache = new Map();

function boardsFrom(ctx) {
  let list = ctx && ctx.companies && Array.isArray(ctx.companies[ATS]) ? ctx.companies[ATS] : null;
  if (!list) { try { list = require('../data/boards-extra.json')[ATS] || []; } catch { list = []; } }
  const seen = new Set();
  return list.map(normalizeBoard).filter((b) => b && !seen.has(b.key) && seen.add(b.key));
}

// Accepts {host, tenant, site} or a full career-site URL in `url`/`host`.
function normalizeBoard(b) {
  if (!b) return null;
  let { host, tenant, site } = b;
  const src = b.url || (host && /\//.test(host) ? host : '');
  const m = /^https?:\/\/(([a-z0-9-]+)\.(wd\d+)\.myworkdayjobs\.com)\/(?:[a-z]{2}-[A-Z]{2}\/)?([A-Za-z0-9_-]+)/i.exec(src);
  if (m) { host = m[1]; tenant = tenant || m[2]; site = site || m[4]; }
  if (!host || !tenant || !site) return null;
  host = host.replace(/^https?:\/\//, '').replace(/\/.*$/, '').toLowerCase();
  return { ...b, host, tenant, site, key: `${host}/${tenant}/${site}`.toLowerCase(), name: b.name || tenant };
}

function cached(map, key, ttl, loader) {
  const hit = map.get(key);
  if (hit && Date.now() - hit.t < hit.ttl) return hit.promise;
  const entry = { t: Date.now(), ttl, promise: null };
  entry.promise = loader().catch((e) => { entry.ttl = FAIL_TTL; throw e; });
  map.set(key, entry);
  return entry.promise;
}

const api = (b) => `https://${b.host}/wday/cxs/${b.tenant}/${b.site}`;

async function post(url, body) {
  for (let attempt = 0; ; attempt++) {
    try {
      return await fetchJson(url, { method: 'POST', body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' }, timeout: 25000 });
    } catch (e) {
      if (attempt >= 2 || !/HTTP (429|5\d\d)/.test(e.message)) throw e;
      await new Promise((r) => setTimeout(r, 1200 * 2 ** attempt));
    }
  }
}

// "Posted Today" / "Posted Yesterday" / "Posted 3 Days Ago" / "Posted 30+ Days Ago" -> ISO date
function postedOnToDate(s) {
  if (!s) return null;
  const day = 86400000;
  if (/today/i.test(s)) return new Date().toISOString();
  if (/yesterday/i.test(s)) return new Date(Date.now() - day).toISOString();
  const m = /(\d+)\+?\s*days?/i.exec(s);
  return m ? new Date(Date.now() - Number(m[1]) * day).toISOString() : null;
}

// "/job/Israel-Yokneam/Software-Engineer_JR123" -> "Israel Yokneam"
function locFromPath(p) {
  const m = /^\/job\/([^/]+)\//.exec(p || '');
  return m ? decodeURIComponent(m[1]).replace(/-{2,}/g, ' - ').replace(/-/g, ' ').trim() : '';
}

function normalizePosting(b, p) {
  const multi = /^\d+\s+locations?$/i.test(p.locationsText || '');
  const url = `https://${b.host}/${b.site}${p.externalPath}`;
  const reqId = (p.bulletFields && p.bulletFields[0]) || p.externalPath;
  const job = makeJob(ATS, {
    externalId: `${b.tenant}:${b.site}:${reqId}`,
    title: p.title,
    company: b.name,
    location: multi ? locFromPath(p.externalPath) : (p.locationsText || locFromPath(p.externalPath)),
    remote: /remote/i.test(`${p.locationsText || ''} ${p.remoteType || ''}`),
    url,
    applyUrl: `${url}/apply`,
    ats: ATS,
    atsMeta: { host: b.host, tenant: b.tenant, site: b.site, externalPath: p.externalPath, reqId, assistedOnly: true },
    tags: [p.timeType].filter(Boolean),
    postedAt: postedOnToDate(p.postedOn),
  });
  job._multi = multi;
  return job;
}

/**
 * Fetch postings of one Workday board (server-side search). Exported for scripts and careerPages.
 * @returns {Promise<{total:number, jobs:Job[]}>}
 */
async function fetchBoard(board, { query = '', max = 60 } = {}) {
  const b = normalizeBoard(board);
  if (!b) throw new Error('workday board needs host, tenant and site');
  const key = `${b.key}|${String(query).toLowerCase().trim()}|${max}`;
  return cached(listCache, key, TTL, async () => {
    const jobs = [];
    let total = 0;
    for (let offset = 0; offset < max; offset += PAGE) {
      const d = await post(`${api(b)}/jobs`, { appliedFacets: {}, limit: PAGE, offset, searchText: query || '' });
      if (offset === 0) total = d.total || 0;
      const list = d.jobPostings || [];
      for (const p of list) if (p && p.title && p.externalPath) jobs.push(normalizePosting(b, p));
      if (list.length < PAGE || offset + PAGE >= total) break;
    }
    return { total, jobs };
  });
}

async function enrich(job) {
  const m = job.atsMeta;
  try {
    const d = await cached(detailCache, `${m.host}/${m.tenant}/${m.site}${m.externalPath}`, TTL, () =>
      fetchJson(`https://${m.host}/wday/cxs/${m.tenant}/${m.site}${m.externalPath}`, { timeout: 20000 }));
    const i = d.jobPostingInfo || {};
    const locs = [i.location, ...(i.additionalLocations || [])].filter(Boolean);
    const out = { ...job, description: htmlToText(i.jobDescription).slice(0, 12000) };
    if (locs.length) out.location = [...new Set(locs)].join(' / ');
    if (i.timeType) out.employmentType = i.timeType;
    if (i.startDate) out.postedAt = new Date(i.startDate).toISOString();
    if (/remote/i.test(`${out.location} ${i.remoteType || ''}`)) out.remote = true;
    if (i.externalUrl) { out.url = i.externalUrl; out.applyUrl = `${i.externalUrl}/apply`; }
    if (d.hiringOrganization && d.hiringOrganization.name) out.atsMeta = { ...m, legalEntity: d.hiringOrganization.name };
    return out;
  } catch {
    return job;
  }
}

async function probe(board) {
  const { total, jobs } = await fetchBoard(board, { query: '', max: PAGE });
  return { count: total || jobs.length };
}

module.exports = {
  id: ATS,
  name: 'Workday',
  kind: 'ats',
  requiresKeys: [],
  homepage: 'https://www.workday.com',
  regions: ['global'],
  description: 'Public Workday career sites of large employers (NVIDIA, Salesforce, Adobe, Intel, ...). Applying needs a Workday account: assisted only.',
  fetchBoard,
  normalizeBoard,
  probe,
  async search({ query, location, remote, limit } = {}, ctx = {}) {
    const max = limit || 100;
    const boards = boardsFrom(ctx);
    // Workday's searchText also matches locations, so "<query> <city>" narrows a 1,700-job board to the
    // relevant postings; a short plain-query page is added because location spellings differ by board.
    const loc = String(location || '').trim();
    const useLoc = loc && !/^(remote|anywhere|worldwide|any)$/i.test(loc) && !/[,/]/.test(loc);
    let failed = 0;
    const lists = await pool(boards, 8, async (b) => {
      try {
        if (!useLoc) return (await fetchBoard(b, { query: query || '', max: 60 })).jobs;
        const [a, c] = await Promise.all([
          fetchBoard(b, { query: `${query || ''} ${loc}`.trim(), max: 60 }),
          fetchBoard(b, { query: query || '', max: PAGE }).catch(() => ({ jobs: [] })),
        ]);
        const seen = new Set();
        return [...a.jobs, ...c.jobs].filter((j) => !seen.has(j.id) && seen.add(j.id));
      } catch (e) { failed++; throw e; }
    });
    if (failed && ctx.log) ctx.log(`workday: ${failed}/${boards.length} boards failed to load`);
    // Multi-location postings only show their first location in the list, so keep them as
    // candidates and re-check the location after the detail call.
    const cand = lists.flat().filter(Boolean)
      .filter((j) => matchesQuery(j, query) && (j._multi ? (remote !== 'remote' && remote !== 'onsite') || matchesLocation(j, '', remote) : matchesLocation(j, location, remote)))
      .sort((a, b) => (b.postedAt || '').localeCompare(a.postedAt || ''));
    const sure = cand.filter((j) => !j._multi);
    const maybe = cand.filter((j) => j._multi);
    const picked = [...sure.slice(0, max), ...maybe.slice(0, Math.max(0, Math.min(maybe.length, max * 2 - Math.min(sure.length, max))))];
    const enriched = (await pool(picked, 10, enrich)).map((j, i) => j || picked[i]);
    return enriched
      .filter((j) => matchesLocation(j, location, remote))
      .map(({ _multi, ...j }) => j)
      .sort((a, b) => (b.postedAt || '').localeCompare(a.postedAt || ''))
      .slice(0, max);
  },
};
