// Jobicy — remote jobs. Free public API v2, no key. Docs: https://jobicy.com/jobs-rss-feed
// Terms: credit Jobicy with a direct link to the source listing.
const { fetchJson, htmlToText, matchesQuery, matchesLocation, makeJob } = require('./_util');

const id = 'jobicy';

module.exports = {
  id,
  name: 'Jobicy',
  kind: 'api',
  requiresKeys: [],
  homepage: 'https://jobicy.com',
  regions: ['remote', 'global'],
  description: 'Remote jobs from jobicy.com, often with salary ranges. Free public API, no key. Remote-only.',

  async search({ query = '', location = '', remote = 'any', limit = 50 } = {}, ctx = {}) {
    if (remote === 'onsite') return [];
    const fetchSet = async (tag) => {
      const params = new URLSearchParams({ count: '100' });
      if (tag) params.set('tag', tag);
      const data = await fetchJson(`https://jobicy.com/api/v2/remote-jobs?${params}`);
      return Array.isArray(data?.jobs) ? data.jobs : [];
    };
    const map = (r) => {
      const period = r.salaryPeriod ? ` / ${r.salaryPeriod}` : '';
      const min = r.salaryMin ?? r.annualSalaryMin ?? null;
      const max = r.salaryMax ?? r.annualSalaryMax ?? null;
      return makeJob(id, {
        externalId: r.id,
        title: htmlToText(r.jobTitle),
        company: htmlToText(r.companyName),
        companyLogo: r.companyLogo || null,
        location: r.jobGeo ? `Remote (${r.jobGeo})` : 'Remote',
        remote: true,
        employmentType: (r.jobType || []).join(', ') || null,
        salaryMin: min != null && min !== '' ? Number(min) : null,
        salaryMax: max != null && max !== '' ? Number(max) : null,
        salaryCurrency: r.salaryCurrency || null,
        salaryText: min || max ? `${r.salaryCurrency || ''} ${min || '?'} - ${max || '?'}${period}`.trim() : null,
        description: htmlToText(r.jobDescription || r.jobExcerpt),
        url: r.url,
        tags: [r.jobLevel, ...(r.jobIndustry || []).map((t) => htmlToText(t))].filter(Boolean),
        postedAt: r.pubDate || null,
      });
    };
    const rows = await fetchSet(query);
    let jobs = rows.map(map).filter((j) => matchesQuery(j, query));
    // Tag search is fuzzy; if strict title filtering leaves little, also scan the latest feed.
    if (query && jobs.length < Math.min(limit, 10)) {
      const extra = await fetchSet('').catch(() => []);
      const ids = new Set(jobs.map((j) => j.id));
      jobs = jobs.concat(extra.map(map).filter((j) => !ids.has(j.id) && matchesQuery(j, query)));
    }
    return jobs.filter((j) => matchesLocation(j, location, remote)).slice(0, limit);
  },
};
