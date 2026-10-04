// Findwork.dev — developer/tech jobs aggregated from HN, Remote OK, company boards, etc.
// Key: "findworkKey" — free account at https://findwork.dev/ then copy the token from
// https://findwork.dev/developers/ (free; rate-limited). Auth header: "Authorization: Token <key>".
const { fetchJson, htmlToText, matchesLocation, makeJob } = require('./_util');

const id = 'findwork';

module.exports = {
  id,
  name: 'Findwork.dev',
  kind: 'api',
  requiresKeys: ['findworkKey'],
  homepage: 'https://findwork.dev',
  regions: ['global', 'remote', 'us', 'eu'],
  description: 'Developer & tech jobs aggregated by findwork.dev. Free API token ("findworkKey") from https://findwork.dev/developers/ after signing up.',

  async search({ query = '', location = '', remote = 'any', limit = 50 } = {}, ctx = {}) {
    const key = ctx.keys?.findworkKey;
    if (!key) throw new Error('Findwork requires an API token (findworkKey)');
    const params = new URLSearchParams({ sort_by: 'date' });
    if (query) params.set('search', query);
    const loc = String(location || '').trim();
    if (loc && !/^(anywhere|worldwide|any|remote)$/i.test(loc)) params.set('location', loc);
    if (remote === 'remote') params.set('remote', 'true');
    if (remote === 'onsite') params.set('remote', 'false');
    const headers = { Authorization: `Token ${key}` };
    const out = [];
    let url = `https://findwork.dev/api/jobs/?${params}`;
    for (let page = 0; url && page < 3 && out.length < limit; page++) {
      let data;
      try {
        data = await fetchJson(url, { headers });
      } catch (e) {
        if (page === 0) throw e;
        break;
      }
      for (const r of data?.results || []) {
        const job = makeJob(id, {
          externalId: r.id,
          title: r.role,
          company: r.company_name,
          companyLogo: r.logo || null,
          location: r.location || (r.remote ? 'Remote' : ''),
          remote: !!r.remote,
          employmentType: r.employment_type || null,
          description: htmlToText(r.text),
          url: r.url,
          tags: [...(r.keywords || []), r.source && `via ${r.source}`, r.company_num_employees && `${r.company_num_employees} employees`].filter(Boolean),
          postedAt: r.date_posted || null,
        });
        if (!matchesLocation(job, '', remote)) continue;
        out.push(job);
        if (out.length >= limit) break;
      }
      url = data?.next || null;
    }
    return out;
  },
};
