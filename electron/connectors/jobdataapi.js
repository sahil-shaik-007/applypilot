// jobdata API — aggregated jobs pulled directly from company career pages / ATSs worldwide.
// Works WITHOUT a key (≈10 requests/hour, 20 results, first page only). An optional key (setting
// "jobdataapiKey", paid plans from https://jobdataapi.com/accounts/signup/) lifts those limits.
// Docs: https://jobdataapi.com/docs/
const { fetchJson, htmlToText, matchesLocation, makeJob } = require('./_util');
const { detectCountry, isCountryOnly } = require('./_helpers');

const id = 'jobdataapi';

module.exports = {
  id,
  name: 'jobdata API',
  kind: 'api',
  requiresKeys: [],
  optionalKeys: ['jobdataapiKey'],
  homepage: 'https://jobdataapi.com',
  regions: ['global'],
  description: 'Jobs sourced directly from company career sites/ATSs worldwide. Free without key (~10 requests/hour, 20 results); optional key "jobdataapiKey" from https://jobdataapi.com for more.',

  async search({ query = '', location = '', remote = 'any', limit = 50 } = {}, ctx = {}) {
    const key = ctx.keys?.jobdataapiKey;
    const params = new URLSearchParams({ max_age: '30' });
    if (query) params.set('title', query);
    const cc = detectCountry(location);
    if (cc) params.set('country_code', cc.toUpperCase());
    else if (location && !/^(anywhere|worldwide|any|remote)$/i.test(location.trim())) params.set('location', location);
    if (remote === 'remote') params.set('has_remote', 'true');
    if (remote === 'onsite') params.set('has_remote', 'false');
    if (key) params.set('page_size', String(Math.min(Math.max(limit, 20), 200)));
    const headers = key ? { Authorization: `Api-Key ${key}` } : {};
    const data = await fetchJson(`https://jobdataapi.com/api/jobs/?${params}`, { headers });
    const rows = data?.results || [];
    const out = [];
    const num = (v) => (v == null || v === '' || Number.isNaN(Number(v)) ? null : Number(v));
    for (const r of rows) {
      const smin = num(r.salary_min);
      const smax = num(r.salary_max);
      const locs = r.location || (r.cities || []).map((c) => [c.name, c.country?.name].filter(Boolean).join(', ')).join('; ') ||
        (r.countries || []).map((c) => c.name).join(', ');
      const cur = r.salary_currency || null;
      const job = makeJob(id, {
        externalId: r.id,
        title: r.title,
        company: r.company?.name,
        companyLogo: r.company?.logo || null,
        location: r.has_remote && !/remote/i.test(locs || '') ? `${locs ? `${locs} / ` : ''}Remote` : locs,
        remote: !!r.has_remote,
        employmentType: (r.types || []).map((t) => t.name).join(', ') || null,
        salaryMin: smin,
        salaryMax: smax,
        salaryCurrency: smin || smax ? cur : null,
        salaryText: smin || smax ? `${cur || ''} ${smin || '?'} - ${smax || '?'}`.trim() : null,
        description: htmlToText(r.description),
        url: r.application_url,
        tags: [r.experience_level, ...(r.regions || []).map((x) => x.name)].filter(Boolean),
        postedAt: r.published || null,
      });
      // Country/remote were filtered server-side; re-check city-level locations locally.
      if (!matchesLocation(job, cc && !isCountryOnly(location) ? location : '', remote)) continue;
      out.push(job);
      if (out.length >= limit) break;
    }
    return out;
  },
};
