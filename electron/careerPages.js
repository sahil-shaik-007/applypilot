// Watch ANY company's careers page.
//
// inspect(url)  -> works out how to read the page and returns a config + a preview of its jobs:
//   1. ATS: the URL or the page's HTML points at Greenhouse, Lever, Ashby, Workable, SmartRecruiters
//      or Recruitee. Jobs come from that ATS's public API, so they're auto-apply capable.
//   2. Workday: *.myworkdayjobs.com sites, read through Workday's public JSON endpoint.
//   3. JSON-LD: schema.org JobPosting blocks, which many career sites embed for Google Jobs.
//   4. Links: a heuristic scan for anchors that look like job postings (the last resort).
// fetchJobs(config, params) -> normalized Job[] (see connectors/_util.js), filtered by params.
const { fetchText, htmlToText, matchesQuery, matchesLocation, makeJob, UA } = require('./connectors/_util');


// [ats, regex with the board slug in group 1]. Checked against the URL first, then the page HTML.
const ATS_PATTERNS = [
  ['greenhouse', /(?:boards|job-boards)(?:\.eu)?\.greenhouse\.io\/(?:embed\/job_board(?:\/js)?\?for=)?([A-Za-z0-9_-]+)/i],
  ['greenhouse', /boards-api\.greenhouse\.io\/v1\/boards\/([A-Za-z0-9_-]+)/i],
  ['lever', /jobs(?:\.eu)?\.lever\.co\/([A-Za-z0-9_.-]+)/i],
  ['lever', /api(?:\.eu)?\.lever\.co\/v0\/postings\/([A-Za-z0-9_.-]+)/i],
  ['ashby', /jobs\.ashbyhq\.com\/([A-Za-z0-9_.%-]+)/i],
  ['ashby', /api\.ashbyhq\.com\/posting-api\/job-board\/([A-Za-z0-9_.%-]+)/i],
  ['workable', /apply\.workable\.com\/(?:api\/v\d\/widget\/accounts\/)?([A-Za-z0-9_-]+)/i],
  ['smartrecruiters', /(?:jobs|careers)\.smartrecruiters\.com\/([A-Za-z0-9_-]+)/i],
  ['recruitee', /\/\/([A-Za-z0-9-]+)\.recruitee\.com/i],
];
const SLUG_STOP = new Set(['embed', 'api', 'v1', 'v0', 'jobs', 'js', 'static', 'assets', 'j', 'o', 'widget', 'oneclick-ui', 'www']);

const WORKDAY = /^https?:\/\/([a-z0-9-]+)\.(wd\d+)\.myworkdayjobs\.com\/(?:[a-z]{2}-[A-Z]{2}\/)?([A-Za-z0-9_-]+)/i;

function slugFrom(ats, text) {
  for (const [a, re] of ATS_PATTERNS) {
    if (ats && a !== ats) continue;
    const g = new RegExp(re.source, 'gi');
    let m;
    while ((m = g.exec(text))) {
      const slug = decodeURIComponent(m[1]).replace(/\.$/, '');
      if (slug && !SLUG_STOP.has(slug.toLowerCase())) return { ats: a, slug };
    }
  }
  return null;
}

