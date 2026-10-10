// BambooHR career sites: https://{slug}.bamboohr.com/careers/list (JSON when Accept: application/json).
// Public, keyless. Board entries: { slug: "canopy", name: "Canopy" }
// The list has title / department / location / employment status; descriptions and the posting date
// come from https://{slug}.bamboohr.com/careers/{id}/detail and are fetched only for returned jobs.
// The application form is on the posting page itself: https://{slug}.bamboohr.com/careers/{id}
const { fetchJson, htmlToText, matchesQuery, matchesLocation, makeJob, pool } = require('./_util');

const ATS = 'bamboohr';
const TTL = 20 * 60 * 1000;
const FAIL_TTL = 5 * 60 * 1000;
const boardCache = new Map();
const detailCache = new Map();

function boardsFrom(ctx) {
  let list = ctx && ctx.companies && Array.isArray(ctx.companies[ATS]) ? ctx.companies[ATS] : null;
  if (!list) { try { list = require('../data/boards-extra.json')[ATS] || []; } catch { list = []; } }
  const seen = new Set();
  return list.filter((c) => c && c.slug && /^[a-z0-9-]+$/i.test(c.slug) && !seen.has(c.slug.toLowerCase()) && seen.add(c.slug.toLowerCase()));
}

function cached(map, key, loader) {
  const hit = map.get(key);
  if (hit && Date.now() - hit.t < hit.ttl) return hit.promise;
  const entry = { t: Date.now(), ttl: TTL, promise: null };
  entry.promise = loader().catch((e) => { entry.ttl = FAIL_TTL; throw e; });
  map.set(key, entry);
  return entry.promise;
}

const LOC_TYPE = { 0: 'On-site', 1: 'Remote', 2: 'Hybrid' };
const base = (slug) => `https://${slug.toLowerCase()}.bamboohr.com/careers`;
// BambooHR answers 302 → its marketing site for unknown tenants; treat that as "no board".
const getJson = (url) => fetchJson(url, { timeout: 20000, redirect: 'manual' });

function placeOf(l) {
  if (!l) return '';
  return [l.city, l.state || l.province, l.country || l.addressCountry].filter(Boolean).join(', ');
}

function normalize(c, j) {
  const loc = placeOf(j.atsLocation) || placeOf(j.location);
  const remote = String(j.locationType) === '1' || j.isRemote === true;
  const url = `${base(c.slug)}/${j.id}`;
  return makeJob(ATS, {
    externalId: `${c.slug.toLowerCase()}:${j.id}`,
    title: j.jobOpeningName,
    company: c.name || c.slug,
    location: remote ? (loc ? `${loc} (Remote)` : 'Remote') : loc,
    remote,
    employmentType: j.employmentStatusLabel || null,
    url,
    applyUrl: url,
    ats: ATS,
    atsMeta: { company: c.slug.toLowerCase(), jobId: String(j.id) },
    tags: [j.departmentLabel, LOC_TYPE[j.locationType] === 'Hybrid' ? 'hybrid' : null].filter(Boolean),
    postedAt: null,
  });
}

async function fetchBoard(c) {
  return cached(boardCache, c.slug.toLowerCase(), async () => {
    const d = await getJson(`${base(c.slug)}/list`);
    if (!d || !Array.isArray(d.result)) throw new Error('not a BambooHR board');
    return d.result.filter((j) => j && j.id && j.jobOpeningName).map((j) => normalize(c, j));
  });
}

async function enrich(job) {
  const { company, jobId } = job.atsMeta;
  try {
    const d = await cached(detailCache, `${company}:${jobId}`, () => getJson(`${base(company)}/${jobId}/detail`));
    const o = (d && d.result && d.result.jobOpening) || {};
    const out = { ...job, description: htmlToText(o.description).slice(0, 12000) };
    if (o.datePosted) out.postedAt = new Date(o.datePosted).toISOString();
    if (o.compensation) out.salaryText = String(o.compensation);
    if (o.minimumExperience) out.tags = [...job.tags, o.minimumExperience];
    if (o.jobOpeningShareUrl) out.url = o.jobOpeningShareUrl;
    return out;
  } catch {
    return job;
  }
}

module.exports = {
  id: ATS,
  name: 'BambooHR',
  kind: 'ats',
  requiresKeys: [],
  homepage: 'https://www.bamboohr.com',
  regions: ['global'],
  description: 'Public BambooHR career sites of SMBs worldwide. Single-page application forms.',
  fetchBoard,
  async probe(c) { return { count: (await fetchBoard(c)).length }; },
  async search({ query, location, remote, limit } = {}, ctx = {}) {
    const boards = boardsFrom(ctx);
    let failed = 0;
    const lists = await pool(boards, 10, async (c) => {
      try { return await fetchBoard(c); } catch (e) { failed++; throw e; }
    });
    if (failed && ctx.log) ctx.log(`bamboohr: ${failed}/${boards.length} boards failed to load`);
    const matched = lists.flat().filter(Boolean)
      .filter((j) => matchesQuery(j, query) && matchesLocation(j, location, remote))
      .sort((a, b) => Number(b.atsMeta.jobId) - Number(a.atsMeta.jobId)) // ids grow over time
      .slice(0, limit || 100);
    const jobs = await pool(matched, 10, enrich);
    return jobs.map((j, i) => j || matched[i]).sort((a, b) => (b.postedAt || '').localeCompare(a.postedAt || ''));
  },
};
