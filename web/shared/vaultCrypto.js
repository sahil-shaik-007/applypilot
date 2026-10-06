// ApplyPilot zero-knowledge vault crypto (format v1).
//
// Runs unchanged in browsers and Node 20+ (WebCrypto via globalThis.crypto.subtle). Used by the
// web PWA, the sync server's tests, and the desktop app. The server never sees passphrases,
// recovery keys or the data-encryption key (DEK); it only stores the outputs of this module.
//
//  passphrase ──PBKDF2-SHA256 (600k, 16B salt)──► KEK ──AES-256-GCM wrap──► wrapped DEK  ┐
//  recovery key ──HKDF-SHA256 (16B salt)────────► RKEK ─AES-256-GCM wrap──► wrapped DEK  ├─ vault (stored server-side)
//  DEK (random AES-256-GCM, kept in memory as a non-extractable CryptoKey)              ┘
//  record = AES-256-GCM(DEK, 12B random IV, plaintext, AAD = "ap:v1:<userId>:<collection>:<id>")
//
// AAD binds every ciphertext to its owner and location, so a malicious server cannot swap
// records between users, collections or ids without decryption failing.

const subtle = globalThis.crypto.subtle;
const getRandom = (n) => globalThis.crypto.getRandomValues(new Uint8Array(n));
const te = new TextEncoder();
const td = new TextDecoder();

export const FORMAT_VERSION = 1;
export const DEFAULT_ITERATIONS = 600000; // OWASP 2023 guidance for PBKDF2-HMAC-SHA256
const MIN_ITERATIONS = 100000;

