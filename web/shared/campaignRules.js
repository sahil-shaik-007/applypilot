// Pure campaign / tracker rules shared by the phone apps and the PWA. Hand-ported from the desktop
// (electron/campaigns.js CampaignManager, electron/main.js insights:salary, applications:import and
// data:exportWorkLog) so a campaign behaves the same on every device. No DOM, no Node APIs.
//
// If you change a rule here, change it in electron/campaigns.js too (and vice versa).
import { scoreJob, isExcluded, extractSkills } from './match.js';

export const DAY = 86400000;
export const today = (d = new Date()) => d.toISOString().slice(0, 10);

// ---------------------------------------------------------------- text helpers (campaigns.js)
export function fillTemplate(tpl, job = {}, profile = {}) {
  let t = tpl || '';
  // The stock sentence "With 0 years of experience in X" is untrue-sounding for a beginner: they get a true one instead.
  const yrs = Number(profile.totalYearsExperience);
  if (profile.totalYearsExperience !== undefined && profile.totalYearsExperience !== '' && yrs < 1) {
    t = t.split('With {years} years of experience in {skills}').join((profile.skills || []).length ? 'As a recent graduate skilled in {skills}' : 'As a recent graduate');
  }
  return t.replace(/\{(\w+)\}/g, (m, k) => ({
    company: job.company, title: job.title, firstName: profile.firstName, lastName: profile.lastName,
    skills: (profile.skills || []).slice(0, 5).join(', '), years: profile.totalYearsExperience,
  }[k] ?? m));
}
export const DEFAULT_COVER_TEMPLATE = "Dear {company} team,\n\nI'm excited to apply for the {title} role. With {years} years of experience in {skills}, I'm confident I can contribute from day one.\n\nThank you for your consideration.\n\n{firstName} {lastName}";

function tokens(s) { return new Set((s || '').toLowerCase().replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter((w) => w.length > 2)); }
/** Jaccard similarity of words longer than 2 chars (same as the desktop Q&A memory). */
export function similarity(a, b) {
  const A = tokens(a); const B = tokens(b);
  if (!A.size || !B.size) return 0;
  let inter = 0; A.forEach((w) => B.has(w) && inter++);
  return inter / (A.size + B.size - inter);
}

/** Best saved answer for a form question (desktop answerQuestion step 1: >= 0.72 similarity). */
export function bestAnswer(qa = [], question) {
  let best = null; let bestSim = 0;
  for (const q of qa) {
    if (!q || !q.answer) continue;
    const sim = similarity(q.question, question);
    if (sim > bestSim) { best = q; bestSim = sim; }
  }
  return best && bestSim >= 0.72 ? best : null;
}

/** Whether an unanswered form question is worth remembering for the user (desktop rule). */
export function worthAsking(qa = [], question, required) {
  const q = String(question || '').trim();
  if (!q) return false;
  if (!(required || q.split(/\s+/).length >= 4)) return false;
  return !qa.some((x) => similarity(x.question, q) >= 0.85);
}

// ---------------------------------------------------------------- guards (campaigns.js)
/**
 * Duplicate guard + per-company cap: true when this job (same id, or same company+title) is already
 * tracked, or 2+ applications went to the same company in the last 30 days (skipped ones don't count).
 */
export function alreadyHandled(job, applications = [], now = Date.now()) {
  const co = (job.company || '').toLowerCase().trim();
  const key = `${co}|${(job.title || '').toLowerCase()}`;
  const since = now - 30 * DAY;
  let sameCompany = 0;
  for (const a of applications) {
    const aj = a.job || {};
    const aco = (aj.company || '').toLowerCase().trim();
    if (a.jobId === job.id || `${aco}|${(aj.title || '').toLowerCase()}` === key) return true;
    if (co && aco === co && a.status !== 'skipped' && new Date(a.createdAt).getTime() > since) sameCompany++;
  }
  return sameCompany >= 2;
}

/** Applications attempted today (optionally for one campaign): the daily-cap counter. */
export function attemptsToday(applications = [], campaignId, d = today()) {
  return applications.filter((a) => a.attemptedAt && String(a.attemptedAt).startsWith(d) && (!campaignId || a.campaignId === campaignId)).length;
}

