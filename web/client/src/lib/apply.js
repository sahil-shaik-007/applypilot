// Job actions shared by Jobs, swipe triage, job sheet and Home. All writes are encrypted records.
import { newId } from '@shared/vaultCrypto.js';
import { extractSkills } from '@shared/match.js';
import { safeId } from './sync.js';

export const AUTO_ATS = ['greenhouse', 'lever', 'ashby', 'workable', 'smartrecruiters', 'recruitee'];

/** Compact job snapshot (same fields as the desktop's createApplication). */
export function jobSnapshot(job) {
  return {
    id: job.id, title: job.title, company: job.company, location: job.location, remote: job.remote,
    url: job.url, applyUrl: job.applyUrl, source: job.source, ats: job.ats, atsMeta: job.atsMeta,
    salaryText: job.salaryText, salaryMin: job.salaryMin, salaryMax: job.salaryMax, salaryCurrency: job.salaryCurrency,
    employmentType: job.employmentType, tags: (job.tags || []).slice(0, 12),
    description: (job.description || '').slice(0, 6000), postedAt: job.postedAt,
  };
}

/** Picks the best resume for a job: role tag match > skill overlap > default (desktop pickResume). */
export function pickResume(resumes, job, resumeId) {
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

export function findApplication(app, job) {
  return app.applications.find((a) => a.jobId === job.id);
}

const event = (message, type = 'note') => ({ t: new Date().toISOString(), type, message });

/** Creates or updates the tracker entry for a job. */
export async function upsertApplication(app, job, status, { resumeId, message } = {}) {
  const now = new Date().toISOString();
  const existing = findApplication(app, job);
  if (existing) {
    const next = { ...existing, status, updatedAt: now, events: [...(existing.events || []), event(message || `Status → ${status}`, 'status')] };
    if (status === 'applied' && !existing.appliedAt) next.appliedAt = now;
    await app.put('applications', existing.id, next);
    return next;
  }
  const resume = pickResume(app.resumes, job, resumeId);
  const rec = {
    id: newId(),
    jobId: job.id,
    job: jobSnapshot(job),
    campaignId: null,
    campaignName: 'Phone',
    resumeId: resume ? resume.id : null,
    resumeName: resume ? resume.name : null,
    score: job.match ? job.match.score : null,
    match: job.match || null,
    status,
    notes: '',
    source: 'web',
    events: [event(message || (status === 'saved' ? 'Saved on phone' : status === 'applied' ? 'Applied from phone' : status === 'skipped' ? 'Skipped on phone' : `Created (${status})`), 'created')],
    createdAt: now,
    updatedAt: now,
    ...(status === 'applied' ? { appliedAt: now } : {}),
  };
  await app.put('applications', rec.id, rec);
  return rec;
}

export async function saveJob(app, job) {
  const id = await safeId(job.id);
  await app.put('savedJobs', id, { ...jobSnapshot(job), match: job.match || null, savedAt: new Date().toISOString() });
  const existing = findApplication(app, job);
  if (!existing) await upsertApplication(app, job, 'saved');
}

export async function unsaveJob(app, job) {
  const id = await safeId(job.id);
  if (app.sync.get('savedJobs', id)) await app.remove('savedJobs', id);
  const a = findApplication(app, job);
  if (a && a.status === 'saved') await app.remove('applications', a.id);
}

export async function isSaved(app, job) { return !!app.sync.get('savedJobs', await safeId(job.id)); }

export async function skipJob(app, job) {
  return upsertApplication(app, job, 'skipped', { message: 'Skipped in swipe triage' });
}

/** Queues a job for the desktop app (`outbox` collection). The desktop deletes it once picked up. */
export async function sendToLaptop(app, job, { resumeId = 'auto', mode = 'review' } = {}) {
  const resume = pickResume(app.resumes, job, resumeId);
  const id = newId();
  const item = {
    jobId: job.id,
    job: { ...jobSnapshot(job), match: job.match || null },
    resumeId: resume ? resume.id : null,
    mode: mode === 'auto' ? 'auto' : 'review',
    createdAt: new Date().toISOString(),
    from: 'web',
  };
  await app.put('outbox', id, item);
  return { id, ...item };
}

export function isQueued(app, job) { return app.outbox.some((o) => o.jobId === job.id); }

export function buildPlatformUrl(p, q, loc, remote) {
  const tpl = (remote && p.remoteSearchUrl) || p.searchUrl;
  if (!tpl) return p.url;
  return tpl.replace(/\{q\}/g, encodeURIComponent(q || '')).replace(/\{loc\}/g, encodeURIComponent(loc || ''));
}

export function openExternal(url) {
  if (!url || !/^https?:\/\//i.test(url)) return false;
  const w = window.open(url, '_blank', 'noopener,noreferrer');
  return w !== undefined;
}
