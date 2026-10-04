// Jooble — global job aggregator (70+ countries, incl. India). REST API: POST https://jooble.org/api/{key}
// Key: setting "joobleKey" — request one (free) at https://jooble.org/api/about (limits set per key on
// approval; typically a few hundred requests/day). Docs: https://jooble.org/api/about
const { fetchJson, htmlToText, matchesLocation, makeJob } = require('./_util');
const { parseSalaryText } = require('./_helpers');

const id = 'jooble';

module.exports = {
  id,
  name: 'Jooble',
  kind: 'api',
  requiresKeys: ['joobleKey'],
  homepage: 'https://jooble.org',
  regions: ['global', 'in', 'us', 'gb', 'eu'],
  description: 'Global job aggregator (70+ countries incl. India). Free API key ("joobleKey") on request at https://jooble.org/api/about — limits assigned per key.',

  async search({ query = '', location = '', remote = 'any', limit = 50 } = {}, ctx = {}) {
    const key = ctx.keys?.joobleKey;
    if (!key) throw new Error('Jooble requires an API key (joobleKey)');
    const loc = String(location || '').trim();
    const out = [];
    const seen = new Set();
    const perPage = Math.min(Math.max(limit, 20), 50);
    for (let page = 1; page <= 3 && out.length < limit; page++) {
      const body = {
        keywords: [query, remote === 'remote' ? 'remote' : ''].filter(Boolean).join(' '),
        location: /^(anywhere|worldwide|any|remote)$/i.test(loc) ? '' : loc,
        page: String(page),
        ResultOnPage: String(perPage),
        companysearch: 'false',
      };
      let data;
      try {
        data = await fetchJson(`https://jooble.org/api/${encodeURIComponent(key)}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
      } catch (e) {
        if (page === 1) throw new Error(`${e.message}${/403/.test(e.message) ? ' (invalid or unapproved Jooble key?)' : ''}`);
        break;
      }
      const rows = data?.jobs || [];
      for (const r of rows) {
        const key2 = String(r.id ?? r.link);
        if (seen.has(key2)) continue;
        seen.add(key2);
        const sal = parseSalaryText(r.salary);
        const job = makeJob(id, {
          externalId: key2,
          title: htmlToText(r.title),
          company: htmlToText(r.company),
          location: r.location || '',
          remote: /remote|work from home|wfh/i.test(`${r.title} ${r.location} ${r.type}`),
          employmentType: r.type || null,
          salaryMin: sal.min,
          salaryMax: sal.max,
          salaryCurrency: sal.currency,
          salaryText: r.salary || null,
          description: htmlToText(r.snippet),
          url: r.link,
          tags: [r.source && `via ${r.source}`].filter(Boolean),
          postedAt: r.updated || null,
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
