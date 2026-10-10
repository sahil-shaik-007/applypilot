// Pinpoint career sites: https://{slug}.pinpointhq.com/postings.json (public, keyless).
// Board entries: { slug: "hollandandbarrett", name: "Holland & Barrett" }
// The feed includes the full description sections and structured compensation. The application
// form is at {posting url}/applications/new.
const { fetchJson, htmlToText, matchesQuery, matchesLocation, makeJob, pool } = require('./_util');

const ATS = 'pinpoint';
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

function normalize(c, p) {
  const l = p.location || {};
  const place = [l.city, l.province, l.name && l.name !== l.city ? l.name : null].filter(Boolean).join(', ');
  const remote = p.workplace_type === 'remote';
  const sections = [
    htmlToText(p.description),
    p.key_responsibilities && `${p.key_responsibilities_header || 'Key responsibilities'}\n${htmlToText(p.key_responsibilities)}`,
    p.skills_knowledge_expertise && `${p.skills_knowledge_expertise_header || 'Skills'}\n${htmlToText(p.skills_knowledge_expertise)}`,
    p.benefits && `${p.benefits_header || 'Benefits'}\n${htmlToText(p.benefits)}`,
  ].filter(Boolean);
  const showPay = p.compensation_visible !== false;
  const url = p.url || `https://${c.slug}.pinpointhq.com${p.path}`;
  return makeJob(ATS, {
    externalId: `${c.slug.toLowerCase()}:${p.id}`,
    title: p.title,
    company: c.name || c.slug,
    location: remote ? (place ? `${place} (Remote)` : 'Remote') : place,
    remote,
    employmentType: p.employment_type_text || null,
    salaryMin: showPay ? p.compensation_minimum ?? null : null,
    salaryMax: showPay ? p.compensation_maximum ?? null : null,
    salaryCurrency: showPay ? p.compensation_currency || null : null,
    salaryText: showPay ? p.compensation || null : null,
    description: sections.join('\n\n'),
    url,
    applyUrl: `${url.replace(/[?#].*$/, '').replace(/\/$/, '')}/applications/new`,
    ats: ATS,
    atsMeta: { company: c.slug.toLowerCase(), postingId: String(p.id), path: p.path || null, deadline: p.deadline_at || null },
    tags: [p.job && p.job.department && p.job.department.name, p.job && p.job.division && p.job.division.name, p.workplace_type_text].filter(Boolean),
    postedAt: null,
  });
}

async function fetchBoard(c) {
  return cached(c.slug.toLowerCase(), async () => {
    const d = await fetchJson(`https://${c.slug.toLowerCase()}.pinpointhq.com/postings.json`, { timeout: 25000 });
    if (!d || !Array.isArray(d.data)) throw new Error('not a Pinpoint board');
    return d.data.filter((p) => p && p.id && p.title).map((p) => normalize(c, p));
  });
}

module.exports = {
  id: ATS,
  name: 'Pinpoint',
  kind: 'ats',
  requiresKeys: [],
  homepage: 'https://www.pinpointhq.com',
  regions: ['gb', 'global'],
  description: 'Public Pinpoint career sites (mostly UK employers). Salary ranges included. Direct application forms.',
  fetchBoard,
  async probe(c) { return { count: (await fetchBoard(c)).length }; },
  async search({ query, location, remote, limit } = {}, ctx = {}) {
    const boards = boardsFrom(ctx);
    let failed = 0;
    const lists = await pool(boards, 10, async (c) => {
      try { return await fetchBoard(c); } catch (e) { failed++; throw e; }
    });
    if (failed && ctx.log) ctx.log(`pinpoint: ${failed}/${boards.length} boards failed to load`);
    return lists.flat().filter(Boolean)
      .filter((j) => matchesQuery(j, query) && matchesLocation(j, location, remote))
      .sort((a, b) => Number(b.atsMeta.postingId) - Number(a.atsMeta.postingId)) // ids grow over time; the feed has no dates
      .slice(0, limit || 100);
  },
};
