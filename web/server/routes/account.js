// Account export (ciphertext only) and hard delete.
import { Router } from 'express';
import { HttpError, isPlainObject } from '../util.js';
import { requireAuth, clearSessionCookies } from '../security.js';

export function accountRoutes(ctx) {
  const { repo, limiters } = ctx;
  const r = Router();
  const session = requireAuth(ctx, 'session');

  r.get('/account/export', session, (req, res) => {
    const uid = req.auth.user.id;
    const v = repo.q.vault.get(uid);
    const items = repo.q.allItems.all(uid).map((row) => ({
      collection: row.collection,
      id: row.id,
      ciphertext: row.deleted ? null : row.ciphertext,
      version: row.version,
      updatedAt: row.updated_at,
      deleted: !!row.deleted,
    }));
    const blobs = repo.q.blobIds.all(uid).map((b) => b.id);
    // The plaintext data we hold: watchlist queries and push registrations (not their endpoint/token secrets).
    const watchlist = repo.q.watchList.all(uid).map((w) => ({ id: w.id, q: w.q, location: w.location, remote: w.remote, createdAt: w.created_at }));
    const push = repo.q.pushListUser.all(uid).map((p) => ({ id: p.id, type: p.type, createdAt: p.created_at, lastOkAt: p.last_ok_at ?? null }));
    res.json({ vault: v ? JSON.parse(v.doc) : null, items, blobs, watchlist, push });
  });

  r.delete('/account', session, limiters.writes, (req, res) => {
    if (!isPlainObject(req.body) || req.body.confirm !== 'DELETE') throw new HttpError(400, 'Send { "confirm": "DELETE" } to delete your account');
    repo.deleteUserEverything(req.auth.user.id);
    if (req.auth.transport === 'cookie') clearSessionCookies(res);
    res.json({ ok: true });
  });

  return r;
}
