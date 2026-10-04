// Reed.co.uk — the UK's largest job board.
// Key: "reedKey" — free at https://www.reed.co.uk/developers/jobseeker (HTTP Basic auth: key as username,
// empty password). Docs: https://www.reed.co.uk/developers/jobseeker
const { fetchJson, htmlToText, matchesLocation, makeJob } = require('./_util');

const id = 'reed';

function parseUkDate(s) {
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(String(s || ''));
  return m ? `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}T00:00:00Z` : null;
}

module.exports = {
  id,
  name: 'Reed (UK)',
  kind: 'api',
  requiresKeys: ['reedKey'],
  homepage: 'https://www.reed.co.uk',
  regions: ['gb'],
  description: "UK's largest job board, with salaries. Free API key (\"reedKey\") from https://www.reed.co.uk/developers/jobseeker.",

  async search({ query = '', location = '', remote = 'any', limit = 50 } = {}, ctx = {}) {
    const key = ctx.keys?.reedKey;
    if (!key) throw new Error('Reed requires an API key (reedKey)');
    const auth = `Basic ${Buffer.from(`${key}:`).toString('base64')}`;
    const loc = String(location || '').trim();
    const params = new URLSearchParams({ resultsToTake: String(Math.min(Math.max(limit, 10), 100)), resultsToSkip: '0' });
    const kw = [query, remote === 'remote' ? 'remote' : ''].filter(Boolean).join(' ');
    if (kw) params.set('keywords', kw);
    if (loc && !/^(anywhere|worldwide|any|remote|uk|united kingdom|england|gb)$/i.test(loc)) {
      params.set('locationName', loc);
      params.set('distanceFromLocation', '15');
    }
    const data = await fetchJson(`https://www.reed.co.uk/api/1.0/search?${params}`, { headers: { Authorization: auth } });
    const out = [];
    for (const r of data?.results || []) {
      const cur = r.currency || 'GBP';
      const job = makeJob(id, {
        externalId: r.jobId,
        title: r.jobTitle,
        company: r.employerName,
        location: r.locationName || '',
        remote: /remote|work from home|home.?based/i.test(`${r.jobTitle} ${r.locationName}`),
        salaryMin: r.minimumSalary ?? null,
        salaryMax: r.maximumSalary ?? null,
        salaryCurrency: r.minimumSalary || r.maximumSalary ? cur : null,
        salaryText: r.minimumSalary || r.maximumSalary ? `${cur} ${r.minimumSalary || '?'} - ${r.maximumSalary || '?'}` : null,
        description: htmlToText(r.jobDescription),
        url: r.jobUrl || `https://www.reed.co.uk/jobs/${r.jobId}`,
        tags: [r.applications != null ? `${r.applications} applications` : ''].filter(Boolean),
        postedAt: parseUkDate(r.date),
      });
      if (!matchesLocation(job, '', remote)) continue;
      out.push(job);
      if (out.length >= limit) break;
    }
    return out;
  },
};
