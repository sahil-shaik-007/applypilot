// HTTP security headers, authentication (web session cookie, native app session bearer token or desktop
// device bearer token), CSRF + Origin checks, and CORS for the Capacitor app origins only.
import helmet from 'helmet';
import { HttpError, parseCookies, sha256, safeEqual, csrfFor, randomToken, randomId } from './util.js';

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

/** Native app session tokens: "ap_s_" + 256-bit base64url. Only ever accepted in the Authorization header. */
export const NATIVE_TOKEN_PREFIX = 'ap_s_';
const NATIVE_TOKEN_RE = /^ap_s_[A-Za-z0-9_-]{43}$/;
const COOKIE_TOKEN_RE = /^[A-Za-z0-9_-]{20,200}$/;
const BEARER_RE = /^Bearer ([A-Za-z0-9_-]{20,200})$/;

/** Creates a web session row (hash only) and sets the cookies. */
export function startSession(ctx, res, userId) {
  const { repo, config, clock } = ctx;
  const token = randomToken();
  const now = clock.peek();
  repo.q.insertSession.run(sha256(token), userId, now, now, now + config.limits.sessionTtlMs, randomId());
  setSessionCookies(res, token, config.limits.sessionTtlMs);
}

/** Creates a native app session (hash only) and returns the bearer token for the app. Sets no cookies. */
export function startNativeSession(ctx, userId, { name, platform }) {
  const { repo, config, clock } = ctx;
  const token = `${NATIVE_TOKEN_PREFIX}${randomToken()}`;
  const now = clock.peek();
  const id = randomId();
  const expiresAt = now + config.limits.sessionTtlMs;
  repo.q.insertNativeSession.run(sha256(token), userId, now, now, expiresAt, id, name, platform);
  return { token, id, expiresAt };
}

/** Id of the credential behind a request (session id or device id). Push targets are tied to it. */
export const ownerIdOf = (auth) => (auth.kind === 'device' ? auth.device.id : auth.session.id);

/**
 * Identifies the caller (never rejects except for a malformed/invalid bearer token).
 * Sets req.auth = { kind: 'session'|'device', transport: 'cookie'|'bearer', user, session?, sessionToken?, device? }.
 *  - web session:    kind 'session', transport 'cookie' (Origin + CSRF enforced on writes)
 *  - native app:     kind 'session', transport 'bearer' (ap_s_… token; CSRF-exempt)
 *  - desktop device: kind 'device',  transport 'bearer' (apd_… token; CSRF-exempt)
 * Session rows carry a kind, so a native token is never accepted from a cookie and a web cookie token is
 * never accepted as a bearer token.
 */
