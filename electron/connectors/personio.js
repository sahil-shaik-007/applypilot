// Personio career sites through the public XML feed: https://{slug}.jobs.personio.de/xml?language=en
// (also served on {slug}.jobs.personio.com). Public, keyless.
// Board entries: { slug: "personio", name: "Personio", host?: "personio.jobs.personio.com" }
// The posting page https://{host}/job/{id} contains the application form (no account needed).
const { fetchText, htmlToText, matchesQuery, matchesLocation, makeJob, pool } = require('./_util');
const { decodeEntities } = require('./_helpers');

const ATS = 'personio';
const TTL = 20 * 60 * 1000;
const FAIL_TTL = 5 * 60 * 1000;
const boardCache = new Map();

function boardsFrom(ctx) {
  let list = ctx && ctx.companies && Array.isArray(ctx.companies[ATS]) ? ctx.companies[ATS] : null;
  if (!list) { try { list = require('../data/boards-extra.json')[ATS] || []; } catch { list = []; } }
  const seen = new Set();
  return list.filter((c) => c && (c.slug || c.host) && !seen.has(hostOf(c)) && seen.add(hostOf(c)));
}
const hostOf = (c) => String(c.host || `${c.slug}.jobs.personio.de`).replace(/^https?:\/\//, '').replace(/\/.*$/, '').toLowerCase();

function cached(key, loader) {
  const hit = boardCache.get(key);
  if (hit && Date.now() - hit.t < hit.ttl) return hit.promise;
  const entry = { t: Date.now(), ttl: TTL, promise: null };
  entry.promise = loader().catch((e) => { entry.ttl = FAIL_TTL; throw e; });
  boardCache.set(key, entry);
  return entry.promise;
}

const unCdata = (s) => String(s || '').replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1');
function tag(xml, name) {
  const m = new RegExp(`<${name}\\b[^>]*>([\\s\\S]*?)</${name}>`, 'i').exec(xml);
  return m ? decodeEntities(unCdata(m[1])).trim() : '';
}
function tags(xml, name) {
  const out = [];
  const re = new RegExp(`<${name}\\b[^>]*>([\\s\\S]*?)</${name}>`, 'gi');
  let m;
  while ((m = re.exec(xml))) out.push(m[1]);
  return out;
}

const EMPLOYMENT = { permanent: 'Permanent', intern: 'Internship', trainee: 'Trainee', freelance: 'Freelance', temporary: 'Temporary', working_student: 'Working student' };
const SCHEDULE = { 'full-time': 'Full-time', 'part-time': 'Part-time', 'full-or-part-time': 'Full- or part-time' };

function normalize(c, xml) {
  const host = hostOf(c);
  const id = tag(xml, 'id');
  const offices = [...new Set(tags(xml, 'office').map((o) => decodeEntities(unCdata(o)).trim()).filter(Boolean))];
  const sections = tags(xml, 'jobDescription').map((d) => {
    const name = tag(d, 'name');
    const value = htmlToText(tag(d, 'value'));
    return [name, value].filter(Boolean).join('\n');
  });
  const keywords = tag(xml, 'keywords').split(',').map((s) => s.trim()).filter(Boolean);
  const url = `https://${host}/job/${id}?language=en`;
  const loc = offices.join(' / ');
  return makeJob(ATS, {
    externalId: `${host}:${id}`,
    title: tag(xml, 'name'),
    company: c.name || tag(xml, 'subcompany') || c.slug,
    location: loc,
    remote: /remote|home ?office|mobile/i.test(loc),
    employmentType: [EMPLOYMENT[tag(xml, 'employmentType')] || tag(xml, 'employmentType'), SCHEDULE[tag(xml, 'schedule')] || tag(xml, 'schedule')].filter(Boolean).join(', ') || null,
    description: sections.join('\n\n'),
    url,
    applyUrl: url,
    ats: ATS,
    atsMeta: { host, slug: c.slug || null, positionId: id },
    tags: [tag(xml, 'department'), tag(xml, 'recruitingCategory'), tag(xml, 'seniority'), ...keywords].filter(Boolean),
    postedAt: tag(xml, 'createdAt') || null,
  });
}

async function fetchBoard(c) {
  const host = hostOf(c);
  return cached(host, async () => {
    const xml = await fetchText(`https://${host}/xml?language=en`, { timeout: 25000, headers: { Accept: 'application/xml, text/xml' } });
    if (!/<workzag-jobs\b/i.test(xml)) throw new Error('not a Personio feed');
    return tags(xml, 'position').map((p) => normalize(c, p)).filter((j) => j.title);
  });
}

module.exports = {
  id: ATS,
  name: 'Personio',
  kind: 'ats',
  requiresKeys: [],
  homepage: 'https://www.personio.com',
  regions: ['eu', 'global'],
  description: 'Public Personio career sites (thousands of German / European SMBs and scale-ups). Direct application forms.',
  fetchBoard,
  async probe(c) { return { count: (await fetchBoard(c)).length }; },
  async search({ query, location, remote, limit } = {}, ctx = {}) {
    const boards = boardsFrom(ctx);
    let failed = 0;
    const lists = await pool(boards, 10, async (c) => {
      try { return await fetchBoard(c); } catch (e) { failed++; throw e; }
    });
    if (failed && ctx.log) ctx.log(`personio: ${failed}/${boards.length} boards failed to load`);
    return lists.flat().filter(Boolean)
      .filter((j) => matchesQuery(j, query) && matchesLocation(j, location, remote))
      .sort((a, b) => (b.postedAt || '').localeCompare(a.postedAt || ''))
      .slice(0, limit || 100);
  },
};
