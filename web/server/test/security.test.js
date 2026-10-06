import test, { describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { startTestServer } from './helpers.js';

function cspMap(h) {
  return Object.fromEntries(h.split(';').map((d) => d.trim()).filter(Boolean).map((d) => { const [k, ...v] = d.split(/\s+/); return [k, v]; }));
}

describe('security headers', () => {
  let t;
  before(async () => { t = await startTestServer(); });
  after(async () => { await t.stop(); });

  test('strict CSP and browser hardening headers on API responses', async () => {
    const r = await t.client().get('/api/health');
    assert.deepEqual(r.json, { ok: true, version: t.config.version });
    const h = r.headers;
    const csp = cspMap(h.get('content-security-policy'));
    assert.deepEqual(csp['default-src'], ["'self'"]);
    assert.deepEqual(csp['frame-ancestors'], ["'none'"]);
    assert.deepEqual(csp['object-src'], ["'none'"]);
    assert.ok(csp['script-src'].includes('https://accounts.google.com/gsi/client'));
    assert.ok(!csp['script-src'].includes("'unsafe-inline'") && !csp['script-src'].includes("'unsafe-eval'"));
    assert.ok(csp['style-src'].includes('https://accounts.google.com/gsi/style'));
    assert.ok(!csp['style-src'].includes("'unsafe-inline'"));
    assert.ok(csp['frame-src'].includes('https://accounts.google.com/gsi/'));
    assert.ok(csp['connect-src'].includes('https://api.anthropic.com'));
    assert.ok(csp['connect-src'].includes('https://accounts.google.com/gsi/'));
    assert.deepEqual(csp['img-src'], ["'self'", 'https:', 'data:']);
    assert.equal(h.get('referrer-policy'), 'no-referrer');
    assert.equal(h.get('x-content-type-options'), 'nosniff');
    assert.equal(h.get('x-frame-options'), 'DENY');
    assert.equal(h.get('cross-origin-opener-policy'), 'same-origin-allow-popups');
    assert.match(h.get('permissions-policy'), /camera=\(\)/);
    assert.match(h.get('permissions-policy'), /geolocation=\(\)/);
    assert.equal(h.get('x-powered-by'), null);
    assert.equal(h.get('strict-transport-security'), null, 'no HSTS in development');
    assert.equal(h.get('cache-control'), 'no-store');
    assert.equal(h.get('access-control-allow-origin'), null, 'no CORS');
  });

  test('HSTS (2 years, preload) in production', async () => {
    const p = await startTestServer({ env: { NODE_ENV: 'production', AP_DEV_LOGIN: '', APP_ORIGIN: 'https://app.example.com' } });
    try {
      const r = await p.client().get('/api/health');
      assert.equal(r.headers.get('strict-transport-security'), 'max-age=63072000; includeSubDomains; preload');
      assert.match(r.headers.get('content-security-policy'), /upgrade-insecure-requests/);
    } finally { await p.stop(); }
  });

  test('unknown API routes return JSON 404; bad JSON 400; oversized JSON 413', async () => {
    const c = t.client();
    const nf = await c.get('/api/nope');
    assert.equal(nf.status, 404);
    assert.deepEqual(nf.json, { error: 'Not found' });
    await c.devLogin('limits@example.com');
    const bad = await c.req('PUT', '/api/items/qa/x', { body: '{"ciphertext":', headers: { 'content-type': 'application/json' } });
    assert.equal(bad.status, 400);
    assert.deepEqual(bad.json, { error: 'Invalid JSON body' });
    const huge = await c.put('/api/items/qa/x', { ciphertext: 'x'.repeat(310 * 1024), baseVersion: null });
    assert.equal(huge.status, 413);
    const justOver = await c.put('/api/items/qa/x', { ciphertext: 'x'.repeat(257 * 1024), baseVersion: null });
    assert.equal(justOver.status, 413);
    const atLimit = await c.put('/api/items/qa/x', { ciphertext: 'x'.repeat(256 * 1024), baseVersion: null });
    assert.equal(atLimit.status, 200);
  });

  test('request log lines contain method, path, status, duration only', async () => {
    const lines = [];
    const orig = console.log;
    t.config.log = true;
    console.log = (...a) => lines.push(a.join(' '));
    try {
      const c = t.client();
      await c.devLogin('logged-person@example.com');
      await c.get('/api/items?since=0&collection=qa');
    } finally { console.log = orig; t.config.log = false; }
    const text = lines.join('\n');
    assert.match(text, /POST \/api\/auth\/dev 200 [\d.]+ms/);
    assert.match(text, /GET \/api\/items 200/);
    assert.doesNotMatch(text, /logged-person|example\.com|since=|ap_session|127\.0\.0\.1|::1/);
  });
});

describe('rate limits', () => {
  test('sign-in attempts are rate-limited per IP', async () => {
    const t = await startTestServer({ overrides: { rateLimits: { auth: [3, 60000] } } });
    try {
      const statuses = [];
      for (let i = 0; i < 5; i++) statuses.push((await t.client().post('/api/auth/dev', { email: `u${i}@example.com` })).status);
      assert.deepEqual(statuses, [200, 200, 200, 429, 429]);
      const r = await t.client().post('/api/auth/google', { credential: 'good:x:y@example.com:pad' });
      assert.equal(r.status, 429);
      assert.ok(r.json.error);
      assert.ok(r.headers.get('ratelimit'));
    } finally { await t.stop(); }
  });

  test('writes and link codes are rate-limited per user', async () => {
    const t = await startTestServer({ overrides: { rateLimits: { writes: [3, 60000], linkCode: [2, 60000] } } });
    try {
      const a = t.client(); await a.devLogin('a@example.com');
      const b = t.client(); await b.devLogin('b@example.com');
      const sa = [];
      for (let i = 0; i < 4; i++) sa.push((await a.put(`/api/items/qa/i${i}`, { ciphertext: 'x', baseVersion: null })).status);
      assert.deepEqual(sa, [200, 200, 200, 429]);
      assert.equal((await b.put('/api/items/qa/i0', { ciphertext: 'x', baseVersion: null })).status, 200, 'per-user, not global');
      const lc = [];
      for (let i = 0; i < 3; i++) lc.push((await a.post('/api/devices/link-code', {})).status);
      assert.deepEqual(lc, [200, 200, 429]);
    } finally { await t.stop(); }
  });
});

describe('static PWA serving', () => {
  test('serves built client with SPA fallback and caching rules', async () => {
    const dist = fs.mkdtempSync(path.join(os.tmpdir(), 'ap-dist-'));
    fs.mkdirSync(path.join(dist, 'assets'));
    fs.writeFileSync(path.join(dist, 'index.html'), '<!doctype html><title>ApplyPilot</title>');
    fs.writeFileSync(path.join(dist, 'assets', 'app-abc123.js'), 'console.log(1)');
    fs.writeFileSync(path.join(dist, 'sw.js'), '//sw');
    const t = await startTestServer({ overrides: { clientDist: dist } });
    try {
      const c = t.client();
      const deep = await c.get('/jobs/123?x=1');
      assert.equal(deep.status, 200);
      assert.match(deep.buf.toString(), /ApplyPilot/);
      assert.equal(deep.headers.get('cache-control'), 'no-cache');
      assert.ok(deep.headers.get('content-security-policy'));
      const asset = await c.get('/assets/app-abc123.js');
      assert.equal(asset.headers.get('cache-control'), 'public, max-age=31536000, immutable');
      assert.equal((await c.get('/sw.js')).headers.get('cache-control'), 'no-cache');
      assert.equal((await c.get('/api/missing')).status, 404, 'API paths never fall back to index.html');
    } finally { await t.stop(); fs.rmSync(dist, { recursive: true, force: true }); }
  });
});
