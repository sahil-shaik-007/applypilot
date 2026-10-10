// Push notifications that carry no content: "N new matches — open ApplyPilot". Never a job title,
// company, query or any user data.
//   - Web Push (PWA): VAPID via the `web-push` package (payload is also end-to-end encrypted to the browser).
//     Keys come from VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY, or are generated once into <data dir>/vapid.json.
//   - Android (and iOS via Firebase): FCM HTTP v1, only when FCM_SERVICE_ACCOUNT is configured.
//   - iOS: APNs token auth (.p8, HTTP/2), only when APNS_* is configured.
// Unconfigured channels are skipped gracefully. Dead targets (404/410/unregistered) are deleted.
import fs from 'node:fs';
import path from 'node:path';
import http2 from 'node:http2';
import crypto from 'node:crypto';
import webpush from 'web-push';
import { JWT } from 'google-auth-library';
import { b64u } from './util.js';

export const NOTIFICATION_TITLE = 'ApplyPilot';
export const notificationBody = (n) => `${n} new ${n === 1 ? 'match' : 'matches'} — open ApplyPilot`;

/** Host allow-list match: exact host, or "*.suffix" for any subdomain of suffix. */
export function hostAllowed(host, patterns) {
  const h = String(host || '').toLowerCase();
  return patterns.some((p) => {
    const pat = p.toLowerCase();
    return pat.startsWith('*.') ? h.endsWith(pat.slice(1)) && h.length > pat.length - 1 : h === pat;
  });
}

/** Validates a Web Push endpoint URL: https, default port, allow-listed push service host (SSRF guard). */
export function validEndpoint(endpoint, patterns) {
  if (typeof endpoint !== 'string' || endpoint.length > 1024) return false;
  let u;
  try { u = new URL(endpoint); } catch { return false; }
  if (u.protocol !== 'https:' || u.port || u.username || u.password) return false;
  return hostAllowed(u.hostname, patterns);
}

/** Loads VAPID keys from config or <data dir>/vapid.json, generating the file (0600) on first start. */
export function loadVapid(config) {
  if (config.push.vapid) return config.push.vapid;
  const file = path.join(path.dirname(config.databasePath), 'vapid.json');
  try {
    const k = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (k.publicKey && k.privateKey) return { publicKey: k.publicKey, privateKey: k.privateKey };
  } catch { /* not there yet */ }
  const keys = webpush.generateVAPIDKeys();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  try {
    fs.writeFileSync(file, JSON.stringify({ publicKey: keys.publicKey, privateKey: keys.privateKey, createdAt: new Date().toISOString() }), { mode: 0o600, flag: 'wx' });
    return keys;
  } catch {
    const k = JSON.parse(fs.readFileSync(file, 'utf8')); // another process won the race
    return { publicKey: k.publicKey, privateKey: k.privateKey };
  }
}

function vapidSubject(config) {
  if (config.push.subject) return config.push.subject;
  if (config.appOrigin.startsWith('https://')) return config.appOrigin;
  return 'mailto:push@localhost.invalid'; // dev only; set VAPID_SUBJECT in production
}

/** APNs provider token (ES256 JWT), cached for 50 minutes (Apple requires refresh between 20 and 60 min). */
export function apnsJwt(apns, now = Date.now()) {
  const header = b64u(JSON.stringify({ alg: 'ES256', kid: apns.keyId }));
  const claims = b64u(JSON.stringify({ iss: apns.teamId, iat: Math.floor(now / 1000) }));
  const sig = crypto.sign('sha256', Buffer.from(`${header}.${claims}`), { key: apns.privateKey, dsaEncoding: 'ieee-p1363' });
  return `${header}.${claims}.${b64u(sig)}`;
}

/**
 * @param {object} ctx  { config, repo }
 * @param {object} [deps]  { fetch, fcmTokenProvider, fcmBaseUrl, apnsOrigin } (tests)
 */
