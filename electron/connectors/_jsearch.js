// Shared JSearch (OpenWeb Ninja) request + mapping, used by jsearch.js (RapidAPI) and
// jsearch_openwebninja.js (direct). Both routes serve identical parameters and response shapes.
const { fetchJson, htmlToText, matchesLocation, makeJob } = require('./_util');
const { detectCountry } = require('./_helpers');

const PER_PAGE = 10; // JSearch returns up to 10 results per page
// Used when the response has salary numbers but no currency field.
const COUNTRY_CURRENCY = { IN: 'INR', US: 'USD', GB: 'GBP', CA: 'CAD', AU: 'AUD', SG: 'SGD', DE: 'EUR', FR: 'EUR', NL: 'EUR', ES: 'EUR', IT: 'EUR', IE: 'EUR', AE: 'AED', PL: 'PLN', CH: 'CHF' };

function buildParams({ query = '', location = '', remote = 'any', limit = 50 }, keys = {}) {
  const loc = String(location || '').trim();
  const isAnywhere = !loc || /^(anywhere|worldwide|any|remote)$/i.test(loc);
  const q = [query || 'jobs', isAnywhere ? '' : `in ${loc}`].filter(Boolean).join(' ');
  const params = new URLSearchParams({
    query: q,
    page: '1',
    // Each page beyond the first costs extra quota on the free plan; cap to keep usage predictable.
    num_pages: String(Math.min(Math.max(Math.ceil(limit / PER_PAGE), 1), Number(keys.jsearchMaxPages) || 3)),
    date_posted: keys.jsearchDatePosted || 'month', // all | today | 3days | week | month
  });
  const cc = detectCountry(loc);
  if (cc) params.set('country', cc);
  if (remote === 'remote') {
    params.set('work_from_home', 'true');
    params.set('remote_jobs_only', 'true'); // legacy name, still accepted
  }
  return params;
}

function salaryPeriodLabel(p) {
  if (!p) return '';
  return ` / ${String(p).toLowerCase()}`;
}

function mapJob(source, r) {
  const loc = r.job_location || [r.job_city, r.job_state, r.job_country].filter(Boolean).join(', ');
  const hl = r.job_highlights || {};
  const highlights = Object.entries(hl)
    .map(([k, v]) => `${k}:\n${(v || []).map((x) => `• ${x}`).join('\n')}`)
    .join('\n\n');
  const min = r.job_min_salary ?? null;
  const max = r.job_max_salary ?? null;
  const cur = r.job_salary_currency || (min || max ? COUNTRY_CURRENCY[String(r.job_country || '').toUpperCase()] || null : null);
  const apply = r.job_apply_link || (r.apply_options || [])[0]?.apply_link || r.job_google_link;
  const direct = (r.apply_options || []).find((o) => o.is_direct)?.apply_link;
  return makeJob(source, {
    externalId: r.job_id,
    title: r.job_title,
    company: r.employer_name,
    companyLogo: r.employer_logo || null,
    location: r.job_is_remote && !/remote/i.test(loc) ? `${loc ? `${loc} / ` : ''}Remote` : loc,
    remote: !!r.job_is_remote,
    employmentType: r.job_employment_type || (r.job_employment_types || []).join(', ') || null,
    salaryMin: min,
    salaryMax: max,
    salaryCurrency: cur,
    salaryText: r.job_salary || (min || max ? `${cur || ''} ${min || '?'} - ${max || '?'}${salaryPeriodLabel(r.job_salary_period)}`.trim() : null),
    description: [htmlToText(r.job_description), highlights].filter(Boolean).join('\n\n'),
    url: r.job_google_link || apply,
    applyUrl: direct || apply,
    tags: [r.job_publisher && `via ${r.job_publisher}`, ...(r.job_required_skills || []), ...(r.required_technologies || [])].filter(Boolean).slice(0, 15),
    postedAt: r.job_posted_at_datetime_utc || (r.job_posted_at_timestamp ? r.job_posted_at_timestamp * 1000 : null),
    atsMeta: { publisher: r.job_publisher || null, applyOptions: (r.apply_options || []).map((o) => ({ publisher: o.publisher, url: o.apply_link, direct: !!o.is_direct })) },
  });
}

async function runSearch(source, baseUrl, headers, params, keys = {}) {
  const { remote = 'any', limit = 50 } = params;
  const data = await fetchJson(`${baseUrl}?${buildParams(params, keys)}`, { headers, timeout: 45000 });
  if (data?.status && data.status !== 'OK') throw new Error(`JSearch error: ${data.error?.message || data.message || data.status}`);
  const rows = Array.isArray(data?.data) ? data.data : data?.data?.jobs || data?.jobs || [];
  return rows
    .filter((r) => r && r.job_title)
    .map((r) => mapJob(source, r))
    .filter((j) => matchesLocation(j, '', remote)) // location already applied in the query text
    .slice(0, limit);
}

module.exports = { runSearch, buildParams, mapJob };
