// Sign-in (Google / dev), sign-out, sign-out everywhere, and /api/me.
import { Router } from 'express';
import { HttpError, randomId, isPlainObject, cleanText, csrfFor, sha256 } from '../util.js';
import { requireAuth, requireOrigin, startSession, clearSessionCookies, setSessionCookies, CSRF_COOKIE } from '../security.js';
import { profileFromPayload } from '../google.js';

export const userView = (u) => ({ id: u.id, email: u.email, name: u.name || '', picture: u.picture || '' });

function upsertUser(repo, clock, { sub, email, name, picture }) {
  const e = cleanText(email, 254).toLowerCase();
  const n = cleanText(name, 120);
  const pic = /^https:\/\/[^\s"'<>]{1,1000}$/.test(picture || '') ? picture : '';
  const existing = repo.q.userBySub.get(sub);
  if (existing) {
    repo.q.updateUser.run(e, n, pic, existing.id);
    return repo.q.userById.get(existing.id);
  }
  const id = randomId();
  repo.q.insertUser.run(id, sub, e, n, pic, clock.peek());
  return repo.q.userById.get(id);
}

/** Drops the caller's current session (if any) before issuing a new one: no session fixation. */
function rotate(ctx, req) {
  if (req.auth?.kind === 'session') ctx.repo.q.deleteSession.run(sha256(req.auth.sessionToken));
}

export function authRoutes(ctx) {
  const { repo, config, limiters, clock } = ctx;
  const r = Router();

  r.post('/auth/google', limiters.auth, requireOrigin(ctx), async (req, res) => {
    if (!config.googleClientId || !ctx.googleVerifier) throw new HttpError(503, 'Google sign-in is not configured on this server');
    const credential = isPlainObject(req.body) ? req.body.credential : undefined;
    if (typeof credential !== 'string' || credential.length < 20 || credential.length > 8192) throw new HttpError(400, 'Missing Google credential');
    let profile;
    try {
      profile = profileFromPayload(await ctx.googleVerifier(credential, config.googleClientId), config.googleClientId);
    } catch {
      throw new HttpError(401, 'Google sign-in failed');
    }
    const user = upsertUser(repo, clock, profile);
    rotate(ctx, req);
    startSession(ctx, res, user.id);
    res.json({ user: userView(user) });
  });

  // Dev login exists only when explicitly enabled outside production (config.js refuses to start otherwise).
  if (config.devLogin && !config.production) {
    r.post('/auth/dev', limiters.auth, requireOrigin(ctx), (req, res) => {
      if (config.production || process.env.NODE_ENV === 'production') throw new HttpError(404, 'Not found');
      const email = isPlainObject(req.body) && typeof req.body.email === 'string' ? req.body.email.trim().toLowerCase() : '';
      if (!/^[^\s@<>"]{1,64}@[^\s@<>"]{1,190}$/.test(email)) throw new HttpError(400, 'Enter an email address');
      const user = upsertUser(repo, clock, { sub: `dev:${email}`, email, name: email.split('@')[0], picture: '' });
      rotate(ctx, req);
      startSession(ctx, res, user.id);
      res.json({ user: userView(user) });
    });
  }

  r.post('/auth/logout', requireAuth(ctx, 'session'), (req, res) => {
    repo.q.deleteSession.run(sha256(req.auth.sessionToken));
    clearSessionCookies(res);
    res.json({ ok: true });
  });

  r.post('/auth/logout-all', requireAuth(ctx, 'session'), (req, res) => {
    const uid = req.auth.user.id;
    repo.tx(() => {
      repo.q.deleteUserSessions.run(uid);
      repo.q.deleteUserDevices.run(uid);
      repo.q.deleteUserLinkCodes.run(uid);
    });
    clearSessionCookies(res);
    res.json({ ok: true });
  });

  r.get('/me', requireAuth(ctx, 'any'), (req, res) => {
    const { auth } = req;
    if (auth.kind === 'session' && req.cookies?.[CSRF_COOKIE] !== csrfFor(auth.sessionToken)) {
      // Re-issue a lost/stale CSRF cookie without extending the session.
      setSessionCookies(res, auth.sessionToken, Math.max(0, auth.session.expires_at - Date.now()));
    }
    const out = { user: userView(auth.user), hasVault: !!repo.q.vault.get(auth.user.id) };
    if (auth.kind === 'device') out.device = { id: auth.device.id, name: auth.device.name };
    res.json(out);
  });

  return r;
}
