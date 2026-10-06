// Desktop device linking (one-time 8-character codes → device bearer tokens), listing and revocation.
import { Router } from 'express';
import { HttpError, assertName, isPlainObject, cleanText, newLinkCode, normalizeLinkCode, randomId, randomToken, sha256 } from '../util.js';
import { requireAuth } from '../security.js';
import { userView } from './auth.js';

export function deviceRoutes(ctx) {
  const { repo, config, limiters, clock } = ctx;
  const r = Router();
  const session = requireAuth(ctx, 'session');

  r.post('/devices/link-code', session, limiters.linkCode, (req, res) => {
    const uid = req.auth.user.id;
    const now = clock.peek();
    const expiresAt = now + config.limits.linkCodeTtlMs;
    let code;
    repo.tx(() => {
      repo.q.purgeLinkCodes.run(now);
      repo.q.deleteUserLinkCodes.run(uid); // only one live code per user
      code = newLinkCode();
      repo.q.insertLinkCode.run(sha256(code), uid, now, expiresAt);
    });
    res.json({ code, expiresAt });
  });

  // Unauthenticated (the desktop app has no session). Rate-limited per IP and globally; codes are
  // 8 chars from a 31-symbol alphabet (~8.5e11 combinations), expire after 10 minutes and are single-use.
  r.post('/devices/redeem', limiters.redeemGlobal, limiters.redeem, (req, res) => {
    const body = isPlainObject(req.body) ? req.body : {};
    const code = normalizeLinkCode(body.code);
    if (!code) throw new HttpError(400, 'Invalid or expired code');
    const name = cleanText(body.name, 64) || 'Desktop app';
    const now = Date.now();
    const result = repo.tx(() => {
      const hash = sha256(code);
      const row = repo.q.linkCodeByHash.get(hash);
      if (!row) return null;
      repo.q.deleteLinkCode.run(hash); // single use, consumed even if expired
      if (row.expires_at <= now) return null;
      const user = repo.q.userById.get(row.user_id);
      if (!user) return null;
      const token = `apd_${randomToken()}`;
      const id = randomId();
      repo.q.insertDevice.run(id, user.id, name, sha256(token), now, now);
      return { deviceToken: token, user: userView(user), device: { id, name } };
    });
    if (!result) throw new HttpError(400, 'Invalid or expired code');
    res.json(result);
  });

  r.get('/devices', session, (req, res) => {
    const devices = repo.q.listDevices.all(req.auth.user.id).map((d) => ({ id: d.id, name: d.name, createdAt: d.created_at, lastSeenAt: d.last_seen_at }));
    res.json({ devices });
  });

  r.delete('/devices/:id', session, limiters.writes, (req, res) => {
    const id = assertName(req.params.id, 'device id');
    const { changes } = repo.q.deleteDevice.run(id, req.auth.user.id);
    if (!changes) throw new HttpError(404, 'Not found');
    res.json({ ok: true });
  });

  return r;
}
