// Rippling Recruiting job boards: https://ats.rippling.com/api/v2/board/{slug}/jobs?page=N&pageSize=100
// Public, keyless. Board entries: { slug: "rippling", name: "Rippling" }
// The list has title / department / locations / workplace type. Description, posting date,
// employment type and pay ranges come from .../jobs/{uuid} and are fetched for returned jobs only.
// The application form is at https://ats.rippling.com/{slug}/jobs/{uuid}/apply
const { fetchJson, htmlToText, matchesQuery, matchesLocation, makeJob, pool } = require('./_util');

const ATS = 'rippling';
const API = 'https://ats.rippling.com/api/v2/board';
const TTL = 20 * 60 * 1000;
const FAIL_TTL = 5 * 60 * 1000;
const MAX_PAGES = 10;
const boardCache = new Map();
const detailCache = new Map();

function boardsFrom(ctx) {
  let list = ctx && ctx.companies && Array.isArray(ctx.companies[ATS]) ? ctx.companies[ATS] : null;
  if (!list) { try { list = require('../data/boards-extra.json')[ATS] || []; } catch { list = []; } }
  const seen = new Set();
  return list.filter((c) => c && c.slug && /^[a-z0-9_-]+$/i.test(c.slug) && !seen.has(c.slug.toLowerCase()) && seen.add(c.slug.toLowerCase()));
}

function cached(map, key, loader) {
  const hit = map.get(key);
  if (hit && Date.now() - hit.t < hit.ttl) return hit.promise;
  const entry = { t: Date.now(), ttl: TTL, promise: null };
  entry.promise = loader().catch((e) => { entry.ttl = FAIL_TTL; throw e; });
  map.set(key, entry);
  return entry.promise;
}

function normalize(c, j) {
  const locs = j.locations || [];
  const names = [...new Set(locs.map((l) => l.name || [l.city, l.state, l.country].filter(Boolean).join(', ')).filter(Boolean))];
  const remote = locs.length > 0 && locs.every((l) => l.workplaceType === 'REMOTE');
  const url = j.url || `https://ats.rippling.com/${c.slug}/jobs/${j.id}`;
  return makeJob(ATS, {
    externalId: `${c.slug.toLowerCase()}:${j.id}`,
    title: j.name,
    company: c.name || c.slug,
    location: names.join(' / ') + (remote && !/remote/i.test(names.join(' ')) ? ' (Remote)' : ''),
    remote,
    url,
    applyUrl: `https://ats.rippling.com/${c.slug}/jobs/${j.id}/apply`,
    ats: ATS,
    atsMeta: { board: c.slug, jobId: j.id },
    tags: [j.department && j.department.name, locs.some((l) => l.workplaceType === 'HYBRID') ? 'hybrid' : null].filter(Boolean),
    postedAt: null,
  });
}

async function fetchBoard(c) {
  return cached(boardCache, c.slug.toLowerCase(), async () => {
    const out = [];
    for (let page = 0; page < MAX_PAGES; page++) {
      const d = await fetchJson(`${API}/${encodeURIComponent(c.slug)}/jobs?page=${page}&pageSize=100`, { timeout: 25000 });
      for (const j of d.items || []) if (j && j.id && j.name) out.push(normalize(c, j));
      if (!d.totalPages || page + 1 >= d.totalPages) break;
    }
    return out;
  });
}

const FREQ = { YEAR: 'year', MONTH: 'month', HOUR: 'hour', WEEK: 'week', DAY: 'day' };

async function enrich(job) {
  const { board, jobId } = job.atsMeta;
  try {
    const d = await cached(detailCache, `${board}:${jobId}`, () => fetchJson(`${API}/${encodeURIComponent(board)}/jobs/${jobId}`, { timeout: 20000 }));
    const desc = d.description || {};
    const out = { ...job, description: [htmlToText(desc.role), htmlToText(desc.company)].filter(Boolean).join('\n\n').slice(0, 12000) };
    if (d.createdOn) out.postedAt = new Date(d.createdOn).toISOString();
    if (d.employmentType && d.employmentType.id) out.employmentType = d.employmentType.id;
    if (d.workLocations && d.workLocations.length && !job.location) out.location = d.workLocations.join(' / ');
    const pay = (d.payRangeDetails || [])[0];
    if (pay && (pay.rangeStart || pay.rangeEnd)) {
      out.salaryMin = pay.rangeStart ?? null;
      out.salaryMax = pay.rangeEnd ?? null;
      out.salaryCurrency = pay.currency || null;
      const fmt = (n) => (n == null ? '?' : Number(n).toLocaleString('en-US', { maximumFractionDigits: 0 }));
      out.salaryText = `${fmt(pay.rangeStart)} - ${fmt(pay.rangeEnd)} ${pay.currency || ''}${FREQ[pay.frequency] ? ` / ${FREQ[pay.frequency]}` : ''}`.trim();
    }
    if (d.companyName && !job.company) out.company = d.companyName;
    return out;
  } catch {
    return job;
  }
}

module.exports = {
  id: ATS,
  name: 'Rippling',
  kind: 'ats',
  requiresKeys: [],
  homepage: 'https://www.rippling.com/recruiting',
  regions: ['us', 'global'],
  description: 'Public Rippling Recruiting job boards (US startups and mid-size companies). Pay ranges included. Direct application forms.',
  fetchBoard,
  async probe(c) { return { count: (await fetchBoard(c)).length }; },
  async search({ query, location, remote, limit } = {}, ctx = {}) {
    const boards = boardsFrom(ctx);
    let failed = 0;
    const lists = await pool(boards, 8, async (c) => {
      try { return await fetchBoard(c); } catch (e) { failed++; throw e; }
    });
    if (failed && ctx.log) ctx.log(`rippling: ${failed}/${boards.length} boards failed to load`);
    const matched = lists.flat().filter(Boolean)
      .filter((j) => matchesQuery(j, query) && matchesLocation(j, location, remote))
      .slice(0, limit || 100);
    const jobs = await pool(matched, 10, enrich);
    return jobs.map((j, i) => j || matched[i]).sort((a, b) => (b.postedAt || '').localeCompare(a.postedAt || ''));
  },
};
