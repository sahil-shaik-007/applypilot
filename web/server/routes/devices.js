// Desktop device linking (one-time 8-character codes → device bearer tokens), listing and revocation of
// desktop devices, native app sessions and web sessions.
import { Router } from 'express';
import { HttpError, assertName, isPlainObject, cleanText, newLinkCode, normalizeLinkCode, randomId, randomToken, sha256 } from '../util.js';
import { requireAuth, clearSessionCookies } from '../security.js';
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

  // Desktop devices, plus the signed-in phone apps (native sessions) under `apps`.
  r.get('/devices', session, (req, res) => {
    const uid = req.auth.user.id;
    const devices = repo.q.listDevices.all(uid).map((d) => ({ id: d.id, name: d.name, createdAt: d.created_at, lastSeenAt: d.last_seen_at }));
    const apps = repo.q.listNativeSessions.all(uid, Date.now()).map((s) => ({
      id: s.id, name: s.name || 'Mobile app', platform: s.platform || null, createdAt: s.created_at, lastSeenAt: s.last_seen_at,
      current: req.auth.session?.id === s.id,
    }));
    res.json({ devices, apps });
  });

  // Revokes a desktop device or a phone app (native session) by id. Push targets registered by it go too.
  r.delete('/devices/:id', session, limiters.writes, (req, res) => {
    const id = assertName(req.params.id, 'device id');
    const uid = req.auth.user.id;
    const changes = repo.tx(() => {
      const n = Number(repo.q.deleteDevice.run(id, uid).changes) + Number(repo.q.deleteNativeSessionById.run(id, uid).changes);
      if (n) repo.q.deletePushOwner.run(uid, id);
      return n;
    });
    if (!changes) throw new HttpError(404, 'Not found');
    res.json({ ok: true });
  });

  // Every live sign-in (web browsers and phone apps).
  r.get('/sessions', session, (req, res) => {
    const sessions = repo.q.listSessions.all(req.auth.user.id, Date.now()).map((s) => ({
      id: s.id,
      kind: s.kind,
      name: s.kind === 'native' ? (s.name || 'Mobile app') : 'Web browser',
      platform: s.platform || (s.kind === 'web' ? 'web' : null),
      createdAt: s.created_at,
      lastSeenAt: s.last_seen_at,
      expiresAt: s.expires_at,
      current: req.auth.session?.id === s.id,
    }));
    res.json({ sessions });
  });

  r.delete('/sessions/:id', session, limiters.writes, (req, res) => {
    const id = assertName(req.params.id, 'session id');
    const uid = req.auth.user.id;
    const changes = repo.tx(() => {
      const n = Number(repo.q.deleteSessionById.run(id, uid).changes);
      if (n) repo.q.deletePushOwner.run(uid, id);
      return n;
    });
    if (!changes) throw new HttpError(404, 'Not found');
    if (req.auth.session?.id === id && req.auth.transport === 'cookie') clearSessionCookies(res);
    res.json({ ok: true });
  });

  return r;
}
