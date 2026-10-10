// ATS detection and application-URL resolution, shared by the native layer (src/native/inapp.js)
// and the injected auto-fill engine (web/mobile-autofill builds it into autofill.bundle.js).
// Ported from electron/apply/engine.js (pickAdapter) and electron/apply/adapters/*.js (resolveUrl).
//
// Keep this file free of imports and DOM access: web/mobile-autofill/build.mjs concatenates it
// into the in-page script with the `export` keywords stripped.

/** ATSs where autopilot may submit (after the cancel window, all required answered, no CAPTCHA). */
export const AUTO_SUBMIT_ATS = ['greenhouse', 'lever', 'ashby', 'workable', 'smartrecruiters', 'recruitee'];
/** Sites we only ever pre-fill: the user always submits. */
export const ASSISTED_ATS = ['linkedin', 'indeed', 'naukri', 'glassdoor', 'workday'];
/** Every ATS the in-page engine has specific handling for. */
export const KNOWN_ATS = [...AUTO_SUBMIT_ATS, 'teamtailor'];

const ATS_URL_RULES = [
  ['greenhouse', /greenhouse\.io|[?&]gh_jid=/i],
  ['lever', /lever\.co\//i],
  ['ashby', /ashbyhq\.com/i],
  ['workable', /workable\.com/i],
  ['smartrecruiters', /smartrecruiters\.com/i],
  ['recruitee', /recruitee\.com/i],
  ['teamtailor', /teamtailor\.com/i],
  ['workday', /myworkdayjobs\.com|workday\.com/i],
  ['linkedin', /linkedin\.com/i],
  ['indeed', /indeed\.[a-z.]+\//i],
  ['naukri', /naukri\.com/i],
  ['glassdoor', /glassdoor\.[a-z.]+\//i],
];

export function isHttpUrl(u) { return typeof u === 'string' && /^https?:\/\/[^\s]+$/i.test(u); }

/** Same precedence as the desktop pickAdapter: a known job.ats wins, then URL patterns. */
export function detectAts(job, url) {
  const ats = job && job.ats ? String(job.ats).toLowerCase() : '';
  if (ats && (KNOWN_ATS.includes(ats) || ASSISTED_ATS.includes(ats))) return ats;
  const u = String(url || (job && (job.applyUrl || job.url)) || '');
  for (const [id, re] of ATS_URL_RULES) if (re.test(u)) return id;
  return 'generic';
}

export function canAutoSubmit(ats) { return AUTO_SUBMIT_ATS.includes(ats) && !ASSISTED_ATS.includes(ats); }

// ---------------------------------------------------------------- Greenhouse
export function parseGreenhouse(url, job) {
  const meta = (job && job.atsMeta) || {};
  let token = meta.boardToken || meta.board || meta.token || meta.company || null;
  let id = meta.jobId || meta.id || null;
  try {
    const u = new URL(url);
    let m = /^\/([^/]+)\/jobs\/(\d+)/.exec(u.pathname);
    if (/greenhouse\.io$/.test(u.hostname) && m && m[1] !== 'embed') { token = m[1]; id = m[2]; }
    if (/greenhouse\.io$/.test(u.hostname) && /\/embed\/job_app/.test(u.pathname)) {
      token = u.searchParams.get('for') || token; id = u.searchParams.get('token') || id;
    }
    if (u.searchParams.get('gh_jid')) id = u.searchParams.get('gh_jid');
    m = /\/v1\/boards\/([^/]+)\/jobs\/(\d+)/.exec(u.pathname);
    if (m) { token = m[1]; id = m[2]; }
  } catch { /* not a URL */ }
  if (!id && job && /^\d+$/.test(String(job.externalId || ''))) id = String(job.externalId);
  return { token, id };
}

/** The Greenhouse-hosted embeddable form: never redirects away to a company careers site. */
export function greenhouseFormUrl(token, id, job) {
  const host = job && job.atsMeta && job.atsMeta.region === 'eu' ? 'job-boards.eu.greenhouse.io' : 'job-boards.greenhouse.io';
  return `https://${host}/embed/job_app?for=${encodeURIComponent(token)}&token=${encodeURIComponent(id)}`;
}

// ---------------------------------------------------------------- per-ATS form URLs
const RESOLVERS = {
  greenhouse(job, url) {
    const { token, id } = parseGreenhouse(url, job);
    return token && id ? greenhouseFormUrl(token, id, job) : url;
  },
  lever(job, url) {
    const m = /^(https?:\/\/jobs\.(?:eu\.)?lever\.co\/[^/?#]+\/[0-9a-f-]{36})/i.exec(url);
    return m ? `${m[1]}/apply` : url;
  },
  ashby(job, url) {
    const m = /^(https?:\/\/jobs\.ashbyhq\.com\/[^/?#]+\/[0-9a-f-]{36})/i.exec(url);
    return m ? `${m[1]}/application` : url;
  },
  workable(job, url) {
    let m = /^https?:\/\/apply\.workable\.com\/j\/([A-Z0-9]+)/i.exec(url);
    if (m) return `https://apply.workable.com/j/${m[1]}/apply`;
    m = /^https?:\/\/apply\.workable\.com\/([^/?#]+)\/j\/([A-Z0-9]+)/i.exec(url);
    if (m) return `https://apply.workable.com/${m[1]}/j/${m[2]}/apply/`;
    m = /^https?:\/\/([^.]+)\.workable\.com\/j(?:obs)?\/([A-Z0-9]+)/i.exec(url);
    if (m && m[1] !== 'apply' && m[1] !== 'www') return `https://apply.workable.com/${m[1]}/j/${m[2]}/apply/`;
    return url;
  },
  smartrecruiters(job, url) {
    const meta = (job && job.atsMeta) || {};
    const company = meta.company || meta.companyIdentifier || (/smartrecruiters\.com\/([^/?#]+)\//i.exec(url) || [])[1];
    const uuid = meta.uuid || meta.publicationId || null;
    if (company && uuid && !/oneclick-ui/.test(url)) return `https://jobs.smartrecruiters.com/oneclick-ui/company/${company}/publication/${uuid}?dcr_ci=${company}`;
    return url;
  },
  recruitee(job, url) {
    const m = /^(https?:\/\/[^/]+\/o\/[^/?#]+)\/?(?:[?#].*)?$/i.exec(url);
    return m ? `${m[1]}/c/new` : url;
  },
};

/** The URL the in-app browser should open for a job (the form itself where we know where it lives). */
export function resolveApplyUrl(job) {
  const url = (job && (job.applyUrl || job.url)) || '';
  const ats = detectAts(job, url);
  const r = RESOLVERS[ats];
  try { return r ? r(job || {}, url) : url; } catch { return url; }
}

/** Approximate registrable domain ("boards.greenhouse.io" -> "greenhouse.io", "x.co.uk" -> "x.co.uk"). */
export function siteOf(hostOrUrl) {
  let h = String(hostOrUrl || '').toLowerCase();
  try { if (/^https?:/.test(h)) h = new URL(h).hostname; } catch { return ''; }
  const parts = h.split('.').filter(Boolean);
  if (parts.length <= 2) return parts.join('.');
  const sld = parts[parts.length - 2];
  const two = /^(co|com|org|net|ac|gov|edu)$/.test(sld) && parts[parts.length - 1].length === 2;
  return parts.slice(two ? -3 : -2).join('.');
}

/** Sites an application may legitimately pass through (the engine only injects data on these). */
export const ATS_SITES = ['greenhouse.io', 'lever.co', 'ashbyhq.com', 'workable.com', 'smartrecruiters.com', 'recruitee.com',
  'teamtailor.com', 'myworkdayjobs.com', 'workday.com', 'linkedin.com', 'indeed.com', 'naukri.com', 'glassdoor.com',
  'icims.com', 'jobvite.com', 'bamboohr.com', 'breezy.hr', 'jazzhr.com', 'applytojob.com', 'personio.de', 'personio.com',
  'successfactors.com', 'taleo.net', 'oraclecloud.com', 'rippling.com', 'dover.com', 'wellfound.com'];
