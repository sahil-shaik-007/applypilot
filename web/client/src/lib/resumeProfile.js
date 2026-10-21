// Fills the EMPTY fields of a profile from what a resume states (same reader as the desktop app: web/shared/resume.js).
// Existing values are never overwritten, so a profile you edited by hand is safe.
import { guessProfile } from '@shared/resume.js';
import { displaySkill } from '@shared/match.js';
import { filled } from './profile.js';
import { getProfile } from './profiles.js';

const LABELS = {
  firstName: 'first name', lastName: 'last name', email: 'email', phone: 'phone', phoneCountryCode: 'phone code', dateOfBirth: 'date of birth',
  nationality: 'nationality', languages: 'languages', state: 'state', country: 'country', education: 'education', linkedin: 'LinkedIn',
  github: 'GitHub', totalYearsExperience: 'years of experience', skills: 'skills', middleName: 'middle name',
};

/** What the resume would add to `values`: { patch, labels }. */
export function resumeFill(values = {}, text = '') {
  const guess = guessProfile(String(text || ''));
  const patch = {};
  for (const [k, v] of Object.entries(guess)) {
    if (k === 'skills') {
      const have = new Set((values.skills || []).map((s) => String(s).toLowerCase()));
      const add = (v || []).filter((s) => !have.has(String(s).toLowerCase()));
      if (add.length) patch.skills = [...(values.skills || []), ...add];
    } else if (k === 'education') { if (!(values.education || []).length && v.length) patch.education = v; }
    else if (!filled(values[k])) patch[k] = v;
  }
  return { patch, labels: Object.keys(patch).map((k) => LABELS[k] || k) };
}

/** Writes the resume's details into the profile's empty fields. Returns the labels of what was added. */
export async function fillProfileFromResume(app, profileId, resume) {
  const who = getProfile(app, profileId);
  const { patch, labels } = resumeFill(who.values || {}, resume && resume.text);
  if (!labels.length) return [];
  await app.saveProfileTo(who.id, { ...(who.values || {}), ...patch });
  return labels;
}
