// Campaigns on the phone (parity with electron/campaigns.js). A campaign is an encrypted record in the
// `campaigns` collection (shape in docs/MOBILE.md "Data shapes"); the desktop app reads the same records.
//
// While the app is open (or comes back to the foreground) every running, due campaign is run once:
//   server search per role x location  ->  on-device scoring + eligibility (web/shared/match.js)
//   -> duplicate & per-company guard + include/exclude keywords (web/shared/campaignRules.js)
//   -> best matches queued as `applications` with status 'queued' (Review queue)
// Applying is always started by you from the Review queue (in-app auto-fill in the phone apps, quick-fill
// in the browser, or "Send to laptop"); campaign mode review/auto decides how the in-app filler submits.
import { useSyncExternalStore } from 'react';
import { newId } from '@shared/vaultCrypto.js';
import { campaignQueries, selectMatches } from '@shared/campaignRules.js';
import { api } from './api.js';
import { newApplication } from './apply.js';
import { rememberJobs } from './insights.js';
import { nat, notify } from './bridge.js';

export const COLORS = ['#6366f1', '#22d3ee', '#f472b6', '#f59e0b', '#10b981', '#a78bfa', '#fb7185'];
export const MODES = [
  { value: 'queue', label: 'Review queue', help: 'Finds & ranks matches; you approve each one. Safest.' },
  { value: 'review', label: 'Fill, I submit', help: 'Approved jobs open pre-filled; you press submit.' },
  { value: 'auto', label: 'Autopilot', help: 'Approved jobs on Greenhouse, Lever, Ashby, Workable, SmartRecruiters and Recruitee are submitted after a cancel window when every answer is known. Others are pre-filled for you.' },
];
export const INTERVALS = [30, 60, 120, 240, 480, 1440];
export const intervalLabel = (m) => (m < 60 ? `${m} minutes` : m === 1440 ? 'day' : `${m / 60} hour${m > 60 ? 's' : ''}`);

export function blankCampaign(app) {
  const p = app.profile || {};
  return {
    name: '', roles: [], locations: (p.preferredLocations || []).slice(0, 3), remote: 'any', resumeId: 'auto', mode: 'queue',
    minScore: Number(app.settings.minMatchScore) || 55, dailyLimit: 25, intervalMinutes: 60, coverLetter: 'ai', tailorResume: false,
    includeKeywords: [], excludeKeywords: [], excludeCompanies: [], sources: [], runOn: 'both',
  };
}

// ---------------------------------------------------------------- runtime state (memory only)
const runtime = new Map(); // campaignId -> { phase, progress, error, at }
const listeners = new Set();
let snapshot = new Map();
const emit = () => { snapshot = new Map(runtime); listeners.forEach((fn) => fn()); };
const setRt = (id, v) => { if (v) runtime.set(id, { ...runtime.get(id), ...v, at: Date.now() }); else runtime.delete(id); emit(); };
export function useCampaignRuntime() {
  return useSyncExternalStore((fn) => { listeners.add(fn); return () => listeners.delete(fn); }, () => snapshot, () => snapshot);
}
export const isBusy = (id) => !!(runtime.get(id) && ['searching', 'scoring', 'queueing'].includes(runtime.get(id).phase));
export const PHASE = { searching: 'Searching job sources', scoring: 'Scoring on this phone', queueing: 'Adding matches to your queue', idle: 'Idle' };

const sessionSeen = new Map(); // campaignId -> Set(jobId): "found" counts each job once per campaign per session

// ---------------------------------------------------------------- CRUD
export async function saveCampaign(app, c) {
  const roles = (c.roles || []).map((r) => r.trim()).filter(Boolean);
  if (!roles.length) throw new Error('Add at least one job title');
  const now = new Date().toISOString();
  const id = c.id || newId();
  const cur = c.id ? app.sync.get('campaigns', c.id) : null;
  const rec = {
    status: 'paused', stats: { found: 0, queued: 0, applied: 0, skipped: 0, failed: 0 }, createdAt: now, from: 'web',
    color: COLORS[app.campaigns.length % COLORS.length],
    ...(cur || {}),
    ...c,
    id, roles, name: (c.name || '').trim() || roles[0],
    minScore: Math.max(0, Math.min(100, Number(c.minScore) || 55)),
    dailyLimit: Math.max(1, Math.min(200, Number(c.dailyLimit) || 25)),
    intervalMinutes: Math.max(15, Number(c.intervalMinutes) || 60),
    locations: (c.locations || []).slice(0, 3),
    updatedAt: now,
  };
  await app.put('campaigns', id, rec);
  return rec;
}

export async function patchCampaign(app, id, patch) {
  const cur = app.sync && app.sync.get('campaigns', id);
  if (!cur) return null;
  const next = { ...cur, ...(typeof patch === 'function' ? patch(cur) : patch), updatedAt: new Date().toISOString() };
  await app.put('campaigns', id, next);
  return next;
}

export async function deleteCampaign(app, id) {
  setRt(id, null);
  await app.remove('campaigns', id);
}

export async function setRunning(app, c, running) {
  const next = await patchCampaign(app, c.id, running ? { status: 'running', nextRunAt: null, lastError: null } : { status: 'paused', nextRunAt: null });
  if (running) registerBackground(app).catch(() => {});
  return next;
}

