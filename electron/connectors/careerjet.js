// Careerjet — global job search engine (90+ countries incl. India) via the v4 Job Search API.
// Key: "careerjetKey" — register as a partner at https://www.careerjet.com/partners/ and copy the API key
// (free; publisher programme). Auth: HTTP Basic, key as username, empty password.
// Docs: https://www.careerjet.com/partners/api/
// The API requires the end user's IP + user agent; set "careerjetUserIp" to override auto-detection.
const { fetchJson, fetchText, UA, htmlToText, matchesLocation, makeJob } = require('./_util');
const { detectCountry } = require('./_helpers');

const id = 'careerjet';
const LOCALES = {
  in: 'en_IN', us: 'en_US', gb: 'en_GB', ca: 'en_CA', au: 'en_AU', nz: 'en_NZ', ie: 'en_IE', sg: 'en_SG', za: 'en_ZA',
  ae: 'en_AE', ph: 'en_PH', my: 'en_MY', de: 'de_DE', at: 'de_AT', ch: 'de_CH', fr: 'fr_FR', be: 'fr_BE', nl: 'nl_NL',
  es: 'es_ES', it: 'it_IT', pl: 'pl_PL', pt: 'pt_PT', br: 'pt_BR', mx: 'es_MX', jp: 'ja_JP', se: 'sv_SE',
};
const PERIOD = { Y: 'year', M: 'month', W: 'week', D: 'day', H: 'hour' };

let cachedIp = null;
async function publicIp() {
  if (cachedIp) return cachedIp;
  try {
    cachedIp = (await fetchText('https://api.ipify.org', { timeout: 5000 })).trim();
  } catch {
    cachedIp = '127.0.0.1';
  }
  return cachedIp;
}

module.exports = {
  id,
  name: 'Careerjet',
  kind: 'api',
  requiresKeys: ['careerjetKey'],
  homepage: 'https://www.careerjet.com',
  regions: Object.keys(LOCALES),
  description: 'Global job search engine (90+ countries incl. India). Free partner API key ("careerjetKey") from https://www.careerjet.com/partners/ .',

  async search({ query = '', location = '', remote = 'any', limit = 50 } = {}, ctx = {}) {
    const keys = ctx.keys || {};
    const key = keys.careerjetKey || keys.careerjetAffid;
    if (!key) throw new Error('Careerjet requires an API key (careerjetKey)');
    const cc = detectCountry(location) || 'in';
    const loc = String(location || '').trim();
    const params = new URLSearchParams({
      locale_code: keys.careerjetLocale || LOCALES[cc] || 'en_GB',
      keywords: [query, remote === 'remote' ? 'remote' : ''].filter(Boolean).join(' '),
      sort: 'date',
      page: '1',
      page_size: String(Math.min(Math.max(limit, 10), 100)),
      fragment_size: '600',
      user_ip: keys.careerjetUserIp || (await publicIp()),
      user_agent: UA,
    });
    if (loc && !/^(anywhere|worldwide|any|remote)$/i.test(loc)) params.set('location', loc);
    const data = await fetchJson(`https://search.api.careerjet.net/v4/query?${params}`, {
      headers: { Authorization: `Basic ${Buffer.from(`${key}:`).toString('base64')}` },
    });
    if (data?.type === 'ERROR') throw new Error(`Careerjet: ${data.error || data.message || 'error'}`);
    if (data?.type === 'LOCATIONS') throw new Error(`Careerjet: ambiguous location "${loc}" — try a more specific city`);
    const out = [];
    for (const r of data?.jobs || []) {
      const cur = r.salary_currency_code || null;
      const per = PERIOD[r.salary_type] || '';
      const job = makeJob(id, {
        externalId: r.url,
        title: htmlToText(r.title),
        company: htmlToText(r.company),
        location: r.locations || '',
        remote: /remote|work from home|wfh/i.test(`${r.title} ${r.locations}`),
        salaryMin: r.salary_min ? Number(r.salary_min) : null,
        salaryMax: r.salary_max ? Number(r.salary_max) : null,
        salaryCurrency: cur,
        salaryText: r.salary || (r.salary_min || r.salary_max ? `${cur || ''} ${r.salary_min || '?'} - ${r.salary_max || '?'}${per ? ` / ${per}` : ''}`.trim() : null),
        description: htmlToText(r.description),
        url: r.url,
        tags: [r.site && `via ${r.site}`].filter(Boolean),
        postedAt: r.date && !Number.isNaN(Date.parse(r.date)) ? r.date : null,
      });
      if (!matchesLocation(job, '', remote)) continue;
      out.push(job);
      if (out.length >= limit) break;
    }
    return out;
  },
};
