// Push: VAPID key handling, subscription validation (SSRF guard), content-free Web Push (payload decrypted
// here per RFC 8291 to prove it carries no job data), FCM HTTP v1 and APNs (local HTTP/2 server).
import test, { describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import http2 from 'node:http2';
import crypto from 'node:crypto';
import { loadConfig } from '../config.js';
import { hostAllowed, validEndpoint, notificationBody } from '../push.js';
import { startTestServer, Client } from './helpers.js';

const ENDPOINT = (n = 1) => `https://fcm.googleapis.com/fcm/send/test-endpoint-${n}`;

/** A browser-side push subscription with real keys, so the test can decrypt what the server sends. */
function browserSubscription(endpoint) {
  const ecdh = crypto.createECDH('prime256v1');
  ecdh.generateKeys();
  const authSecret = crypto.randomBytes(16);
  return {
    json: { endpoint, expirationTime: null, keys: { p256dh: ecdh.getPublicKey().toString('base64url'), auth: authSecret.toString('base64url') } },
    decrypt(body) { // RFC 8291 (aes128gcm) as a browser would do it
      const buf = Buffer.from(body);
      const salt = buf.subarray(0, 16);
      const idlen = buf[20];
      const asPublic = buf.subarray(21, 21 + idlen);
      const ct = buf.subarray(21 + idlen);
      const secret = ecdh.computeSecret(asPublic);
      const keyInfo = Buffer.concat([Buffer.from('WebPush: info\0'), ecdh.getPublicKey(), asPublic]);
      const ikm = Buffer.from(crypto.hkdfSync('sha256', secret, authSecret, keyInfo, 32));
      const cek = Buffer.from(crypto.hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: aes128gcm\0'), 16));
      const nonce = Buffer.from(crypto.hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: nonce\0'), 12));
      const d = crypto.createDecipheriv('aes-128-gcm', cek, nonce);
      d.setAuthTag(ct.subarray(ct.length - 16));
      const plain = Buffer.concat([d.update(ct.subarray(0, ct.length - 16)), d.final()]);
      const end = plain.lastIndexOf(2); // padding delimiter
      return JSON.parse(plain.subarray(0, end).toString('utf8'));
    },
  };
}

function fakeFetch(calls, respond = () => new Response(null, { status: 201 })) {
  return async (url, opts) => { calls.push({ url, ...opts }); return respond(url, opts); };
}

describe('push: VAPID and Web Push', () => {
  let t; const calls = []; let respond = () => new Response(null, { status: 201 });
  before(async () => {
    t = await startTestServer({ deps: { pushDeps: { fetch: fakeFetch(calls, (...a) => respond(...a)) } }, overrides: { rateLimits: { auth: [1000, 60000] } } });
  });
  after(async () => { await t.stop(); });

  test('VAPID keys are generated into the data dir on first start and reused', async () => {
    const file = path.join(path.dirname(t.dbPath), 'vapid.json');
    const saved = JSON.parse(fs.readFileSync(file, 'utf8'));
    assert.equal(Buffer.from(saved.publicKey, 'base64url').length, 65);
    if (process.platform !== 'win32') assert.equal(fs.statSync(file).mode & 0o777, 0o600);
    const cfg = await t.client().get('/api/push/config');
    assert.deepEqual(cfg.json, { webPush: { publicKey: saved.publicKey }, native: { fcm: false, apns: false } });
    assert.ok(!JSON.stringify(cfg.json).includes(saved.privateKey));
    // A second server on the same data dir reuses the key.
    const { createPush } = await import('../push.js');
    assert.equal(createPush({ config: t.config, repo: t.ctx.repo }).publicKey, saved.publicKey);
  });

  test('VAPID env keys win; half-configured env refuses to start', async () => {
    const { generateVAPIDKeys } = (await import('web-push')).default;
    const k = generateVAPIDKeys();
    const t2 = await startTestServer({ env: { VAPID_PUBLIC_KEY: k.publicKey, VAPID_PRIVATE_KEY: k.privateKey, VAPID_SUBJECT: 'mailto:ops@example.com' } });
    try {
      assert.equal((await t2.client().get('/api/push/config')).json.webPush.publicKey, k.publicKey);
      assert.equal(fs.existsSync(path.join(path.dirname(t2.dbPath), 'vapid.json')), false);
    } finally { await t2.stop(); }
    assert.throws(() => loadConfig({ VAPID_PUBLIC_KEY: k.publicKey }), /VAPID/);
    assert.throws(() => loadConfig({ VAPID_SUBJECT: 'ops@example.com' }), /VAPID_SUBJECT/);
  });

  test('endpoint allow-list (SSRF guard)', () => {
    const hosts = t.config.push.hosts;
    for (const ok of [ENDPOINT(), 'https://updates.push.services.mozilla.com/wpush/v2/abc', 'https://web.push.apple.com/QO_abc', 'https://wns2-par02p.notify.windows.com/w/?token=x']) {
      assert.ok(validEndpoint(ok, hosts), ok);
    }
    for (const bad of ['http://fcm.googleapis.com/x', 'https://fcm.googleapis.com:8443/x', 'https://169.254.169.254/latest', 'https://localhost/x',
      'https://fcm.googleapis.com.evil.example/x', 'https://evilpush.apple.com/x', 'https://push.apple.com/x', 'https://user:pw@fcm.googleapis.com/x', 'not a url', 'https://fcm.googleapis.com/' + 'x'.repeat(1100)]) {
      assert.ok(!validEndpoint(bad, hosts), bad);
    }
    assert.ok(hostAllowed('a.b.push.apple.com', ['*.push.apple.com']));
  });

  test('subscribe: auth, CSRF, validation, de-dup, per-user cap', async () => {
    const sub = browserSubscription(ENDPOINT(1)).json;
    assert.equal((await t.client().post('/api/push/subscribe', { subscription: sub })).status, 401);
    const c = t.client();
    await c.devLogin('push-validate@example.com');
    assert.equal((await c.post('/api/push/subscribe', { subscription: sub }, { csrf: false })).status, 403);
    for (const bad of [
      {}, { subscription: { endpoint: ENDPOINT() } },
      { subscription: { ...sub, endpoint: 'https://169.254.169.254/x' } },
      { subscription: { ...sub, keys: { ...sub.keys, p256dh: 'AAAA' } } },
      { subscription: { ...sub, keys: { ...sub.keys, auth: crypto.randomBytes(8).toString('base64url') } } },
      { subscription: { ...sub, keys: { ...sub.keys, p256dh: Buffer.alloc(65, 5).toString('base64url') } } },
    ]) assert.equal((await c.post('/api/push/subscribe', bad)).status, 400, JSON.stringify(bad).slice(0, 80));
    const a = await c.post('/api/push/subscribe', { subscription: sub });
    assert.equal(a.status, 200);
    assert.match(a.json.id, /^[A-Za-z0-9_-]{22}$/);
    assert.equal((await c.post('/api/push/subscribe', { subscription: sub })).json.id, a.json.id, 'same endpoint → same target');
    for (let i = 2; i <= 10; i++) assert.equal((await c.post('/api/push/subscribe', { subscription: browserSubscription(ENDPOINT(i)).json })).status, 200);
    assert.equal((await c.post('/api/push/subscribe', { subscription: browserSubscription(ENDPOINT(11)).json })).status, 409);
    const del = await c.req('DELETE', '/api/push/subscribe', { json: { endpoint: ENDPOINT(1) } });
    assert.deepEqual(del.json, { ok: true, removed: 1 });
    const delAll = await c.req('DELETE', '/api/push/subscribe', { json: {} });
    assert.deepEqual(delAll.json, { ok: true, removed: 9 });
  });

  test('web push delivery: VAPID-signed, encrypted, and carries no job details', async () => {
    const c = t.client();
    const u = await c.devLogin('push-deliver@example.com');
    const b = browserSubscription(ENDPOINT(50));
    await c.post('/api/push/subscribe', { subscription: b.json });
    calls.length = 0;
    const out = await t.ctx.push.notifyUser(u.id, 3);
    assert.deepEqual(out, { sent: 1, failed: 0, removed: 0, skipped: 0 });
    const [call] = calls;
    assert.equal(call.url, ENDPOINT(50));
    assert.equal(call.method, 'POST');
    assert.equal(call.redirect, 'manual');
    assert.match(call.headers.Authorization, /^vapid t=[\w-]+\.[\w-]+\.[\w-]+, k=[\w-]+$/);
    assert.equal(call.headers['Content-Encoding'], 'aes128gcm');
    assert.equal(call.headers.Urgency, 'normal');
    assert.equal(call.headers.Topic, 'new-matches');
    const payload = b.decrypt(call.body);
    assert.deepEqual(payload, { title: 'ApplyPilot', body: '3 new matches — open ApplyPilot', tag: 'ap-new-matches', url: '/', count: 3 });
    assert.equal(notificationBody(1), '1 new match — open ApplyPilot');
    // The test endpoint: same content-free shape.
    calls.length = 0;
    const test2 = await c.post('/api/push/test', {});
    assert.equal(test2.json.sent, 1);
    assert.doesNotMatch(JSON.stringify(b.decrypt(calls[0].body)), /engineer|acme|@example/i);
  });

  test('gone subscriptions (404/410) are deleted; failures are counted, not logged with endpoints', async () => {
    const c = t.client();
    const u = await c.devLogin('push-gone@example.com');
    await c.post('/api/push/subscribe', { subscription: browserSubscription(ENDPOINT(60)).json });
    await c.post('/api/push/subscribe', { subscription: browserSubscription(ENDPOINT(61)).json });
    respond = (url) => new Response(null, { status: url.endsWith('60') ? 410 : 500 });
    const lines = [];
    const orig = console.warn;
    t.config.log = true;
    console.warn = (...a) => lines.push(a.join(' '));
    try {
      assert.deepEqual(await t.ctx.push.notifyUser(u.id, 1), { sent: 0, failed: 1, removed: 1, skipped: 0 });
    } finally { console.warn = orig; t.config.log = false; respond = () => new Response(null, { status: 201 }); }
    assert.doesNotMatch(lines.join('\n'), /fcm\.googleapis|test-endpoint/);
    assert.equal(t.ctx.repo.q.pushCount.get(u.id).n, 1);
  });

  test('push targets die with their session/device', async () => {
    const web = t.client();
    const u = await web.devLogin('push-owner@example.com');
    await web.post('/api/push/subscribe', { subscription: browserSubscription(ENDPOINT(70)).json });
    const phone = (await new Client(t.url, { origin: null }).post('/api/auth/dev', { email: 'push-owner@example.com', client: 'native', platform: 'android' })).json;
    const app = new Client(t.url, { origin: null }); app.bearer = phone.token;
    assert.equal((await app.post('/api/push/native', { platform: 'android', token: 'fcm-token-' + 'a'.repeat(140) })).status, 200);
    assert.equal(t.ctx.repo.q.pushCount.get(u.id).n, 2);
    await web.del(`/api/devices/${phone.session.id}`); // revoke the phone
    assert.equal(t.ctx.repo.q.pushCount.get(u.id).n, 1);
    await web.post('/api/auth/logout', {});
    assert.equal(t.ctx.repo.q.pushCount.get(u.id).n, 0);
    // Orphans (session expired) are purged.
    const w2 = t.client(); await w2.devLogin('push-owner@example.com');
    await w2.post('/api/push/subscribe', { subscription: browserSubscription(ENDPOINT(71)).json });
    t.ctx.repo.raw.prepare('UPDATE sessions SET expires_at = 0 WHERE user_id = ?').run(u.id);
    t.ctx.repo.purgeExpired(Date.now(), t.config.limits);
    assert.equal(t.ctx.repo.q.pushCount.get(u.id).n, 0);
  });

  test('native tokens: validation; unconfigured providers are skipped gracefully', async () => {
    const c = t.client();
    const u = await c.devLogin('push-native@example.com');
    for (const bad of [{}, { platform: 'windows', token: 'x'.repeat(40) }, { platform: 'android', token: 'short' }, { platform: 'ios', token: 'zz'.repeat(32) },
      { platform: 'ios', token: 'a'.repeat(64), provider: 'mqtt' }, { platform: 'android', token: 'bad token with spaces and more chars' }]) {
      assert.equal((await c.post('/api/push/native', bad)).status, 400, JSON.stringify(bad));
    }
    const a = await c.post('/api/push/native', { platform: 'android', token: 'dGVzdA:APA91b' + 'x'.repeat(140) });
    assert.deepEqual(Object.keys(a.json).sort(), ['configured', 'id', 'provider']);
    assert.equal(a.json.provider, 'fcm');
    assert.equal(a.json.configured, false);
    const i = await c.post('/api/push/native', { platform: 'ios', token: 'AB'.repeat(32) });
    assert.equal(i.json.provider, 'apns');
    assert.equal((await c.post('/api/push/native', { platform: 'ios', token: 'ab'.repeat(32) })).json.id, i.json.id, 'case-insensitive de-dup');
    assert.deepEqual(await t.ctx.push.notifyUser(u.id, 2), { sent: 0, failed: 0, removed: 0, skipped: 2 });
    assert.deepEqual((await c.req('DELETE', '/api/push/native', { json: { token: 'AB'.repeat(32) } })).json, { ok: true, removed: 1 });
    const ex = await c.get('/api/account/export');
    assert.deepEqual(ex.json.push.map((p) => p.type), ['fcm']);
    assert.ok(!JSON.stringify(ex.json).includes('APA91b'), 'export never echoes device tokens');
  });
});

describe('push: FCM HTTP v1 and APNs', () => {
  let t; let h2; let apnsOrigin; const fcmCalls = []; const apnsReqs = [];
  const { privateKey, publicKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const APNS_OK = 'ab'.repeat(32);
  const APNS_GONE = 'cd'.repeat(32);

  before(async () => {
    h2 = http2.createServer();
    h2.on('stream', (stream, headers) => {
      let body = '';
      stream.setEncoding('utf8');
      stream.on('data', (c) => { body += c; });
      stream.on('end', () => {
        apnsReqs.push({ headers, body });
        const gone = headers[':path'].endsWith(APNS_GONE);
        stream.respond({ ':status': gone ? 410 : 200, 'content-type': 'application/json' });
        stream.end(gone ? JSON.stringify({ reason: 'Unregistered' }) : '');
      });
    });
    await new Promise((r) => h2.listen(0, r));
    apnsOrigin = `http://localhost:${h2.address().port}`;
    t = await startTestServer({
      env: {
        FCM_SERVICE_ACCOUNT: JSON.stringify({ client_email: 'push@proj-1.iam.gserviceaccount.com', private_key: '-----BEGIN PRIVATE KEY-----\nAA\n-----END PRIVATE KEY-----\n', project_id: 'proj-1' }),
        APNS_KEY_ID: 'KEYID12345', APNS_TEAM_ID: 'TEAMID1234', APNS_BUNDLE_ID: 'app.applypilot.test',
        APNS_PRIVATE_KEY: privateKey.export({ type: 'pkcs8', format: 'pem' }).replace(/\n/g, '\\n'),
      },
      deps: {
        pushDeps: {
          apnsOrigin,
          fcmTokenProvider: async () => 'fake-access-token',
          fcmBaseUrl: 'https://fcm.test',
          fetch: fakeFetch(fcmCalls, (url, opts) => (JSON.parse(opts.body).message.token.startsWith('gone')
            ? new Response(JSON.stringify({ error: { status: 'NOT_FOUND', details: [{ errorCode: 'UNREGISTERED' }] } }), { status: 404 })
            : new Response('{"name":"projects/proj-1/messages/1"}', { status: 200 }))),
        },
      },
    });
  });
  after(async () => { await t.stop(); await new Promise((r) => h2.close(r)); });

  test('config reports both native channels', async () => {
    assert.deepEqual((await t.client().get('/api/push/config')).json.native, { fcm: true, apns: true });
  });

  test('FCM: HTTP v1 request, notification has no job details, unregistered tokens removed', async () => {
    const c = t.client();
    const u = await c.devLogin('fcm@example.com');
    await c.post('/api/push/native', { platform: 'android', token: 'okToken:' + 'x'.repeat(100) });
    await c.post('/api/push/native', { platform: 'android', token: 'goneToken:' + 'x'.repeat(100) });
    const out = await t.ctx.push.notifyUser(u.id, 4);
    assert.deepEqual(out, { sent: 1, failed: 0, removed: 1, skipped: 0 });
    const ok = fcmCalls.find((x) => JSON.parse(x.body).message.token.startsWith('ok'));
    assert.equal(ok.url, 'https://fcm.test/v1/projects/proj-1/messages:send');
    assert.equal(ok.headers.authorization, 'Bearer fake-access-token');
    const msg = JSON.parse(ok.body).message;
    assert.deepEqual(msg.notification, { title: 'ApplyPilot', body: '4 new matches — open ApplyPilot' });
    assert.deepEqual(msg.data, { type: 'new-matches', count: '4' });
    assert.equal(t.ctx.repo.q.pushCount.get(u.id).n, 1);
  });

  test('APNs: ES256 provider token, topic and content-free alert over HTTP/2; 410 removes the token', async () => {
    const c = t.client();
    const u = await c.devLogin('apns@example.com');
    await c.post('/api/push/native', { platform: 'ios', token: APNS_OK });
    await c.post('/api/push/native', { platform: 'ios', token: APNS_GONE });
    const out = await t.ctx.push.notifyUser(u.id, 2);
    assert.deepEqual(out, { sent: 1, failed: 0, removed: 1, skipped: 0 });
    const req = apnsReqs.find((r) => r.headers[':path'] === `/3/device/${APNS_OK}`);
    assert.equal(req.headers[':method'], 'POST');
    assert.equal(req.headers['apns-topic'], 'app.applypilot.test');
    assert.equal(req.headers['apns-push-type'], 'alert');
    const [h, p, s] = req.headers.authorization.replace(/^bearer /, '').split('.');
    assert.deepEqual(JSON.parse(Buffer.from(h, 'base64url')), { alg: 'ES256', kid: 'KEYID12345' });
    assert.equal(JSON.parse(Buffer.from(p, 'base64url')).iss, 'TEAMID1234');
    assert.ok(crypto.verify('sha256', Buffer.from(`${h}.${p}`), { key: publicKey, dsaEncoding: 'ieee-p1363' }, Buffer.from(s, 'base64url')), 'valid ES256 signature');
    const body = JSON.parse(req.body);
    assert.deepEqual(body.aps.alert, { title: 'ApplyPilot', body: '2 new matches — open ApplyPilot' });
    assert.equal(t.ctx.repo.q.pushCount.get(u.id).n, 1);
  });

  test('bad APNs / FCM env is refused at startup without echoing secrets', () => {
    assert.throws(() => loadConfig({ APNS_KEY_ID: 'short', APNS_TEAM_ID: 'TEAMID1234', APNS_BUNDLE_ID: 'a.b', APNS_PRIVATE_KEY: '-----BEGIN PRIVATE KEY-----\\nx' }), /APNS_KEY_ID/);
    let err;
    try { loadConfig({ FCM_SERVICE_ACCOUNT: '{"private_key":"SECRET-MATERIAL", oops' }); } catch (e) { err = e; }
    assert.ok(err);
    assert.doesNotMatch(err.message, /SECRET-MATERIAL/);
  });
});
