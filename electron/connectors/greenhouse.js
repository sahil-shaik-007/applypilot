// Greenhouse job boards (boards-api.greenhouse.io). Public, keyless.
//
// Strategy: pull the lightweight job list of every board (no content), filter by title /
// location, then fetch full details (description + pay ranges) only for the jobs we return.
const { fetchJson, htmlToText, matchesQuery, matchesLocation, makeJob, pool } = require('./_util');

const ATS = 'greenhouse';
// Greenhouse runs a separate EU instance; companies.json entries may carry region: 'eu'.
const API = { us: 'https://boards-api.greenhouse.io/v1/boards', eu: 'https://boards.eu.greenhouse.io/v1/boards' };
const BOARD_HOST = { us: 'https://job-boards.greenhouse.io', eu: 'https://job-boards.eu.greenhouse.io' };
const regionOf = (c) => (c && c.region === 'eu' ? 'eu' : 'us');
const TTL = 20 * 60 * 1000;
const FAIL_TTL = 5 * 60 * 1000;
const boardCache = new Map(); // slug -> { t, ttl, promise }
const detailCache = new Map(); // slug:id -> { t, promise }

function boardsFrom(ctx) {
  const companies = ctx && ctx.companies ? ctx.companies : require('../data/companies.json');
  const seen = new Set();
  return (companies[ATS] || []).filter((c) => c && c.slug && !seen.has(c.slug.toLowerCase()) && seen.add(c.slug.toLowerCase()));
}

function cached(map, key, ttl, loader) {
  const hit = map.get(key);
  if (hit && Date.now() - hit.t < hit.ttl) return hit.promise;
  const entry = { t: Date.now(), ttl, promise: null };
  entry.promise = loader().catch((e) => { entry.ttl = FAIL_TTL; throw e; });
  map.set(key, entry);
  return entry.promise;
}

const CURRENCY = { $: 'USD', '£': 'GBP', '€': 'EUR', '₹': 'INR' };
// Extracts the first "$120,000 - $150,000" / "€80K–€95K" style range from plain text.
function parseSalaryText(text) {
  if (!text) return null;
  const m = text.match(/(US\$|CA\$|C\$|A\$|[$£€₹])\s?(\d[\d,.]*)\s?([kK])?\s*(?:-|–|—|to)\s*(?:US\$|CA\$|C\$|A\$|[$£€₹])?\s?(\d[\d,.]*)\s?([kK])?(?:\s*(USD|CAD|AUD|GBP|EUR|INR))?/);
  if (!m) return null;
  const num = (s, k) => { const n = parseFloat(s.replace(/,/g, '')); return k ? n * 1000 : n; };
  const min = num(m[2], m[3] || m[5]);
  const max = num(m[4], m[5] || m[3]);
  if (!(min > 0) || !(max >= min) || max < 1000) return null; // ignore hourly-ish noise / bad parses
  const sym = m[1];
  const currency = m[6] || (sym === 'CA$' || sym === 'C$' ? 'CAD' : sym === 'A$' ? 'AUD' : CURRENCY[sym.replace('US', '')] || 'USD');
  return { min, max, currency, text: m[0].trim() };
}

async function loadBoard(company) {
  const region = regionOf(company);
  return cached(boardCache, `${region}:${company.slug.toLowerCase()}`, TTL, async () => {
    const data = await fetchJson(`${API[region]}/${encodeURIComponent(company.slug)}/jobs`, { timeout: 25000 });
    return (data.jobs || []).map((j) => {
      const departments = (j.departments || []).map((d) => d.name).filter(Boolean);
      // Hosted Greenhouse form (works even when absolute_url points at a custom careers site).
      const hosted = /^https:\/\/[a-z.-]*greenhouse\.io\//.test(j.absolute_url || '')
        ? j.absolute_url
        : `${BOARD_HOST[region]}/${company.slug}/jobs/${j.id}`;
      return {
        region,
        slug: company.slug,
        job: makeJob(ATS, {
          externalId: `${company.slug}:${j.id}`,
          title: j.title,
          company: j.company_name || company.name,
          location: ((j.location && j.location.name) || '').replace(/^\s*n\/?a\s*$/i, ''),
          url: j.absolute_url,
          applyUrl: hosted,
          ats: ATS,
          atsMeta: { boardToken: company.slug, jobId: j.id, region, absoluteUrl: j.absolute_url },
          tags: departments,
          postedAt: j.first_published || j.updated_at,
        }),
      };
    });
  });
}

async function enrich(item) {
  const { slug, job, region } = item;
  const id = job.atsMeta.jobId;
  try {
    const d = await cached(detailCache, `${region}:${slug}:${id}`, TTL, () =>
      fetchJson(`${API[region]}/${encodeURIComponent(slug)}/jobs/${id}?pay_transparency=true`, { timeout: 20000 }));
    const text = htmlToText(d.content);
    const out = { ...job, description: text.slice(0, 12000) };
    const pay = (d.pay_input_ranges || [])[0];
    if (pay && (pay.min_cents || pay.max_cents)) {
      out.salaryMin = pay.min_cents != null ? pay.min_cents / 100 : null;
      out.salaryMax = pay.max_cents != null ? pay.max_cents / 100 : null;
      out.salaryCurrency = pay.currency_type || null;
      const fmt = (n) => (n == null ? '?' : n.toLocaleString('en-US', { maximumFractionDigits: 0 }));
      const label = (pay.title || '').replace(/[:\s]+$/, '');
      out.salaryText = `${fmt(out.salaryMin)} - ${fmt(out.salaryMax)} ${pay.currency_type || ''}`.trim() + (label ? ` (${label})` : '');
    } else {
      const s = parseSalaryText(text);
      if (s) Object.assign(out, { salaryMin: s.min, salaryMax: s.max, salaryCurrency: s.currency, salaryText: s.text });
    }
    const md = (d.metadata || []).find((m) => /employment|job type|commitment/i.test(m.name || ''));
    if (md && typeof md.value === 'string') out.employmentType = md.value;
    return out;
  } catch {
    return job; // listing without description is still useful
  }
}

module.exports = {
  id: ATS,
  name: 'Greenhouse',
  kind: 'ats',
  requiresKeys: [],
  homepage: 'https://www.greenhouse.io',
  regions: ['global'],
  description: 'Public Greenhouse job boards of hundreds of tech companies (Stripe, Airbnb, Anthropic, ...). Direct application forms.',
  parseSalaryText,
  async search({ query, location, remote, limit } = {}, ctx = {}) {
    const max = limit || 100;
    const boards = boardsFrom(ctx);
    let failed = 0;
    const lists = await pool(boards, 12, async (c) => {
      try { return await loadBoard(c); } catch (e) { failed++; throw e; }
    });
    const matched = lists.flat().filter(Boolean)
      .filter((it) => matchesQuery(it.job, query) && matchesLocation(it.job, location, remote))
      .sort((a, b) => (b.job.postedAt || '').localeCompare(a.job.postedAt || ''))
      .slice(0, max);
    if (failed && ctx.log) ctx.log(`greenhouse: ${failed}/${boards.length} boards failed to load`);
    const jobs = await pool(matched, 12, enrich);
    return jobs.map((j, i) => j || matched[i].job);
  },
};
