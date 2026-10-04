// Lever job boards (api.lever.co / api.eu.lever.co). Public, keyless.
const { fetchJson, htmlToText, matchesQuery, matchesLocation, makeJob, pool } = require('./_util');

const ATS = 'lever';
const TTL = 20 * 60 * 1000;
const FAIL_TTL = 5 * 60 * 1000;
const boardCache = new Map();

function boardsFrom(ctx) {
  const companies = ctx && ctx.companies ? ctx.companies : require('../data/companies.json');
  const seen = new Set();
  return (companies[ATS] || []).filter((c) => c && c.slug && !seen.has(c.slug.toLowerCase()) && seen.add(c.slug.toLowerCase()));
}

function cached(key, loader) {
  const hit = boardCache.get(key);
  if (hit && Date.now() - hit.t < hit.ttl) return hit.promise;
  const entry = { t: Date.now(), ttl: TTL, promise: null };
  entry.promise = loader().catch((e) => { entry.ttl = FAIL_TTL; throw e; });
  boardCache.set(key, entry);
  return entry.promise;
}

const INTERVAL = { 'per-year-salary': 'year', 'per-month-salary': 'month', 'per-hour-wage': 'hour', 'per-day-wage': 'day', 'per-week-salary': 'week' };

function toText(p) {
  const parts = [p.openingPlain || htmlToText(p.opening), p.descriptionBodyPlain || p.descriptionPlain || htmlToText(p.description)];
  for (const l of p.lists || []) parts.push(`${l.text || ''}\n${htmlToText(l.content)}`);
  parts.push(p.additionalPlain || htmlToText(p.additional));
  return parts.filter((s) => s && s.trim()).join('\n\n').trim();
}

function normalize(company, p, eu) {
  const cat = p.categories || {};
  const locs = cat.allLocations && cat.allLocations.length ? cat.allLocations : [cat.location].filter(Boolean);
  const sr = p.salaryRange;
  const fmt = (n) => (n >= 1000 ? `${Math.round(n / 1000)}K` : String(n));
  const salaryText = sr && (sr.min || sr.max)
    ? `${sr.currency || ''} ${fmt(sr.min || 0)} - ${fmt(sr.max || 0)}${INTERVAL[sr.interval] ? ` / ${INTERVAL[sr.interval]}` : ''}`.trim()
    : (p.salaryDescriptionPlain || '').trim() || null;
  const host = eu ? 'https://jobs.eu.lever.co' : 'https://jobs.lever.co';
  const hostedUrl = p.hostedUrl || `${host}/${company.slug}/${p.id}`;
  return makeJob(ATS, {
    externalId: `${company.slug}:${p.id}`,
    title: p.text,
    company: company.name,
    location: [...new Set(locs)].join(' / '),
    remote: p.workplaceType === 'remote',
    employmentType: cat.commitment || null,
    salaryMin: sr ? sr.min ?? null : null,
    salaryMax: sr ? sr.max ?? null : null,
    salaryCurrency: sr ? sr.currency || null : null,
    salaryText,
    description: toText(p),
    url: hostedUrl,
    applyUrl: p.applyUrl || `${hostedUrl}/apply`,
    ats: ATS,
    atsMeta: { company: company.slug, postingId: p.id, region: eu ? 'eu' : 'global', hostedUrl },
    tags: [cat.team, cat.department, cat.commitment, p.workplaceType].filter(Boolean),
    postedAt: p.createdAt,
  });
}

async function loadBoard(company) {
  const eu = company.region === 'eu';
  return cached(`${eu ? 'eu' : 'g'}:${company.slug.toLowerCase()}`, async () => {
    const base = eu ? 'https://api.eu.lever.co' : 'https://api.lever.co';
    const data = await fetchJson(`${base}/v0/postings/${encodeURIComponent(company.slug)}?mode=json`, { timeout: 25000 });
    return (Array.isArray(data) ? data : []).map((p) => normalize(company, p, eu));
  });
}

module.exports = {
  id: ATS,
  name: 'Lever',
  kind: 'ats',
  requiresKeys: [],
  homepage: 'https://www.lever.co',
  regions: ['global'],
  description: 'Public Lever job boards (US + EU instances): CRED, Meesho, Palantir, Spotify and many more. Direct application forms.',
  async search({ query, location, remote, limit } = {}, ctx = {}) {
    const boards = boardsFrom(ctx);
    let failed = 0;
    const lists = await pool(boards, 12, async (c) => {
      try { return await loadBoard(c); } catch (e) { failed++; throw e; }
    });
    if (failed && ctx.log) ctx.log(`lever: ${failed}/${boards.length} boards failed to load`);
    return lists.flat().filter(Boolean)
      .filter((j) => matchesQuery(j, query) && matchesLocation(j, location, remote))
      .sort((a, b) => (b.postedAt || '').localeCompare(a.postedAt || ''))
      .slice(0, limit || 100);
  },
};
