// Cloud watchlist (opt-in plaintext queries) and the public ghost-job history lookup.
import { Router } from 'express';
import { HttpError, assertName, isPlainObject } from '../util.js';
import { requireAuth } from '../security.js';

export const WATCHLIST_PRIVACY = 'Watchlist queries (role, location, remote) are stored on the server in plain text so it can '
  + 'keep searching while your devices are off. They are the only unencrypted data in your account. They are never shared, '
  + 'and they are deleted when you remove them, turn the watchlist off or delete your account.';

const intParam = (v, { min, max, dflt }, what) => {
  if (v === undefined || v === '') return dflt;
  if (typeof v !== 'string' || !/^\d{1,16}$/.test(v)) throw new HttpError(400, `Invalid ${what}`);
  const n = Number(v);
  if (n < min || n > max) throw new HttpError(400, `Invalid ${what}`);
  return n;
};

export function watchlistRoutes(ctx) {
  const { config, limiters, watch, history } = ctx;
  const r = Router();
  const any = requireAuth(ctx, 'any');

  r.get('/watchlist', any, (req, res) => {
    res.json({ items: watch.list(req.auth.user.id), max: config.limits.watchMaxPerUser, privacy: WATCHLIST_PRIVACY });
  });

  r.post('/watchlist', any, limiters.watchlist, (req, res) => {
    const body = isPlainObject(req.body) ? req.body : {};
    // Explicit opt-in: the client must show WATCHLIST_PRIVACY and send consent: true.
    if (body.consent !== true) throw new HttpError(400, 'Watchlist queries are stored unencrypted: send consent: true after showing the privacy note', { privacy: WATCHLIST_PRIVACY });
    for (const k of ['q', 'location']) if (body[k] !== undefined && typeof body[k] !== 'string') throw new HttpError(400, `${k} must be a string`);
    if ((body.q || '').length > 400 || (body.location || '').length > 400) throw new HttpError(400, 'Query too long');
    const { item, created } = watch.add(req.auth.user.id, body);
    res.status(created ? 201 : 200).json({ item, created });
  });

  r.delete('/watchlist/:id', any, limiters.watchlist, (req, res) => {
    const id = assertName(req.params.id, 'watchlist id');
    if (!watch.remove(req.auth.user.id, id)) throw new HttpError(404, 'Not found');
    res.json({ ok: true });
  });

  // Turn the watchlist off: removes every query and every queued result.
  r.delete('/watchlist', any, limiters.watchlist, (req, res) => {
    res.json({ ok: true, removed: watch.removeAll(req.auth.user.id) });
  });

  r.get('/watchlist/new', any, (req, res) => {
    const cursor = intParam(req.query.cursor, { min: 0, max: Number.MAX_SAFE_INTEGER, dflt: 0 }, 'cursor');
    const limit = intParam(req.query.limit, { min: 1, max: 200, dflt: 100 }, 'limit');
    res.json(watch.newSince(req.auth.user.id, cursor, limit));
  });

  // Ghost-job signal: public job ids only, no user data. GET ?ids=a,b or ?ids=a&ids=b; POST { ids: [...] }
  // for ids that contain commas (some sources use the posting URL as the id).
  r.get('/jobs/history', any, limiters.history, (req, res) => {
    res.json(history.lookup(history.parseIds(req.query.ids)));
  });
  r.post('/jobs/history', any, limiters.history, (req, res) => {
    const ids = isPlainObject(req.body) ? req.body.ids : undefined;
    if (!Array.isArray(ids)) throw new HttpError(400, 'Body must be { ids: [...] }');
    res.json(history.lookup(history.parseIds(ids)));
  });

  return r;
}
