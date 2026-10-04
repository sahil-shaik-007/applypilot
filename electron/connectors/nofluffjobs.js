// No Fluff Jobs — IT jobs in Poland & Central/Eastern Europe, always with salary ranges. Public search
// endpoint used by nofluffjobs.com (no key). Remote roles open to EU candidates are common.
const { fetchJson, matchesQuery, matchesLocation, makeJob } = require('./_util');

const id = 'nofluffjobs';

module.exports = {
  id,
  name: 'No Fluff Jobs',
  kind: 'api',
  requiresKeys: [],
  homepage: 'https://nofluffjobs.com',
  regions: ['pl', 'eu', 'remote'],
  description: 'IT jobs in Poland / CEE with mandatory salary ranges (PLN/EUR, monthly). Public search endpoint, no key.',

  async search({ query = '', location = '', remote = 'any', limit = 50 } = {}, ctx = {}) {
    const raw = [query, remote === 'remote' ? 'remote' : ''].filter(Boolean).join(' ');
    const data = await fetchJson('https://nofluffjobs.com/api/search/posting?page=1&salaryCurrency=PLN&salaryPeriod=month&region=pl&language=en-GB', {
      method: 'POST',
      headers: { 'Content-Type': 'application/infiniteSearch+json', Accept: 'application/json' },
      body: JSON.stringify({ rawSearch: raw, page: 1 }),
      timeout: 30000,
    });
    const rows = data?.postings || [];
    const out = [];
    const seen = new Set();
    for (const r of rows) {
      // The same posting is listed once per city; collapse on the reference/title+company.
      const key = r.reference || `${r.name}|${r.title}`;
      if (!r?.url || seen.has(key)) continue;
      seen.add(key);
      const places = r.location?.places || [];
      const cities = [...new Set(places.map((p) => p.city).filter((c) => c && !/^remote$/i.test(c)))];
      const isRemote = !!(r.fullyRemote || r.location?.fullyRemote || places.some((p) => /remote/i.test(p.city || '')));
      const c0 = places.find((p) => p.country)?.country;
      const country = !c0 || c0.code === 'POL' ? 'Poland' : c0.name || c0.code;
      const s = r.salary || {};
      const job = makeJob(id, {
        externalId: r.id || r.url,
        title: r.title,
        company: r.name,
        companyLogo: r.logo?.jobs_listing ? `https://static.nofluffjobs.com/${r.logo.jobs_listing}` : null,
        location: [isRemote ? 'Remote' : '', cities.slice(0, 5).join(', '), country].filter(Boolean).join(' - '),
        remote: isRemote,
        employmentType: s.type || null,
        salaryMin: s.from ?? null,
        salaryMax: s.to ?? null,
        salaryCurrency: s.currency || null,
        salaryText: s.from || s.to ? `${s.currency || ''} ${s.from || '?'} - ${s.to || '?'} / ${String(s.period || 'month').toLowerCase()} (${s.type || 'n/a'})`.trim() : null,
        description: [r.title, r.technology && `Main technology: ${r.technology}`, (r.seniority || []).join(', '), r.category && `Category: ${r.category}`].filter(Boolean).join('\n'),
        url: `https://nofluffjobs.com/job/${r.url}`,
        tags: [r.technology, ...(r.seniority || []), r.category, ...(r.tiles?.values || []).map((t) => t.value)].filter(Boolean).slice(0, 15),
        postedAt: r.renewed || r.posted || null,
      });
      if (!matchesQuery(job, query) || !matchesLocation(job, location, remote)) continue;
      out.push(job);
      if (out.length >= limit) break;
    }
    return out;
  },
};
