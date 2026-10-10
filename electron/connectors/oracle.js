// Oracle Recruiting Cloud (Oracle Fusion HCM "Candidate Experience") career sites, via the public
// REST resource the career site itself uses:
//   GET https://{host}/hcmRestApi/resources/latest/recruitingCEJobRequisitions?onlyData=true
//       &expand=requisitionList.secondaryLocations
//       &finder=findReqs;siteNumber={site},limit=25,offset=N,keyword="...",location=...,sortBy=POSTING_DATES_DESC
//   GET .../recruitingCEJobRequisitionDetails?expand=all&onlyData=true&finder=ById;Id="{id}",siteNumber={site}
// Public, keyless. Board entries: { slug: "jpmc", name: "JPMorganChase", host: "jpmc.fa.oraclecloud.com", siteNumber: "CX_1001" }
// Keyword and location are filtered server-side. Applying needs an email verification code /
// candidate profile, so these jobs are assisted-only.
const { fetchJson, htmlToText, matchesQuery, matchesLocation, makeJob, pool } = require('./_util');

const ATS = 'oracle';
const TTL = 20 * 60 * 1000;
const FAIL_TTL = 5 * 60 * 1000;
const PAGE = 25;
const listCache = new Map();
const detailCache = new Map();

function boardsFrom(ctx) {
  let list = ctx && ctx.companies && Array.isArray(ctx.companies[ATS]) ? ctx.companies[ATS] : null;
  if (!list) { try { list = require('../data/boards-extra.json')[ATS] || []; } catch { list = []; } }
  const seen = new Set();
  return list.map(normalizeBoard).filter((b) => b && !seen.has(b.key) && seen.add(b.key));
}

