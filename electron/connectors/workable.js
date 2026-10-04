// Workable job boards (apply.workable.com widget API). Public, keyless.
const { fetchJson, htmlToText, matchesQuery, matchesLocation, makeJob, pool } = require('./_util');

const ATS = 'workable';
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

function normalize(company, apiName, j) {
  const locs = (j.locations && j.locations.length ? j.locations : [{ city: j.city, region: j.state, country: j.country }])
    .map((l) => [l.city, l.region, l.country].filter(Boolean).join(', '))
    .filter(Boolean);
  const url = j.url || j.shortlink || `https://apply.workable.com/${company.slug}/j/${j.shortcode}/`;
  return makeJob(ATS, {
    externalId: `${company.slug}:${j.shortcode}`,
    title: j.title,
    company: company.name || apiName,
    location: [...new Set(locs)].join(' / ') + (j.telecommuting ? (locs.length ? ' (Remote)' : 'Remote') : ''),
    remote: !!j.telecommuting,
    employmentType: j.employment_type || null,
    description: htmlToText(j.description),
    url,
    applyUrl: j.application_url || `https://apply.workable.com/${company.slug}/j/${j.shortcode}/apply/`,
    ats: ATS,
    atsMeta: { account: company.slug, shortcode: j.shortcode },
    // industry/function are left out of tags on purpose: values like "Computer Software" would make
    // matchesQuery's tag fallback treat e.g. a "Sales Engineer" as a "software engineer".
    tags: [j.department, j.experience].filter(Boolean),
    postedAt: j.published_on || j.created_at,
  });
}

// Workable rate-limits per client IP across all accounts (bursts get 429s for minutes), so
// requests are spaced out and 429s are retried with backoff.
const GAP_MS = 350;
let nextSlot = 0;
async function throttle() {
  const now = Date.now();
  const at = Math.max(now, nextSlot);
  nextSlot = at + GAP_MS;
  if (at > now) await new Promise((r) => setTimeout(r, at - now));
}

async function fetchThrottled(url) {
  for (let attempt = 0; ; attempt++) {
    await throttle();
    try {
      return await fetchJson(url, { timeout: 25000 });
    } catch (e) {
      if (attempt >= 3 || !/HTTP (429|5\d\d)/.test(e.message)) throw e;
      await new Promise((r) => setTimeout(r, 2000 * 2 ** attempt));
    }
  }
}

async function loadBoard(company) {
  return cached(company.slug.toLowerCase(), async () => {
    const data = await fetchThrottled(`https://apply.workable.com/api/v1/widget/accounts/${encodeURIComponent(company.slug)}?details=true`);
    return (data.jobs || []).map((j) => normalize(company, data.name, j));
  });
}

module.exports = {
  id: ATS,
  name: 'Workable',
  kind: 'ats',
  requiresKeys: [],
  homepage: 'https://www.workable.com',
  regions: ['global'],
  description: 'Public Workable career pages (Hugging Face and many SMB/European companies). Direct application forms.',
  async search({ query, location, remote, limit } = {}, ctx = {}) {
    const boards = boardsFrom(ctx);
    let failed = 0;
    const lists = await pool(boards, 4, async (c) => {
      try { return await loadBoard(c); } catch (e) { failed++; throw e; }
    });
    if (failed && ctx.log) ctx.log(`workable: ${failed}/${boards.length} boards failed to load`);
    return lists.flat().filter(Boolean)
      .filter((j) => matchesQuery(j, query) && matchesLocation(j, location, remote))
      .sort((a, b) => (b.postedAt || '').localeCompare(a.postedAt || ''))
      .slice(0, limit || 100);
  },
};
