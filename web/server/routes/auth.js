// Sign-in (Google / dev), sign-out, sign-out everywhere, and /api/me.
// Web clients get cookies; native apps ({ client: 'native' }) get a bearer token in the body instead.
import { Router } from 'express';
import { HttpError, randomId, isPlainObject, cleanText, csrfFor, sha256 } from '../util.js';
import {
  requireAuth, checkSignInOrigin, startSession, startNativeSession, clearSessionCookies, setSessionCookies, CSRF_COOKIE,
} from '../security.js';
import { profileFromPayload } from '../google.js';

export const userView = (u) => ({ id: u.id, email: u.email, name: u.name || '', picture: u.picture || '' });

const PLATFORMS = new Set(['ios', 'android']);

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

/** Revokes a session and the push targets registered through it. */
function endSession(repo, auth) {
  repo.tx(() => {
    repo.q.deleteSession.run(sha256(auth.sessionToken));
    repo.q.deletePushOwnerAny.run(auth.session.id);
  });
}

/**
 * Drops the caller's current session of the same transport (if any) before issuing a new one: no session
 * fixation. A native sign-in never touches the browser's cookie session and vice versa.
 */
function rotate(ctx, req, native) {
  const a = req.auth;
  if (a?.kind === 'session' && a.transport === (native ? 'bearer' : 'cookie')) endSession(ctx.repo, a);
}

/** Parses the sign-in mode: { native, name, platform }. */
function signInMode(body) {
  const client = body.client === undefined ? 'web' : body.client;
  if (client !== 'web' && client !== 'native') throw new HttpError(400, "client must be 'web' or 'native'");
  if (client === 'web') return { native: false };
  let platform = null;
  if (body.platform !== undefined && body.platform !== null) {
    if (!PLATFORMS.has(body.platform)) throw new HttpError(400, "platform must be 'ios' or 'android'");
    platform = body.platform;
  }
  const fallback = platform === 'ios' ? 'iPhone app' : platform === 'android' ? 'Android app' : 'Mobile app';
  return { native: true, platform, name: cleanText(body.deviceName, 64) || fallback };
}

/** Finishes a sign-in: cookies for the web, { token } for native apps. */
function issue(ctx, req, res, user, mode) {
  rotate(ctx, req, mode.native);
  if (!mode.native) {
    startSession(ctx, res, user.id);
    return res.json({ user: userView(user) });
  }
  const s = startNativeSession(ctx, user.id, mode);
  return res.json({ token: s.token, user: userView(user), session: { id: s.id, name: mode.name, platform: mode.platform, expiresAt: s.expiresAt } });
}

export function authRoutes(ctx) {
  const { repo, config, limiters, clock } = ctx;
  const r = Router();

  r.post('/auth/google', limiters.auth, async (req, res) => {
    const body = isPlainObject(req.body) ? req.body : {};
    const mode = signInMode(body);
    checkSignInOrigin(config, req, mode.native);
    const audiences = config.googleClientIds && config.googleClientIds.length ? config.googleClientIds : [config.googleClientId].filter(Boolean);
    if (!audiences.length || !ctx.googleVerifier) throw new HttpError(503, 'Google sign-in is not configured on this server');
    const { credential } = body;
    if (typeof credential !== 'string' || credential.length < 20 || credential.length > 8192) throw new HttpError(400, 'Missing Google credential');
    let profile;
    try {
      profile = profileFromPayload(await ctx.googleVerifier(credential, audiences.length === 1 ? audiences[0] : audiences), audiences);
    } catch {
      throw new HttpError(401, 'Google sign-in failed');
    }
    const user = upsertUser(repo, clock, profile);
    issue(ctx, req, res, user, mode);
  });

  // Dev login exists only when explicitly enabled outside production (config.js refuses to start otherwise).
  if (config.devLogin && !config.production) {
    r.post('/auth/dev', limiters.auth, (req, res) => {
      if (config.production || process.env.NODE_ENV === 'production') throw new HttpError(404, 'Not found');
      const body = isPlainObject(req.body) ? req.body : {};
      const mode = signInMode(body);
      checkSignInOrigin(config, req, mode.native);
      const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
      if (!/^[^\s@<>"]{1,64}@[^\s@<>"]{1,190}$/.test(email)) throw new HttpError(400, 'Enter an email address');
      const user = upsertUser(repo, clock, { sub: `dev:${email}`, email, name: email.split('@')[0], picture: '' });
      issue(ctx, req, res, user, mode);
    });
  }

  r.post('/auth/logout', requireAuth(ctx, 'session'), (req, res) => {
    endSession(repo, req.auth);
    if (req.auth.transport === 'cookie') clearSessionCookies(res);
    res.json({ ok: true });
  });

  r.post('/auth/logout-all', requireAuth(ctx, 'session'), (req, res) => {
    repo.revokeAll(req.auth.user.id);
    if (req.auth.transport === 'cookie') clearSessionCookies(res);
    res.json({ ok: true });
  });

  r.get('/me', requireAuth(ctx, 'any'), (req, res) => {
    const { auth } = req;
    if (auth.transport === 'cookie' && req.cookies?.[CSRF_COOKIE] !== csrfFor(auth.sessionToken)) {
      // Re-issue a lost/stale CSRF cookie without extending the session.
      setSessionCookies(res, auth.sessionToken, Math.max(0, auth.session.expires_at - Date.now()));
    }
    const out = { user: userView(auth.user), hasVault: !!repo.q.vault.get(auth.user.id) };
    if (auth.kind === 'device') out.device = { id: auth.device.id, name: auth.device.name };
    if (auth.transport === 'bearer' && auth.kind === 'session') {
      out.session = { id: auth.session.id, name: auth.session.name, platform: auth.session.platform, expiresAt: auth.session.expires_at };
    }
    res.json(out);
  });

  return r;
}
