// JazzHR career pages ({slug}.applytojob.com) through JazzHR's public XML job feed:
//   https://app.jazz.co/feeds/export/jobs/{slug}     (410 Gone for inactive accounts)
// Public, keyless. Board entries: { slug: "mojotech", name: "MojoTech" }
// Each job's page https://{slug}.applytojob.com/apply/{code}/{title} contains the application form.
const { fetchText, htmlToText, matchesQuery, matchesLocation, makeJob, pool } = require('./_util');
const { decodeEntities } = require('./_helpers');

const ATS = 'jazzhr';
const TTL = 20 * 60 * 1000;
const FAIL_TTL = 5 * 60 * 1000;
const boardCache = new Map();

function boardsFrom(ctx) {
  let list = ctx && ctx.companies && Array.isArray(ctx.companies[ATS]) ? ctx.companies[ATS] : null;
  if (!list) { try { list = require('../data/boards-extra.json')[ATS] || []; } catch { list = []; } }
  const seen = new Set();
  return list.filter((c) => c && c.slug && /^[a-z0-9-]+$/i.test(c.slug) && !seen.has(c.slug.toLowerCase()) && seen.add(c.slug.toLowerCase()));
}

function cached(key, loader) {
  const hit = boardCache.get(key);
  if (hit && Date.now() - hit.t < hit.ttl) return hit.promise;
  const entry = { t: Date.now(), ttl: TTL, promise: null };
  entry.promise = loader().catch((e) => { entry.ttl = FAIL_TTL; throw e; });
  boardCache.set(key, entry);
  return entry.promise;
}

function tag(xml, name) {
  const m = new RegExp(`<${name}\\b[^>]*>([\\s\\S]*?)</${name}>`, 'i').exec(xml);
  if (!m) return '';
  const v = m[1].replace(/^\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*$/, '$1');
  return (v === m[1] ? decodeEntities(v) : v).trim();
}

// id looks like job_20261007150008_X7PHYKDVYIEF5ZN8 → 2026-10-07T15:00:08Z
function dateFromId(id) {
  const m = /^job_(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})_/.exec(id || '');
  return m ? `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}Z` : null;
}

function normalize(c, xml, companyName) {
  const id = tag(xml, 'id');
  const url = tag(xml, 'url');
  const place = [tag(xml, 'city'), tag(xml, 'state'), tag(xml, 'country')].filter(Boolean).join(', ');
  const title = tag(xml, 'title');
  const remote = /remote/i.test(`${title} ${place}`);
  const code = (/\/apply\/([A-Za-z0-9]+)\//.exec(url) || [])[1] || null;
  return makeJob(ATS, {
    externalId: `${c.slug.toLowerCase()}:${code || id}`,
    title,
    company: c.name || companyName || c.slug,
    location: place || (remote ? 'Remote' : ''),
    remote,
    employmentType: tag(xml, 'type') || null,
    description: htmlToText(tag(xml, 'description')),
    url,
    applyUrl: url,
    ats: ATS,
    atsMeta: { company: c.slug.toLowerCase(), jobId: id, code },
    tags: [tag(xml, 'department'), tag(xml, 'experience')].filter(Boolean),
    postedAt: dateFromId(id),
  });
}

async function fetchBoard(c) {
  return cached(c.slug.toLowerCase(), async () => {
    const xml = await fetchText(`https://app.jazz.co/feeds/export/jobs/${encodeURIComponent(c.slug.toLowerCase())}`, { timeout: 25000, headers: { Accept: 'application/xml, text/xml' } });
    if (!/<jobs\b/i.test(xml)) throw new Error('not a JazzHR feed');
    const companyName = tag(xml.split(/<job>/i)[0], 'company');
    return (xml.match(/<job>[\s\S]*?<\/job>/gi) || [])
      .filter((x) => !/^(closed|filled|on hold)$/i.test(tag(x, 'status')))
      .map((x) => normalize(c, x, companyName))
      .filter((j) => j.title && j.url);
  });
}

module.exports = {
  id: ATS,
  name: 'JazzHR',
  kind: 'ats',
  requiresKeys: [],
  homepage: 'https://www.jazzhr.com',
  regions: ['us', 'global'],
  description: 'Public JazzHR (applytojob.com) career pages of US small and mid-size businesses. Direct application forms.',
  fetchBoard,
  async probe(c) { return { count: (await fetchBoard(c)).length }; },
  async search({ query, location, remote, limit } = {}, ctx = {}) {
    const boards = boardsFrom(ctx);
    let failed = 0;
    const lists = await pool(boards, 8, async (c) => {
      try { return await fetchBoard(c); } catch (e) { failed++; throw e; }
    });
    if (failed && ctx.log) ctx.log(`jazzhr: ${failed}/${boards.length} boards failed to load`);
    return lists.flat().filter(Boolean)
      .filter((j) => matchesQuery(j, query) && matchesLocation(j, location, remote))
      .sort((a, b) => (b.postedAt || '').localeCompare(a.postedAt || ''))
      .slice(0, limit || 100);
  },
};
