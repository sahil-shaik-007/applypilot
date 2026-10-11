// Profiles: several people (you, a brother, ...) each with their own details and their own resumes.
//   - The default profile is the existing `profile/main` record (never moved or deleted). Its label lives on
//     that record (`label`, shown as "Me" until renamed), so a user with no other profiles sees no change.
//   - Other profiles are records in the encrypted `profiles` collection: { id, label, values, createdAt, updatedAt }.
//   - A resume may carry `profileId` (null/undefined = shared with every profile). A campaign or application
//     carries `profileId` (absent = the default profile) and applications/outbox items carry a `profile`
//     snapshot { label, values }, so the desktop can apply with the right details without syncing profiles.
import { newId } from '@shared/vaultCrypto.js';
import { pickResume } from '@shared/campaignRules.js';
import { withDefaults } from './profile.js';

export const DEFAULT_PROFILE_ID = 'main';
export const DEFAULT_LABEL = 'Me';

const norm = (id) => (id ? id : DEFAULT_PROFILE_ID);
/** Profile id of a campaign / application / resume record (absent = the default profile). */
export const profileIdOf = (rec) => norm(rec && rec.profileId);

/** Every profile, default first, then the others in the order they were created. Reads the live sync layer. */
export function allProfiles(app) {
  const s = app && app.sync;
  if (!s) return [{ id: DEFAULT_PROFILE_ID, label: DEFAULT_LABEL, values: {}, isDefault: true }];
  const main = s.get('profile', DEFAULT_PROFILE_ID) || {};
  const others = s.entries('profiles')
    .map((r) => ({ id: r.id, label: r.data.label || 'Unnamed', values: r.data.values || {}, createdAt: r.data.createdAt || '', isDefault: false }))
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  return [{ id: DEFAULT_PROFILE_ID, label: main.label || DEFAULT_LABEL, values: main.values || {}, isDefault: true }, ...others];
}

/** One profile by id; an unknown or missing id falls back to the default profile. */
export function getProfile(app, id) {
  const list = allProfiles(app);
  return list.find((p) => p.id === norm(id)) || list[0];
}

/** Snapshot stored on applications and outbox items: what the desktop needs to fill the form. */
export const snapshotOf = (p) => ({ label: p.label, values: p.values || {} });

/** Resumes a profile may use: its own first, then shared ones (no profile, or a profile that no longer exists). */
export function resumePool(app, profileId) {
  const pid = norm(profileId);
  const ids = new Set(allProfiles(app).map((p) => p.id));
  const all = app && app.sync ? app.sync.list('resumes') : (app.resumes || []);
  const own = all.filter((r) => r.profileId === pid);
  const shared = all.filter((r) => !r.profileId || !ids.has(r.profileId));
  return { own, shared, all: [...own, ...shared] };
}

/**
 * Desktop pickResume for one profile: an explicit resume wins, then the profile's own resumes (role tag, skills,
 * default), then the shared ones.
 */
export function pickResumeFor(app, job, resumeId, profileId) {
  const all = app && app.sync ? app.sync.list('resumes') : (app.resumes || []);
  if (resumeId && resumeId !== 'auto') { const r = all.find((x) => x.id === resumeId); if (r) return r; }
  const { own, shared } = resumePool(app, profileId);
  return own.length ? pickResume(own, job) : pickResume(shared, job);
}

/** Profile an application for this job should use: its own, else its campaign's, else the default. */
export function profileIdForJob(app, job) {
  if (!job) return DEFAULT_PROFILE_ID;
  const a = (app.applications || []).find((x) => x.jobId === job.id);
  if (a && a.profileId) return a.profileId;
  if (a && a.campaignId && app.sync) {
    const c = app.sync.get('campaigns', a.campaignId);
    if (c && c.profileId) return c.profileId;
  }
  return DEFAULT_PROFILE_ID;
}

/** Resume group used to scope "default": resumes of one profile, or the shared group. */
export const resumeGroup = (r) => r.profileId || 'shared';

// ---------------------------------------------------------------- writes
export async function createProfile(app, label) {
  const name = String(label || '').trim();
  if (!name) throw new Error('Give the profile a name, for example "Brother".');
  const id = newId();
  const now = new Date().toISOString();
  await app.put('profiles', id, { id, label: name.slice(0, 60), values: withDefaults({}), createdAt: now, updatedAt: now });
  return id;
}

export async function renameProfile(app, id, label) {
  const name = String(label || '').trim();
  if (!name) throw new Error('The name cannot be empty.');
  if (norm(id) === DEFAULT_PROFILE_ID) {
    const cur = app.sync.get('profile', DEFAULT_PROFILE_ID) || {};
    await app.put('profile', DEFAULT_PROFILE_ID, { ...cur, label: name.slice(0, 60) });
    return;
  }
  const cur = app.sync.get('profiles', id);
  if (!cur) throw new Error('Profile not found');
  await app.put('profiles', id, { ...cur, label: name.slice(0, 60), updatedAt: new Date().toISOString() });
}

/**
 * Deletes a non-default profile. Its resumes and applications stay (they keep their profileId). Campaigns that
 * used it move to the default profile so they never run with a missing profile.
 */
export async function deleteProfile(app, id) {
  if (norm(id) === DEFAULT_PROFILE_ID) throw new Error('The default profile cannot be deleted.');
  for (const c of app.sync.list('campaigns')) {
    if (c.profileId === id) await app.put('campaigns', c.id, { ...c, profileId: DEFAULT_PROFILE_ID, updatedAt: new Date().toISOString() });
  }
  await app.remove('profiles', id);
}

/** Moves a resume to a profile (`profileId` null = shared with every profile). */
export async function setResumeProfile(app, resume, profileId) {
  const cur = app.sync.get('resumes', resume.id) || resume;
  await app.put('resumes', resume.id, { ...cur, profileId: profileId || null });
}
