// SQLite storage via the built-in node:sqlite (no native modules). Every query is parameterized.
//
// The server stores only opaque ciphertext (items, blobs) and the wrapped-key vault document.
// Tokens (sessions, devices, link codes) are stored as SHA-256 hashes, never in plaintext.
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id          TEXT PRIMARY KEY,
  google_sub  TEXT NOT NULL UNIQUE,
  email       TEXT NOT NULL,
  name        TEXT,
  picture     TEXT,
  created_at  INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS sessions (
  token_hash   TEXT PRIMARY KEY,
  user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at   INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL,
  expires_at   INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS devices (
  id           TEXT PRIMARY KEY,
  user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name         TEXT NOT NULL,
  token_hash   TEXT NOT NULL UNIQUE,
  created_at   INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS devices_user ON devices(user_id);
CREATE TABLE IF NOT EXISTS link_codes (
  code_hash  TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS link_codes_user ON link_codes(user_id);
CREATE TABLE IF NOT EXISTS vaults (
  user_id    TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  doc        TEXT NOT NULL,
  version    INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS items (
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  collection TEXT NOT NULL,
  id         TEXT NOT NULL,
  ciphertext TEXT,
  version    INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted    INTEGER NOT NULL DEFAULT 0,
  size       INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, collection, id)
);
CREATE INDEX IF NOT EXISTS items_user_updated ON items(user_id, updated_at);
CREATE TABLE IF NOT EXISTS blobs (
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  id         TEXT NOT NULL,
  data       BLOB NOT NULL,
  size       INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, id)
);

-- Cloud watchlist: the ONLY plaintext user data (opt-in). One row per distinct normalized query,
-- shared by every subscriber, plus one row per user entry.
CREATE TABLE IF NOT EXISTS watch_queries (
  key          TEXT PRIMARY KEY,           -- sha256 of the normalized query
  q            TEXT NOT NULL,
  location     TEXT NOT NULL,
  remote       TEXT NOT NULL,
  created_at   INTEGER NOT NULL,
  next_run_at  INTEGER NOT NULL,
  last_run_at  INTEGER,
  last_ok_at   INTEGER,
  last_count   INTEGER,
  failures     INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS watch_queries_due ON watch_queries(next_run_at);
CREATE TABLE IF NOT EXISTS watchlist (
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  id         TEXT NOT NULL,
  query_key  TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, id),
  UNIQUE (user_id, query_key)
);
CREATE INDEX IF NOT EXISTS watchlist_query ON watchlist(query_key);
-- Public job ids a query has already produced (so later runs can tell what is new). No user data.
CREATE TABLE IF NOT EXISTS watch_seen (
  query_key  TEXT NOT NULL,
  job_id     TEXT NOT NULL,
  seen_at    INTEGER NOT NULL,
  PRIMARY KEY (query_key, job_id)
);
CREATE INDEX IF NOT EXISTS watch_seen_age ON watch_seen(seen_at);
-- Per-user "new since last check" queue. seq is the client's cursor.
CREATE TABLE IF NOT EXISTS watch_new (
  seq        INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  watch_id   TEXT NOT NULL,
  job_id     TEXT NOT NULL,
  found_at   INTEGER NOT NULL,
  UNIQUE (user_id, job_id)
);
CREATE INDEX IF NOT EXISTS watch_new_user ON watch_new(user_id, seq);
CREATE TABLE IF NOT EXISTS watch_state (
  user_id      TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  ack_seq      INTEGER NOT NULL DEFAULT 0,
  last_push_at INTEGER NOT NULL DEFAULT 0
);
-- Public job snapshots for watch results (what /api/watchlist/new returns). No user data.
CREATE TABLE IF NOT EXISTS watch_jobs (
  job_id     TEXT PRIMARY KEY,
  data       TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);

-- Ghost-job / repost signal: when each public job id (and each company+title+location fingerprint)
-- was first and last seen by any search. Never linked to a user or a query.
CREATE TABLE IF NOT EXISTS job_history (
  job_id      TEXT PRIMARY KEY,
  fp          TEXT,
  first_seen  INTEGER NOT NULL,
  last_seen   INTEGER NOT NULL,
  times_seen  INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX IF NOT EXISTS job_history_last ON job_history(last_seen);
CREATE TABLE IF NOT EXISTS job_fingerprints (
  fp          TEXT PRIMARY KEY,
  first_seen  INTEGER NOT NULL,
  last_seen   INTEGER NOT NULL,
  ids         INTEGER NOT NULL DEFAULT 1   -- distinct job ids seen with this fingerprint (reposts)
);
CREATE INDEX IF NOT EXISTS job_fingerprints_last ON job_fingerprints(last_seen);

-- Push targets. owner_id = the session or device that registered it (revoked together).
CREATE TABLE IF NOT EXISTS push_targets (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  owner_id    TEXT NOT NULL,
  type        TEXT NOT NULL,              -- webpush | fcm | apns
  target_hash TEXT NOT NULL,              -- sha256(endpoint or device token), for de-dup / lookup
  target      TEXT NOT NULL,              -- endpoint URL or device token
  keys        TEXT,                       -- webpush { p256dh, auth }
  created_at  INTEGER NOT NULL,
  last_ok_at  INTEGER,
  UNIQUE (type, target_hash)
);
CREATE INDEX IF NOT EXISTS push_targets_user ON push_targets(user_id);
CREATE INDEX IF NOT EXISTS push_targets_owner ON push_targets(owner_id);
`;

/** Additive migrations for databases created by older versions. */
function migrate(db) {
  const cols = new Set(db.prepare('PRAGMA table_info(sessions)').all().map((c) => c.name));
  if (!cols.has('id')) db.exec('ALTER TABLE sessions ADD COLUMN id TEXT');
  if (!cols.has('kind')) db.exec("ALTER TABLE sessions ADD COLUMN kind TEXT NOT NULL DEFAULT 'web'");
  if (!cols.has('name')) db.exec('ALTER TABLE sessions ADD COLUMN name TEXT');
  if (!cols.has('platform')) db.exec('ALTER TABLE sessions ADD COLUMN platform TEXT');
  db.exec('UPDATE sessions SET id = lower(hex(randomblob(16))) WHERE id IS NULL');
  db.exec('CREATE UNIQUE INDEX IF NOT EXISTS sessions_id ON sessions(id)');
  db.exec('CREATE INDEX IF NOT EXISTS sessions_user ON sessions(user_id)');
}

export function openDb(file) {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA foreign_keys = ON');
  db.exec('PRAGMA secure_delete = ON'); // overwrite deleted content (account deletion really erases)
  db.exec('PRAGMA busy_timeout = 5000');
  db.exec(SCHEMA);
  migrate(db);
  return createRepo(db);
}

function createRepo(db) {
  const s = (sql) => db.prepare(sql);
  const q = {
    userBySub: s('SELECT * FROM users WHERE google_sub = ?'),
    userById: s('SELECT * FROM users WHERE id = ?'),
    insertUser: s('INSERT INTO users (id, google_sub, email, name, picture, created_at) VALUES (?, ?, ?, ?, ?, ?)'),
    updateUser: s('UPDATE users SET email = ?, name = ?, picture = ? WHERE id = ?'),

    insertSession: s("INSERT INTO sessions (token_hash, user_id, created_at, last_seen_at, expires_at, id, kind) VALUES (?, ?, ?, ?, ?, ?, 'web')"),
    insertNativeSession: s("INSERT INTO sessions (token_hash, user_id, created_at, last_seen_at, expires_at, id, kind, name, platform) VALUES (?, ?, ?, ?, ?, ?, 'native', ?, ?)"),
    listSessions: s('SELECT id, kind, name, platform, created_at, last_seen_at, expires_at FROM sessions WHERE user_id = ? AND expires_at > ? ORDER BY created_at'),
    listNativeSessions: s("SELECT id, name, platform, created_at, last_seen_at FROM sessions WHERE user_id = ? AND kind = 'native' AND expires_at > ? ORDER BY created_at"),
    deleteSessionById: s('DELETE FROM sessions WHERE id = ? AND user_id = ?'),
    deleteNativeSessionById: s("DELETE FROM sessions WHERE id = ? AND user_id = ? AND kind = 'native'"),
    sessionByHash: s('SELECT * FROM sessions WHERE token_hash = ?'),
    touchSession: s('UPDATE sessions SET last_seen_at = ?, expires_at = ? WHERE token_hash = ?'),
    deleteSession: s('DELETE FROM sessions WHERE token_hash = ?'),
    deleteUserSessions: s('DELETE FROM sessions WHERE user_id = ?'),
    purgeSessions: s('DELETE FROM sessions WHERE expires_at <= ?'),

    insertDevice: s('INSERT INTO devices (id, user_id, name, token_hash, created_at, last_seen_at) VALUES (?, ?, ?, ?, ?, ?)'),
    deviceByHash: s('SELECT * FROM devices WHERE token_hash = ?'),
    touchDevice: s('UPDATE devices SET last_seen_at = ? WHERE id = ?'),
    listDevices: s('SELECT id, name, created_at, last_seen_at FROM devices WHERE user_id = ? ORDER BY created_at'),
    deleteDevice: s('DELETE FROM devices WHERE id = ? AND user_id = ?'),
    deleteDeviceById: s('DELETE FROM devices WHERE id = ?'),
    deleteUserDevices: s('DELETE FROM devices WHERE user_id = ?'),

    insertLinkCode: s('INSERT INTO link_codes (code_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)'),
    linkCodeByHash: s('SELECT * FROM link_codes WHERE code_hash = ?'),
    deleteLinkCode: s('DELETE FROM link_codes WHERE code_hash = ?'),
    deleteUserLinkCodes: s('DELETE FROM link_codes WHERE user_id = ?'),
    purgeLinkCodes: s('DELETE FROM link_codes WHERE expires_at <= ?'),

    vault: s('SELECT doc, version, updated_at FROM vaults WHERE user_id = ?'),
    insertVault: s('INSERT INTO vaults (user_id, doc, version, updated_at) VALUES (?, ?, 1, ?)'),
    updateVault: s('UPDATE vaults SET doc = ?, version = version + 1, updated_at = ? WHERE user_id = ? AND version = ?'),

    item: s('SELECT collection, id, ciphertext, version, updated_at, deleted, size FROM items WHERE user_id = ? AND collection = ? AND id = ?'),
    upsertItem: s(`INSERT INTO items (user_id, collection, id, ciphertext, version, updated_at, deleted, size) VALUES (?, ?, ?, ?, ?, ?, 0, ?)
      ON CONFLICT (user_id, collection, id) DO UPDATE SET ciphertext = excluded.ciphertext, version = excluded.version,
      updated_at = excluded.updated_at, deleted = 0, size = excluded.size`),
    tombstoneItem: s('UPDATE items SET ciphertext = NULL, deleted = 1, size = 0, version = version + 1, updated_at = ? WHERE user_id = ? AND collection = ? AND id = ?'),
    itemsSince: s('SELECT collection, id, ciphertext, version, updated_at, deleted FROM items WHERE user_id = ? AND updated_at > ? ORDER BY updated_at, collection, id'),
    itemsSinceIn: s('SELECT collection, id, ciphertext, version, updated_at, deleted FROM items WHERE user_id = ? AND updated_at > ? AND collection = ? ORDER BY updated_at, id'),
    allItems: s('SELECT collection, id, ciphertext, version, updated_at, deleted FROM items WHERE user_id = ? ORDER BY collection, id'),

    blob: s('SELECT data, size FROM blobs WHERE user_id = ? AND id = ?'),
    blobSize: s('SELECT size FROM blobs WHERE user_id = ? AND id = ?'),
    upsertBlob: s(`INSERT INTO blobs (user_id, id, data, size, updated_at) VALUES (?, ?, ?, ?, ?)
      ON CONFLICT (user_id, id) DO UPDATE SET data = excluded.data, size = excluded.size, updated_at = excluded.updated_at`),
    deleteBlob: s('DELETE FROM blobs WHERE user_id = ? AND id = ?'),
    blobIds: s('SELECT id FROM blobs WHERE user_id = ? ORDER BY id'),

    usageItems: s('SELECT COALESCE(SUM(size), 0) AS n FROM items WHERE user_id = ?'),
    usageBlobs: s('SELECT COALESCE(SUM(size), 0) AS n FROM blobs WHERE user_id = ?'),
    usageVault: s('SELECT COALESCE(LENGTH(CAST(doc AS BLOB)), 0) AS n FROM vaults WHERE user_id = ?'),

    delUserItems: s('DELETE FROM items WHERE user_id = ?'),
    delUserBlobs: s('DELETE FROM blobs WHERE user_id = ?'),
    delUserVault: s('DELETE FROM vaults WHERE user_id = ?'),
    delUser: s('DELETE FROM users WHERE id = ?'),

    // watchlist
    watchList: s(`SELECT w.id, w.created_at, w.query_key, q.q, q.location, q.remote, q.last_run_at, q.next_run_at, q.last_ok_at, q.last_count
      FROM watchlist w JOIN watch_queries q ON q.key = w.query_key WHERE w.user_id = ? ORDER BY w.created_at, w.id`),
    watchCount: s('SELECT COUNT(*) AS n FROM watchlist WHERE user_id = ?'),
    watchByKey: s('SELECT id FROM watchlist WHERE user_id = ? AND query_key = ?'),
    insertWatch: s('INSERT INTO watchlist (user_id, id, query_key, created_at) VALUES (?, ?, ?, ?)'),
    watchById: s('SELECT query_key FROM watchlist WHERE user_id = ? AND id = ?'),
    deleteWatch: s('DELETE FROM watchlist WHERE user_id = ? AND id = ?'),
    deleteUserWatches: s('DELETE FROM watchlist WHERE user_id = ?'),
    userWatchKeys: s('SELECT query_key FROM watchlist WHERE user_id = ?'),
    queryByKey: s('SELECT * FROM watch_queries WHERE key = ?'),
    insertQuery: s('INSERT OR IGNORE INTO watch_queries (key, q, location, remote, created_at, next_run_at) VALUES (?, ?, ?, ?, ?, ?)'),
    queryRefs: s('SELECT COUNT(*) AS n FROM watchlist WHERE query_key = ?'),
    deleteQuery: s('DELETE FROM watch_queries WHERE key = ?'),
    deleteQuerySeen: s('DELETE FROM watch_seen WHERE query_key = ?'),
    dueQueries: s('SELECT * FROM watch_queries WHERE next_run_at <= ? ORDER BY next_run_at LIMIT ?'),
    finishQuery: s('UPDATE watch_queries SET last_run_at = ?, next_run_at = ?, last_ok_at = COALESCE(?, last_ok_at), last_count = COALESCE(?, last_count), failures = ? WHERE key = ?'),
    querySubscribers: s('SELECT user_id, id, created_at FROM watchlist WHERE query_key = ?'),
    seenHas: s('SELECT 1 AS x FROM watch_seen WHERE query_key = ? AND job_id = ?'),
    seenUpsert: s('INSERT INTO watch_seen (query_key, job_id, seen_at) VALUES (?, ?, ?) ON CONFLICT (query_key, job_id) DO UPDATE SET seen_at = excluded.seen_at'),
    insertNew: s('INSERT OR IGNORE INTO watch_new (user_id, watch_id, job_id, found_at) VALUES (?, ?, ?, ?)'),
    newSince: s(`SELECT n.seq, n.watch_id, n.job_id, n.found_at, j.data, h.first_seen
      FROM watch_new n LEFT JOIN watch_jobs j ON j.job_id = n.job_id LEFT JOIN job_history h ON h.job_id = n.job_id
      WHERE n.user_id = ? AND n.seq > ? ORDER BY n.seq LIMIT ?`),
    newMaxSeq: s('SELECT COALESCE(MAX(seq), 0) AS n FROM watch_new WHERE user_id = ?'),
    newUnseen: s('SELECT COUNT(*) AS n FROM watch_new WHERE user_id = ? AND seq > COALESCE((SELECT ack_seq FROM watch_state WHERE user_id = ?), 0)'),
    deleteUserNew: s('DELETE FROM watch_new WHERE user_id = ?'),
    deleteWatchNew: s('DELETE FROM watch_new WHERE user_id = ? AND watch_id = ?'),
    trimUserNew: s('DELETE FROM watch_new WHERE user_id = ? AND seq <= (SELECT seq FROM watch_new WHERE user_id = ? ORDER BY seq DESC LIMIT 1 OFFSET ?)'),
    state: s('SELECT ack_seq, last_push_at FROM watch_state WHERE user_id = ?'),
    ack: s('INSERT INTO watch_state (user_id, ack_seq) VALUES (?, ?) ON CONFLICT (user_id) DO UPDATE SET ack_seq = MAX(ack_seq, excluded.ack_seq)'),
    markPushed: s('INSERT INTO watch_state (user_id, last_push_at) VALUES (?, ?) ON CONFLICT (user_id) DO UPDATE SET last_push_at = excluded.last_push_at'),
    deleteUserState: s('DELETE FROM watch_state WHERE user_id = ?'),
    upsertWatchJob: s('INSERT INTO watch_jobs (job_id, data, updated_at) VALUES (?, ?, ?) ON CONFLICT (job_id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at'),

    // job history
    history: s('SELECT job_id, fp, first_seen, last_seen, times_seen FROM job_history WHERE job_id = ?'),
    insertHistory: s('INSERT INTO job_history (job_id, fp, first_seen, last_seen, times_seen) VALUES (?, ?, ?, ?, 1)'),
    touchHistory: s('UPDATE job_history SET last_seen = ?, times_seen = times_seen + ?, fp = COALESCE(fp, ?) WHERE job_id = ?'),
    historyIn: s(`SELECT h.job_id, h.first_seen, h.last_seen, h.times_seen, f.first_seen AS fp_first_seen, f.ids AS fp_ids
      FROM job_history h LEFT JOIN job_fingerprints f ON f.fp = h.fp WHERE h.job_id IN (SELECT value FROM json_each(?))`),
    firstSeenIn: s('SELECT job_id, first_seen FROM job_history WHERE job_id IN (SELECT value FROM json_each(?))'),
    upsertFingerprint: s(`INSERT INTO job_fingerprints (fp, first_seen, last_seen, ids) VALUES (?, ?, ?, ?)
      ON CONFLICT (fp) DO UPDATE SET last_seen = MAX(last_seen, excluded.last_seen), ids = ids + excluded.ids`),

    // push
    upsertPush: s(`INSERT INTO push_targets (id, user_id, owner_id, type, target_hash, target, keys, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT (type, target_hash) DO UPDATE SET user_id = excluded.user_id, owner_id = excluded.owner_id, target = excluded.target,
      keys = excluded.keys, created_at = excluded.created_at`),
    pushByTarget: s('SELECT id, user_id FROM push_targets WHERE type = ? AND target_hash = ?'),
    pushCount: s('SELECT COUNT(*) AS n FROM push_targets WHERE user_id = ?'),
    pushForUser: s('SELECT id, type, target, keys FROM push_targets WHERE user_id = ?'),
    pushListUser: s('SELECT id, type, owner_id, created_at, last_ok_at FROM push_targets WHERE user_id = ? ORDER BY created_at'),
    deletePushTarget: s('DELETE FROM push_targets WHERE user_id = ? AND type = ? AND target_hash = ?'),
    deletePushOwner: s('DELETE FROM push_targets WHERE user_id = ? AND owner_id = ?'),
    deletePushOwnerAny: s('DELETE FROM push_targets WHERE owner_id = ?'),
    deletePushId: s('DELETE FROM push_targets WHERE id = ?'),
    pushOk: s('UPDATE push_targets SET last_ok_at = ? WHERE id = ?'),
    deleteUserPush: s('DELETE FROM push_targets WHERE user_id = ?'),
    purgeOrphanPush: s('DELETE FROM push_targets WHERE owner_id NOT IN (SELECT id FROM sessions) AND owner_id NOT IN (SELECT id FROM devices)'),
    purgeNew: s('DELETE FROM watch_new WHERE found_at < ?'),
    purgeSeen: s('DELETE FROM watch_seen WHERE seen_at < ?'),
    purgeHistory: s('DELETE FROM job_history WHERE last_seen < ?'),
    purgeFingerprints: s('DELETE FROM job_fingerprints WHERE last_seen < ?'),
    purgeWatchJobs: s('DELETE FROM watch_jobs WHERE job_id NOT IN (SELECT job_id FROM watch_new)'),
  };

  function tx(fn) {
    db.exec('BEGIN IMMEDIATE');
    try {
      const out = fn();
      db.exec('COMMIT');
      return out;
    } catch (e) {
      db.exec('ROLLBACK');
      throw e;
    }
  }

  /** Removes a watch query (its plaintext and its seen-set) once nobody subscribes to it any more. */
  function dropQueryIfOrphan(key) {
    if (q.queryRefs.get(key).n === 0) {
      q.deleteQuery.run(key);
      q.deleteQuerySeen.run(key);
    }
  }

  return {
    raw: db,
    dropQueryIfOrphan,
    /** Revokes every session, device, link code and push target of a user ("sign out everywhere"). */
    revokeAll(userId) {
      tx(() => {
        q.deleteUserSessions.run(userId);
        q.deleteUserDevices.run(userId);
        q.deleteUserLinkCodes.run(userId);
        q.deleteUserPush.run(userId);
      });
    },
    q,
    tx,
    usage(userId) {
      return Number(q.usageItems.get(userId).n) + Number(q.usageBlobs.get(userId).n) + Number(q.usageVault.get(userId)?.n || 0);
    },
    /** Hard-deletes a user and everything they own, then checkpoints the WAL so no copy lingers. */
    deleteUserEverything(userId) {
      tx(() => {
        q.delUserItems.run(userId);
        q.delUserBlobs.run(userId);
        q.delUserVault.run(userId);
        q.deleteUserSessions.run(userId);
        q.deleteUserDevices.run(userId);
        q.deleteUserLinkCodes.run(userId);
        const keys = q.userWatchKeys.all(userId).map((r) => r.query_key);
        q.deleteUserWatches.run(userId);
        for (const k of keys) dropQueryIfOrphan(k);
        q.deleteUserNew.run(userId);
        q.deleteUserState.run(userId);
        q.deleteUserPush.run(userId);
        q.delUser.run(userId);
      });
      try { db.exec('PRAGMA wal_checkpoint(TRUNCATE)'); } catch { /* best effort */ }
    },
    purgeExpired(now, limits = {}) {
      q.purgeSessions.run(now);
      q.purgeLinkCodes.run(now);
      // Push targets whose session/device is gone (expired, revoked) must not keep receiving pushes.
      q.purgeOrphanPush.run();
      if (limits.watchNewTtlMs) q.purgeNew.run(now - limits.watchNewTtlMs);
      if (limits.watchSeenTtlMs) q.purgeSeen.run(now - limits.watchSeenTtlMs);
      if (limits.historyTtlMs) {
        q.purgeHistory.run(now - limits.historyTtlMs);
        q.purgeFingerprints.run(now - limits.historyTtlMs);
      }
      q.purgeWatchJobs.run();
    },
    close() { try { db.close(); } catch { /* already closed */ } },
  };
}
