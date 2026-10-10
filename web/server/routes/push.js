// Push registration: Web Push subscriptions (PWA) and native FCM / APNs device tokens. Notifications carry
// no content (see push.js). Every target is tied to the session/device that registered it and is removed
// when that credential is revoked, on sign-out everywhere and on account deletion.
import { Router } from 'express';
import { HttpError, isPlainObject, randomId, sha256 } from '../util.js';
import { requireAuth, ownerIdOf } from '../security.js';
import { validEndpoint } from '../push.js';

const B64U = /^[A-Za-z0-9_-]+={0,2}$/;
const b64uLen = (s) => (typeof s === 'string' && s.length <= 200 && B64U.test(s) ? Buffer.from(s, 'base64url').length : -1);
const FCM_TOKEN_RE = /^[A-Za-z0-9_:-]{20,4096}$/;
const APNS_TOKEN_RE = /^[0-9a-fA-F]{64,200}$/;

export function pushRoutes(ctx) {
  const { repo, config, limiters, push } = ctx;
  const r = Router();
  const any = requireAuth(ctx, 'any');

  const assertRoom = (uid, type, hash) => {
    const existing = repo.q.pushByTarget.get(type, hash);
    if (existing && existing.user_id === uid) return;
    if (repo.q.pushCount.get(uid).n >= config.limits.pushMaxPerUser) throw new HttpError(409, `At most ${config.limits.pushMaxPerUser} notification targets per account`);
  };
  const store = (req, type, target, keys) => {
    const uid = req.auth.user.id;
    const hash = sha256(target);
    return repo.tx(() => {
      assertRoom(uid, type, hash);
      const existing = repo.q.pushByTarget.get(type, hash);
      const id = existing ? existing.id : randomId();
      // A target belongs to whoever registered it last (a browser/phone shared by two accounts moves over).
      repo.q.upsertPush.run(id, uid, ownerIdOf(req.auth), type, hash, target, keys ? JSON.stringify(keys) : null, Date.now());
      return id;
    });
  };

  // Public: what the client needs to subscribe. The VAPID public key is public by design.
  r.get('/push/config', (req, res) => {
    res.json({
      webPush: push ? { publicKey: push.publicKey } : null,
      native: { fcm: !!push?.channels.fcm, apns: !!push?.channels.apns },
    });
  });

  r.post('/push/subscribe', any, limiters.push, (req, res) => {
    const sub = isPlainObject(req.body) ? req.body.subscription : undefined;
    if (!isPlainObject(sub) || !isPlainObject(sub.keys)) throw new HttpError(400, 'Body must be { subscription: PushSubscription.toJSON() }');
    if (!validEndpoint(sub.endpoint, config.push.hosts)) throw new HttpError(400, 'Unsupported push endpoint');
    // p256dh: uncompressed P-256 public key (65 bytes); auth: 16-byte secret (RFC 8291).
    if (b64uLen(sub.keys.p256dh) !== 65 || Buffer.from(sub.keys.p256dh, 'base64url')[0] !== 4) throw new HttpError(400, 'Invalid subscription keys');
    if (b64uLen(sub.keys.auth) !== 16) throw new HttpError(400, 'Invalid subscription keys');
    const id = store(req, 'webpush', sub.endpoint, { p256dh: sub.keys.p256dh, auth: sub.keys.auth });
    res.json({ id });
  });

  r.delete('/push/subscribe', any, limiters.push, (req, res) => {
    const uid = req.auth.user.id;
    const endpoint = isPlainObject(req.body) ? req.body.endpoint : undefined;
    let removed;
    if (endpoint === undefined) {
      // No endpoint: remove every Web Push subscription this session/device registered.
      removed = repo.raw.prepare("DELETE FROM push_targets WHERE user_id = ? AND owner_id = ? AND type = 'webpush'").run(uid, ownerIdOf(req.auth)).changes;
    } else {
      if (typeof endpoint !== 'string' || endpoint.length > 1024) throw new HttpError(400, 'Invalid endpoint');
      removed = repo.q.deletePushTarget.run(uid, 'webpush', sha256(endpoint)).changes;
    }
    res.json({ ok: true, removed: Number(removed) });
  });

  r.post('/push/native', any, limiters.push, (req, res) => {
    const body = isPlainObject(req.body) ? req.body : {};
    const { platform, token } = body;
    if (platform !== 'android' && platform !== 'ios') throw new HttpError(400, "platform must be 'android' or 'ios'");
    let provider = body.provider ?? (platform === 'android' ? 'fcm' : 'apns');
    if (provider !== 'fcm' && provider !== 'apns') throw new HttpError(400, "provider must be 'fcm' or 'apns'");
    if (platform === 'android') provider = 'fcm';
    const ok = provider === 'fcm' ? FCM_TOKEN_RE.test(token || '') : APNS_TOKEN_RE.test(token || '');
    if (typeof token !== 'string' || !ok) throw new HttpError(400, 'Invalid device token');
    const target = provider === 'apns' ? token.toLowerCase() : token;
    const id = store(req, provider, target, null);
    res.json({ id, provider, configured: !!push?.channels[provider] });
  });

  r.delete('/push/native', any, limiters.push, (req, res) => {
    const token = isPlainObject(req.body) ? req.body.token : undefined;
    if (typeof token !== 'string' || token.length > 4096) throw new HttpError(400, 'Body must be { token }');
    const uid = req.auth.user.id;
    const removed = Number(repo.q.deletePushTarget.run(uid, 'fcm', sha256(token)).changes)
      + Number(repo.q.deletePushTarget.run(uid, 'apns', sha256(token.toLowerCase())).changes);
    res.json({ ok: true, removed });
  });

  // Sends a content-free test notification to all of the caller's targets.
  r.post('/push/test', any, limiters.push, async (req, res) => {
    if (!push) throw new HttpError(503, 'Push is not available on this server');
    res.json(await push.notifyUser(req.auth.user.id, 0, { test: true }));
  });

  return r;
}