// ---------------------------------------------------------------- encoding helpers
export function toB64u(bytes) {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let s = '';
  for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
export function fromB64u(str) {
  const s = String(str).replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(s + '==='.slice((s.length + 3) % 4));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
function toBase32(bytes) {
  let bits = 0; let value = 0; let out = '';
  for (const b of bytes) {
    value = (value << 8) | b; bits += 8;
    while (bits >= 5) { out += CROCKFORD[(value >>> (bits - 5)) & 31]; bits -= 5; }
  }
  if (bits > 0) out += CROCKFORD[(value << (5 - bits)) & 31];
  return out;
}
function fromBase32(str) {
  const clean = normalizeRecoveryKey(str);
  let bits = 0; let value = 0; const out = [];
  for (const ch of clean) {
    const v = CROCKFORD.indexOf(ch);
    if (v < 0) throw new Error('Invalid recovery key');
    value = (value << 5) | v; bits += 5;
    if (bits >= 8) { out.push((value >>> (bits - 8)) & 255); bits -= 8; }
  }
  return new Uint8Array(out);
}
/** Uppercases, strips separators and maps look-alike characters (O→0, I/L→1). */
export function normalizeRecoveryKey(str) {
  return String(str || '').toUpperCase().replace(/[\s-]/g, '').replace(/O/g, '0').replace(/[IL]/g, '1').replace(/U/g, 'V');
}
function formatRecoveryKey(bytes) {
  return toBase32(bytes).match(/.{1,4}/g).join('-');
}

export function aadFor(userId, collection, id) {
  if (!userId || !collection || !id) throw new Error('aadFor needs userId, collection and id');
  return `ap:v1:${userId}:${collection}:${id}`;
}

// ---------------------------------------------------------------- key derivation
async function deriveKek(passphrase, salt, iterations) {
  if (typeof passphrase !== 'string' || passphrase.length < 1) throw new Error('Passphrase required');
  const base = await subtle.importKey('raw', te.encode(passphrase.normalize('NFKC')), 'PBKDF2', false, ['deriveKey']);
  return subtle.deriveKey({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}
async function deriveRecoveryKek(recoveryBytes, salt) {
  const base = await subtle.importKey('raw', recoveryBytes, 'HKDF', false, ['deriveKey']);
  return subtle.deriveKey({ name: 'HKDF', hash: 'SHA-256', salt, info: te.encode('applypilot-vault-recovery-v1') }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}

async function wrapRaw(kek, rawDek, label) {
  const iv = getRandom(12);
  const ct = await subtle.encrypt({ name: 'AES-GCM', iv, additionalData: te.encode(label) }, kek, rawDek);
  return { iv: toB64u(iv), ct: toB64u(ct) };
}
async function unwrapRaw(kek, wrapped, label) {
  const raw = await subtle.decrypt({ name: 'AES-GCM', iv: fromB64u(wrapped.iv), additionalData: te.encode(label) }, kek, fromB64u(wrapped.ct));
  return new Uint8Array(raw);
}
/** Turns raw DEK bytes into a CryptoKey (non-extractable unless asked) and wipes the bytes. */
export async function importDek(rawDek, { extractable = false, wipe = true } = {}) {
  const key = await subtle.importKey('raw', rawDek, { name: 'AES-GCM', length: 256 }, extractable, ['encrypt', 'decrypt']);
  if (wipe && rawDek.fill) rawDek.fill(0);
  return key;
}

// ---------------------------------------------------------------- vault lifecycle
/**
 * Creates a new vault. Returns the public vault document (safe to upload), the DEK as a CryptoKey,
 * and a recovery key the user must write down (shown once, never stored anywhere).
 */
export async function createVault(passphrase, { iterations = DEFAULT_ITERATIONS, extractable = false } = {}) {
  assertPassphraseStrength(passphrase);
  if (iterations < MIN_ITERATIONS && !globalThis.__AP_TEST__) throw new Error('Iteration count too low');
  const rawDek = getRandom(32);
  const salt = getRandom(16);
  const kek = await deriveKek(passphrase, salt, iterations);
  const recoveryBytes = getRandom(20); // 160-bit recovery key
  const rSalt = getRandom(16);
  const rkek = await deriveRecoveryKek(recoveryBytes, rSalt);
  const vault = {
    v: FORMAT_VERSION,
    kdf: { alg: 'PBKDF2-SHA256', iterations, salt: toB64u(salt) },
    wrapped: await wrapRaw(kek, rawDek, 'ap:v1:dek:passphrase'),
    recovery: { alg: 'HKDF-SHA256', salt: toB64u(rSalt), wrapped: await wrapRaw(rkek, rawDek, 'ap:v1:dek:recovery') },
    createdAt: new Date().toISOString(),
  };
  const recoveryKey = formatRecoveryKey(recoveryBytes);
  recoveryBytes.fill(0);
  const dek = await importDek(rawDek, { extractable });
  return { vault, dek, recoveryKey };
}

function assertVault(vault) {
  if (!vault || vault.v !== FORMAT_VERSION || !vault.kdf || !vault.wrapped || !vault.recovery) throw new Error('Unsupported vault format');
  if (vault.kdf.alg !== 'PBKDF2-SHA256' || vault.kdf.iterations < MIN_ITERATIONS && !globalThis.__AP_TEST__) throw new Error('Unsupported or weak vault KDF');
}

/** Unlocks with the passphrase. Throws Error('Wrong passphrase') on failure. */
export async function unlockVault(vault, passphrase, { extractable = false } = {}) {
  assertVault(vault);
  const kek = await deriveKek(passphrase, fromB64u(vault.kdf.salt), vault.kdf.iterations);
  let raw;
  try { raw = await unwrapRaw(kek, vault.wrapped, 'ap:v1:dek:passphrase'); } catch { throw new Error('Wrong passphrase'); }
  return importDek(raw, { extractable });
}

/** Unlocks with the recovery key (e.g. forgotten passphrase). */
export async function unlockWithRecovery(vault, recoveryKey, { extractable = false } = {}) {
  assertVault(vault);
  let bytes;
  try { bytes = fromBase32(recoveryKey); } catch { throw new Error('Wrong recovery key'); }
  if (bytes.length !== 20) throw new Error('Wrong recovery key');
  const rkek = await deriveRecoveryKek(bytes, fromB64u(vault.recovery.salt));
  bytes.fill(0);
  let raw;
  try { raw = await unwrapRaw(rkek, vault.recovery.wrapped, 'ap:v1:dek:recovery'); } catch { throw new Error('Wrong recovery key'); }
  return importDek(raw, { extractable });
}

/**
 * Sets a new passphrase (and optionally a new recovery key) for an existing vault, keeping the
 * same DEK so no data needs re-encrypting. `secret` = { passphrase } or { recoveryKey }.
 */
export async function rewrapVault(vault, secret, newPassphrase, { newRecoveryKey = false, iterations } = {}) {
  assertPassphraseStrength(newPassphrase);
  const dek = secret.recoveryKey
    ? await unlockWithRecovery(vault, secret.recoveryKey, { extractable: true })
    : await unlockVault(vault, secret.passphrase, { extractable: true });
  const rawDek = new Uint8Array(await subtle.exportKey('raw', dek));
  const salt = getRandom(16);
  const iters = iterations || Math.max(vault.kdf.iterations, DEFAULT_ITERATIONS);
  const kek = await deriveKek(newPassphrase, salt, iters);
  const next = { ...vault, kdf: { alg: 'PBKDF2-SHA256', iterations: iters, salt: toB64u(salt) }, wrapped: await wrapRaw(kek, rawDek, 'ap:v1:dek:passphrase'), updatedAt: new Date().toISOString() };
  let recoveryKey = null;
  if (newRecoveryKey) {
    const rb = getRandom(20); const rSalt = getRandom(16);
    next.recovery = { alg: 'HKDF-SHA256', salt: toB64u(rSalt), wrapped: await wrapRaw(await deriveRecoveryKek(rb, rSalt), rawDek, 'ap:v1:dek:recovery') };
    recoveryKey = formatRecoveryKey(rb);
    rb.fill(0);
  }
  rawDek.fill(0);
  return { vault: next, recoveryKey };
}

/** Passphrase policy: ≥ 12 chars and not trivially weak. Returns true or throws. */
export function assertPassphraseStrength(p) {
  if (typeof p !== 'string' || p.length < 12) throw new Error('Use a passphrase of at least 12 characters');
  if (/^(.)\1+$/.test(p) || /^(?:0123456789|1234567890|password|passphrase|qwerty)/i.test(p)) throw new Error('That passphrase is too easy to guess');
  return true;
}

// ---------------------------------------------------------------- record encryption
/** Encrypts any JSON value → "v1.<iv>.<ciphertext>" (base64url). */
export async function encryptJSON(dek, value, aad) {
  const iv = getRandom(12);
  const ct = await subtle.encrypt({ name: 'AES-GCM', iv, additionalData: te.encode(aad) }, dek, te.encode(JSON.stringify(value)));
  return `v1.${toB64u(iv)}.${toB64u(ct)}`;
}
export async function decryptJSON(dek, payload, aad) {
  const [v, iv, ct] = String(payload).split('.');
  if (v !== 'v1' || !iv || !ct) throw new Error('Unsupported ciphertext');
  let pt;
  try { pt = await subtle.decrypt({ name: 'AES-GCM', iv: fromB64u(iv), additionalData: te.encode(aad) }, dek, fromB64u(ct)); } catch { throw new Error('Decryption failed (wrong key or tampered data)'); }
  return JSON.parse(td.decode(pt));
}

/** Encrypts bytes (e.g. a resume file) → Uint8Array [0x01 | iv(12) | ciphertext+tag]. */
export async function encryptBytes(dek, bytes, aad) {
  const iv = getRandom(12);
  const ct = new Uint8Array(await subtle.encrypt({ name: 'AES-GCM', iv, additionalData: te.encode(aad) }, dek, bytes));
  const out = new Uint8Array(1 + 12 + ct.length);
  out[0] = 1; out.set(iv, 1); out.set(ct, 13);
  return out;
}
export async function decryptBytes(dek, blob, aad) {
  const u8 = blob instanceof Uint8Array ? blob : new Uint8Array(blob);
  if (u8[0] !== 1) throw new Error('Unsupported ciphertext');
  try {
    return new Uint8Array(await subtle.decrypt({ name: 'AES-GCM', iv: u8.subarray(1, 13), additionalData: te.encode(aad) }, dek, u8.subarray(13)));
  } catch { throw new Error('Decryption failed (wrong key or tampered data)'); }
}

/** Random id for records (base64url, 128-bit). */
export function newId() { return toB64u(getRandom(16)); }
