// Encrypted sync storage: the vault document, records (items) with optimistic versions and tombstones,
// and encrypted blobs. The server treats ciphertext as opaque strings/bytes and never parses it.
import express, { Router } from 'express';
import { HttpError, assertName, isPlainObject } from '../util.js';
import { requireAuth } from '../security.js';

const itemView = (row) => ({
  collection: row.collection,
  id: row.id,
  ciphertext: row.deleted ? null : row.ciphertext,
  version: row.version,
  updatedAt: row.updated_at,
  deleted: !!row.deleted,
});

/** baseVersion: null/undefined (create) or a positive integer. */
function parseBaseVersion(v) {
  if (v === null || v === undefined) return null;
  if (Number.isSafeInteger(v) && v >= 1) return v;
  throw new HttpError(400, 'baseVersion must be null or a positive integer');
}

export function syncRoutes(ctx) {
  const { repo, config, limiters, clock } = ctx;
  const { limits } = config;
  const r = Router();
  const any = requireAuth(ctx, 'any');
  const session = requireAuth(ctx, 'session');

  const assertQuota = (userId, delta) => {
    if (delta > 0 && repo.usage(userId) + delta > limits.quota) throw new HttpError(413, 'Storage quota exceeded');
  };

  // ------------------------------------------------------------------ vault (wrapped keys only)
  r.get('/vault', any, (req, res) => {
    const row = repo.q.vault.get(req.auth.user.id);
    if (!row) throw new HttpError(404, 'No vault yet');
    res.json({ vault: JSON.parse(row.doc), version: row.version });
  });

  r.put('/vault', session, limiters.writes, (req, res) => {
    if (!isPlainObject(req.body) || !isPlainObject(req.body.vault)) throw new HttpError(400, 'Body must be { vault, baseVersion }');
    const baseVersion = parseBaseVersion(req.body.baseVersion);
    const doc = JSON.stringify(req.body.vault);
    const size = Buffer.byteLength(doc);
    if (size > limits.vaultDoc) throw new HttpError(413, 'Vault document too large');
    const uid = req.auth.user.id;
    const version = repo.tx(() => {
      const cur = repo.q.vault.get(uid);
      if (baseVersion === null ? !!cur : (!cur || cur.version !== baseVersion)) {
        throw new HttpError(409, 'Version conflict', { version: cur ? cur.version : null });
      }
      assertQuota(uid, size - (cur ? Buffer.byteLength(cur.doc) : 0));
      if (!cur) { repo.q.insertVault.run(uid, doc, clock.tick()); return 1; }
      repo.q.updateVault.run(doc, clock.tick(), uid, cur.version);
      return cur.version + 1;
    });
    res.json({ version });
  });

  // ------------------------------------------------------------------ items
  r.get('/items', any, (req, res) => {
    let since = 0;
    if (req.query.since !== undefined && req.query.since !== '') {
      if (typeof req.query.since !== 'string' || !/^\d{1,16}$/.test(req.query.since)) throw new HttpError(400, 'since must be a millisecond timestamp');
      since = Number(req.query.since);
    }
    const uid = req.auth.user.id;
    const now = clock.peek();
    const rows = req.query.collection !== undefined
      ? repo.q.itemsSinceIn.all(uid, since, assertName(req.query.collection, 'collection'))
      : repo.q.itemsSince.all(uid, since);
    res.json({ items: rows.map(itemView), now });
  });

  r.put('/items/:collection/:id', any, limiters.writes, (req, res) => {
    const collection = assertName(req.params.collection, 'collection');
    const id = assertName(req.params.id, 'id');
    if (!isPlainObject(req.body)) throw new HttpError(400, 'Body must be { ciphertext, baseVersion }');
    const { ciphertext } = req.body;
    if (typeof ciphertext !== 'string' || !ciphertext.length) throw new HttpError(400, 'ciphertext must be a non-empty string');
    const size = Buffer.byteLength(ciphertext);
    if (size > limits.record) throw new HttpError(413, 'Record too large');
    const baseVersion = parseBaseVersion(req.body.baseVersion);
    const uid = req.auth.user.id;
    const out = repo.tx(() => {
      const cur = repo.q.item.get(uid, collection, id);
      const conflict = baseVersion === null ? (cur && !cur.deleted) : (!cur || cur.version !== baseVersion);
      if (conflict) throw new HttpError(409, 'Version conflict', { current: cur ? itemView(cur) : null });
      assertQuota(uid, size - (cur ? cur.size : 0));
      const version = (cur ? cur.version : 0) + 1;
      const updatedAt = clock.tick();
      repo.q.upsertItem.run(uid, collection, id, ciphertext, version, updatedAt, size);
      return { version, updatedAt };
    });
    res.json(out);
  });

  r.delete('/items/:collection/:id', any, limiters.writes, (req, res) => {
    const collection = assertName(req.params.collection, 'collection');
    const id = assertName(req.params.id, 'id');
    let baseVersion = null;
    if (req.query.baseVersion !== undefined) {
      if (typeof req.query.baseVersion !== 'string' || !/^[1-9]\d{0,15}$/.test(req.query.baseVersion)) throw new HttpError(400, 'Invalid baseVersion');
      baseVersion = Number(req.query.baseVersion);
    }
    const uid = req.auth.user.id;
    const version = repo.tx(() => {
      const cur = repo.q.item.get(uid, collection, id);
      if (!cur) throw new HttpError(404, 'Not found');
      if (cur.deleted) return cur.version; // idempotent
      if (baseVersion !== null && cur.version !== baseVersion) throw new HttpError(409, 'Version conflict', { current: itemView(cur) });
      repo.q.tombstoneItem.run(clock.tick(), uid, collection, id);
      return cur.version + 1;
    });
    res.json({ version });
  });

  // ------------------------------------------------------------------ blobs (raw encrypted bytes)
  const raw = express.raw({ type: () => true, limit: limits.blob });
  r.put('/blobs/:id', any, limiters.writes, (req, res, next) => {
    assertName(req.params.id, 'blob id');
    if (!req.is('application/octet-stream')) throw new HttpError(415, 'Blobs must be sent as application/octet-stream');
    const declared = Number(req.headers['content-length']);
    if (Number.isFinite(declared)) {
      if (declared > limits.blob) throw new HttpError(413, 'Blob too large');
      const existing = repo.q.blobSize.get(req.auth.user.id, req.params.id);
      assertQuota(req.auth.user.id, declared - (existing ? existing.size : 0));
    }
    next();
  }, raw, (req, res) => {
    const id = req.params.id;
    const body = req.body;
    if (!Buffer.isBuffer(body) || body.length === 0) throw new HttpError(400, 'Empty blob');
    if (body.length > limits.blob) throw new HttpError(413, 'Blob too large');
    const uid = req.auth.user.id;
    repo.tx(() => {
      const existing = repo.q.blobSize.get(uid, id);
      assertQuota(uid, body.length - (existing ? existing.size : 0));
      repo.q.upsertBlob.run(uid, id, body, body.length, clock.tick());
    });
    res.json({ size: body.length });
  });

  r.get('/blobs/:id', any, (req, res) => {
    const id = assertName(req.params.id, 'blob id');
    const row = repo.q.blob.get(req.auth.user.id, id);
    if (!row) throw new HttpError(404, 'Not found');
    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('Content-Disposition', 'attachment');
    res.send(Buffer.from(row.data));
  });

  r.delete('/blobs/:id', any, limiters.writes, (req, res) => {
    const id = assertName(req.params.id, 'blob id');
    const { changes } = repo.q.deleteBlob.run(req.auth.user.id, id);
    if (!changes) throw new HttpError(404, 'Not found');
    res.json({ ok: true });
  });

  return r;
}
