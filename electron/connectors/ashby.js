// Ashby job boards (api.ashbyhq.com posting API). Public, keyless; includes compensation.
const { fetchJson, htmlToText, matchesQuery, matchesLocation, makeJob, pool } = require('./_util');

const ATS = 'ashby';
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

const EMPLOYMENT = { FullTime: 'Full-time', PartTime: 'Part-time', Intern: 'Internship', Contract: 'Contract', Temporary: 'Temporary' };

function salaryOf(comp) {
  if (!comp) return {};
  const parts = [...(comp.summaryComponents || []), ...(comp.compensationTiers || []).flatMap((t) => t.components || [])];
  const s = parts.find((c) => c.compensationType === 'Salary' && (c.minValue != null || c.maxValue != null));
  return {
    salaryMin: s ? s.minValue : null,
    salaryMax: s ? s.maxValue : null,
    salaryCurrency: s ? s.currencyCode : null,
    salaryText: comp.scrapeableCompensationSalarySummary || comp.compensationTierSummary || null,
  };
}

function normalize(company, j) {
  const locs = [j.location, ...(j.secondaryLocations || []).map((l) => l.location)].filter(Boolean);
  const jobUrl = j.jobUrl || `https://jobs.ashbyhq.com/${company.slug}/${j.id}`;
  return makeJob(ATS, {
    externalId: `${company.slug}:${j.id}`,
    title: j.title,
    company: company.name,
    location: [...new Set(locs)].join(' / '),
    remote: j.isRemote === true || j.workplaceType === 'Remote',
    employmentType: EMPLOYMENT[j.employmentType] || j.employmentType || null,
    ...salaryOf(j.shouldDisplayCompensationOnJobPostings === false ? null : j.compensation),
    description: j.descriptionPlain || htmlToText(j.descriptionHtml),
    url: jobUrl,
    applyUrl: j.applyUrl || `${jobUrl}/application`,
    ats: ATS,
    atsMeta: { org: company.slug, jobId: j.id, jobUrl },
    tags: [j.department, j.team, j.workplaceType].filter(Boolean),
    postedAt: j.publishedAt,
  });
}

async function loadBoard(company) {
  return cached(company.slug.toLowerCase(), async () => {
    const data = await fetchJson(`https://api.ashbyhq.com/posting-api/job-board/${encodeURIComponent(company.slug)}?includeCompensation=true`, { timeout: 30000 });
    return (data.jobs || []).filter((j) => j.isListed !== false).map((j) => normalize(company, j));
  });
}

module.exports = {
  id: ATS,
  name: 'Ashby',
  kind: 'ats',
  requiresKeys: [],
  homepage: 'https://www.ashbyhq.com',
  regions: ['global'],
  description: 'Public Ashby job boards (OpenAI, Ramp, Notion, Linear, ...) with salary ranges. Direct application forms.',
  async search({ query, location, remote, limit } = {}, ctx = {}) {
    const boards = boardsFrom(ctx);
    let failed = 0;
    const lists = await pool(boards, 12, async (c) => {
      try { return await loadBoard(c); } catch (e) { failed++; throw e; }
    });
    if (failed && ctx.log) ctx.log(`ashby: ${failed}/${boards.length} boards failed to load`);
    return lists.flat().filter(Boolean)
      .filter((j) => matchesQuery(j, query) && matchesLocation(j, location, remote))
      .sort((a, b) => (b.postedAt || '').localeCompare(a.postedAt || ''))
      .slice(0, limit || 100);
  },
};
