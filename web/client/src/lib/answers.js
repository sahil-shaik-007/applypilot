// Answer bank scoping by profile.
//   qa record: { id, question, answer, options, source: 'user'|'ai'|'pending', profileId?, uses, updatedAt }
//   - `profileId` (string) = the answer belongs to that profile only ('main' = the default profile).
//   - `profileId` null / absent = shared with every profile (every answer saved before profiles existed).
// Answering for profile P uses P's own answers first, then the shared ones, and never another profile's.
import { newId } from '@shared/vaultCrypto.js';
import { bestAnswer, worthAsking, similarity } from '@shared/campaignRules.js';
import { DEFAULT_PROFILE_ID, allProfiles } from './profiles.js';

const pidOf = (id) => id || DEFAULT_PROFILE_ID;

/** Scope of an answer: a profile id, or null when it is shared with every profile. */
export const qaScope = (rec) => (rec && rec.profileId) || null;

/** The answers profile `profileId` may use: its own and the shared ones. */
export const qaVisibleTo = (qa = [], profileId) => {
  const pid = pidOf(profileId);
  return qa.filter((q) => q && (!q.profileId || q.profileId === pid));
};

/** Best saved answer for a question: the profile's own answers first, then shared ones. */
export function bestAnswerFor(qa = [], question, profileId) {
  const pid = pidOf(profileId);
  return bestAnswer(qa.filter((q) => q && q.profileId === pid), question) || bestAnswer(qa.filter((q) => q && !q.profileId), question);
}

/**
 * Answers handed to the in-app form filler for one profile: its own first, then shared ones that no own answer
 * already covers (so the filler's best-match pick can never prefer a shared answer over the profile's own).
 */
export function answersForFiller(qa = [], profileId) {
  const pid = pidOf(profileId);
  const own = qa.filter((q) => q && q.answer && q.profileId === pid);
  const shared = qa.filter((q) => q && q.answer && !q.profileId && !own.some((o) => similarity(o.question, q.question) >= 0.72));
  return [...own, ...shared].map((q) => ({ id: q.id, question: q.question, answer: q.answer }));
}

/** Display name of an answer's scope: "Shared", a profile label, or "Removed profile". */
export function qaScopeLabel(app, rec) {
  const id = qaScope(rec);
  if (!id) return 'Shared';
  const p = allProfiles(app).find((x) => x.id === id);
  return p ? p.label : 'Removed profile';
}

/** Remembers unanswered form questions in the Answer bank (once each per profile), tagged with the profile that asked. */
export async function rememberQuestionsFor(app, unanswered = [], profileId) {
  const pid = pidOf(profileId);
  let added = 0;
  const known = app.sync.list('qa');
  for (const u of unanswered) {
    const q = typeof u === 'string' ? { question: u } : u;
    if (!worthAsking(qaVisibleTo(known, pid), q.question, q.required)) continue;
    const rec = { id: newId(), question: String(q.question).trim().slice(0, 500), answer: '', options: (q.options || []).slice(0, 30), source: 'pending', profileId: pid, uses: 0, updatedAt: new Date().toISOString() };
    await app.put('qa', rec.id, rec);
    known.push(rec);
    added++;
  }
  return added;
}

/**
 * Saves an answer for a question. `profileId` is the profile it was asked for; `shared` saves it for every profile.
 * A shared answer is edited in place only when it stays shared: saving it "for this profile" leaves the shared
 * one untouched and gives this profile its own copy (which then wins for this profile).
 */
export async function saveAnswerFor(app, item, answer, { profileId, shared = false } = {}) {
  const text = String(answer || '').trim();
  if (!text) throw new Error('Type an answer first.');
  const pid = pidOf(profileId);
  const target = shared ? null : pid;
  const all = app.sync.list('qa');
  let match = item.answerRec ? (all.find((q) => q.id === item.answerRec.id) || null) : null;
  if (match && !match.profileId && target) match = null;
  if (!match) match = qaVisibleTo(all, pid).find((q) => !q.answer && similarity(q.question, item.question) >= 0.85) || null;
  const id = match ? match.id : newId();
  const rec = {
    ...(match || {}),
    id,
    question: match ? match.question : item.question,
    answer: text,
    options: match ? (match.options || []) : (item.options || []).slice(0, 30),
    source: 'user',
    profileId: target,
    uses: (match && match.uses) || 0,
    updatedAt: new Date().toISOString(),
  };
  await app.put('qa', id, rec);
  return rec;
}

/** Remembers an answer the AI wrote, tagged with the profile that asked so it is reused only for that profile. */
export async function saveAiAnswer(app, question, answer, profileId) {
  const text = String(Array.isArray(answer) ? answer.join(', ') : answer || '').trim();
  const q = String(question || '').trim();
  if (!text || !q) return null;
  const pid = pidOf(profileId);
  if (bestAnswerFor(app.sync.list('qa'), q, pid)) return null;
  const rec = { id: newId(), question: q.slice(0, 500), answer: text, options: [], source: 'ai', profileId: pid, uses: 1, updatedAt: new Date().toISOString() };
  await app.put('qa', rec.id, rec);
  return rec;
}