// The company behind a careers page. Order: the site's own name, then the company part of a job
// page title ("Graduate Engineer Trainee - Exponent Energy"), then "Careers at X" style titles, then the
// board slug (e.g. "exponent-energy" -> "Exponent Energy"). A job title is never used as the company.
const GENERIC_TITLE = /^(careers?|jobs?|openings|(open )?roles|positions|work with us|join us|search|apply|home|welcome|job (application|details|board))$/i;
const prettySlug = (slug) => String(slug || '').replace(/[-_.]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()).trim();
function companyFromHtml(html, url, { slug = '' } = {}) {
  const meta = html.match(/<meta[^>]+property=["']og:site_name["'][^>]+content=["']([^"']+)/i) || html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:site_name/i);
  if (meta) { const n = htmlToText(meta[1]).trim(); if (n && n.length <= 60) return n; }
  const title = html.match(/<title[^>]*>([^<]+)<\/title>/i);
  const titleText = title ? htmlToText(title[1]).trim() : '';
  const at = titleText.match(/(?:careers|jobs)\s+(?:at|@)\s+([^|\-–—:]{2,50})/i) || titleText.match(/^([^|\-–—:]{2,50}?)\s+(?:careers|jobs)\b/i);
  if (at && !GENERIC_TITLE.test(at[1].trim())) return at[1].trim();
  // A single job page: "<job title> - <company>" -> the last part is the company.
  const isJobPage = /\/(j|jobs?|job|positions?|postings?|requisitions?|o)\/[^/?#]+/i.test(new URL(url).pathname) || /\/\d{4,}/.test(new URL(url).pathname);
  const parts = titleText.split(/\s[|–—-]\s|:\s/).map((x) => x.trim()).filter(Boolean);
  if (isJobPage && parts.length >= 2) {
    const last = parts[parts.length - 1];
    if (last.length <= 60 && !GENERIC_TITLE.test(last)) return last;
  }
  if (slug) return prettySlug(slug);
  const host = new URL(url).hostname.replace(/^(www|careers|jobs|join)\./, '');
  const base = host.split('.')[0];
  return base.charAt(0).toUpperCase() + base.slice(1);
}

// ---------- JSON-LD JobPosting ----------
function jsonLdBlocks(html) {
  const out = [];
  const re = /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let m;
  while ((m = re.exec(html))) {
    try { out.push(JSON.parse(m[1].trim())); } catch { /* ignore malformed blocks */ }
  }
  return out;
}
function collectPostings(node, acc) {
  if (!node || typeof node !== 'object') return acc;
  if (Array.isArray(node)) { node.forEach((n) => collectPostings(n, acc)); return acc; }
  const type = [].concat(node['@type'] || []);
  if (type.includes('JobPosting')) acc.push(node);
  for (const k of ['@graph', 'itemListElement', 'item', 'hasPart', 'mainEntity']) if (node[k]) collectPostings(node[k], acc);
  return acc;
}
function placeOf(p) {
  const locs = [].concat(p.jobLocation || []).map((l) => {
    const a = (l && l.address) || {};
    return typeof a === 'string' ? a : [a.addressLocality, a.addressRegion, a.addressCountry && (a.addressCountry.name || a.addressCountry)].filter(Boolean).join(', ');
  }).filter(Boolean);
  return [...new Set(locs)].join(' / ');
}
function fromJsonLd(html, pageUrl, company) {
  const postings = collectPostings(jsonLdBlocks(html), []);
  return postings.map((p) => {
    const url = new URL(p.url || p.sameAs || pageUrl, pageUrl).href;
    const sal = p.baseSalary && p.baseSalary.value;
    return makeJob('careerpage', {
      externalId: `${new URL(pageUrl).hostname}:${p.identifier && (p.identifier.value || p.identifier) || url}`,
      title: htmlToText(p.title || ''),
      company: (p.hiringOrganization && p.hiringOrganization.name) || company,
      companyLogo: p.hiringOrganization && p.hiringOrganization.logo,
      location: placeOf(p),
      remote: /TELECOMMUTE/i.test(p.jobLocationType || ''),
      employmentType: [].concat(p.employmentType || []).join(', ') || null,
      salaryMin: sal && (sal.minValue ?? sal.value) || null,
      salaryMax: sal && sal.maxValue || null,
      salaryCurrency: p.baseSalary && p.baseSalary.currency || null,
      description: htmlToText(p.description || ''),
      url,
      applyUrl: url,
      postedAt: p.datePosted || null,
    });
  }).filter((j) => j.title);
}

// ---------- link heuristic ----------
const JOB_HREF = /\/(jobs?|careers?|positions?|openings?|vacanc(y|ies)|opportunit(y|ies)|requisitions?|postings?|roles?)\/[^?#]*[a-z0-9]/i;
const JOB_WORDS = /\b(engineer|developer|manager|designer|analyst|scientist|lead|director|specialist|associate|intern|consultant|architect|administrator|coordinator|officer|executive|representative|head|sales|marketing|support|product|data|devops|qa|tester|accountant|recruiter|writer|operations)\b/i;
const NAV_WORDS = /^(jobs?|careers?|all jobs|view all|see all|open positions|openings|apply|learn more|read more|home|about|benefits|life at|our teams?|students|privacy|cookies?|search)$/i;
function fromLinks(html, pageUrl, company) {
  const seen = new Set();
  const out = [];
  const re = /<a\b[^>]*href=["']([^"'#]+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let m;
  while ((m = re.exec(html)) && out.length < 400) {
    let href;
    try { href = new URL(m[1].replace(/&amp;/g, '&'), pageUrl).href; } catch { continue; }
    if (!/^https?:/.test(href) || href === pageUrl || seen.has(href)) continue;
    const text = htmlToText(m[2]).replace(/\s+/g, ' ').trim();
    if (!text || text.length < 4 || text.length > 140 || NAV_WORDS.test(text)) continue;
    const ats = slugFrom(null, href);
    if (!(JOB_HREF.test(new URL(href).pathname) || ats) || !JOB_WORDS.test(text)) continue;
    seen.add(href);
    // A card's text often runs "Title · Location"; keep the first chunk as the title.
    const [title, ...rest] = text.split(/\s(?:[·|•–—]|-\s)\s?/);
    out.push(makeJob('careerpage', { externalId: href, title: title.trim(), company, location: rest.join(', ').trim().slice(0, 80), url: href, applyUrl: href }));
  }
  return out;
}

// ---------- Workday ----------
async function workdayJobs({ tenant, dc, site }, { query = '', limit = 300 } = {}) {
  const base = `https://${tenant}.${dc}.myworkdayjobs.com`;
  const out = [];
  let total = 0;
  for (let offset = 0; offset < Math.min(limit, 500); offset += 20) {
    const res = await fetch(`${base}/wday/cxs/${tenant}/${site}/jobs`, {
      method: 'POST',
      headers: { 'User-Agent': UA, Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify({ appliedFacets: {}, limit: 20, offset, searchText: query || '' }),
      signal: AbortSignal.timeout(20000),
    });
    if (!res.ok) throw new Error(`Workday returned HTTP ${res.status}`);
    const data = await res.json();
    const list = data.jobPostings || [];
    if (data.total) total = data.total;
    for (const p of list) {
      const url = `${base}/${site}${p.externalPath}`;
      out.push(makeJob('careerpage', {
        externalId: `workday:${tenant}:${(p.bulletFields && p.bulletFields[0]) || p.externalPath}`,
        title: p.title, company: tenant, location: p.locationsText || '', url, applyUrl: url, ats: 'workday',
        atsMeta: { tenant, dc, site, externalPath: p.externalPath },
        postedAt: null, tags: [p.postedOn].filter(Boolean),
      }));
    }
    if (list.length < 20 || out.length >= total) break;
  }
  out.total = total || out.length;
  return out;
}

function connectorFor(ats) { return require(`./connectors/${ats}`); }

async function atsJobs(cfg, params = {}) {
  const c = connectorFor(cfg.ats);
  const jobs = await c.search({ query: params.query || '', location: params.location || '', remote: params.remote || 'any', limit: params.limit || 300 },
    { companies: { [cfg.ats]: [{ slug: cfg.slug, name: cfg.company || cfg.slug }] }, log: () => {} });
  return jobs.map((j) => ({ ...j, company: cfg.company || j.company, careerPageId: cfg.id || null }));
}

async function inspect(url) {
  const u = new URL(url);
  const wd = u.href.match(WORKDAY);
  if (wd) {
    const cfg = { url: u.href, method: 'workday', ats: 'workday', workday: { tenant: wd[1], dc: wd[2], site: wd[3] }, company: wd[1].charAt(0).toUpperCase() + wd[1].slice(1), enabled: true };
    const raw = await workdayJobs(cfg.workday, { limit: 60 });
    return { ...cfg, jobCount: raw.total, jobsPreview: raw.map((j) => ({ ...j, company: cfg.company })) };
  }
  const direct = slugFrom(null, u.href);
  let html = '';
  try { html = await fetchText(u.href, { timeout: 25000, headers: { Accept: 'text/html,application/xhtml+xml' } }); } catch (e) { if (!direct) throw new Error(`Couldn't open that page (${e.message}).`); }
  const company = html ? companyFromHtml(html, u.href, { slug: direct ? direct.slug : '' }) : (direct && direct.slug);
  const ats = direct || (html && slugFrom(null, html));
  if (ats) {
    const cfg = { url: u.href, method: 'ats', ats: ats.ats, slug: ats.slug, company, enabled: true };
    try {
      const jobs = await atsJobs(cfg, { limit: 300 });
      if (jobs.length || direct) return { ...cfg, jobCount: jobs.length, jobsPreview: jobs };
    } catch (e) { if (direct) throw new Error(`Found a ${ats.ats} board "${ats.slug}" but couldn't read it (${e.message}).`); }
  }
  const wdLink = html.match(/https?:\/\/[a-z0-9-]+\.wd\d+\.myworkdayjobs\.com\/(?:[a-z]{2}-[A-Z]{2}\/)?[A-Za-z0-9_-]+/i);
  if (wdLink) { try { const r = await inspect(wdLink[0]); return { ...r, url: u.href, company }; } catch { /* fall through */ } }
  const ld = fromJsonLd(html, u.href, company);
  if (ld.length) return { url: u.href, method: 'jsonld', ats: null, company, enabled: true, jobCount: ld.length, jobsPreview: ld };
  const links = fromLinks(html, u.href, company);
  if (links.length) return { url: u.href, method: 'links', ats: null, company, enabled: true, jobCount: links.length, jobsPreview: links };
  throw new Error('No job listings found on that page. Try the page that lists all open roles (often /careers/jobs), or a single job link from it.');
}

async function fetchJobs(cfg, params = {}) {
  let jobs;
  if (cfg.method === 'ats') jobs = await atsJobs(cfg, params);
  else if (cfg.method === 'workday') jobs = (await workdayJobs(cfg.workday, params)).map((j) => ({ ...j, company: cfg.company || j.company }));
  else {
    const html = await fetchText(cfg.url, { timeout: 25000, headers: { Accept: 'text/html,application/xhtml+xml' } });
    jobs = cfg.method === 'jsonld' ? fromJsonLd(html, cfg.url, cfg.company) : fromLinks(html, cfg.url, cfg.company);
  }
  return jobs
    .map((j) => ({ ...j, careerPageId: cfg.id || null }))
    .filter((j) => matchesQuery(j, params.query) && matchesLocation(j, params.location, params.remote))
    .slice(0, params.limit || 300);
}

module.exports = { inspect, fetchJobs, _internal: { slugFrom, fromJsonLd, fromLinks, companyFromHtml, WORKDAY } };
