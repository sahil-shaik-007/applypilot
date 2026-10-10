// Zoho Recruit career sites through their public RSS feed: https://{host}/jobs/{portal}/rss
// host is {slug}.zohorecruit.com / .zohorecruit.in / .zohorecruit.eu or a custom domain
// (e.g. careers.zohocorp.com); portal defaults to "Careers". Public, keyless.
// Board entries: { slug: "zohocorp", name: "Zoho", host: "careers.zohocorp.com", portal?: "Careers" }
// The posting page https://{host}/jobs/{portal}/{id}/{title} has the "Apply" / "I'm interested" form.
const { fetchText, htmlToText, matchesQuery, matchesLocation, makeJob, pool } = require('./_util');
const { parseRssItems, decodeEntities } = require('./_helpers');

const ATS = 'zohorecruit';
const TTL = 20 * 60 * 1000;
const FAIL_TTL = 5 * 60 * 1000;
const boardCache = new Map();

function boardsFrom(ctx) {
  let list = ctx && ctx.companies && Array.isArray(ctx.companies[ATS]) ? ctx.companies[ATS] : null;
  if (!list) { try { list = require('../data/boards-extra.json')[ATS] || []; } catch { list = []; } }
  const seen = new Set();
  return list.filter((c) => c && (c.slug || c.host) && !seen.has(keyOf(c)) && seen.add(keyOf(c)));
}
const hostOf = (c) => String(c.host || `${c.slug}.zohorecruit.com`).replace(/^https?:\/\//, '').replace(/\/.*$/, '').toLowerCase();
const portalOf = (c) => c.portal || 'Careers';
const keyOf = (c) => `${hostOf(c)}/${portalOf(c)}`.toLowerCase();

function cached(key, loader) {
  const hit = boardCache.get(key);
  if (hit && Date.now() - hit.t < hit.ttl) return hit.promise;
  const entry = { t: Date.now(), ttl: TTL, promise: null };
  entry.promise = loader().catch((e) => { entry.ttl = FAIL_TTL; throw e; });
  boardCache.set(key, entry);
  return entry.promise;
}

const TZ = { IST: '+0530', PST: '-0800', PDT: '-0700', EST: '-0500', EDT: '-0400', CET: '+0100', CEST: '+0200', BST: '+0100', GST: '+0400', SGT: '+0800', AEST: '+1000' };
function parseDate(s) {
  if (!s) return null;
  const d = new Date(String(s).replace(/\b([A-Z]{3,4})$/, (m) => TZ[m] || m));
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

function normalize(c, it) {
  const host = hostOf(c);
  const raw = it.get('description');
  const cat = (/Category:\s*([^<]*)</i.exec(raw) || [])[1];
  const loc = ((/Location:\s*([^<]*)</i.exec(raw) || [])[1] || '').replace(/\s+/g, ' ').trim();
  // collapse "Tamil Nadu Tamil Nadu India" style repeats
  const location = loc.replace(/\b(.+?) \1\b/g, '$1');
  const body = raw.replace(/^[\s\S]*?(<span id="spandesc">|$)/i, '$1') || raw;
  const link = decodeEntities(it.get('link'));
  const id = it.get('guid') || (/\/(\d{6,})\//.exec(link) || [])[1] || link;
  const url = link.replace(/\?source=RSS$/i, '?source=CareerSite');
  const title = decodeEntities(it.get('title'));
  return makeJob(ATS, {
    externalId: `${host}:${id}`,
    title,
    company: c.name || c.slug,
    location,
    remote: /remote|work from home|wfh/i.test(`${title} ${location}`),
    description: htmlToText(decodeEntities(body)),
    url,
    applyUrl: url,
    ats: ATS,
    atsMeta: { host, portal: portalOf(c), jobId: id },
    tags: [cat && cat.trim()].filter(Boolean),
    postedAt: parseDate(it.get('pubDate')),
  });
}

async function fetchBoard(c) {
  return cached(keyOf(c), async () => {
    const xml = await fetchText(`https://${hostOf(c)}/jobs/${encodeURIComponent(portalOf(c))}/rss`, { timeout: 25000, headers: { Accept: 'application/rss+xml, application/xml, text/xml' } });
    if (!/<rss\b/i.test(xml)) throw new Error('not a Zoho Recruit feed');
    return parseRssItems(xml).map((it) => normalize(c, it)).filter((j) => j.title && j.url);
  });
}

module.exports = {
  id: ATS,
  name: 'Zoho Recruit',
  kind: 'ats',
  requiresKeys: [],
  homepage: 'https://www.zoho.com/recruit/',
  regions: ['in', 'global'],
  description: 'Public Zoho Recruit career sites (Zoho itself and many Indian / global SMBs). Application forms are assisted.',
  fetchBoard,
  async probe(c) { return { count: (await fetchBoard(c)).length }; },
  async search({ query, location, remote, limit } = {}, ctx = {}) {
    const boards = boardsFrom(ctx);
    let failed = 0;
    const lists = await pool(boards, 8, async (c) => {
      try { return await fetchBoard(c); } catch (e) { failed++; throw e; }
    });
    if (failed && ctx.log) ctx.log(`zohorecruit: ${failed}/${boards.length} boards failed to load`);
    return lists.flat().filter(Boolean)
      .filter((j) => matchesQuery(j, query) && matchesLocation(j, location, remote))
      .sort((a, b) => (b.postedAt || '').localeCompare(a.postedAt || ''))
      .slice(0, limit || 100);
  },
};
