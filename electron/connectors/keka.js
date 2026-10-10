// Keka Hire career portals (Indian HRMS): https://{slug}.keka.com/careers/api/jobs/default/active
// Public, keyless (the JSON the careers page itself loads). Board entries: { slug: "wingify", name: "Wingify" }
// Unknown tenants redirect to /careers/Content/TenantNotFound.html.
// Job page: https://{slug}.keka.com/careers/jobdetails/{id}; form: https://{slug}.keka.com/careers/applyjob/{id}
const { fetchJson, htmlToText, matchesQuery, matchesLocation, makeJob, pool } = require('./_util');

const ATS = 'keka';
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

const JOB_TYPE = { 1: 'Part-time', 2: 'Full-time' };
const PERIOD = { 0: 'year', 1: 'month', 2: 'week', 3: 'day', 4: 'hour' };

function normalize(c, j) {
  const base = `https://${c.slug.toLowerCase()}.keka.com/careers`;
  const locs = (j.jobLocations || []).map((l) => {
    const place = [l.city, l.state, l.countryName].filter(Boolean).join(', ');
    return /remote/i.test(l.name || '') ? `${place || ''} (Remote)`.trim() : (place || l.name || '');
  }).filter(Boolean);
  const location = [...new Set(locs)].join(' / ');
  const s = j.salaryRange || {};
  const hasPay = s.min > 0 || s.max > 0 || s.minimum > 0 || s.maximum > 0;
  const min = s.min ?? s.minimum ?? null;
  const max = s.max ?? s.maximum ?? null;
  return makeJob(ATS, {
    externalId: `${c.slug.toLowerCase()}:${j.id}`,
    title: j.title,
    company: c.name || c.slug,
    location,
    remote: /remote/i.test(location),
    employmentType: JOB_TYPE[j.jobType] || null,
    salaryMin: hasPay ? min : null,
    salaryMax: hasPay ? max : null,
    salaryCurrency: hasPay ? s.currency || null : null,
    salaryText: hasPay ? `${s.currency || ''} ${min ?? '?'} - ${max ?? '?'}${PERIOD[s.salaryPeriod] ? ` / ${PERIOD[s.salaryPeriod]}` : ''}`.trim() : null,
    description: htmlToText(j.description),
    url: `${base}/jobdetails/${j.id}`,
    applyUrl: `${base}/applyjob/${j.id}`,
    ats: ATS,
    atsMeta: { company: c.slug.toLowerCase(), jobId: j.id },
    tags: [j.departmentName, j.experience, ...(j.skillNames || [])].filter(Boolean),
    postedAt: j.publishedOn || null,
  });
}

async function fetchBoard(c) {
  return cached(c.slug.toLowerCase(), async () => {
    const d = await fetchJson(`https://${c.slug.toLowerCase()}.keka.com/careers/api/jobs/default/active`, { timeout: 25000, redirect: 'manual' });
    if (!Array.isArray(d)) throw new Error('not a Keka careers portal');
    return d.filter((j) => j && j.id && j.title).map((j) => normalize(c, j));
  });
}

module.exports = {
  id: ATS,
  name: 'Keka Hire',
  kind: 'ats',
  requiresKeys: [],
  homepage: 'https://www.keka.com/hire',
  regions: ['in'],
  description: 'Public Keka Hire career portals of Indian companies. Application forms (some show a CAPTCHA: assisted).',
  fetchBoard,
  async probe(c) { return { count: (await fetchBoard(c)).length }; },
  async search({ query, location, remote, limit } = {}, ctx = {}) {
    const boards = boardsFrom(ctx);
    let failed = 0;
    const lists = await pool(boards, 10, async (c) => {
      try { return await fetchBoard(c); } catch (e) { failed++; throw e; }
    });
    if (failed && ctx.log) ctx.log(`keka: ${failed}/${boards.length} boards failed to load`);
    return lists.flat().filter(Boolean)
      .filter((j) => matchesQuery(j, query) && matchesLocation(j, location, remote))
      .sort((a, b) => (b.postedAt || '').localeCompare(a.postedAt || ''))
      .slice(0, limit || 100);
  },
};
