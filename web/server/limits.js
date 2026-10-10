// Rate limiters (express-rate-limit, in-memory store: one server process by design).
import { rateLimit, ipKeyGenerator } from 'express-rate-limit';

function make([limit, windowMs], keyGenerator, message = 'Too many requests, please slow down') {
  return rateLimit({
    windowMs,
    limit,
    keyGenerator,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    handler: (req, res, _next, opts) => res.status(opts.statusCode).json({ error: message }),
  });
}

const byIp = (req) => `ip:${ipKeyGenerator(req.ip || '0.0.0.0')}`;
const byUser = (req) => (req.auth ? `u:${req.auth.user.id}` : byIp(req));
const everyone = () => 'global';

export function createLimiters(config) {
  const r = config.rateLimits;
  return {
    api: make(r.api, byIp),
    auth: make(r.auth, byIp, 'Too many sign-in attempts, try again later'),
    linkCode: make(r.linkCode, byUser, 'Too many link codes, try again later'),
    redeem: make(r.redeem, byIp, 'Too many attempts, try again later'),
    redeemGlobal: make(r.redeemGlobal, everyone, 'Device linking is temporarily paused, try again later'),
    search: make(r.search, byUser, 'Too many searches, wait a minute'),
    writes: make(r.writes, byUser),
    watchlist: make(r.watchlist, byUser, 'Too many watchlist changes, try again later'),
    history: make(r.history, byUser, 'Too many lookups, wait a minute'),
    push: make(r.push, byUser, 'Too many notification changes, try again later'),
  };
}