/** Desktop pickResume: explicit id > role tag in title > most shared skills > default > first. */
export function pickResume(resumes = [], job, resumeId) {
  if (!resumes.length) return null;
  if (resumeId && resumeId !== 'auto') { const r = resumes.find((x) => x.id === resumeId); if (r) return r; }
  if (job) {
    const title = (job.title || '').toLowerCase();
    const tagged = resumes.find((r) => (r.roles || []).some((role) => role && title.includes(role.toLowerCase())));
    if (tagged) return tagged;
    const js = new Set(extractSkills(`${job.title} ${job.description}`));
    let best = null; let bestN = -1;
    for (const r of resumes) { const n = (r.skills || []).filter((s) => js.has(s)).length; if (n > bestN) { best = r; bestN = n; } }
    if (bestN > 0) return best;
  }
  return resumes.find((r) => r.isDefault) || resumes[0];
}

/** The searches one campaign run performs: every role x up to 3 locations (max `cap`). */
export function campaignQueries(c, cap = 6) {
  const roles = (c.roles || []).map((r) => String(r).trim()).filter(Boolean);
  const locations = (c.locations && c.locations.length ? c.locations : ['']).slice(0, 3);
  const out = [];
  for (const q of roles) for (const location of locations) out.push({ q, location: String(location || '').trim(), remote: c.remote || 'any' });
  return out.slice(0, cap);
}

/**
 * One campaign pass over freshly searched jobs (desktop runOnce, minus the browser part).
 * Returns { fresh, good, toQueue, stats } where toQueue are the best matches to put in the
 * Review queue (max 50 waiting per campaign) sorted by score.
 */
export function selectMatches(c, jobs, { profile = {}, resumes = [], applications = [], minMatchScore = 55, now = Date.now() } = {}) {
  const include = (c.includeKeywords || []).map((k) => k.toLowerCase()).filter(Boolean);
  const handled = applications.slice();
  const fresh = [];
  let excluded = 0; let duplicates = 0;
  for (const job of jobs) {
    if (alreadyHandled(job, handled, now)) { duplicates++; continue; }
    if (isExcluded(job, { profile, campaign: c })) { excluded++; continue; }
    if (include.length && !include.some((k) => `${job.title} ${job.description}`.toLowerCase().includes(k))) { excluded++; continue; }
    const resume = pickResume(resumes, job, c.resumeId);
    const match = scoreJob(job, { resumeText: resume ? resume.text || '' : '', profile, campaign: c });
    fresh.push({ job, match, resume });
  }
  const minScore = Number(c.minScore ?? minMatchScore ?? 55);
  // Scams and jobs you can't take (eligibility blockers) never reach the queue.
  const good = fresh.filter((x) => x.match.score >= minScore
    && !x.match.flags.some((f) => /scam/i.test(f))
    && !(x.match.eligibility && x.match.eligibility.ok === false))
    .sort((a, b) => b.match.score - a.match.score);
  // The per-company cap also applies within one run.
  const picked = [];
  for (const g of good) {
    if (alreadyHandled(g.job, handled, now)) continue;
    picked.push(g);
    handled.push({ jobId: g.job.id, job: { company: g.job.company, title: g.job.title }, status: 'queued', createdAt: new Date(now).toISOString() });
  }
  const waiting = applications.filter((a) => a.campaignId === c.id && a.status === 'queued').length;
  const toQueue = picked.slice(0, Math.max(0, 50 - waiting));
  return { fresh, good: picked, toQueue, stats: { searched: jobs.length, excluded, duplicates, belowMin: fresh.length - good.length, minScore } };
}

/** Engine result → tracker status (desktop finalize()). */
export function resultStatus(result = {}) {
  return { submitted: 'applied', 'filled-awaiting-user': 'awaiting-you', 'needs-attention': 'awaiting-you', failed: 'failed', held: 'awaiting-you', cancelled: 'awaiting-you' }[result.status] || 'awaiting-you';
}

