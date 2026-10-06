// Express application factory. Dependencies (database, Google verifier, job aggregator) are injectable
// so tests can run against a temp SQLite file with stubbed external services.
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import express from 'express';
import { assertConfigSafe } from './config.js';
import { openDb } from './db.js';
import { HttpError, createClock } from './util.js';
import { securityHeaders, authenticate, requireAuth } from './security.js';
import { createLimiters } from './limits.js';
import { createGoogleVerifier } from './google.js';
import { createJobSearch, loadPlatforms } from './jobs.js';
import { authRoutes } from './routes/auth.js';
import { syncRoutes } from './routes/sync.js';
import { deviceRoutes } from './routes/devices.js';
import { accountRoutes } from './routes/account.js';

function requestLogger(config) {
  return (req, res, next) => {
    if (!config.log) return next();
    const t0 = process.hrtime.bigint();
    res.on('finish', () => {
      const ms = Number(process.hrtime.bigint() - t0) / 1e6;
      // Method, path (no query string), status and duration only: no bodies, tokens, emails or IPs.
      const p = (req.originalUrl || req.url).split('?')[0].slice(0, 200);
      console.log(`${new Date().toISOString()} ${req.method} ${p} ${res.statusCode} ${ms.toFixed(1)}ms`);
    });
    next();
  };
}

/**
 * @param {object} config  from loadConfig()
 * @param {object} [deps]  { repo, googleVerifier, aggregator, jobSearch }
 */
export function createApp(config, deps = {}) {
  assertConfigSafe(config);
  const repo = deps.repo || openDb(config.databasePath);
  const ctx = {
    config,
    repo,
    clock: deps.clock || createClock(),
    limiters: createLimiters(config),
    googleVerifier: deps.googleVerifier !== undefined ? deps.googleVerifier : (config.googleClientId ? createGoogleVerifier() : null),
    jobSearch: deps.jobSearch || createJobSearch({ aggregator: deps.aggregator, limits: config.limits }),
  };

  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', config.trustProxy);
  app.set('query parser', 'simple');
  app.set('etag', false);

  app.use(requestLogger(config));
  app.use(securityHeaders(config));

  // ------------------------------------------------------------------ API
  const api = express.Router();
  api.use((req, res, next) => { res.setHeader('Cache-Control', 'no-store'); next(); });
  api.use(ctx.limiters.api);
  api.use(express.json({ limit: config.limits.jsonBody }));
  api.use(authenticate(ctx));

  api.get('/health', (req, res) => res.json({ ok: true, version: config.version }));
  api.get('/config', (req, res) => res.json({ googleClientId: config.googleClientId || null, devLogin: !!config.devLogin, version: config.version }));

  api.use(authRoutes(ctx));
  api.use(syncRoutes(ctx));
  api.use(deviceRoutes(ctx));
  api.use(accountRoutes(ctx));

  api.get('/jobs/search', requireAuth(ctx, 'any'), ctx.limiters.search, async (req, res) => {
    const { jobs, stats, cached } = await ctx.jobSearch.search(req.query);
    res.json({ jobs, stats, cached });
  });
  api.get('/jobs/platforms', (req, res) => {
    res.setHeader('Cache-Control', 'public, max-age=3600');
    res.json(loadPlatforms());
  });

  api.use((req, res) => res.status(404).json({ error: 'Not found' }));
  app.use('/api', api);

  // ------------------------------------------------------------------ built PWA (SPA fallback)
  const dist = config.clientDist;
  const indexHtml = path.join(dist, 'index.html');
  app.use(express.static(dist, {
    index: false,
    dotfiles: 'ignore',
    setHeaders: (res, file) => {
      const rel = path.relative(dist, file).replace(/\\/g, '/');
      res.setHeader('Cache-Control', rel.startsWith('assets/') ? 'public, max-age=31536000, immutable' : 'no-cache');
    },
  }));
  app.use((req, res, next) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') return next();
    if (!fs.existsSync(indexHtml)) return res.status(404).type('text/plain').send('Web client not built. Run `npm run build` in web/ (or use the Vite dev server).');
    res.setHeader('Cache-Control', 'no-cache');
    res.sendFile(indexHtml);
  });
  app.use((req, res) => res.status(404).type('text/plain').send('Not found'));

  // ------------------------------------------------------------------ errors
  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    if (err instanceof HttpError) return res.status(err.status).json({ error: err.message, ...(err.extra || {}) });
    if (err && err.type === 'entity.too.large') return res.status(413).json({ error: 'Request body too large' });
    if (err && err.type === 'entity.parse.failed') return res.status(400).json({ error: 'Invalid JSON body' });
    if (err && typeof err.status === 'number' && err.status >= 400 && err.status < 500) return res.status(err.status).json({ error: 'Bad request' });
    console.error(`Unhandled error on ${req.method} ${(req.originalUrl || '').split('?')[0]}:`, err && err.stack ? err.stack : err);
    res.status(500).json({ error: 'Internal server error' });
  });

  const purge = setInterval(() => { try { repo.purgeExpired(Date.now()); } catch { /* ignore */ } }, 60 * 60 * 1000);
  purge.unref();

  return { app, ctx, close: () => { clearInterval(purge); if (!deps.repo) repo.close(); } };
}

/** Starts an HTTP server. Resolves with { server, url, ctx, close }. */
export function startServer(config, deps = {}, { host } = {}) {
  const { app, ctx, close } = createApp(config, deps);
  const server = http.createServer(app);
  server.headersTimeout = 30000;
  server.requestTimeout = 120000;
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(config.port, host, () => {
      const { port } = server.address();
      resolve({
        server,
        ctx,
        port,
        url: `http://localhost:${port}`,
        close: () => new Promise((r) => { server.closeAllConnections?.(); server.close(() => { close(); r(); }); }),
      });
    });
  });
}
