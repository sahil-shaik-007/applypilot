// Arbeitnow — jobs in Germany/Europe (many English-speaking, visa sponsorship, remote). Free API, no key.
// Info: https://www.arbeitnow.com/blog/job-board-api
const { fetchJson, htmlToText, matchesQuery, matchesLocation, makeJob, pool } = require('./_util');

const id = 'arbeitnow';
const MAX_PAGES = 4;

module.exports = {
  id,
  name: 'Arbeitnow',
  kind: 'api',
  requiresKeys: [],
  homepage: 'https://www.arbeitnow.com',
  regions: ['de', 'eu', 'remote'],
  description: 'Jobs in Germany & Europe (incl. remote and visa-sponsored roles). Free public API, no key. Filtered locally by query.',

  async search({ query = '', location = '', remote = 'any', limit = 50 } = {}, ctx = {}) {
    const pages = Array.from({ length: MAX_PAGES }, (_, i) => i + 1);
    const results = await pool(pages, 2, (p) => fetchJson(`https://www.arbeitnow.com/api/job-board-api?page=${p}`));
    if (!results.some(Boolean)) throw new Error('Arbeitnow API request failed');
    const out = [];
    const seen = new Set();
    for (const res of results) {
      for (const r of res?.data || []) {
        if (!r?.slug || seen.has(r.slug)) continue;
        seen.add(r.slug);
        const job = makeJob(id, {
          externalId: r.slug,
          title: r.title,
          company: r.company_name,
          location: r.location || (r.remote ? 'Remote' : ''),
          remote: !!r.remote,
          employmentType: (r.job_types || []).join(', ') || null,
          description: htmlToText(r.description),
          url: r.url,
          tags: r.tags || [],
          postedAt: r.created_at ? r.created_at * 1000 : null,
        });
        if (!matchesQuery(job, query) || !matchesLocation(job, location, remote)) continue;
        out.push(job);
        if (out.length >= limit) return out;
      }
    }
    return out;
  },
};
