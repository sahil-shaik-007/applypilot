// 4 Day Week — jobs at companies offering 4-day weeks / reduced hours / strong benefits (many big-tech roles).
// Free public API, no key, 60 req/min. Docs: https://4dayweek.io/developers
const { fetchJson, matchesQuery, matchesLocation, makeJob } = require('./_util');
const { detectCountry, isCountryOnly } = require('./_helpers');

const id = 'fourdayweek';
const MAX_PAGES = 3;

function mdToText(md) {
  return String(md || '')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/^#{1,6}\s*/gm, '')
    .replace(/\*\*|__|\*(?=\S)|(?<=\S)\*/g, '')
    .replace(/^\s*[-*]\s+/gm, '• ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

const COUNTRY_NAMES = { in: 'India', us: 'United States', gb: 'United Kingdom', ca: 'Canada', au: 'Australia', de: 'Germany', fr: 'France', nl: 'Netherlands', es: 'Spain', ie: 'Ireland', pt: 'Portugal', pl: 'Poland', sg: 'Singapore' };

module.exports = {
  id,
  name: '4 Day Week',
  kind: 'api',
  requiresKeys: [],
  homepage: 'https://4dayweek.io',
  regions: ['global', 'remote', 'us', 'eu'],
  description: 'Jobs with 4-day weeks, reduced hours or generous benefits (onsite, hybrid & remote), often with salary. Free API, no key.',

  async search({ query = '', location = '', remote = 'any', limit = 50 } = {}, ctx = {}) {
    const cc = detectCountry(location);
    const out = [];
    const seen = new Set();
    for (let page = 1; page <= MAX_PAGES && out.length < limit; page++) {
      const params = new URLSearchParams({ page: String(page), limit: '100' });
      if (query) params.set('q', query);
      if (cc && COUNTRY_NAMES[cc]) params.set('country', COUNTRY_NAMES[cc]);
      if (remote === 'remote') params.set('work_arrangement', 'remote');
      if (remote === 'onsite') params.set('work_arrangement', 'onsite,hybrid');
      let data;
      try {
        data = await fetchJson(`https://4dayweek.io/api/v2/jobs?${params}`);
      } catch (e) {
        if (page === 1) throw e;
        break;
      }
      const rows = data?.data || data?.jobs || [];
      for (const r of rows) {
        if (!r?.id || seen.has(r.id)) continue;
        seen.add(r.id);
        const locs = (r.locations || []).map((l) => [l.city, l.state, l.country].filter(Boolean).join(', ')).filter(Boolean);
        const isRemote = r.work_arrangement === 'remote';
        const cur = r.salary_currency || null;
        const min = r.salary_min != null ? Math.round(r.salary_min / 100) : null; // API returns cents
        const max = r.salary_max != null ? Math.round(r.salary_max / 100) : null;
        const job = makeJob(id, {
          externalId: r.id,
          title: r.title,
          company: r.company?.name,
          companyLogo: r.company?.logo_url || null,
          location: [isRemote ? 'Remote' : r.work_arrangement === 'hybrid' ? 'Hybrid' : '', locs.slice(0, 4).join('; ')].filter(Boolean).join(' - '),
          remote: isRemote,
          employmentType: r.contract_type || null,
          salaryMin: min,
          salaryMax: max,
          salaryCurrency: cur,
          salaryText: min || max ? `${cur || ''} ${min || '?'} - ${max || '?'}${r.salary_period ? ` / ${r.salary_period}` : ''}`.trim() : null,
          description: mdToText(r.description),
          url: r.url,
          tags: [r.category, r.level, r.schedule_type && String(r.schedule_type).replace(/_/g, ' '), ...(r.skills || []).map((s) => s.name), ...(r.stack || []).map((s) => s.name)].filter(Boolean),
          postedAt: r.posted_at || null,
        });
        if (!matchesQuery(job, query) || !matchesLocation(job, cc && isCountryOnly(location) ? '' : location, remote)) continue;
        out.push(job);
        if (out.length >= limit) break;
      }
      if (!data?.has_more) break;
    }
    return out;
  },
};
