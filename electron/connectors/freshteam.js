// Freshteam (Freshworks) career sites: https://{slug}.freshteam.com/hire/widgets/jobs.json
// Public, keyless (the JSON behind the embeddable jobs widget). Board entries: { slug: "zetwerk", name: "Zetwerk" }
// Unknown tenants answer 200 with an HTML page, so only a JSON body with a `jobs` array counts.
// The application form is at {job url}/applicant.
const { fetchJson, htmlToText, matchesQuery, matchesLocation, makeJob, pool } = require('./_util');

const ATS = 'freshteam';
const TTL = 20 * 60 * 1000;
const FAIL_TTL = 5 * 60 * 1000;
const boardCache = new Map();

function boardsFrom(ctx) {
  let list = ctx && ctx.companies && Array.isArray(ctx.companies[ATS]) ? ctx.companies[ATS] : null;
  if (!list) { try { list = require('../data/boards-extra.json')[ATS] || []; } catch { list = []; } }
  const seen = new Set();
  return list.filter((c) => c && c.slug && /^[a-z0-9-]+$/i.test(c.slug) && !seen.has(c.slug.toLowerCase()) && seen.add(c.slug.toLowerCase()));
}

function cached(key, loader) {
  const hit = boardCache.get(key);
  if (hit && Date.now() - hit.t < hit.ttl) return hit.promise;
  const entry = { t: Date.now(), ttl: TTL, promise: null };
  entry.promise = loader().catch((e) => { entry.ttl = FAIL_TTL; throw e; });
  boardCache.set(key, entry);
  return entry.promise;
}

const COUNTRY = { IN: 'India', US: 'United States', GB: 'United Kingdom', AE: 'United Arab Emirates', SG: 'Singapore', DE: 'Germany', AU: 'Australia', CA: 'Canada' };
const SAMPLE = /^sample job posting$/i;

function normalize(c, j, branches, roles) {
  const b = branches.get(j.branch_id) || {};
  const branchLoc = b.location || [b.city, COUNTRY[b.country_code] || b.country_code].filter(Boolean).join(', ');
  const prefer = (j.preferred_remote_job_locations || '').split('|').map((s) => s.trim()).filter(Boolean);
  const remote = !!j.remote;
  const location = remote ? `${prefer.length ? prefer.join(' / ') : branchLoc} (Remote)`.trim() : branchLoc;
  const url = j.url || `https://${c.slug}.freshteam.com/jobs/${j.unique_id}`;
  return makeJob(ATS, {
    externalId: `${c.slug.toLowerCase()}:${j.id}`,
    title: j.title,
    company: c.name || c.slug,
    location,
    remote,
    description: htmlToText(j.description),
    url,
    applyUrl: `${url.replace(/[?#].*$/, '').replace(/\/$/, '')}/applicant`,
    ats: ATS,
    atsMeta: { company: c.slug.toLowerCase(), jobId: j.id, uniqueId: j.unique_id || null, closingDate: j.closing_date || null },
    tags: [roles.get(j.job_role_id)].filter(Boolean),
    postedAt: j.created_at || null,
  });
}

async function fetchBoard(c) {
  return cached(c.slug.toLowerCase(), async () => {
    let d;
    try { d = await fetchJson(`https://${c.slug.toLowerCase()}.freshteam.com/hire/widgets/jobs.json`, { timeout: 25000 }); } catch (e) {
      if (/JSON|Unexpected token/i.test(e.message)) throw new Error('not a Freshteam board');
      throw e;
    }
    if (!d || !Array.isArray(d.jobs)) throw new Error('not a Freshteam board');
    const branches = new Map((d.branches || []).map((b) => [b.id, b]));
    const roles = new Map((d.job_roles || []).map((r) => [r.id, r.name]));
    const now = Date.now();
    return d.jobs
      .filter((j) => j && j.title && !j.deleted && !SAMPLE.test(j.title) && (!j.closing_date || new Date(j.closing_date).getTime() > now))
      .map((j) => normalize(c, j, branches, roles));
  });
}

module.exports = {
  id: ATS,
  name: 'Freshteam',
  kind: 'ats',
  requiresKeys: [],
  homepage: 'https://www.freshworks.com/hrms/',
  regions: ['in', 'global'],
  description: 'Public Freshteam career sites (Indian and global SMBs). Direct application forms.',
  fetchBoard,
  async probe(c) { return { count: (await fetchBoard(c)).length }; },
  async search({ query, location, remote, limit } = {}, ctx = {}) {
    const boards = boardsFrom(ctx);
    let failed = 0;
    const lists = await pool(boards, 10, async (c) => {
      try { return await fetchBoard(c); } catch (e) { failed++; throw e; }
    });
    if (failed && ctx.log) ctx.log(`freshteam: ${failed}/${boards.length} boards failed to load`);
    return lists.flat().filter(Boolean)
      .filter((j) => matchesQuery(j, query) && matchesLocation(j, location, remote))
      .sort((a, b) => (b.postedAt || '').localeCompare(a.postedAt || ''))
      .slice(0, limit || 100);
  },
};
