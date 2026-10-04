// Remote OK — remote jobs board. Free public API (no key); requires a browser-like User-Agent.
// Terms: link back to the Remote OK URL and mention Remote OK as the source.
const { fetchJson, htmlToText, matchesQuery, matchesLocation, makeJob } = require('./_util');
const { dedupe } = require('./_helpers');

const id = 'remoteok';

function slug(s) {
  return String(s || '').toLowerCase().trim().replace(/[^a-z0-9+#]+/g, '-').replace(/^-|-$/g, '');
}

module.exports = {
  id,
  name: 'Remote OK',
  kind: 'api',
  requiresKeys: [],
  homepage: 'https://remoteok.com',
  regions: ['remote', 'global'],
  description: 'Remote jobs from remoteok.com (tech-heavy, often with salary ranges). Free public API, no key. Remote-only.',

  async search({ query = '', location = '', remote = 'any', limit = 50 } = {}, ctx = {}) {
    if (remote === 'onsite') return [];
    // The API returns ~100 latest jobs per tag; query a few tag variants and filter locally.
    const words = String(query).toLowerCase().split(/\s+/).map(slug).filter((w) => w.length > 1);
    const tags = [...new Set([slug(query), ...words])].filter(Boolean).slice(0, 3);
    const urls = tags.length ? tags.map((t) => `https://remoteok.com/api?tag=${encodeURIComponent(t)}`) : ['https://remoteok.com/api'];
    const results = await Promise.allSettled(urls.map((u) => fetchJson(u)));
    const ok = results.filter((r) => r.status === 'fulfilled');
    if (!ok.length) throw results[0].reason || new Error('Remote OK request failed');
    const rows = ok.flatMap((r) => (Array.isArray(r.value) ? r.value : [])).filter((r) => r && r.id && r.position);
    const jobs = dedupe(rows.map((r) => makeJob(id, {
      externalId: r.id,
      title: htmlToText(r.position),
      company: htmlToText(r.company),
      companyLogo: r.company_logo || r.logo || null,
      location: r.location ? `Remote (${r.location})` : 'Remote',
      remote: true,
      salaryMin: r.salary_min || null,
      salaryMax: r.salary_max || null,
      salaryCurrency: r.salary_min || r.salary_max ? 'USD' : null,
      salaryText: r.salary_min || r.salary_max ? `USD ${r.salary_min || '?'} - ${r.salary_max || '?'} / year` : null,
      description: htmlToText(r.description),
      url: r.url || `https://remoteok.com/remote-jobs/${r.slug || r.id}`,
      applyUrl: r.apply_url || r.url,
      tags: r.tags || [],
      postedAt: r.date || (r.epoch ? r.epoch * 1000 : null),
    })));
    return jobs
      .filter((j) => matchesQuery(j, query) && matchesLocation(j, location, remote))
      .sort((a, b) => String(b.postedAt).localeCompare(String(a.postedAt)))
      .slice(0, limit);
  },
};
