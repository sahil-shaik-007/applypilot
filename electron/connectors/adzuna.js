// Adzuna — large job search engine (India, US, UK, EU, AU, CA, SG, ...), with salary data.
// Keys: "adzunaAppId" + "adzunaAppKey" — register free at https://developer.adzuna.com/signup
// (free tier: ~250 requests/day, 25 hits/minute). Optional "adzunaCountry" overrides country detection.
// Docs: https://developer.adzuna.com/docs/search
const { fetchJson, htmlToText, matchesLocation, makeJob } = require('./_util');
const { detectCountry } = require('./_helpers');

const id = 'adzuna';
const SUPPORTED = ['at', 'au', 'be', 'br', 'ca', 'ch', 'de', 'es', 'fr', 'gb', 'in', 'it', 'mx', 'nl', 'nz', 'pl', 'sg', 'us', 'za'];
const CURRENCY = { at: 'EUR', au: 'AUD', be: 'EUR', br: 'BRL', ca: 'CAD', ch: 'CHF', de: 'EUR', es: 'EUR', fr: 'EUR', gb: 'GBP', in: 'INR', it: 'EUR', mx: 'MXN', nl: 'EUR', nz: 'NZD', pl: 'PLN', sg: 'SGD', us: 'USD', za: 'ZAR' };

module.exports = {
  id,
  name: 'Adzuna',
  kind: 'api',
  requiresKeys: ['adzunaAppId', 'adzunaAppKey'],
  homepage: 'https://www.adzuna.com',
  regions: SUPPORTED,
  description: 'Large job search engine for India, US, UK, EU, AU, CA, SG and more, with salary data. Free App ID + Key from https://developer.adzuna.com/signup (≈250 requests/day). Country from location (override with "adzunaCountry").',

  async search({ query = '', location = '', remote = 'any', limit = 50 } = {}, ctx = {}) {
    const keys = ctx.keys || {};
    if (!keys.adzunaAppId || !keys.adzunaAppKey) throw new Error('Adzuna requires adzunaAppId and adzunaAppKey');
    const override = String(keys.adzunaCountry || '').toLowerCase().trim();
    let country = SUPPORTED.includes(override) ? override : detectCountry(location);
    if (!SUPPORTED.includes(country)) country = 'us';
    // Country-only locations ("India", "USA") should not be sent as "where".
    const loc = String(location || '').trim();
    const where = loc && !/^(anywhere|worldwide|any|remote|india|usa|us|united states|uk|united kingdom|canada|australia|germany|france|singapore)$/i.test(loc) ? loc : '';
    const perPage = Math.min(Math.max(limit, 10), 50);
    const pages = Math.min(Math.ceil(limit / perPage), 3);
    const out = [];
    for (let page = 1; page <= pages && out.length < limit; page++) {
      const params = new URLSearchParams({
        app_id: keys.adzunaAppId,
        app_key: keys.adzunaAppKey,
        results_per_page: String(perPage),
        'content-type': 'application/json',
        max_days_old: '30',
        sort_by: 'date',
      });
      const what = [query, remote === 'remote' ? 'remote' : ''].filter(Boolean).join(' ');
      if (what) params.set('what', what);
      if (where) params.set('where', where);
      let data;
      try {
        data = await fetchJson(`https://api.adzuna.com/v1/api/jobs/${country}/search/${page}?${params}`);
      } catch (e) {
        if (page === 1) throw e;
        break;
      }
      const rows = data?.results || [];
      for (const r of rows) {
        const loc2 = r.location?.display_name || (r.location?.area || []).slice().reverse().join(', ');
        const cur = CURRENCY[country] || null;
        const predicted = String(r.salary_is_predicted) === '1';
        const job = makeJob(id, {
          externalId: `${country}-${r.id}`,
          title: htmlToText(r.title),
          company: htmlToText(r.company?.display_name),
          location: loc2,
          remote: /remote|work from home|wfh/i.test(`${r.title} ${loc2}`),
          employmentType: [r.contract_time, r.contract_type].filter(Boolean).join(', ').replace(/_/g, '-') || null,
          salaryMin: r.salary_min ?? null,
          salaryMax: r.salary_max ?? null,
          salaryCurrency: r.salary_min || r.salary_max ? cur : null,
          salaryText: r.salary_min || r.salary_max ? `${cur || ''} ${Math.round(r.salary_min || 0) || '?'} - ${Math.round(r.salary_max || 0) || '?'} / year${predicted ? ' (estimated)' : ''}`.trim() : null,
          description: htmlToText(r.description),
          url: r.redirect_url,
          tags: [r.category?.label, country.toUpperCase()].filter(Boolean),
          postedAt: r.created || null,
        });
        if (!matchesLocation(job, '', remote)) continue;
        out.push(job);
        if (out.length >= limit) break;
      }
      if (rows.length < perPage) break;
    }
    return out;
  },
};