function normalizeBoard(b) {
  if (!b) return null;
  let host = b.host;
  let site = b.siteNumber || b.site;
  const m = /^https?:\/\/([^/]+)\/hcmUI\/CandidateExperience\/[a-z-]+\/sites\/([A-Za-z0-9_]+)/i.exec(b.url || '');
  if (m) { host = host || m[1]; site = site || m[2]; }
  if (!host || !site) return null;
  host = host.replace(/^https?:\/\//, '').replace(/\/.*$/, '').toLowerCase();
  return { ...b, host, siteNumber: site, key: `${host}/${site}`.toLowerCase(), name: b.name || b.slug || host };
}

function cached(map, key, loader) {
  const hit = map.get(key);
  if (hit && Date.now() - hit.t < hit.ttl) return hit.promise;
  const entry = { t: Date.now(), ttl: TTL, promise: null };
  entry.promise = loader().catch((e) => { entry.ttl = FAIL_TTL; throw e; });
  map.set(key, entry);
  return entry.promise;
}

// finder values are comma-separated; keep user text from breaking the syntax
const clean = (s) => String(s || '').replace(/[",;=]/g, ' ').replace(/\s+/g, ' ').trim();
const siteUrl = (b) => `https://${b.host}/hcmUI/CandidateExperience/en/sites/${b.siteNumber}`;

function normalize(b, r) {
  const locs = [r.PrimaryLocation, ...(r.secondaryLocations || []).map((l) => l.Name)].filter(Boolean);
  const location = [...new Set(locs)].join(' / ');
  const url = `${siteUrl(b)}/job/${r.Id}`;
  const wp = String(r.WorkplaceType || r.WorkplaceTypeCode || '');
  return makeJob(ATS, {
    externalId: `${b.host}:${b.siteNumber}:${r.Id}`,
    title: r.Title,
    company: b.name,
    location,
    remote: /remote/i.test(`${wp} ${location}`),
    employmentType: r.JobSchedule || r.JobType || null,
    description: r.ShortDescriptionStr || '',
    url,
    applyUrl: `${url}/apply/email`,
    ats: ATS,
    atsMeta: { host: b.host, siteNumber: b.siteNumber, requisitionId: r.Id, assistedOnly: true },
    tags: [r.JobFamily, r.JobFunction, /hybrid/i.test(wp) ? 'hybrid' : null].filter(Boolean),
    postedAt: r.PostedDate || null,
  });
}

/** Server-side search of one Oracle site. Exported for scripts. */
async function fetchBoard(board, { query = '', location = '', max = 50 } = {}) {
  const b = normalizeBoard(board);
  if (!b) throw new Error('oracle board needs host and siteNumber');
  const kw = clean(query);
  const loc = clean(location);
  return cached(listCache, `${b.key}|${kw.toLowerCase()}|${loc.toLowerCase()}|${max}`, async () => {
    const jobs = [];
    let total = 0;
    for (let offset = 0; offset < max; offset += PAGE) {
      const finder = [`siteNumber=${b.siteNumber}`, `limit=${PAGE}`, `offset=${offset}`, kw && `keyword="${kw}"`, loc && `location=${loc}`, 'sortBy=POSTING_DATES_DESC'].filter(Boolean).join(',');
      const url = `https://${b.host}/hcmRestApi/resources/latest/recruitingCEJobRequisitions?onlyData=true&expand=requisitionList.secondaryLocations&finder=findReqs;${encodeURI(finder)}`;
      const d = await fetchJson(url, { timeout: 30000 });
      const item = (d.items || [])[0] || {};
      if (offset === 0) total = item.TotalJobsCount || 0;
      const list = item.requisitionList || [];
      for (const r of list) if (r && r.Id && r.Title) jobs.push(normalize(b, r));
      if (list.length < PAGE || offset + PAGE >= total) break;
    }
    return { total, jobs };
  });
}

async function enrich(job) {
  const { host, siteNumber, requisitionId } = job.atsMeta;
  try {
    const d = await cached(detailCache, `${host}/${siteNumber}/${requisitionId}`, () => fetchJson(
      `https://${host}/hcmRestApi/resources/latest/recruitingCEJobRequisitionDetails?expand=all&onlyData=true&finder=ById;Id=%22${encodeURIComponent(requisitionId)}%22,siteNumber=${siteNumber}`, { timeout: 25000 }));
    const r = (d.items || [])[0] || {};
    const desc = [r.ExternalDescriptionStr, r.ExternalResponsibilitiesStr, r.ExternalQualificationsStr, r.CorporateDescriptionStr].filter(Boolean).map(htmlToText).join('\n\n');
    const out = { ...job };
    if (desc) out.description = desc.slice(0, 12000);
    if (r.ExternalPostedStartDate) out.postedAt = new Date(r.ExternalPostedStartDate).toISOString();
    if (r.JobSchedule) out.employmentType = r.JobSchedule;
    return out;
  } catch {
    return job;
  }
}

module.exports = {
  id: ATS,
  name: 'Oracle Recruiting Cloud',
  kind: 'ats',
  requiresKeys: [],
  homepage: 'https://www.oracle.com/human-capital-management/recruiting/',
  regions: ['global'],
  description: 'Public Oracle Recruiting Cloud career sites of large enterprises (JPMorganChase, ...). Assisted applications only.',
  fetchBoard,
  normalizeBoard,
  async probe(board) { const { total, jobs } = await fetchBoard(board, { max: PAGE }); return { count: total || jobs.length }; },
  async search({ query, location, remote, limit } = {}, ctx = {}) {
    const max = limit || 100;
    const boards = boardsFrom(ctx);
    const loc = String(location || '').trim();
    const serverLoc = loc && !/^(remote|anywhere|worldwide|any)$/i.test(loc) && !/[,/]/.test(loc) ? loc : '';
    let failed = 0;
    const lists = await pool(boards, 6, async (b) => {
      try { return (await fetchBoard(b, { query: query || '', location: serverLoc, max: 50 })).jobs; } catch (e) { failed++; throw e; }
    });
    if (failed && ctx.log) ctx.log(`oracle: ${failed}/${boards.length} boards failed to load`);
    const matched = lists.flat().filter(Boolean)
      .filter((j) => matchesQuery(j, query) && (serverLoc ? matchesLocation(j, '', remote) : matchesLocation(j, location, remote)))
      .sort((a, b) => (b.postedAt || '').localeCompare(a.postedAt || ''))
      .slice(0, max);
    const jobs = await pool(matched, 8, enrich);
    return jobs.map((j, i) => j || matched[i]);
  },
};
