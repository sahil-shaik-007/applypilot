// Offline license keys: "AP1.<base64url payload>.<base64url ed25519 signature>".
// Keys are minted with scripts/license-tool.js using the private key that never ships with the app.
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const PLANS = {
  // Safety features (review queue, duplicate guard, blacklist, limits) are never paywalled.
  free: { label: 'Free', campaigns: 1, resumes: 2, dailyApplies: 10, parallelBrowsers: 1, aiPerDay: 5, autoSubmit: false, analytics: false },
  trial: { label: 'Pro trial', campaigns: 10, resumes: 50, dailyApplies: 120, parallelBrowsers: 6, aiPerDay: 1000, autoSubmit: true, analytics: true },
  pro: { label: 'Pro', campaigns: 10, resumes: 50, dailyApplies: 120, parallelBrowsers: 6, aiPerDay: 1000, autoSubmit: true, analytics: true },
  sprint: { label: 'Sprint Pass', campaigns: 10, resumes: 50, dailyApplies: 120, parallelBrowsers: 6, aiPerDay: 1000, autoSubmit: true, analytics: true },
  lifetime: { label: 'Lifetime', campaigns: 10, resumes: 100, dailyApplies: 150, parallelBrowsers: 10, aiPerDay: 1000, autoSubmit: true, analytics: true },
};
const TRIAL_DAYS = 7;

function publicKey() {
  const p = path.join(__dirname, 'license-public.pem');
  return fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : null;
}

function b64u(buf) { return Buffer.from(buf).toString('base64url'); }

function verifyKey(key) {
  if (!key || typeof key !== 'string') return { valid: false, error: 'No key' };
  const parts = key.trim().split('.');
  if (parts.length !== 3 || parts[0] !== 'AP1') return { valid: false, error: 'Malformed license key' };
  const pub = publicKey();
  if (!pub) return { valid: false, error: 'This build has no license public key' };
  const ok = crypto.verify(null, Buffer.from(`${parts[0]}.${parts[1]}`), pub, Buffer.from(parts[2], 'base64url'));
  if (!ok) return { valid: false, error: 'Invalid license key' };
  let payload;
  try { payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8')); } catch { return { valid: false, error: 'Corrupt license key' }; }
  if (payload.exp && new Date(payload.exp) < new Date()) return { valid: false, error: `License expired on ${payload.exp.slice(0, 10)}`, payload };
  return { valid: true, payload };
}

function signKey(privateKeyPem, payload) {
  const body = `AP1.${b64u(JSON.stringify(payload))}`;
  const sig = crypto.sign(null, Buffer.from(body), privateKeyPem);
  return `${body}.${b64u(sig)}`;
}

// ---- Online keys sold through Dodo Payments (public license endpoints, no secret needed) ----
const DODO_BASE = process.env.APPLYPILOT_DODO_BASE || 'https://live.dodopayments.com';
const OFFLINE_GRACE_DAYS = 14;

function planFromProductName(name = '') {
  if (/lifetime/i.test(name)) return 'lifetime';
  if (/sprint|90/i.test(name)) return 'sprint';
  return 'pro';
}

async function dodo(pathname, body) {
  const res = await fetch(`${DODO_BASE}${pathname}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(20000),
  });
  let json = null;
  try { json = await res.json(); } catch {}
  return { status: res.status, ok: res.ok, json };
}

// Activates either kind of key and returns the record to persist in the license collection.
async function activate(key, deviceName) {
  key = (key || '').trim();
  if (key.startsWith('AP1.')) {
    const v = verifyKey(key);
    if (!v.valid) throw new Error(v.error);
    return { key, provider: 'offline' };
  }
  const r = await dodo('/licenses/activate', { license_key: key, name: deviceName || 'ApplyPilot device' });
  if (r.status === 404) throw new Error('License key not found.');
  if (r.status === 403) throw new Error('This license key is not active (expired, refunded or disabled).');
  if (r.status === 422) throw new Error('Device limit reached for this key. Deactivate it on another PC or contact support.');
  if (!r.ok || !r.json) throw new Error(`Could not activate (HTTP ${r.status}). Check your internet connection.`);
  return {
    key,
    provider: 'dodo',
    instanceId: r.json.id,
    plan: planFromProductName(r.json.product && r.json.product.name),
    email: r.json.customer && r.json.customer.email,
    lastValidatedAt: new Date().toISOString(),
  };
}

// Re-checks an online key; returns patch for the license record. Network failures keep the grace window.
async function revalidate(lic) {
  if (lic.provider !== 'dodo' || !lic.key) return {};
  try {
    const r = await dodo('/licenses/validate', { license_key: lic.key, license_key_instance_id: lic.instanceId });
    if (r.ok && r.json) return r.json.valid ? { lastValidatedAt: new Date().toISOString(), revoked: false } : { revoked: true };
  } catch {}
  return {};
}

// Resolves the current plan from the license collection { key, provider, trialStartedAt, ... }.
function currentPlan(licenseData) {
  if (licenseData.provider === 'dodo' && licenseData.key && !licenseData.revoked) {
    const age = (Date.now() - new Date(licenseData.lastValidatedAt || 0).getTime()) / 86400000;
    if (age <= OFFLINE_GRACE_DAYS) {
      const plan = PLANS[licenseData.plan] ? licenseData.plan : 'pro';
      return { plan, ...PLANS[plan], email: licenseData.email, licensed: true };
    }
  }
  const v = verifyKey(licenseData.key);
  if (v.valid) {
    const plan = PLANS[v.payload.plan] ? v.payload.plan : 'pro';
    return { plan, ...PLANS[plan], email: v.payload.email, expires: v.payload.exp || null, licensed: true };
  }
  if (licenseData.trialStartedAt) {
    const left = TRIAL_DAYS - (Date.now() - new Date(licenseData.trialStartedAt).getTime()) / 86400000;
    if (left > 0) return { plan: 'trial', ...PLANS.trial, trialDaysLeft: Math.ceil(left), licensed: false };
  }
  return { plan: 'free', ...PLANS.free, licensed: false, keyError: licenseData.key ? v.error : null, trialUsed: !!licenseData.trialStartedAt };
}

module.exports = { PLANS, TRIAL_DAYS, verifyKey, signKey, currentPlan, activate, revalidate };