// ---------------------------------------------------------------- market pay (main.js insights:salary)
const titleWords = (t) => new Set(String(t || '').toLowerCase().replace(/(senior|sr|junior|jr|lead|staff|principal|ii|iii|iv|i)/g, ' ').split(/[^a-z0-9+#]+/).filter((w) => w.length > 1));
/** 25th/50th/75th percentile pay of similar titles among `seen` jobs (needs >= 5 samples). */
export function salaryInsight(job, seen = []) {
  if (!job) return null;
  const target = titleWords(job.title);
  const cur = job.salaryCurrency || null;
  const mids = [];
  const ids = new Set();
  for (const j of seen) {
    if (!j || !(j.salaryMin || j.salaryMax) || (cur && j.salaryCurrency && j.salaryCurrency !== cur)) continue;
    const key = j.id || `${j.company}|${j.title}|${j.salaryMin}|${j.salaryMax}`;
    if (ids.has(key)) continue;
    const w = titleWords(j.title); let inter = 0; target.forEach((x) => w.has(x) && inter++);
    if (!target.size || inter / target.size < 0.6) continue;
    ids.add(key);
    const lo = j.salaryMin || j.salaryMax; const hi = j.salaryMax || j.salaryMin;
    mids.push({ v: (lo + hi) / 2, cur: j.salaryCurrency || cur });
  }
  if (mids.length < 5) return { count: mids.length };
  const currency = cur || mids[0].cur;
  const vals = mids.filter((m) => !currency || m.cur === currency).map((m) => m.v).sort((a, b) => a - b);
  const q = (p) => vals[Math.min(vals.length - 1, Math.max(0, Math.round(p * (vals.length - 1))))];
  return { count: vals.length, currency, p25: q(0.25), median: q(0.5), p75: q(0.75) };
}

// ---------------------------------------------------------------- tracker import / work log (main.js)
/** Turns parsed tracker rows into new application records, skipping company+title duplicates. */
export function trackerImportRecords(items, existing = [], source = 'CSV', newId = () => Math.random().toString(36).slice(2)) {
  const keys = new Set(existing.map((a) => `${((a.job || {}).company || '').toLowerCase()}|${((a.job || {}).title || '').toLowerCase()}`));
  const out = [];
  for (const it of items) {
    const key = `${it.company.toLowerCase()}|${it.title.toLowerCase()}`;
    if (keys.has(key)) continue;
    keys.add(key);
    const now = new Date().toISOString();
    out.push({
      id: newId(), jobId: `import:${newId()}`, campaignId: null, campaignName: `Imported (${source})`, resumeId: null, resumeName: null, score: null,
      job: { title: it.title, company: it.company, location: it.location, url: it.url, applyUrl: it.url, source: 'import', salaryText: it.salaryText },
      status: it.status, notes: it.notes, appliedAt: it.appliedAt || (it.status !== 'saved' ? now : null), source: 'import',
      events: [{ t: now, type: 'imported', message: `Imported from ${source}` }], createdAt: it.appliedAt || now, updatedAt: now,
    });
  }
  return { records: out, skipped: items.length - out.length };
}

const csvCell = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
export const toCsv = (rows) => rows.map((row) => row.map(csvCell).join(',')).join('\r\n');

/** Dated log of applications since `from` (default: last 4 weeks), e.g. for work-search requirements. */
export function workLogRows(applications = [], from = new Date(Date.now() - 28 * DAY)) {
  const rows = [['Date', 'Employer', 'Position', 'Contact method', 'Website / URL', 'Location', 'Result']];
  const apps = applications.filter((a) => a.appliedAt && new Date(a.appliedAt) >= from).sort((a, b) => new Date(a.appliedAt) - new Date(b.appliedAt));
  for (const a of apps) {
    rows.push([new Date(a.appliedAt).toLocaleDateString(), a.job.company, a.job.title, 'Online application', a.job.applyUrl || a.job.url, a.job.location,
      { applied: 'Applied — awaiting response', interview: 'Interview', offer: 'Offer received', rejected: 'Not selected' }[a.status] || a.status]);
  }
  return { rows, count: apps.length };
}

/** Full tracker export (same columns as the desktop CSV). */
export function trackerRows(applications = []) {
  const rows = [['Title', 'Company', 'Location', 'Status', 'Match', 'Resume', 'Campaign', 'Source', 'Applied', 'URL', 'Notes']];
  for (const a of applications) rows.push([a.job.title, a.job.company, a.job.location, a.status, a.score ?? '', a.resumeName || '', a.campaignName || '', a.job.source || '', a.appliedAt ? a.appliedAt.slice(0, 10) : '', a.job.applyUrl || a.job.url || '', a.notes || '']);
  return rows;
}

// ---------------------------------------------------------------- dashboard stats (Dashboard.jsx)
export const isApplied = (a) => ['applied', 'interview', 'offer', 'rejected'].includes(a.status) && a.appliedAt;

export function groupRate(apps, key) {
  const m = new Map();
  for (const a of apps.filter(isApplied)) {
    const k = key(a) || '—';
    const g = m.get(k) || { k, applied: 0, interviews: 0, offers: 0 };
    g.applied++;
    if (a.status === 'interview' || a.status === 'offer') g.interviews++;
    if (a.status === 'offer') g.offers++;
    m.set(k, g);
  }
  return [...m.values()].sort((a, b) => b.applied - a.applied).slice(0, 6);
}

export function dashboardStats(apps = [], campaigns = [], now = Date.now()) {
  const startToday = new Date(now); startToday.setHours(0, 0, 0, 0);
  const applied = apps.filter(isApplied);
  const todayN = applied.filter((a) => new Date(a.appliedAt) >= startToday).length;
  const week = applied.filter((a) => now - new Date(a.appliedAt) < 7 * DAY).length;
  const interviews = apps.filter((a) => a.status === 'interview' || a.status === 'offer').length;
  const offers = apps.filter((a) => a.status === 'offer').length;
  const responded = apps.filter((a) => ['interview', 'offer', 'rejected'].includes(a.status)).length;
  const days = Array.from({ length: 14 }, (_, i) => {
    const d0 = new Date(startToday.getTime() - (13 - i) * DAY);
    const d1 = new Date(d0.getTime() + DAY);
    return applied.filter((a) => new Date(a.appliedAt) >= d0 && new Date(a.appliedAt) < d1).length;
  });
  const found = campaigns.reduce((n, c) => n + ((c.stats && c.stats.found) || 0), 0);
  const funnel = [
    { label: 'Jobs scanned', v: Math.max(found, apps.length) },
    { label: 'Matched & queued', v: apps.filter((a) => a.status !== 'skipped').length },
    { label: 'Applied', v: applied.length },
    { label: 'Interviews', v: interviews },
    { label: 'Offers', v: offers },
  ];
  return { total: applied.length, today: todayN, week, interviews, offers, responseRate: applied.length ? Math.round((responded / applied.length) * 100) : 0, days, found, funnel };
}

/** Morning digest: what changed in the last `hours` and what needs attention today. */
export function digest(apps = [], { now = Date.now(), hours = 24 } = {}) {
  const since = now - hours * 3600000;
  const recent = (iso) => iso && new Date(iso).getTime() >= since;
  const newMatches = apps.filter((a) => a.status === 'queued' && recent(a.createdAt)).length;
  const needsYou = apps.filter((a) => a.status === 'awaiting-you').length;
  const queued = apps.filter((a) => a.status === 'queued').length;
  const appliedRecently = apps.filter((a) => a.appliedAt && recent(a.appliedAt)).length;
  const followUps = apps.filter((a) => a.status === 'applied' && ((a.followUpAt && new Date(a.followUpAt).getTime() <= now) || (!a.followUpAt && a.appliedAt && now - new Date(a.appliedAt) > 7 * DAY)));
  const end = new Date(now); end.setHours(23, 59, 59, 999);
  const interviewsToday = apps.filter((a) => a.interviewAt && new Date(a.interviewAt).getTime() >= now - 3600000 && new Date(a.interviewAt) <= end);
  return { newMatches, needsYou, queued, appliedRecently, followUps, interviewsToday };
}

/** Activity feed derived from application timelines (the phone has no separate activity log). */
export function activityFeed(apps = [], limit = 30) {
  const out = [];
  for (const a of apps) for (const e of a.events || []) out.push({ id: `${a.id}:${e.t}:${out.length}`, t: e.t, type: e.type, message: `${e.message} · ${a.job.title} at ${a.job.company}`, appId: a.id });
  return out.sort((x, y) => String(y.t).localeCompare(String(x.t))).slice(0, limit);
}
