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
CREATE INDEX IF NOT EXISTS sessions_user ON sessions(user_id);
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
`;

export function openDb(file) {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA foreign_keys = ON');
  db.exec('PRAGMA secure_delete = ON'); // overwrite deleted content (account deletion really erases)
  db.exec('PRAGMA busy_timeout = 5000');
  db.exec(SCHEMA);
  return createRepo(db);
}

function createRepo(db) {
  const s = (sql) => db.prepare(sql);
  const q = {
    userBySub: s('SELECT * FROM users WHERE google_sub = ?'),
    userById: s('SELECT * FROM users WHERE id = ?'),
    insertUser: s('INSERT INTO users (id, google_sub, email, name, picture, created_at) VALUES (?, ?, ?, ?, ?, ?)'),
    updateUser: s('UPDATE users SET email = ?, name = ?, picture = ? WHERE id = ?'),

    insertSession: s('INSERT INTO sessions (token_hash, user_id, created_at, last_seen_at, expires_at) VALUES (?, ?, ?, ?, ?)'),
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

  return {
    raw: db,
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
        q.delUser.run(userId);
      });
      try { db.exec('PRAGMA wal_checkpoint(TRUNCATE)'); } catch { /* best effort */ }
    },
    purgeExpired(now) {
      q.purgeSessions.run(now);
      q.purgeLinkCodes.run(now);
    },
    close() { try { db.close(); } catch { /* already closed */ } },
  };
}
