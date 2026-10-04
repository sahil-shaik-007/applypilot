// Himalayas — large remote jobs index. Free public API, no key (rate-limited, 20 results/request).
// Docs: https://himalayas.app/api
const { fetchJson, htmlToText, matchesQuery, matchesLocation, makeJob } = require('./_util');
const { detectCountry, isCountryOnly } = require('./_helpers');

const id = 'himalayas';
const MAX_PAGES = 5;

module.exports = {
  id,
  name: 'Himalayas',
  kind: 'api',
  requiresKeys: [],
  homepage: 'https://himalayas.app',
  regions: ['remote', 'global'],
  description: 'Remote jobs from himalayas.app with salary data, server-side keyword search and country filter. Free, no key. Remote-only.',

  async search({ query = '', location = '', remote = 'any', limit = 50 } = {}, ctx = {}) {
    if (remote === 'onsite') return [];
    const cc = detectCountry(location);
    const out = []; // title matches
    const weak = []; // matched only via category tags
    const seen = new Set();
    for (let page = 1; page <= MAX_PAGES && out.length < limit; page++) {
      const params = new URLSearchParams({ sort: 'recent', page: String(page) });
      if (query) params.set('q', query);
      if (cc) params.set('country', cc.toUpperCase());
      let data;
      try {
        data = await fetchJson(`https://himalayas.app/jobs/api/search?${params}`);
      } catch (e) {
        if (page === 1) throw e;
        break; // keep what we have (e.g. 429 on later pages)
      }
      const rows = data?.jobs || [];
      if (!rows.length) break;
      for (const r of rows) {
        const key = r.guid || r.applicationLink;
        if (!key || seen.has(key)) continue;
        seen.add(key);
        const locs = r.locationRestrictions || [];
        const period = r.salaryPeriod && r.salaryPeriod !== 'annual' ? ` / ${r.salaryPeriod}` : ' / year';
        const job = makeJob(id, {
          externalId: key,
          title: r.title,
          company: r.companyName,
          companyLogo: r.companyLogo || null,
          location: locs.length ? `Remote (${locs.join(', ')})` : 'Remote (Worldwide)',
          remote: true,
          employmentType: r.employmentType || null,
          salaryMin: r.minSalary ?? null,
          salaryMax: r.maxSalary ?? null,
          salaryCurrency: r.currency || null,
          salaryText: r.minSalary || r.maxSalary ? `${r.currency || ''} ${r.minSalary || '?'} - ${r.maxSalary || '?'}${period}`.trim() : null,
          description: htmlToText(r.description || r.excerpt),
          url: r.applicationLink || r.guid,
          tags: [...(r.seniority || []), ...(r.parentCategories || []), ...(r.categories || []).slice(0, 6).map((c) => String(c).replace(/-/g, ' '))],
          postedAt: r.pubDate ? r.pubDate * 1000 : null,
        });
        // Server search is loose (matches descriptions); require the query words in title/tags.
        // Country was applied server-side; enforce free-text location locally otherwise.
        if (!matchesQuery(job, query)) continue;
        if (!(cc && isCountryOnly(location)) && !matchesLocation(job, cc ? '' : location, remote)) continue;
        (matchesQuery({ title: job.title }, query) ? out : weak).push(job);
        if (out.length >= limit) break;
      }
      if (rows.length < 20) break;
    }
    return out.concat(weak).slice(0, limit);
  },
};
