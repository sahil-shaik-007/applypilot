// Working Nomads — curated remote jobs. Public JSON export (latest postings), no key.
const { fetchJson, htmlToText, matchesQuery, matchesLocation, makeJob } = require('./_util');

const id = 'workingnomads';

module.exports = {
  id,
  name: 'Working Nomads',
  kind: 'api',
  requiresKeys: [],
  homepage: 'https://www.workingnomads.com',
  regions: ['remote', 'global'],
  description: 'Curated remote jobs from workingnomads.com (latest postings only, small feed). Free, no key. Remote-only.',

  async search({ query = '', location = '', remote = 'any', limit = 50 } = {}, ctx = {}) {
    if (remote === 'onsite') return [];
    const rows = await fetchJson('https://www.workingnomads.com/api/exposed_jobs/');
    if (!Array.isArray(rows)) throw new Error('Unexpected Working Nomads response');
    const out = [];
    for (const r of rows) {
      if (!r?.url || !r.title) continue;
      const job = makeJob(id, {
        externalId: (r.url.match(/\/(\d+)\/?$/) || [])[1] || r.url,
        title: r.title,
        company: r.company_name,
        location: r.location ? `Remote (${r.location})` : 'Remote',
        remote: true,
        description: htmlToText(r.description),
        url: r.url,
        tags: [r.category_name, ...String(r.tags || '').split(',').map((t) => t.trim())].filter(Boolean),
        postedAt: r.pub_date || null,
      });
      if (!matchesQuery(job, query) || !matchesLocation(job, location, remote)) continue;
      out.push(job);
      if (out.length >= limit) break;
    }
    return out;
  },
};
