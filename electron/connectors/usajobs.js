// USAJOBS — official US federal government jobs.
// Keys: "usajobsKey" (Authorization-Key) + "usajobsEmail" (the email you registered with; sent as User-Agent).
// Request a free key at https://developer.usajobs.gov/apirequest/ (free; generous rate limits).
// Docs: https://developer.usajobs.gov/api-reference/get-api-search
const { fetchJson, htmlToText, matchesLocation, makeJob } = require('./_util');

const id = 'usajobs';
const RATE = { PA: 'year', PH: 'hour', PM: 'month', PW: 'week', PD: 'day', BW: 'bi-week' };

module.exports = {
  id,
  name: 'USAJOBS',
  kind: 'api',
  requiresKeys: ['usajobsKey', 'usajobsEmail'],
  homepage: 'https://www.usajobs.gov',
  regions: ['us'],
  description: 'Official US federal government jobs. Free API key ("usajobsKey") + your registered email ("usajobsEmail") from https://developer.usajobs.gov/apirequest/.',

  async search({ query = '', location = '', remote = 'any', limit = 50 } = {}, ctx = {}) {
    const keys = ctx.keys || {};
    if (!keys.usajobsKey || !keys.usajobsEmail) throw new Error('USAJOBS requires usajobsKey and usajobsEmail');
    const params = new URLSearchParams({ ResultsPerPage: String(Math.min(Math.max(limit, 10), 500)), Page: '1', SortField: 'opendate', SortDirection: 'desc' });
    if (query) params.set('Keyword', query);
    const loc = String(location || '').trim();
    if (loc && !/^(anywhere|worldwide|any|remote|usa|us|united states)$/i.test(loc)) params.set('LocationName', loc);
    if (remote === 'remote') params.set('RemoteIndicator', 'True');
    const data = await fetchJson(`https://data.usajobs.gov/api/search?${params}`, {
      headers: { 'User-Agent': keys.usajobsEmail, 'Authorization-Key': keys.usajobsKey },
    });
    const items = data?.SearchResult?.SearchResultItems || [];
    const out = [];
    for (const it of items) {
      const d = it.MatchedObjectDescriptor || {};
      const det = d.UserArea?.Details || {};
      const pay = (d.PositionRemuneration || [])[0] || {};
      const min = pay.MinimumRange ? Number(pay.MinimumRange) : null;
      const max = pay.MaximumRange ? Number(pay.MaximumRange) : null;
      const per = RATE[pay.RateIntervalCode] || pay.Description || '';
      const isRemote = det.RemoteIndicator === true || String(det.RemoteIndicator).toLowerCase() === 'true';
      const job = makeJob(id, {
        externalId: it.MatchedObjectId || d.PositionID,
        title: d.PositionTitle,
        company: [d.OrganizationName, d.DepartmentName && d.DepartmentName !== d.OrganizationName ? `(${d.DepartmentName})` : ''].filter(Boolean).join(' '),
        location: d.PositionLocationDisplay || (d.PositionLocation || []).map((l) => l.LocationName).join('; '),
        remote: isRemote,
        employmentType: (d.PositionSchedule || []).map((s) => s.Name).join(', ') || null,
        salaryMin: Number.isFinite(min) ? min : null,
        salaryMax: Number.isFinite(max) ? max : null,
        salaryCurrency: min || max ? 'USD' : null,
        salaryText: min || max ? `USD ${min || '?'} - ${max || '?'}${per ? ` / ${per}` : ''}` : null,
        description: htmlToText([det.JobSummary, d.QualificationSummary, (det.MajorDuties || []).join('\n')].filter(Boolean).join('\n\n')),
        url: d.PositionURI,
        applyUrl: (d.ApplyURI || [])[0] || d.PositionURI,
        tags: [...(d.JobCategory || []).map((c) => c.Name), ...(d.JobGrade || []).map((g) => `Grade ${g.Code}`), det.TeleworkEligible ? 'Telework eligible' : '', det.WhoMayApply?.Name].filter(Boolean),
        postedAt: d.PublicationStartDate || null,
      });
      if (!matchesLocation(job, '', remote)) continue;
      out.push(job);
      if (out.length >= limit) break;
    }
    return out;
  },
};
