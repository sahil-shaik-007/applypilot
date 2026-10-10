// Teamtailor career sites through their public RSS feed: https://{slug}.teamtailor.com/jobs.rss
// (custom career domains also serve /jobs.rss; put it in `host`). Public, keyless.
// Board entries: { slug: "instabee", name: "Instabee", host?: "career.instabee.com" }
// The feed carries title, full HTML description, publish date, remote status, locations and
// department. The application form lives at {job url}/applications/new.
const { fetchText, htmlToText, matchesQuery, matchesLocation, makeJob, pool } = require('./_util');
const { parseRssItems, decodeEntities } = require('./_helpers');

const ATS = 'teamtailor';
const TTL = 20 * 60 * 1000;
const FAIL_TTL = 5 * 60 * 1000;
const boardCache = new Map();

function boardsFrom(ctx) {
  let list = ctx && ctx.companies && Array.isArray(ctx.companies[ATS]) ? ctx.companies[ATS] : null;
  if (!list) { try { list = require('../data/boards-extra.json')[ATS] || []; } catch { list = []; } }
  const seen = new Set();
  return list.filter((c) => c && (c.slug || c.host) && !seen.has(hostOf(c)) && seen.add(hostOf(c)));
}
const hostOf = (c) => String(c.host || `${c.slug}.teamtailor.com`).replace(/^https?:\/\//, '').replace(/\/.*$/, '').toLowerCase();

function cached(key, loader) {
  const hit = boardCache.get(key);
  if (hit && Date.now() - hit.t < hit.ttl) return hit.promise;
  const entry = { t: Date.now(), ttl: TTL, promise: null };
  entry.promise = loader().catch((e) => { entry.ttl = FAIL_TTL; throw e; });
  boardCache.set(key, entry);
  return entry.promise;
}

const REMOTE = { fully: 'Remote', hybrid: 'Hybrid', temporary: 'Temporarily remote' };

function parseLocations(raw) {
  const out = [];
  const re = /<tt:location>([\s\S]*?)<\/tt:location>/gi;
  let m;
  while ((m = re.exec(raw))) {
    const get = (t) => { const x = new RegExp(`<tt:${t}>([\\s\\S]*?)</tt:${t}>`, 'i').exec(m[1]); return x ? decodeEntities(x[1].replace(/<!\[CDATA\[|\]\]>/g, '')).trim() : ''; };
    const name = get('name') || [get('city'), get('country')].filter(Boolean).join(', ');
    if (name) out.push(name);
  }
  return [...new Set(out)];
}

function normalize(c, it) {
  const link = decodeEntities(it.get('link'));
  const remoteStatus = (it.get('remoteStatus') || '').toLowerCase();
  const locs = parseLocations(it.raw);
  const dept = decodeEntities(it.get('tt:department'));
  const role = decodeEntities(it.get('tt:role'));
  const idm = /\/jobs\/(\d+)/.exec(link);
  return makeJob(ATS, {
    externalId: `${hostOf(c)}:${idm ? idm[1] : it.get('guid') || link}`,
    title: decodeEntities(it.get('title')),
    company: c.name || c.slug,
    location: locs.length ? `${locs.join(' / ')}${remoteStatus === 'fully' ? ' (Remote)' : ''}` : (REMOTE[remoteStatus] || ''),
    remote: remoteStatus === 'fully',
    description: htmlToText(decodeEntities(it.get('description'))),
    url: link,
    applyUrl: link ? `${link.replace(/[?#].*$/, '').replace(/\/$/, '')}/applications/new` : '',
    ats: ATS,
    atsMeta: { host: hostOf(c), slug: c.slug || null, jobId: idm ? idm[1] : null, guid: it.get('guid') || null },
    tags: [dept, role, remoteStatus === 'hybrid' ? 'hybrid' : null].filter(Boolean),
    postedAt: it.get('pubDate') || null,
  });
}

async function fetchBoard(c) {
  const host = hostOf(c);
  return cached(host, async () => {
    const xml = await fetchText(`https://${host}/jobs.rss`, { timeout: 25000, headers: { Accept: 'application/rss+xml, application/xml, text/xml' } });
    if (!/<rss\b/i.test(xml)) throw new Error('not a Teamtailor feed');
    return parseRssItems(xml).map((it) => normalize(c, it)).filter((j) => j.title && j.url);
  });
}

module.exports = {
  id: ATS,
  name: 'Teamtailor',
  kind: 'ats',
  requiresKeys: [],
  homepage: 'https://www.teamtailor.com',
  regions: ['global', 'eu'],
  description: 'Public Teamtailor career sites (Nordic / European scale-ups and SMBs). Direct application forms.',
  fetchBoard,
  async probe(c) { return { count: (await fetchBoard(c)).length }; },
  async search({ query, location, remote, limit } = {}, ctx = {}) {
    const boards = boardsFrom(ctx);
    let failed = 0;
    const lists = await pool(boards, 10, async (c) => {
      try { return await fetchBoard(c); } catch (e) { failed++; throw e; }
    });
    if (failed && ctx.log) ctx.log(`teamtailor: ${failed}/${boards.length} boards failed to load`);
    return lists.flat().filter(Boolean)
      .filter((j) => matchesQuery(j, query) && matchesLocation(j, location, remote))
      .sort((a, b) => (b.postedAt || '').localeCompare(a.postedAt || ''))
      .slice(0, limit || 100);
  },
};
