// Rise (joinrise.co) — aggregated tech/startup jobs. Free public API, no key.
// Terms: link back to the Rise URL and mention Rise as the source.
const { fetchJson, htmlToText, matchesQuery, matchesLocation, makeJob } = require('./_util');

const id = 'rise';
const PAGE_SIZE = 100;
const MAX_PAGES = 2;

module.exports = {
  id,
  name: 'Rise',
  kind: 'api',
  requiresKeys: [],
  homepage: 'https://joinrise.co',
  regions: ['global', 'us', 'remote'],
  description: 'Tech & startup jobs aggregated by joinrise.co (title/company/location only, no descriptions). Free public API, no key.',

  async search({ query = '', location = '', remote = 'any', limit = 50 } = {}, ctx = {}) {
    const out = [];
    const seen = new Set();
    for (let page = 1; page <= MAX_PAGES && out.length < limit; page++) {
      const params = new URLSearchParams({ page: String(page), limit: String(PAGE_SIZE) });
      if (query) params.set('search', query);
      let data;
      try {
        data = await fetchJson(`https://api.joinrise.io/api/v1/jobs/public?${params}`);
      } catch (e) {
        if (page === 1) throw e;
        break;
      }
      const rows = data?.result?.jobs || [];
      for (const r of rows) {
        if (!r?._id || seen.has(r._id)) continue;
        seen.add(r._id);
        const loc = /no location/i.test(r.locationAddress || '') ? '' : r.locationAddress || '';
        const desc = r.descriptionBreakdown
          ? htmlToText([r.descriptionBreakdown.oneSentenceJobSummary, ...(r.descriptionBreakdown.keywords || [])].filter(Boolean).join('\n'))
          : '';
        const job = makeJob(id, {
          externalId: r._id,
          title: r.title,
          company: r.owner?.companyName,
          companyLogo: r.owner?.photo && !/avatar\.jpg$/.test(r.owner.photo) ? r.owner.photo : null,
          location: loc,
          remote: /remote/i.test(loc),
          description: desc,
          url: r.url,
          tags: [r.seniority, r.owner?.sector, r.owner?.funding].filter(Boolean),
          postedAt: r.createdAt || r.updatedAt || null,
        });
        if (!matchesQuery(job, query) || !matchesLocation(job, location, remote)) continue;
        out.push(job);
        if (out.length >= limit) break;
      }
      if (rows.length < PAGE_SIZE) break;
    }
    return out;
  },
};