/** Searches a background job may run to decide whether to notify (public queries, no personal data). */
export function campaignWatchlist(campaigns) {
  return campaigns.filter((c) => c.status === 'running' && c.runOn !== 'desktop').flatMap((c) => campaignQueries(c).map((q) => ({ ...q, campaignId: c.id, minScore: c.minScore })));
}

async function registerBackground(app) {
  const list = campaignWatchlist(app.sync ? app.sync.list('campaigns') : app.campaigns);
  if (list.length) await nat().background.register(list);
}

// ---------------------------------------------------------------- one run
/**
 * Runs one campaign pass now. Resolves to { queued, searched, errors }.
 * Safe to call concurrently: a campaign that is already running is skipped.
 */
export async function runCampaign(app, c, { signal } = {}) {
  if (isBusy(c.id)) return { queued: 0, skipped: true };
  const sync = app.sync;
  const queries = campaignQueries(c);
  if (!queries.length) throw new Error('Add at least one job title to this campaign.');
  setRt(c.id, { phase: 'searching', progress: { done: 0, total: queries.length, found: 0 }, error: null });
  const merged = new Map();
  const errors = [];
  try {
    for (let i = 0; i < queries.length; i++) {
      if (signal && signal.aborted) break;
      const q = queries[i];
      try {
        const qs = new URLSearchParams({ q: q.q, location: q.location, remote: q.remote });
        if ((c.sources || []).length) qs.set('sources', c.sources.join(','));
        const r = await api(`/jobs/search?${qs}`, { signal });
        for (const j of r.jobs || []) merged.set(j.id, j);
      } catch (e) {
        if (e.name === 'AbortError') break;
        errors.push(e.message);
        if (e.status === 429 || e.status === 0) break; // rate-limited / offline: try again next time
      }
      setRt(c.id, { progress: { done: i + 1, total: queries.length, found: merged.size } });
    }
    const jobs = [...merged.values()];
    rememberJobs(jobs);
    if (!jobs.length && errors.length) throw new Error(errors[0]);

    setRt(c.id, { phase: 'scoring' });
    const latest = sync.get('campaigns', c.id) || c;
    const applications = sync.list('applications');
    const settings = sync.get('settings', 'main') || {};
    const { fresh, toQueue, stats } = selectMatches(latest, jobs, {
      profile: (sync.get('profile', 'main') || {}).values || {},
      resumes: sync.list('resumes'),
      applications,
      minMatchScore: Number(settings.minMatchScore) || 55,
    });
    const seen = sessionSeen.get(c.id) || new Set();
    const brandNew = fresh.filter((x) => !seen.has(x.job.id));
    brandNew.forEach((x) => seen.add(x.job.id));
    sessionSeen.set(c.id, seen);

    setRt(c.id, { phase: 'queueing' });
    let queued = 0;
    for (const { job, match, resume } of toQueue) {
      if (signal && signal.aborted) break;
      const rec = newApplication(job, { status: 'queued', resume, match, campaign: latest, message: `Matched by "${latest.name}" (${match.score}%)` });
      await app.put('applications', rec.id, rec);
      queued++;
    }
    const mins = Math.max(15, Number(latest.intervalMinutes) || 60);
    await patchCampaign(app, c.id, (cur) => ({
      lastRunAt: new Date().toISOString(),
      nextRunAt: cur.status === 'running' ? new Date(Date.now() + mins * 60000).toISOString() : null,
      lastError: errors.length ? `${errors.length} search(es) failed: ${errors[0]}` : null,
      lastRun: { searched: jobs.length, queued, belowMin: stats.belowMin, duplicates: stats.duplicates, excluded: stats.excluded, device: 'phone' },
      stats: { ...(cur.stats || {}), found: ((cur.stats || {}).found || 0) + brandNew.length, queued: ((cur.stats || {}).queued || 0) + queued },
    }));
    if (queued && settings.notifyMatches !== false) {
      notify('Jobs ready for review', `${queued} new match${queued > 1 ? 'es' : ''} for ${latest.name}`, { route: 'queue', campaignId: c.id });
    }
    setRt(c.id, { phase: 'idle', lastQueued: queued, error: null });
    return { queued, searched: jobs.length, errors };
  } catch (e) {
    await patchCampaign(app, c.id, (cur) => ({
      lastRunAt: new Date().toISOString(), lastError: e.message,
      nextRunAt: cur.status === 'running' ? new Date(Date.now() + 15 * 60000).toISOString() : null,
    })).catch(() => {});
    setRt(c.id, { phase: 'idle', error: e.message });
    throw e;
  }
}

/** Due = running, allowed on this device, and never run or past nextRunAt. */
export function dueCampaigns(campaigns, now = Date.now()) {
  return campaigns.filter((c) => c.status === 'running' && c.runOn !== 'desktop' && !isBusy(c.id) && (!c.nextRunAt || new Date(c.nextRunAt).getTime() <= now));
}

let schedulerBusy = false;
/** Runs every due campaign one after another (called on open, every minute while visible, on resume). */
export async function tick(app) {
  if (schedulerBusy || !app || !app.sync || document.hidden) return;
  const settings = app.sync.get('settings', 'main') || {};
  if (settings.campaignsOnPhone === false) return;
  const due = dueCampaigns(app.sync.list('campaigns'));
  if (!due.length) return;
  schedulerBusy = true;
  try {
    for (const c of due) { try { await runCampaign(app, c); } catch { /* recorded on the campaign */ } }
  } finally { schedulerBusy = false; }
}
export function resetRuntime() { runtime.clear(); sessionSeen.clear(); emit(); }
