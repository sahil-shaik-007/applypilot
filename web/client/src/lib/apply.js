// Job actions shared by Jobs, swipe triage, job sheet and Home. All writes are encrypted records.
import { newId } from '@shared/vaultCrypto.js';
import { pickResume as sharedPickResume } from '@shared/campaignRules.js';
import { safeId } from './sync.js';
import { getProfile, pickResumeFor, snapshotOf, profileIdOf } from './profiles.js';

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
export function pickResume(resumes, job, resumeId) { return sharedPickResume(resumes, job, resumeId); }

export function findApplication(app, job) {
  return app.applications.find((a) => a.jobId === job.id);
}

export const event = (message, type = 'note') => ({ t: new Date().toISOString(), type, message });

/** Latest copy of an application (the store re-renders, so look it up again before writing). */
export function getApplication(app, id) { return app.sync.get('applications', id) || app.applications.find((a) => a.id === id); }

/** Merges a patch into an application (+ optional timeline event), keeping the newest copy. */
export async function patchApplication(app, id, patch = {}, ev) {
  const cur = getApplication(app, id);
  if (!cur) throw new Error('Application not found');
  const now = new Date().toISOString();
  const events = ev ? [...(cur.events || []), typeof ev === 'string' ? event(ev, 'step') : { t: now, ...ev }].slice(-60) : cur.events;
  const next = { ...cur, ...patch, events, updatedAt: now };
  if (patch.status === 'applied' && !cur.appliedAt && !patch.appliedAt) {
    next.appliedAt = now;
    if (!next.followUpAt) next.followUpAt = new Date(Date.now() + 7 * 86400000).toISOString();
  }
  await app.put('applications', id, next);
  return next;
}

/**
 * New tracker record (desktop createApplication shape). `profile` is the profile {id, label, values} the
 * application is for; it is stored as `profileId` plus a `profile` snapshot { label, values }.
 */
export function newApplication(job, { status = 'queued', resume, match, campaign, message, source = 'web', profile } = {}) {
  const now = new Date().toISOString();
  const m = match || job.match || null;
  const pid = profile ? profile.id : profileIdOf(campaign);
  return {
    id: newId(),
    jobId: job.id,
    job: jobSnapshot(job),
    campaignId: campaign ? campaign.id : null,
    campaignName: campaign ? campaign.name : 'Phone',
    profileId: pid,
    ...(profile ? { profile: snapshotOf(profile) } : {}),
    resumeId: resume ? resume.id : null,
    resumeName: resume ? resume.name : null,
    score: m ? m.score : null,
    match: m,
    status,
    notes: '',
    source,
    events: [event(message || (status === 'queued' ? 'Queued' : `Created (${status})`), 'created')],
    createdAt: now,
    updatedAt: now,
  };
}

/** Returns the tracker entry for a job, creating it (default 'saved') if missing. */
export async function ensureApplication(app, job, { status = 'saved', resumeId, message, profileId } = {}) {
  const existing = findApplication(app, job);
  if (existing) return existing;
  const who = getProfile(app, profileId);
  const rec = newApplication(job, { status, resume: pickResumeFor(app, job, resumeId, who.id), profile: who, message: message || (status === 'saved' ? 'Saved on phone' : undefined) });
  await app.put('applications', rec.id, rec);
  return rec;
}

/** Creates or updates the tracker entry for a job. */
export async function upsertApplication(app, job, status, { resumeId, message, profileId } = {}) {
  const now = new Date().toISOString();
  const existing = findApplication(app, job);
  if (existing) {
    const next = { ...existing, status, updatedAt: now, events: [...(existing.events || []), event(message || `Status → ${status}`, 'status')] };
    if (status === 'applied' && !existing.appliedAt) { next.appliedAt = now; if (!next.followUpAt) next.followUpAt = new Date(Date.now() + 7 * 86400000).toISOString(); }
    await app.put('applications', existing.id, next);
    return next;
  }
  const who = getProfile(app, profileId);
  const resume = pickResumeFor(app, job, resumeId, who.id);
  const rec = {
    id: newId(),
    jobId: job.id,
    job: jobSnapshot(job),
    campaignId: null,
    campaignName: 'Phone',
    profileId: who.id,
    profile: snapshotOf(who),
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
    ...(status === 'applied' ? { appliedAt: now, followUpAt: new Date(Date.now() + 7 * 86400000).toISOString() } : {}),
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

/**
 * Queues a job for the desktop app (`outbox` collection). The desktop deletes it once picked up.
 * Item fields: jobId, job, resumeId (chosen resume record id), profileId, profile {label, values} (snapshot of
 * the profile to apply with), mode ('review' | 'auto'), createdAt, from. Without a profile the desktop uses profile/main.
 */
export async function sendToLaptop(app, job, { resumeId = 'auto', mode = 'review', profileId } = {}) {
  const who = getProfile(app, profileId);
  const resume = pickResumeFor(app, job, resumeId, who.id);
  const id = newId();
  const item = {
    jobId: job.id,
    job: { ...jobSnapshot(job), match: job.match || null },
    resumeId: resume ? resume.id : null,
    profileId: who.id,
    profile: snapshotOf(who),
    mode: mode === 'auto' ? 'auto' : 'review',
    createdAt: new Date().toISOString(),
    from: 'web',
  };
  await app.put('outbox', id, item);
  // The tracker entry for this job follows the profile it was sent as.
  const existing = findApplication(app, job);
  if (existing && profileIdOf(existing) !== who.id) await patchApplication(app, existing.id, { profileId: who.id, profile: snapshotOf(who) }, `Sent as ${who.label}`).catch(() => {});
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
