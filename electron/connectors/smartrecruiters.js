// SmartRecruiters company career pages (api.smartrecruiters.com v1 postings API). Public, keyless.
//
// Some SmartRecruiters tenants have thousands of postings, so the query is passed to the API's
// full-text search (q=), results are re-filtered locally by title, and full details
// (description + canonical apply URL) are fetched only for the jobs we return.
const { fetchJson, htmlToText, matchesQuery, matchesLocation, makeJob, pool } = require('./_util');

const ATS = 'smartrecruiters';
const API = 'https://api.smartrecruiters.com/v1/companies';
const TTL = 20 * 60 * 1000;
const FAIL_TTL = 5 * 60 * 1000;
const PAGE = 100;
const MAX_PAGES = 5; // per board per query
const boardCache = new Map();
const detailCache = new Map();

function boardsFrom(ctx) {
  const companies = ctx && ctx.companies ? ctx.companies : require('../data/companies.json');
  const seen = new Set();
  return (companies[ATS] || []).filter((c) => c && c.slug && !seen.has(c.slug.toLowerCase()) && seen.add(c.slug.toLowerCase()));
}

function cached(map, key, loader) {
  const hit = map.get(key);
  if (hit && Date.now() - hit.t < hit.ttl) return hit.promise;
  const entry = { t: Date.now(), ttl: TTL, promise: null };
  entry.promise = loader().catch((e) => { entry.ttl = FAIL_TTL; throw e; });
  map.set(key, entry);
  return entry.promise;
}

function normalize(company, p) {
  const loc = p.location || {};
  const remote = !!loc.remote;
  const location = (loc.fullLocation || [loc.city, loc.region, (loc.country || '').toUpperCase()].filter(Boolean).join(', ')) + (remote ? ' (Remote)' : '');
  const id = p.id;
  return makeJob(ATS, {
    externalId: `${company.slug}:${id}`,
    title: p.name,
    company: company.name || (p.company && p.company.name),
    location,
    remote,
    employmentType: p.typeOfEmployment && p.typeOfEmployment.label,
    url: `https://jobs.smartrecruiters.com/${company.slug}/${id}`,
    applyUrl: `https://jobs.smartrecruiters.com/${company.slug}/${id}?oga=true`,
    ats: ATS,
    atsMeta: { company: company.slug, postingId: id, uuid: p.uuid || null },
    // (function label is deliberately not a tag: it is very coarse, e.g. "Engineering" for production roles)
    tags: [p.department && p.department.label, p.experienceLevel && p.experienceLevel.label, loc.hybrid ? 'hybrid' : null].filter(Boolean),
    postedAt: p.releasedDate,
  });
}

async function loadBoard(company, query) {
  const q = (query || '').trim();
  return cached(boardCache, `${company.slug.toLowerCase()}|${q.toLowerCase()}`, async () => {
    const url = (offset) => `${API}/${encodeURIComponent(company.slug)}/postings?limit=${PAGE}&offset=${offset}${q ? `&q=${encodeURIComponent(q)}` : ''}`;
    const first = await fetchJson(url(0), { timeout: 25000 });
    const total = Math.min(first.totalFound || 0, PAGE * MAX_PAGES);
    const offsets = [];
    for (let o = PAGE; o < total; o += PAGE) offsets.push(o);
    const rest = await pool(offsets, 4, (o) => fetchJson(url(o), { timeout: 25000 }));
    const posts = [first, ...rest].filter(Boolean).flatMap((d) => d.content || []);
    return posts.map((p) => normalize(company, p));
  });
}

async function enrich(job) {
  const { company, postingId } = job.atsMeta;
  try {
    const d = await cached(detailCache, `${company}:${postingId}`, () =>
      fetchJson(`${API}/${encodeURIComponent(company)}/postings/${postingId}`, { timeout: 20000 }));
    const sections = (d.jobAd && d.jobAd.sections) || {};
    const text = ['jobDescription', 'qualifications', 'additionalInformation', 'companyDescription']
      .map((k) => sections[k] && sections[k].text ? `${sections[k].title || ''}\n${htmlToText(sections[k].text)}` : '')
      .filter(Boolean).join('\n\n');
    return {
      ...job,
      description: text.slice(0, 12000),
      url: d.postingUrl || job.url,
      applyUrl: d.applyUrl || job.applyUrl,
    };
  } catch {
    return job;
  }
}

module.exports = {
  id: ATS,
  name: 'SmartRecruiters',
  kind: 'ats',
  requiresKeys: [],
  homepage: 'https://www.smartrecruiters.com',
  regions: ['global'],
  description: 'Public SmartRecruiters career pages of large enterprises (Bosch, Visa-style global employers, ...). Direct application forms.',
  async search({ query, location, remote, limit } = {}, ctx = {}) {
    const boards = boardsFrom(ctx);
    let failed = 0;
    const lists = await pool(boards, 12, async (c) => {
      try { return await loadBoard(c, query); } catch (e) { failed++; throw e; }
    });
    if (failed && ctx.log) ctx.log(`smartrecruiters: ${failed}/${boards.length} boards failed to load`);
    const seen = new Set();
    const matched = lists.flat().filter(Boolean)
      .filter((j) => !seen.has(j.id) && seen.add(j.id))
      .filter((j) => matchesQuery(j, query) && matchesLocation(j, location, remote))
      .sort((a, b) => (b.postedAt || '').localeCompare(a.postedAt || ''))
      .slice(0, limit || 100);
    const jobs = await pool(matched, 12, enrich);
    return jobs.map((j, i) => j || matched[i]);
  },
};
