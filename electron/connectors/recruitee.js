// Recruitee career sites ({slug}.recruitee.com/api/offers). Public, keyless.
// Recruitee rate-limits per client IP across all tenants, so this connector uses a smaller pool.
const { fetchJson, htmlToText, matchesQuery, matchesLocation, makeJob, pool } = require('./_util');

const ATS = 'recruitee';
const TTL = 20 * 60 * 1000;
const FAIL_TTL = 5 * 60 * 1000;
const boardCache = new Map();

function boardsFrom(ctx) {
  const companies = ctx && ctx.companies ? ctx.companies : require('../data/companies.json');
  const seen = new Set();
  return (companies[ATS] || []).filter((c) => c && c.slug && /^[a-z0-9-]+$/i.test(c.slug) && !seen.has(c.slug.toLowerCase()) && seen.add(c.slug.toLowerCase()));
}

function cached(key, loader) {
  const hit = boardCache.get(key);
  if (hit && Date.now() - hit.t < hit.ttl) return hit.promise;
  const entry = { t: Date.now(), ttl: TTL, promise: null };
  entry.promise = loader().catch((e) => { entry.ttl = FAIL_TTL; throw e; });
  boardCache.set(key, entry);
  return entry.promise;
}

async function fetchWithRetry(url) {
  for (let attempt = 0; ; attempt++) {
    try {
      return await fetchJson(url, { timeout: 25000 });
    } catch (e) {
      if (attempt >= 3 || !/HTTP (429|5\d\d)/.test(e.message)) throw e;
      await new Promise((r) => setTimeout(r, 1500 * 2 ** attempt));
    }
  }
}

const EMPLOYMENT = { fulltime: 'Full-time', parttime: 'Part-time', internship: 'Internship', contract: 'Contract', freelance: 'Freelance', temporary: 'Temporary' };

function normalize(company, o) {
  const locs = (o.locations && o.locations.length ? o.locations : [{ city: o.city, state: o.state_name, country: o.country }])
    .map((l) => [l.city, l.state || l.state_name, l.country].filter(Boolean).join(', '))
    .filter(Boolean);
  const remote = !!o.remote;
  const sal = o.salary || {};
  const salMin = sal.min != null && sal.min !== '' ? Number(sal.min) : null;
  const salMax = sal.max != null && sal.max !== '' ? Number(sal.max) : null;
  const careersUrl = o.careers_url || `https://${company.slug}.recruitee.com/o/${o.slug}`;
  const typeCode = String(o.employment_type_code || '').replace(/_.*/, '');
  return makeJob(ATS, {
    externalId: `${company.slug}:${o.id}`,
    title: o.title,
    company: company.name || o.company_name,
    location: [...new Set(locs)].join(' / ') + (remote ? (locs.length ? ' (Remote)' : 'Remote') : ''),
    remote,
    employmentType: EMPLOYMENT[typeCode] || o.employment_type_code || null,
    salaryMin: Number.isFinite(salMin) ? salMin : null,
    salaryMax: Number.isFinite(salMax) ? salMax : null,
    salaryCurrency: (salMin != null || salMax != null) ? sal.currency || null : null,
    salaryText: (salMin != null || salMax != null) ? `${sal.currency || ''} ${salMin ?? ''} - ${salMax ?? ''}${sal.period ? ` / ${sal.period}` : ''}`.trim() : null,
    description: [htmlToText(o.description), htmlToText(o.requirements)].filter(Boolean).join('\n\n'),
    url: careersUrl,
    applyUrl: o.careers_apply_url || `${careersUrl}/c/new`,
    ats: ATS,
    atsMeta: { company: company.slug, offerId: o.id, offerSlug: o.slug },
    tags: [o.department, ...(o.tags || []), o.hybrid ? 'hybrid' : null].filter((t) => typeof t === 'string' && t),
    postedAt: o.published_at || o.created_at,
  });
}

async function loadBoard(company) {
  return cached(company.slug.toLowerCase(), async () => {
    const data = await fetchWithRetry(`https://${company.slug.toLowerCase()}.recruitee.com/api/offers/`);
    return (data.offers || []).map((o) => normalize(company, o));
  });
}

module.exports = {
  id: ATS,
  name: 'Recruitee',
  kind: 'ats',
  requiresKeys: [],
  homepage: 'https://recruitee.com',
  regions: ['global'],
  description: 'Public Recruitee career sites (mostly European scale-ups such as bunq, Channable). Direct application forms.',
  async search({ query, location, remote, limit } = {}, ctx = {}) {
    const boards = boardsFrom(ctx);
    let failed = 0;
    const lists = await pool(boards, 6, async (c) => {
      try { return await loadBoard(c); } catch (e) { failed++; throw e; }
    });
    if (failed && ctx.log) ctx.log(`recruitee: ${failed}/${boards.length} boards failed to load`);
    return lists.flat().filter(Boolean)
      .filter((j) => matchesQuery(j, query) && matchesLocation(j, location, remote))
      .sort((a, b) => (b.postedAt || '').localeCompare(a.postedAt || ''))
      .slice(0, limit || 100);
  },
};