export function createPush(ctx, deps = {}) {
  const { config, repo } = ctx;
  const doFetch = deps.fetch || globalThis.fetch;
  const timeoutMs = config.limits.pushTimeoutMs;
  const vapid = loadVapid(config);
  const vapidDetails = { subject: vapidSubject(config), publicKey: vapid.publicKey, privateKey: vapid.privateKey };
  const fcm = config.push.fcm;
  const apns = config.push.apns;
  const fcmBase = deps.fcmBaseUrl || 'https://fcm.googleapis.com';
  const apnsOrigin = deps.apnsOrigin || (apns?.production ? 'https://api.push.apple.com' : 'https://api.sandbox.push.apple.com');

  let fcmToken = null;
  const fcmTokenProvider = deps.fcmTokenProvider || (fcm ? async () => {
    if (fcmToken && fcmToken.expires > Date.now() + 60000) return fcmToken.value;
    const client = new JWT({ email: fcm.serviceAccount.client_email, key: fcm.serviceAccount.private_key, scopes: ['https://www.googleapis.com/auth/firebase.messaging'] });
    const t = await client.authorize();
    fcmToken = { value: t.access_token, expires: t.expiry_date || Date.now() + 50 * 60000 };
    return fcmToken.value;
  } : null);

  let apnsToken = null;
  const apnsAuth = () => {
    if (!apnsToken || apnsToken.at < Date.now() - 50 * 60000) apnsToken = { value: apnsJwt(apns), at: Date.now() };
    return apnsToken.value;
  };

  const channels = { webpush: true, fcm: !!(fcm && fcmTokenProvider), apns: !!apns };

  async function sendWebPush(target, message) {
    if (!validEndpoint(target.target, config.push.hosts)) return 'gone'; // re-checked at send time (SSRF guard)
    const keys = JSON.parse(target.keys || '{}');
    const details = webpush.generateRequestDetails(
      { endpoint: target.target, keys },
      JSON.stringify({ title: message.title, body: message.body, tag: 'ap-new-matches', url: '/', count: message.count }),
      { vapidDetails, TTL: 6 * 3600, urgency: 'normal', topic: 'new-matches' },
    );
    const res = await doFetch(details.endpoint, { method: details.method, headers: details.headers, body: details.body, redirect: 'manual', signal: AbortSignal.timeout(timeoutMs) });
    if (res.status === 404 || res.status === 410) return 'gone';
    return res.status >= 200 && res.status < 300 ? 'ok' : 'error';
  }

  async function sendFcm(target, message) {
    const accessToken = await fcmTokenProvider();
    const res = await doFetch(`${fcmBase}/v1/projects/${encodeURIComponent(fcm.projectId)}/messages:send`, {
      method: 'POST',
      headers: { authorization: `Bearer ${accessToken}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        message: {
          token: target.target,
          notification: { title: message.title, body: message.body },
          data: { type: 'new-matches', count: String(message.count) },
          android: { priority: 'NORMAL', collapse_key: 'new-matches', ttl: '21600s', notification: { tag: 'new-matches' } },
          apns: { headers: { 'apns-collapse-id': 'new-matches', 'apns-priority': '5' } },
        },
      }),
      redirect: 'manual',
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (res.ok) return 'ok';
    let status = '';
    try { status = JSON.stringify((await res.json()).error || ''); } catch { /* ignore */ }
    if (res.status === 404 || /UNREGISTERED|registration-token-not-registered/.test(status)) return 'gone';
    if (res.status === 400 && /INVALID_ARGUMENT/.test(status) && /token/i.test(status)) return 'gone';
    return 'error';
  }

  function sendApns(target, message) {
    return new Promise((resolve) => {
      let done = false;
      const finish = (v) => { if (!done) { done = true; try { session.close(); } catch { /* ignore */ } resolve(v); } };
      const session = http2.connect(apnsOrigin);
      session.setTimeout(timeoutMs, () => { session.destroy(); finish('error'); });
      session.on('error', () => finish('error'));
      const body = JSON.stringify({ aps: { alert: { title: message.title, body: message.body }, sound: 'default', 'thread-id': 'new-matches' }, type: 'new-matches', count: message.count });
      const req = session.request({
        ':method': 'POST',
        ':path': `/3/device/${target.target}`,
        authorization: `bearer ${apnsAuth()}`,
        'apns-topic': apns.bundleId,
        'apns-push-type': 'alert',
        'apns-priority': '5',
        'apns-collapse-id': 'new-matches',
        'apns-expiration': String(Math.floor(Date.now() / 1000) + 6 * 3600),
        'content-type': 'application/json',
      });
      let status = 0;
      let data = '';
      req.on('response', (h) => { status = Number(h[':status']); });
      req.setEncoding('utf8');
      req.on('data', (c) => { if (data.length < 4096) data += c; });
      req.on('end', () => {
        if (status === 200) return finish('ok');
        let reason = '';
        try { reason = JSON.parse(data).reason || ''; } catch { /* ignore */ }
        if (status === 410 || (status === 400 && /BadDeviceToken|DeviceTokenNotForTopic/.test(reason))) return finish('gone');
        return finish('error');
      });
      req.on('error', () => finish('error'));
      req.end(body);
    });
  }

  async function sendTo(target, message) {
    try {
      if (target.type === 'webpush') return await sendWebPush(target, message);
      if (target.type === 'fcm') return channels.fcm ? await sendFcm(target, message) : 'skipped';
      if (target.type === 'apns') return channels.apns ? await sendApns(target, message) : 'skipped';
      return 'skipped';
    } catch {
      return 'error'; // logged as a count only; never the endpoint or token
    }
  }

  /** Sends a content-free notification to every push target of a user. Returns counts. */
  async function notifyUser(userId, count, { test = false } = {}) {
    const message = test
      ? { title: NOTIFICATION_TITLE, body: 'Notifications are working — open ApplyPilot', count: 0 }
      : { title: NOTIFICATION_TITLE, body: notificationBody(count), count };
    const out = { sent: 0, failed: 0, removed: 0, skipped: 0 };
    const targets = repo.q.pushForUser.all(userId);
    await Promise.all(targets.map(async (t) => {
      const r = await sendTo(t, message);
      if (r === 'ok') { out.sent++; repo.q.pushOk.run(Date.now(), t.id); } else if (r === 'gone') { out.removed++; repo.q.deletePushId.run(t.id); } else if (r === 'skipped') out.skipped++;
      else out.failed++;
    }));
    if (out.failed && config.log) console.warn(`[push] ${out.failed} delivery failure(s)`);
    return out;
  }

  return { publicKey: vapid.publicKey, channels, notifyUser };
}
