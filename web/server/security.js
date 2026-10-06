// HTTP security headers, authentication (session cookie or device bearer token), CSRF + Origin checks.
import helmet from 'helmet';
import { HttpError, parseCookies, sha256, safeEqual, csrfFor, randomToken } from './util.js';

export const SESSION_COOKIE = '__Host-ap_session';
export const CSRF_COOKIE = 'ap_csrf';
export const CSRF_HEADER = 'x-csrf-token';
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

const GSI = 'https://accounts.google.com/gsi/';

export function securityHeaders(config) {
  const csp = {
    useDefaults: false,
    directives: {
      'default-src': ["'self'"],
      // 'wasm-unsafe-eval' only permits compiling WebAssembly (pdf.js image decoders); it does not allow eval().
      'script-src': ["'self'", `${GSI}client`, "'wasm-unsafe-eval'"],
      'style-src': ["'self'", `${GSI}style`],
      'img-src': ["'self'", 'https:', 'data:'],
      'font-src': ["'self'"],
      'connect-src': ["'self'", GSI, 'https://api.anthropic.com'],
      'frame-src': [GSI],
      'worker-src': ["'self'"],
      'manifest-src': ["'self'"],
      'object-src': ["'none'"],
      'base-uri': ["'none'"],
      'form-action': ["'self'"],
      'frame-ancestors': ["'none'"],
      ...(config.production ? { 'upgrade-insecure-requests': [] } : {}),
    },
  };
  const h = helmet({
    contentSecurityPolicy: csp,
    crossOriginOpenerPolicy: { policy: 'same-origin-allow-popups' },
    crossOriginResourcePolicy: { policy: 'same-origin' },
    crossOriginEmbedderPolicy: false,
    referrerPolicy: { policy: 'no-referrer' },
    frameguard: { action: 'deny' },
    strictTransportSecurity: config.production ? { maxAge: 63072000, includeSubDomains: true, preload: true } : false,
    xPoweredBy: false,
  });
  return [
    h,
    (req, res, next) => {
      res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=(), usb=(), serial=(), bluetooth=(), hid=(), midi=(), magnetometer=(), gyroscope=(), accelerometer=(), browsing-topics=()');
      next();
    },
  ];
}

function cookieBase(maxAge) {
  return { secure: true, sameSite: 'lax', path: '/', maxAge };
}

export function setSessionCookies(res, token, maxAgeMs) {
  res.cookie(SESSION_COOKIE, token, { ...cookieBase(maxAgeMs), httpOnly: true });
  res.cookie(CSRF_COOKIE, csrfFor(token), { ...cookieBase(maxAgeMs), httpOnly: false });
}
export function clearSessionCookies(res) {
  res.clearCookie(SESSION_COOKIE, { secure: true, sameSite: 'lax', path: '/', httpOnly: true });
  res.clearCookie(CSRF_COOKIE, { secure: true, sameSite: 'lax', path: '/' });
}

/** Creates a session row (hash only) and sets the cookies. */
export function startSession(ctx, res, userId) {
  const { repo, config, clock } = ctx;
  const token = randomToken();
  const now = clock.peek();
  repo.q.insertSession.run(sha256(token), userId, now, now, now + config.limits.sessionTtlMs);
  setSessionCookies(res, token, config.limits.sessionTtlMs);
}

/**
 * Identifies the caller (never rejects except for a malformed/invalid bearer token).
 * Sets req.auth = { kind: 'session'|'device', user, session?, sessionToken?, device? }.
 */
export function authenticate(ctx) {
  const { repo, config } = ctx;
  return (req, res, next) => {
    req.auth = null;
    const now = Date.now();
    const authz = req.headers.authorization;
    if (authz !== undefined) {
      const m = /^Bearer ([A-Za-z0-9_-]{20,200})$/.exec(String(authz));
      if (!m) return next(new HttpError(401, 'Invalid authorization header'));
      const device = repo.q.deviceByHash.get(sha256(m[1]));
      if (!device || now - device.last_seen_at > config.limits.deviceIdleTtlMs) return next(new HttpError(401, 'Invalid or revoked device token'));
      const user = repo.q.userById.get(device.user_id);
      if (!user) return next(new HttpError(401, 'Invalid or revoked device token'));
      if (now - device.last_seen_at > 60 * 1000) repo.q.touchDevice.run(now, device.id);
      req.auth = { kind: 'device', user, device };
      return next();
    }
    const cookies = parseCookies(req.headers.cookie);
    req.cookies = cookies;
    const token = cookies[SESSION_COOKIE];
    if (token && /^[A-Za-z0-9_-]{20,200}$/.test(token)) {
      const hash = sha256(token);
      const session = repo.q.sessionByHash.get(hash);
      if (session && session.expires_at > now) {
        const user = repo.q.userById.get(session.user_id);
        if (user) {
          if (now - session.last_seen_at > config.limits.sessionRefreshMs) {
            repo.q.touchSession.run(now, now + config.limits.sessionTtlMs, hash);
            setSessionCookies(res, token, config.limits.sessionTtlMs); // sliding expiry
          }
          req.auth = { kind: 'session', user, session, sessionToken: token };
        }
      } else if (session) {
        repo.q.deleteSession.run(hash);
      }
      if (!req.auth) clearSessionCookies(res);
    }
    next();
  };
}

/** Origin must exactly equal APP_ORIGIN; browsers send Origin on every non-GET fetch. */
export function checkOrigin(config, req) {
  const origin = req.headers.origin;
  if (!origin || origin !== config.appOrigin) throw new HttpError(403, 'Origin not allowed');
  if (req.headers['sec-fetch-site'] === 'cross-site') throw new HttpError(403, 'Cross-site request blocked');
}

/** For unauthenticated state-changing endpoints called from the web app (sign-in): Origin check only. */
export function requireOrigin(ctx) {
  return (req, res, next) => { checkOrigin(ctx.config, req); next(); };
}

function checkCsrf(req) {
  const header = req.headers[CSRF_HEADER];
  const cookie = req.cookies?.[CSRF_COOKIE];
  const expected = csrfFor(req.auth.sessionToken);
  if (typeof header !== 'string' || !header || !safeEqual(header, cookie || '') || !safeEqual(header, expected)) {
    throw new HttpError(403, 'Missing or invalid CSRF token');
  }
}

/**
 * @param {'any'|'session'} mode  'any' accepts a session cookie or a device bearer token.
 * Cookie-authenticated non-GET requests must pass the Origin check and CSRF double-submit check.
 * Bearer requests are exempt (browsers never attach them automatically).
 */
export function requireAuth(ctx, mode = 'any') {
  return (req, res, next) => {
    if (!req.auth) throw new HttpError(401, 'Not signed in');
    if (mode === 'session' && req.auth.kind !== 'session') throw new HttpError(403, 'This action requires a web session');
    if (req.auth.kind === 'session' && !SAFE_METHODS.has(req.method)) {
      checkOrigin(ctx.config, req);
      checkCsrf(req);
    }
    next();
  };
}
