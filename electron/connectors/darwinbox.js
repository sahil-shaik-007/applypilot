// Darwinbox career portals (Indian HRMS): https://{host}/ms/candidateapi/job?page=N  (10 jobs/page)
// Public, keyless JSON used by the careers SPA; the host sits behind Cloudflare, so requests are kept
// small and few. Board entries: { slug: "nobroker", name: "NoBroker", host?: "nobroker.darwinbox.in" }
// Job page / application start: https://{host}/ms/candidate/careers/{id}. Applying needs a Darwinbox
// candidate login (email OTP), so these jobs are assisted-only.
const { fetchJson, htmlToText, matchesQuery, matchesLocation, makeJob, pool } = require('./_util');

const ATS = 'darwinbox';
const TTL = 20 * 60 * 1000;
const FAIL_TTL = 5 * 60 * 1000;
const MAX_PAGES = 15;
const boardCache = new Map();
const detailCache = new Map();
const BROWSER_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';

function boardsFrom(ctx) {
  let list = ctx && ctx.companies && Array.isArray(ctx.companies[ATS]) ? ctx.companies[ATS] : null;
  if (!list) { try { list = require('../data/boards-extra.json')[ATS] || []; } catch { list = []; } }
  const seen = new Set();
  return list.filter((c) => c && (c.slug || c.host) && !seen.has(hostOf(c)) && seen.add(hostOf(c)));
}
const hostOf = (c) => String(c.host || `${c.slug}.darwinbox.in`).replace(/^https?:\/\//, '').replace(/\/.*$/, '').toLowerCase();

function cached(map, key, loader) {
  const hit = map.get(key);
  if (hit && Date.now() - hit.t < hit.ttl) return hit.promise;
  const entry = { t: Date.now(), ttl: TTL, promise: null };
  entry.promise = loader().catch((e) => { entry.ttl = FAIL_TTL; throw e; });
  map.set(key, entry);
  return entry.promise;
}

const get = (url) => fetchJson(url, { timeout: 20000, headers: { 'User-Agent': BROWSER_UA } });

function normalize(c, j) {
  const host = hostOf(c);
  const locs = (j.tool_tip_locations && j.tool_tip_locations.length ? j.tool_tip_locations : [j.officelocation_show_arr])
    .map((s) => String(s || '').replace(/\s+/g, ' ').replace(/\s+,/g, ',').trim()).filter((s) => s && !/^multiple locations$/i.test(s));
  const location = [...new Set(locs)].join(' / ');
  const exp = j.experience_from_num !== '' && j.experience_from_num != null ? `${j.experience_from_num}-${j.experience_to_num || ''} yrs`.replace(/- yrs/, '+ yrs') : null;
  const url = `https://${host}/ms/candidate/careers/${j.id}`;
  return makeJob(ATS, {
    externalId: `${host}:${j.id}`,
    title: j.title || j.designation_display_name,
    company: c.name || c.slug,
    location,
    remote: /remote/i.test(location),
    employmentType: j.emp_type || null,
    url,
    applyUrl: url,
    ats: ATS,
    atsMeta: { host, jobId: j.id, assistedOnly: true },
    tags: [j.department, j.functional_area, exp].filter(Boolean),
    postedAt: j.job_posting_on ? new Date(j.job_posting_on * 1000).toISOString() : j.created_on || null,
  });
}

async function fetchBoard(c) {
  const host = hostOf(c);
  return cached(boardCache, host, async () => {
    const out = [];
    let total = Infinity;
    for (let page = 1; page <= MAX_PAGES && out.length < total; page++) {
      const d = await get(`https://${host}/ms/candidateapi/job?page=${page}`);
      if (!d || d.status !== 'success' || !d.message || !Array.isArray(d.message.jobs)) throw new Error('not a Darwinbox careers portal');
      total = Number(d.message.jobscount) || 0;
      const list = d.message.jobs;
      for (const j of list) if (j && j.id && (j.title || j.designation_display_name)) out.push(normalize(c, j));
      if (!list.length) break;
    }
    return out;
  });
}

async function enrich(job) {
  const { host, jobId } = job.atsMeta;
  try {
    const d = await cached(detailCache, `${host}:${jobId}`, () => get(`https://${host}/ms/candidateapi/job/${jobId}`));
    const j = (d && d.message && d.message.job && d.message.job[0]) || {};
    const out = { ...job };
    if (j.jd) out.description = htmlToText(j.jd).slice(0, 12000);
    if (j.salary_min || j.salary_max) {
      out.salaryMin = Number(j.salary_min) || null;
      out.salaryMax = Number(j.salary_max) || null;
      out.salaryCurrency = j.salary_currency || null;
      out.salaryText = j.salary_range || `${j.salary_currency || ''} ${j.salary_min || '?'} - ${j.salary_max || '?'}${j.salary_timeframe ? ` / ${j.salary_timeframe}` : ''}`.trim();
    }
    if (j.is_remote) out.remote = true;
    return out;
  } catch {
    return job;
  }
}

module.exports = {
  id: ATS,
  name: 'Darwinbox',
  kind: 'ats',
  requiresKeys: [],
  homepage: 'https://darwinbox.com',
  regions: ['in', 'apac'],
  description: 'Public Darwinbox career portals of Indian / Asian enterprises. Applying needs a candidate login: assisted only.',
  fetchBoard,
  async probe(c) { return { count: (await fetchBoard(c)).length }; },
  async search({ query, location, remote, limit } = {}, ctx = {}) {
    const boards = boardsFrom(ctx);
    let failed = 0;
    const lists = await pool(boards, 4, async (c) => {
      try { return await fetchBoard(c); } catch (e) { failed++; throw e; }
    });
    if (failed && ctx.log) ctx.log(`darwinbox: ${failed}/${boards.length} boards failed to load`);
    const matched = lists.flat().filter(Boolean)
      .filter((j) => matchesQuery(j, query) && matchesLocation(j, location, remote))
      .sort((a, b) => (b.postedAt || '').localeCompare(a.postedAt || ''))
      .slice(0, limit || 100);
    const jobs = await pool(matched, 4, enrich);
    return jobs.map((j, i) => j || matched[i]);
  },
};
