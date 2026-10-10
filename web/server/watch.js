// Cloud watchlist: opt-in, plaintext job queries (role, location, remote) that the server keeps running
// while the user's devices are off. This is the ONLY non-encrypted user data (documented in docs/CLOUD.md).
//
// Each distinct normalized query is stored once and shared by every subscriber. A single scheduler queue
// runs due queries one at a time (min gap + jitter between searches, global hourly cap) through the shared
// job-search cache, then appends job ids the query has never produced before to each subscriber's
// "new since last check" list and sends a content-free push.
import { HttpError, randomId, sha256 } from './util.js';

const sleepReal = (ms) => new Promise((r) => { const t = setTimeout(r, ms); t.unref?.(); });
const slimJob = (j) => (typeof j.description === 'string' && j.description.length > 4000 ? { ...j, description: `${j.description.slice(0, 4000)}…` } : j);

/**
 * @param {object} ctx  { config, repo, jobSearch, push }
 * @param {object} [deps]  { sleep, random, now }
 */
export function createWatch(ctx, deps = {}) {
  const { config, repo } = ctx;
  const L = config.limits;
  const sleep = deps.sleep || sleepReal;
  const random = deps.random || Math.random;
  const now = deps.now || Date.now;
  const runTimes = []; // timestamps of scheduled searches in the last hour (global politeness cap)
  let running = null;
  let timer = null;

  /** Validates and normalizes { q, location, remote } with the same rules as /api/jobs/search. */
  function normalize(body) {
    const nq = ctx.jobSearch.normalizeQuery({ q: body.q, location: body.location, remote: body.remote ?? 'any' });
    const query = { q: nq.q, location: nq.location, remote: nq.remote };
    return { ...query, key: sha256(JSON.stringify(query)) };
  }

  const view = (row) => ({
    id: row.id,
    q: row.q,
    location: row.location,
    remote: row.remote,
    createdAt: row.created_at,
    lastRunAt: row.last_ok_at ?? null,
    nextRunAt: row.next_run_at,
    lastCount: row.last_count ?? null,
  });

  function list(userId) { return repo.q.watchList.all(userId).map(view); }

  /** Adds a query for a user. Returns { item, created }. Same normalized query twice → the existing item. */
  function add(userId, body) {
    const nq = normalize(body);
    const t = now();
    const out = repo.tx(() => {
      const existing = repo.q.watchByKey.get(userId, nq.key);
      if (existing) return { id: existing.id, created: false };
      if (repo.q.watchCount.get(userId).n >= L.watchMaxPerUser) throw new HttpError(409, `Your watchlist is full (max ${L.watchMaxPerUser})`);
      // First run soon (it sets the baseline: results already out there are not "new").
      repo.q.insertQuery.run(nq.key, nq.q, nq.location, nq.remote, t, t + Math.floor(random() * 60000));
      const id = randomId();
      repo.q.insertWatch.run(userId, id, nq.key, t);
      return { id, created: true };
    });
    return { item: list(userId).find((w) => w.id === out.id), created: out.created };
  }

  function remove(userId, id) {
    return repo.tx(() => {
      const row = repo.q.watchById.get(userId, id);
      if (!row) return false;
      repo.q.deleteWatch.run(userId, id);
      repo.q.deleteWatchNew.run(userId, id);
      repo.dropQueryIfOrphan(row.query_key);
      return true;
    });
  }

  /** Opt-out: removes every query, the queued new jobs and the cursor state. */
  function removeAll(userId) {
    return repo.tx(() => {
      const keys = repo.q.userWatchKeys.all(userId).map((r) => r.query_key);
      repo.q.deleteUserWatches.run(userId);
      for (const k of keys) repo.dropQueryIfOrphan(k);
      repo.q.deleteUserNew.run(userId);
      repo.q.deleteUserState.run(userId);
      return keys.length;
    });
  }

  /** New jobs after `cursor` (exclusive). Passing a cursor also acknowledges everything up to it. */
  function newSince(userId, cursor, limit) {
    if (cursor > 0) repo.q.ack.run(userId, cursor);
    const rows = repo.q.newSince.all(userId, cursor, limit);
    const jobs = [];
    for (const r of rows) {
      let job = { id: r.job_id };
      try { if (r.data) job = JSON.parse(r.data); } catch { /* keep the id */ }
      jobs.push({ ...job, firstSeen: r.first_seen ?? null, watchId: r.watch_id, foundAt: r.found_at, seq: r.seq });
    }
    const next = rows.length ? rows[rows.length - 1].seq : Math.max(cursor, 0);
    return { jobs, cursor: next, more: rows.length === limit };
  }

  /** Runs one distinct query and fans its new job ids out to the subscribers. Returns Set<userId> touched. */
  async function runQuery(row) {
    const started = now();
    const touched = new Set();
    let result;
    let failed = false;
    try {
      result = await ctx.jobSearch.search({ q: row.q, location: row.location, remote: row.remote });
      const stats = result.stats || [];
      failed = !(result.jobs || []).length && stats.length > 0 && stats.every((s) => s.error);
    } catch {
      failed = true;
    }
    const t = now();
    if (failed) {
      const failures = (row.failures || 0) + 1;
      repo.q.finishQuery.run(t, t + L.watchFailureBackoffMs * Math.min(failures, 6), null, null, failures, row.key);
      return touched;
    }
    const jobs = (result.jobs || []).filter((j) => j && typeof j.id === 'string' && j.id.length <= 300);
    const baseline = row.last_ok_at === null || row.last_ok_at === undefined;
    repo.tx(() => {
      const fresh = [];
      for (const j of jobs) {
        if (!repo.q.seenHas.get(row.key, j.id)) fresh.push(j);
        repo.q.seenUpsert.run(row.key, j.id, t);
      }
      if (!baseline && fresh.length) {
        const subs = repo.q.querySubscribers.all(row.key);
        const batch = fresh.slice(0, L.watchNewPerRunMax);
        for (const j of batch) repo.q.upsertWatchJob.run(j.id, JSON.stringify(slimJob(j)), t);
        for (const s of subs) {
          let added = 0;
          for (const j of batch) added += Number(repo.q.insertNew.run(s.user_id, s.id, j.id, t).changes);
          if (added) {
            touched.add(s.user_id);
            repo.q.trimUserNew.run(s.user_id, s.user_id, L.watchNewPerUserMax);
          }
        }
      }
      const jitter = Math.floor(random() * L.watchIntervalJitterMs);
      repo.q.finishQuery.run(t, started + L.watchIntervalMs + jitter, t, jobs.length, 0, row.key);
    });
    return touched;
  }

  async function notify(userIds) {
    if (!ctx.push) return;
    const t = now();
    for (const uid of userIds) {
      const state = repo.q.state.get(uid);
      if (state && t - state.last_push_at < L.pushMinIntervalMs) continue;
      const unseen = repo.q.newUnseen.get(uid, uid).n;
      if (!unseen) continue;
      repo.q.markPushed.run(uid, t);
      try { await ctx.push.notifyUser(uid, unseen); } catch { /* never let a push failure stop the queue */ }
    }
  }

  /** One scheduler pass: runs every due query in the shared queue (gap + jitter, hourly cap). */
  function tick() {
    if (running) return running;
    running = (async () => {
      const touched = new Set();
      let first = true;
      for (;;) {
        const t = now();
        while (runTimes.length && runTimes[0] <= t - 3600e3) runTimes.shift();
        if (runTimes.length >= L.watchMaxRunsPerHour) break; // the rest stay due and run on a later tick
        const [row] = repo.q.dueQueries.all(t, 1);
        if (!row) break;
        if (!first) await sleep(L.watchGapMs + Math.floor(random() * L.watchGapJitterMs));
        first = false;
        runTimes.push(now());
        // The row may have been deleted (unsubscribed) while we slept.
        const fresh = repo.q.queryByKey.get(row.key);
        if (!fresh) continue;
        for (const u of await runQuery(fresh)) touched.add(u);
        if (stopped) break;
      }
      await notify(touched);
      return touched;
    })().finally(() => { running = null; });
    return running;
  }

  let stopped = false;
  function start() {
    if (timer) return;
    stopped = false;
    timer = setInterval(() => { tick().catch((e) => console.error(`[watch] scheduler error: ${e && e.message}`)); }, L.watchTickMs);
    timer.unref();
  }
  function stop() { stopped = true; if (timer) clearInterval(timer); timer = null; }

  return { normalize, list, add, remove, removeAll, newSince, runQuery, tick, start, stop };
}
