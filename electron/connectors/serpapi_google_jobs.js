// SerpApi Google Jobs — Google for Jobs results (aggregates LinkedIn, Indeed, Glassdoor, Naukri, company
// sites...). Key: "serpapiKey" from https://serpapi.com/users/sign_up (free plan includes a small monthly
// search quota — see https://serpapi.com/pricing; each page of 10 results = 1 search).
// Docs: https://serpapi.com/google-jobs-api
const { fetchJson, htmlToText, matchesLocation, makeJob } = require('./_util');
const { detectCountry, parseSalaryText } = require('./_helpers');

const id = 'serpapi_google_jobs';

function relativeToDate(s) {
  const m = /(\d+)\+?\s*(minute|hour|day|week|month)s?\s+ago/i.exec(String(s || ''));
  if (!m) return null;
  const ms = { minute: 6e4, hour: 36e5, day: 864e5, week: 6048e5, month: 2592e6 }[m[2].toLowerCase()];
  return new Date(Date.now() - Number(m[1]) * ms).toISOString();
}

module.exports = {
  id,
  name: 'Google Jobs (SerpApi)',
  kind: 'api',
  requiresKeys: ['serpapiKey'],
  homepage: 'https://serpapi.com/google-jobs-api',
  regions: ['global', 'in', 'us', 'gb', 'eu'],
  description: 'Google for Jobs results (LinkedIn, Indeed, Glassdoor, Naukri, company sites…) via SerpApi. Key "serpapiKey" from https://serpapi.com/users/sign_up — free plan has a small monthly quota (1 search per 10 results).',

  async search({ query = '', location = '', remote = 'any', limit = 50 } = {}, ctx = {}) {
    const keys = ctx.keys || {};
    if (!keys.serpapiKey) throw new Error('SerpApi requires an API key (serpapiKey)');
    const loc = String(location || '').trim();
    const anywhere = !loc || /^(anywhere|worldwide|any|remote)$/i.test(loc);
    const q = [query || 'jobs', remote === 'remote' ? 'remote' : '', anywhere ? '' : `in ${loc}`].filter(Boolean).join(' ');
    const cc = detectCountry(loc);
    const maxPages = Math.min(Math.ceil(limit / 10), Number(keys.serpapiMaxPages) || 3);
    const out = [];
    let token = null;
    for (let page = 0; page < maxPages && out.length < limit; page++) {
      const params = new URLSearchParams({ engine: 'google_jobs', q, hl: 'en', api_key: keys.serpapiKey });
      if (cc) params.set('gl', cc);
      if (token) params.set('next_page_token', token);
      let data;
      try {
        data = await fetchJson(`https://serpapi.com/search.json?${params}`, { timeout: 45000 });
      } catch (e) {
        if (page === 0) throw e;
        break;
      }
      if (data?.error) {
        if (page === 0 && !/hasn't returned any results/i.test(data.error)) throw new Error(`SerpApi: ${data.error}`);
        break;
      }
      for (const r of data?.jobs_results || []) {
        const ext = r.detected_extensions || {};
        const salaryText = ext.salary || null;
        const sal = parseSalaryText(salaryText);
        const opts = r.apply_options || [];
        const highlights = (r.job_highlights || []).map((h) => `${h.title || ''}:\n${(h.items || []).map((x) => `• ${x}`).join('\n')}`).join('\n\n');
        const job = makeJob(id, {
          externalId: r.job_id || `${r.company_name}|${r.title}|${r.location}`,
          title: r.title,
          company: r.company_name,
          companyLogo: r.thumbnail || null,
          location: r.location || '',
          remote: !!ext.work_from_home || /remote|anywhere/i.test(r.location || ''),
          employmentType: ext.schedule_type || null,
          salaryMin: sal.min,
          salaryMax: sal.max,
          salaryCurrency: sal.currency,
          salaryText,
          description: [htmlToText(r.description), highlights].filter(Boolean).join('\n\n'),
          url: r.share_link || opts[0]?.link,
          applyUrl: opts[0]?.link || r.share_link,
          tags: [r.via, ...(r.extensions || [])].filter(Boolean).slice(0, 8),
          postedAt: relativeToDate(ext.posted_at),
          atsMeta: { via: r.via || null, applyOptions: opts.map((o) => ({ publisher: o.title, url: o.link })) },
        });
        if (!matchesLocation(job, '', remote)) continue;
        out.push(job);
        if (out.length >= limit) break;
      }
      token = data?.serpapi_pagination?.next_page_token;
      if (!token) break;
    }
    return out;
  },
};