export function authenticate(ctx) {
  const { repo, config } = ctx;
  const nativeOrigins = new Set(config.nativeOrigins || []);
  return (req, res, next) => {
    req.auth = null;
    req.cookies = Object.create(null);
    const now = Date.now();
    const authz = req.headers.authorization;
    if (authz !== undefined) {
      const m = BEARER_RE.exec(String(authz));
      if (!m) return next(new HttpError(401, 'Invalid authorization header'));
      const token = m[1];
      if (token.startsWith(NATIVE_TOKEN_PREFIX)) {
        const hash = sha256(token);
        const session = NATIVE_TOKEN_RE.test(token) ? repo.q.sessionByHash.get(hash) : undefined;
        if (!session || session.kind !== 'native') return next(new HttpError(401, 'Invalid or revoked session'));
        if (session.expires_at <= now) {
          repo.q.deleteSession.run(hash);
          return next(new HttpError(401, 'Invalid or revoked session'));
        }
        const user = repo.q.userById.get(session.user_id);
        if (!user) return next(new HttpError(401, 'Invalid or revoked session'));
        if (now - session.last_seen_at > config.limits.sessionRefreshMs) {
          repo.q.touchSession.run(now, now + config.limits.sessionTtlMs, hash); // 30-day sliding expiry
        }
        req.auth = { kind: 'session', transport: 'bearer', user, session, sessionToken: token };
        return next();
      }
      const device = repo.q.deviceByHash.get(sha256(token));
      if (!device || now - device.last_seen_at > config.limits.deviceIdleTtlMs) return next(new HttpError(401, 'Invalid or revoked device token'));
      const user = repo.q.userById.get(device.user_id);
      if (!user) return next(new HttpError(401, 'Invalid or revoked device token'));
      if (now - device.last_seen_at > 60 * 1000) repo.q.touchDevice.run(now, device.id);
      req.auth = { kind: 'device', transport: 'bearer', user, device };
      return next();
    }
    // Requests from the native app origins are bearer-only: any cookies they carry are ignored.
    if (nativeOrigins.has(req.headers.origin)) return next();
    const cookies = parseCookies(req.headers.cookie);
    req.cookies = cookies;
    const token = cookies[SESSION_COOKIE];
    if (token && COOKIE_TOKEN_RE.test(token)) {
      const hash = sha256(token);
      const session = repo.q.sessionByHash.get(hash);
      if (session && session.kind === 'web' && session.expires_at > now) {
        const user = repo.q.userById.get(session.user_id);
        if (user) {
          if (now - session.last_seen_at > config.limits.sessionRefreshMs) {
            repo.q.touchSession.run(now, now + config.limits.sessionTtlMs, hash);
            setSessionCookies(res, token, config.limits.sessionTtlMs); // sliding expiry
          }
          req.auth = { kind: 'session', transport: 'cookie', user, session, sessionToken: token };
        }
      } else if (session && session.kind === 'web') {
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

/**
 * Sign-in Origin rule. A web sign-in sets cookies, so it requires the exact app Origin (login CSRF).
 * A native sign-in only returns a token in the body, so it may come from native HTTP (no Origin), a
 * Capacitor WebView origin or the web app. Any other browser origin is refused.
 */
export function checkSignInOrigin(config, req, native) {
  if (!native) return checkOrigin(config, req);
  const origin = req.headers.origin;
  if (origin === undefined) return;
  if (origin === config.appOrigin || (config.nativeOrigins || []).includes(origin)) return;
  throw new HttpError(403, 'Origin not allowed');
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
 * @param {'any'|'session'} mode  'any' accepts a session (web cookie or native bearer) or a device bearer token;
 *   'session' refuses desktop device tokens.
 * Cookie-authenticated non-GET requests must pass the Origin check and the CSRF double-submit check.
 * Bearer requests are exempt (browsers never attach them automatically).
 */
export function requireAuth(ctx, mode = 'any') {
  return (req, res, next) => {
    if (!req.auth) throw new HttpError(401, 'Not signed in');
    if (mode === 'session' && req.auth.kind !== 'session') throw new HttpError(403, 'This action requires a web session');
    if (req.auth.transport === 'cookie' && !SAFE_METHODS.has(req.method)) {
      checkOrigin(ctx.config, req);
      checkCsrf(req);
    }
    next();
  };
}

const CORS_METHODS = new Set(['GET', 'POST', 'PUT', 'DELETE']);
const CORS_HEADERS = new Set(['authorization', 'content-type']);

/**
 * CORS for the Capacitor app origins only (APP_NATIVE_ORIGINS). No credentials mode: apps authenticate with
 * the bearer token, never cookies. The web app is same-origin and gets no CORS headers at all.
 */
export function nativeCors(config) {
  const allowed = new Set(config.nativeOrigins || []);
  return (req, res, next) => {
    const origin = req.headers.origin;
    if (origin === undefined || origin === config.appOrigin) return next();
    res.vary('Origin');
    if (!allowed.has(origin)) {
      if (req.method === 'OPTIONS') return res.status(403).json({ error: 'Origin not allowed' });
      return next(); // no CORS headers: the browser hides the response; all server-side checks still apply
    }
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Expose-Headers', 'RateLimit, RateLimit-Policy, Retry-After');
    if (req.method !== 'OPTIONS') return next();
    const method = String(req.headers['access-control-request-method'] || '').toUpperCase();
    const asked = String(req.headers['access-control-request-headers'] || '').split(',').map((x) => x.trim().toLowerCase()).filter(Boolean);
    if (!CORS_METHODS.has(method) || asked.some((x) => !CORS_HEADERS.has(x))) {
      return res.status(403).json({ error: 'CORS request not allowed' });
    }
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE');
    res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
    res.setHeader('Access-Control-Max-Age', '600');
    return res.status(204).end();
  };
}
