// Shared helpers for job-source connectors.
//
// Every connector module exports:
//   { id, name, kind: 'api' | 'ats' | 'feed', requiresKeys: [settingKey...], homepage,
//     async search({ query, location, remote, limit }, ctx) -> Job[] }
// ctx = { keys: { [settingKey]: string }, companies: {...}, log: (msg) => void }
//
// Normalized Job shape (use makeJob to build one):
// { id, source, externalId, title, company, companyLogo, location, remote, employmentType,
//   salaryMin, salaryMax, salaryCurrency, salaryText, description, url, applyUrl,
//   ats, atsMeta, tags, postedAt }

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36 ApplyPilot/1.0';

async function fetchJson(url, opts = {}) {
  const res = await fetch(url, {
    ...opts,
    headers: { 'User-Agent': UA, Accept: 'application/json', ...(opts.headers || {}) },
    signal: opts.signal || AbortSignal.timeout(opts.timeout || 20000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url.split('?')[0]}`);
  return res.json();
}

async function fetchText(url, opts = {}) {
  const res = await fetch(url, {
    ...opts,
    headers: { 'User-Agent': UA, ...(opts.headers || {}) },
    signal: opts.signal || AbortSignal.timeout(opts.timeout || 20000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url.split('?')[0]}`);
  return res.text();
}

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', '#39': "'" };

function htmlToText(html) {
  if (!html) return '';
  return String(html)
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&amp;/g, '&')
    .replace(/<\s*(br|\/p|\/div|\/li|\/h\d)\s*\/?>/gi, '\n')
    .replace(/<li[^>]*>/gi, '• ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&(#?\w+);/g, (m, e) => ENTITIES[e] ?? (e[0] === '#' ? String.fromCharCode(parseInt(e.slice(1), 10)) : m))
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s*\n+/g, '\n\n')
    .trim();
}

// Loose relevance test: every word of the query must appear in the title (or, failing that,
// all words appear somewhere in title + tags). Keeps results on-target for multi-word roles.
function matchesQuery(job, query) {
  if (!query) return true;
  const words = query.toLowerCase().split(/[^a-z0-9+#.]+/).filter((w) => w.length > 1);
  if (!words.length) return true;
  const title = (job.title || '').toLowerCase();
  if (words.every((w) => title.includes(w))) return true;
  const hay = `${title} ${(job.tags || []).join(' ')}`.toLowerCase();
  return words.every((w) => hay.includes(w));
}

// City / region aliases so "Bengaluru" also matches "Bangalore", "NYC" matches "New York", etc.
const LOC_ALIASES = [
  ['bengaluru', 'bangalore', 'blr'], ['mumbai', 'bombay', 'navi mumbai'], ['gurugram', 'gurgaon'], ['chennai', 'madras'], ['kolkata', 'calcutta'],
  ['delhi', 'new delhi', 'ncr', 'noida', 'gurugram', 'gurgaon'], ['hyderabad', 'secunderabad'], ['pune', 'poona'], ['kochi', 'cochin'], ['thiruvananthapuram', 'trivandrum'],
  ['india', 'in', 'ind'], ['new york', 'nyc', 'ny'], ['san francisco', 'sf', 'bay area'], ['los angeles', 'la'], ['united states', 'usa', 'us', 'america'],
  ['united kingdom', 'uk', 'england', 'london'], ['germany', 'deutschland', 'berlin', 'munich'], ['uae', 'dubai', 'united arab emirates', 'abu dhabi'],
  ['singapore', 'sg'], ['netherlands', 'amsterdam'], ['canada', 'toronto', 'vancouver'],
];
function expandLocation(p) {
  const out = new Set([p]);
  for (const group of LOC_ALIASES) if (group.includes(p)) group.forEach((g) => out.add(g));
  return [...out];
}
function locIncludes(hay, term) {
  const esc = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(^|[^a-z])${esc}([^a-z]|$)`).test(hay);
}

function matchesLocation(job, location, remote) {
  if (remote === 'remote' && !job.remote) return false;
  if (remote === 'onsite' && job.remote) return false;
  if (!location) return true;
  const loc = location.toLowerCase().trim();
  if (['anywhere', 'worldwide', 'any'].includes(loc)) return true;
  const jl = (job.location || '').toLowerCase();
  if (!jl) return !!job.remote;
  if (/^remote$/.test(loc)) return !!job.remote;
  return loc.split(/[,/]/).map((s) => s.trim()).filter(Boolean).some((p) => expandLocation(p).some((t) => locIncludes(jl, t))) ||
    (job.remote && /anywhere|worldwide|global/.test(jl));
}

function makeJob(source, j) {
  const externalId = String(j.externalId ?? j.url ?? Math.random());
  return {
    id: `${source}:${externalId}`,
    source,
    externalId,
    title: (j.title || '').trim(),
    company: (j.company || '').trim(),
    companyLogo: j.companyLogo || null,
    location: (j.location || '').trim(),
    remote: !!j.remote || /remote|anywhere|worldwide/i.test(j.location || ''),
    employmentType: j.employmentType || null,
    salaryMin: j.salaryMin ?? null,
    salaryMax: j.salaryMax ?? null,
    salaryCurrency: j.salaryCurrency || null,
    salaryText: j.salaryText || null,
    description: (j.description || '').slice(0, 12000),
    url: j.url || j.applyUrl || '',
    applyUrl: j.applyUrl || j.url || '',
    ats: j.ats || detectAts(j.applyUrl || j.url || ''),
    atsMeta: j.atsMeta || null,
    tags: j.tags || [],
    postedAt: j.postedAt ? new Date(j.postedAt).toISOString() : null,
  };
}

function detectAts(url) {
  if (/greenhouse\.io/.test(url)) return 'greenhouse';
  if (/lever\.co/.test(url)) return 'lever';
  if (/ashbyhq\.com/.test(url)) return 'ashby';
  if (/workable\.com/.test(url)) return 'workable';
  if (/smartrecruiters\.com/.test(url)) return 'smartrecruiters';
  if (/recruitee\.com/.test(url)) return 'recruitee';
  if (/myworkdayjobs\.com/.test(url)) return 'workday';
  if (/linkedin\.com/.test(url)) return 'linkedin';
  if (/indeed\./.test(url)) return 'indeed';
  if (/naukri\.com/.test(url)) return 'naukri';
  return null;
}

// Run async fn over items with bounded concurrency; failures are swallowed per item.
async function pool(items, concurrency, fn) {
  const out = [];
  let i = 0;
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (i < items.length) {
      const idx = i++;
      try { out[idx] = await fn(items[idx], idx); } catch { out[idx] = null; }
    }
  });
  await Promise.all(workers);
  return out;
}

module.exports = { UA, fetchJson, fetchText, htmlToText, matchesQuery, matchesLocation, makeJob, detectAts, pool };
