// Ghost-job / repost signal. Records when each PUBLIC job id was first and last seen by any fresh search
// (user searches and watchlist runs alike), plus a company+title+location fingerprint so a job reposted
// under a new id is still recognised. Nothing here is linked to a user or to the query that found it.
import crypto from 'node:crypto';
import { HttpError } from './util.js';

const fpNorm = (s) => (typeof s === 'string' ? s : '').normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim().slice(0, 200);

/** Stable fingerprint of a posting independent of its source id, or null when there is too little to go on. */
export function fingerprint(job) {
  const company = fpNorm(job.company);
  const title = fpNorm(job.title);
  if (!company || !title) return null;
  return crypto.createHash('sha256').update(`${company}|${title}|${fpNorm(job.location)}`).digest('hex').slice(0, 32);
}

// Job ids are "<source>:<externalId>" and the external id may be a URL, so commas and slashes are allowed.
// eslint-disable-next-line no-control-regex
const JOB_ID_RE = /^[^\u0000-\u001f\u007f\s]{1,300}$/;
export const isJobId = (v) => typeof v === 'string' && JOB_ID_RE.test(v);

export function createHistory({ repo, limits }) {
  const fpGet = repo.raw.prepare('SELECT ids FROM job_fingerprints WHERE fp = ?');

  /** Records one observation of each job (deduplicated). Observations < observationGap apart don't bump timesSeen. */
  function record(jobs, now = Date.now()) {
    const seen = new Set();
    repo.tx(() => {
      for (const j of jobs || []) {
        if (!j || !isJobId(j.id) || seen.has(j.id)) continue;
        seen.add(j.id);
        const fp = fingerprint(j);
        const row = repo.q.history.get(j.id);
        if (!row) {
          repo.q.insertHistory.run(j.id, fp, now, now);
          if (fp) repo.q.upsertFingerprint.run(fp, now, now, 1); // one more distinct id with this fingerprint
        } else {
          const inc = now - row.last_seen >= limits.historyObservationGapMs ? 1 : 0;
          repo.q.touchHistory.run(Math.max(now, row.last_seen), inc, fp, j.id);
          const f = row.fp || fp;
          if (f) repo.q.upsertFingerprint.run(f, now, now, fpGet.get(f) ? 0 : 1);
        }
      }
    });
  }

  /** { id: { firstSeen, lastSeen, timesSeen, repostFirstSeen?, repostIds? } } for known ids (unknown ids omitted). */
  function lookup(ids) {
    const out = Object.create(null);
    if (!ids.length) return out;
    for (const r of repo.q.historyIn.all(JSON.stringify(ids))) {
      const v = { firstSeen: r.first_seen, lastSeen: r.last_seen, timesSeen: r.times_seen };
      // Same company + title + location seen under other ids: likely a repost; repostFirstSeen is the oldest sighting.
      if (r.fp_ids > 1) { v.repostFirstSeen = Math.min(r.fp_first_seen, r.first_seen); v.repostIds = r.fp_ids; }
      out[r.job_id] = v;
    }
    return out;
  }

  /** Adds firstSeen (ms, or null if never recorded) to each job. */
  function annotate(jobs) {
    const ids = jobs.map((j) => j.id).filter(isJobId);
    const map = new Map();
    if (ids.length) for (const r of repo.q.firstSeenIn.all(JSON.stringify(ids))) map.set(r.job_id, r.first_seen);
    return jobs.map((j) => ({ ...j, firstSeen: map.get(j.id) ?? null }));
  }

  /** Accepts ?ids=a,b (comma list), repeated ?ids=a&ids=b, or a JSON array; validates and de-duplicates. */
  function parseIds(raw) {
    let list;
    if (Array.isArray(raw)) list = raw;
    else if (typeof raw === 'string') list = raw.split(',');
    else throw new HttpError(400, 'ids is required');
    if (list.length > limits.historyMaxIds) throw new HttpError(400, `At most ${limits.historyMaxIds} ids per request`);
    const ids = [...new Set(list.map((s) => (typeof s === 'string' ? s.trim() : s)).filter((s) => s !== ''))];
    if (!ids.length) throw new HttpError(400, 'ids is required');
    if (!ids.every(isJobId)) throw new HttpError(400, 'Invalid job id');
    return ids;
  }

  return { record, lookup, annotate, parseIds };
}
