// Remotive — curated remote jobs. Free public API, no key. https://remotive.com/api/remote-jobs
// Terms: link back to the Remotive URL and credit Remotive as the source.
const { fetchJson, htmlToText, matchesQuery, matchesLocation, makeJob } = require('./_util');
const { parseSalaryText } = require('./_helpers');

const id = 'remotive';

module.exports = {
  id,
  name: 'Remotive',
  kind: 'api',
  requiresKeys: [],
  homepage: 'https://remotive.com',
  regions: ['remote', 'global'],
  description: 'Curated remote jobs (tech, data, product, marketing, support). Free public API, no key needed. Remote-only.',

  async search({ query = '', location = '', remote = 'any', limit = 50 } = {}, ctx = {}) {
    if (remote === 'onsite') return [];
    const fetchRows = async (q) => {
      const params = new URLSearchParams();
      if (q) params.set('search', q);
      params.set('limit', String(Math.max(150, limit * 3)));
      const data = await fetchJson(`https://remotive.com/api/remote-jobs?${params}`);
      return Array.isArray(data?.jobs) ? data.jobs : [];
    };
    let rows = await fetchRows(query);
    // Remotive's search is phrase-ish; fall back to the last query word for broader recall.
    const words = String(query).trim().split(/\s+/).filter(Boolean);
    if (words.length > 1 && rows.length < limit) {
      const more = await fetchRows(words[words.length - 1]).catch(() => []);
      const ids = new Set(rows.map((r) => r.id));
      rows = rows.concat(more.filter((r) => !ids.has(r.id)));
    }
    const out = [];
    for (const r of rows) {
      const sal = parseSalaryText(r.salary);
      const pd = r.publication_date;
      const job = makeJob(id, {
        externalId: r.id,
        title: r.title,
        company: r.company_name,
        companyLogo: r.company_logo_url || r.company_logo || null,
        location: r.candidate_required_location ? `Remote (${r.candidate_required_location})` : 'Remote',
        remote: true,
        employmentType: r.job_type ? String(r.job_type).replace(/_/g, '-') : null,
        salaryMin: sal.min,
        salaryMax: sal.max,
        salaryCurrency: sal.currency,
        salaryText: r.salary || null,
        description: htmlToText(r.description),
        url: r.url,
        tags: [r.category, ...(r.tags || [])].filter(Boolean),
        postedAt: pd ? (/Z|[+-]\d\d:?\d\d$/.test(pd) ? pd : `${pd}Z`) : null,
      });
      if (!matchesQuery(job, query) || !matchesLocation(job, location, remote)) continue;
      out.push(job);
      if (out.length >= limit) break;
    }
    return out;
  },
};
