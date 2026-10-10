// Breezy HR career portals: https://{slug}.breezy.hr/json (public, keyless).
// Board entries: { slug: "acme", name: "Acme" }
// The JSON list has title, locations, type, department, salary and publish date but no description,
// so descriptions are read from the posting page (<div class="description">) for returned jobs only.
// The application form is at {posting url}/apply.
const { fetchJson, fetchText, htmlToText, matchesQuery, matchesLocation, makeJob, pool } = require('./_util');
const { parseSalaryText } = require('./_helpers');

const ATS = 'breezy';
const TTL = 20 * 60 * 1000;
const FAIL_TTL = 5 * 60 * 1000;
const boardCache = new Map();
const detailCache = new Map();

function boardsFrom(ctx) {
  let list = ctx && ctx.companies && Array.isArray(ctx.companies[ATS]) ? ctx.companies[ATS] : null;
  if (!list) { try { list = require('../data/boards-extra.json')[ATS] || []; } catch { list = []; } }
  const seen = new Set();
  return list.filter((c) => c && c.slug && /^[a-z0-9-]+$/i.test(c.slug) && !seen.has(c.slug.toLowerCase()) && seen.add(c.slug.toLowerCase()));
}

function cached(map, key, loader) {
  const hit = map.get(key);
  if (hit && Date.now() - hit.t < hit.ttl) return hit.promise;
  const entry = { t: Date.now(), ttl: TTL, promise: null };
  entry.promise = loader().catch((e) => { entry.ttl = FAIL_TTL; throw e; });
  map.set(key, entry);
  return entry.promise;
}

function normalize(c, p) {
  const locs = (p.locations && p.locations.length ? p.locations : [p.location]).filter(Boolean);
  const names = [...new Set(locs.map((l) => l.name || [l.city, l.state && l.state.name, l.country && l.country.name].filter(Boolean).join(', ')).filter(Boolean))];
  const remote = locs.some((l) => l.is_remote) || /remote/i.test(names.join(' '));
  const sal = p.salary ? parseSalaryText(p.salary) : {};
  const url = p.url || `https://${c.slug}.breezy.hr/p/${p.friendly_id || p.id}`;
  return makeJob(ATS, {
    externalId: `${c.slug.toLowerCase()}:${p.id}`,
    title: p.name,
    company: c.name || (p.company && p.company.name) || c.slug,
    companyLogo: (p.company && p.company.logo_url) || null,
    location: names.join(' / ') + (remote && !/remote/i.test(names.join(' ')) ? (names.length ? ' (Remote)' : 'Remote') : ''),
    remote,
    employmentType: (p.type && p.type.name) || null,
    salaryMin: sal.min ?? null,
    salaryMax: sal.max ?? null,
    salaryCurrency: sal.currency || null,
    salaryText: p.salary || null,
    url,
    applyUrl: `${url.replace(/[?#].*$/, '').replace(/\/$/, '')}/apply`,
    ats: ATS,
    atsMeta: { company: c.slug.toLowerCase(), positionId: p.id, friendlyId: p.friendly_id || null },
    tags: [p.department, p.type && p.type.name].filter(Boolean),
    postedAt: p.published_date || null,
  });
}

async function fetchBoard(c) {
  return cached(boardCache, c.slug.toLowerCase(), async () => {
    const d = await fetchJson(`https://${c.slug.toLowerCase()}.breezy.hr/json`, { timeout: 25000 });
    if (!Array.isArray(d)) throw new Error('not a Breezy portal');
    return d.filter((p) => p && p.id && p.name).map((p) => normalize(c, p));
  });
}

async function enrich(job) {
  try {
    const html = await cached(detailCache, job.url, () => fetchText(job.url, { timeout: 20000 }));
    const m = /<div class="description">([\s\S]*?)<\/div>\s*<div class="apply-container">/i.exec(html) || /<div class="description">([\s\S]*?)<\/div>/i.exec(html);
    return m ? { ...job, description: htmlToText(m[1]).slice(0, 12000) } : job;
  } catch {
    return job;
  }
}

module.exports = {
  id: ATS,
  name: 'Breezy HR',
  kind: 'ats',
  requiresKeys: [],
  homepage: 'https://breezy.hr',
  regions: ['global'],
  description: 'Public Breezy HR career portals of SMBs and agencies. Direct application forms.',
  fetchBoard,
  async probe(c) { return { count: (await fetchBoard(c)).length }; },
  async search({ query, location, remote, limit } = {}, ctx = {}) {
    const boards = boardsFrom(ctx);
    let failed = 0;
    const lists = await pool(boards, 8, async (c) => {
      try { return await fetchBoard(c); } catch (e) { failed++; throw e; }
    });
    if (failed && ctx.log) ctx.log(`breezy: ${failed}/${boards.length} boards failed to load`);
    const matched = lists.flat().filter(Boolean)
      .filter((j) => matchesQuery(j, query) && matchesLocation(j, location, remote))
      .sort((a, b) => (b.postedAt || '').localeCompare(a.postedAt || ''))
      .slice(0, limit || 100);
    const jobs = await pool(matched, 8, enrich);
    return jobs.map((j, i) => j || matched[i]);
  },
};
