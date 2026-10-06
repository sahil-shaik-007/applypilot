// node --test web/shared/vaultCrypto.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import * as vc from './vaultCrypto.js';

globalThis.__AP_TEST__ = true; // allow fast iteration counts in tests only
const FAST = { iterations: 1000 };
const PASS = 'correct horse battery staple';

test('create → unlock with passphrase → round-trip JSON', async () => {
  const { vault, dek, recoveryKey } = await vc.createVault(PASS, FAST);
  assert.equal(vault.v, 1);
  assert.match(recoveryKey, /^[0-9A-Z]{4}(-[0-9A-Z]{4}){7}$/);
  const aad = vc.aadFor('u1', 'profile', 'main');
  const ct = await vc.encryptJSON(dek, { name: 'Priya', skills: ['SQL'] }, aad);
  assert.ok(!ct.includes('Priya'));
  const dek2 = await vc.unlockVault(vault, PASS);
  assert.deepEqual(await vc.decryptJSON(dek2, ct, aad), { name: 'Priya', skills: ['SQL'] });
});

test('wrong passphrase and wrong recovery key are rejected', async () => {
  const { vault } = await vc.createVault(PASS, FAST);
  await assert.rejects(vc.unlockVault(vault, 'not the passphrase!!'), /Wrong passphrase/);
  await assert.rejects(vc.unlockWithRecovery(vault, 'AAAA-BBBB-CCCC-DDDD-EEEE-FFFF-GGGG-HHHH'), /Wrong recovery key/);
  await assert.rejects(vc.unlockWithRecovery(vault, 'garbage'), /Wrong recovery key/);
});

test('recovery key unlocks (case/spacing/look-alike tolerant) and rewrap keeps data readable', async () => {
  const { vault, dek, recoveryKey } = await vc.createVault(PASS, FAST);
  const aad = vc.aadFor('u1', 'qa', 'x');
  const ct = await vc.encryptJSON(dek, 'answer', aad);
  const messy = recoveryKey.toLowerCase().replace(/-/g, ' ');
  const dekR = await vc.unlockWithRecovery(vault, messy);
  assert.equal(await vc.decryptJSON(dekR, ct, aad), 'answer');
  const { vault: v2, recoveryKey: rk2 } = await vc.rewrapVault(vault, { recoveryKey }, 'a brand new passphrase', { newRecoveryKey: true, iterations: 1000 });
  await assert.rejects(vc.unlockVault(v2, PASS), /Wrong passphrase/);
  const dek3 = await vc.unlockVault(v2, 'a brand new passphrase');
  assert.equal(await vc.decryptJSON(dek3, ct, aad), 'answer');
  await assert.rejects(vc.unlockWithRecovery(v2, recoveryKey), /Wrong recovery key/);
  assert.equal(await vc.decryptJSON(await vc.unlockWithRecovery(v2, rk2), ct, aad), 'answer');
});

test('AAD binding: moving a ciphertext to another user/collection/id fails', async () => {
  const { dek } = await vc.createVault(PASS, FAST);
  const ct = await vc.encryptJSON(dek, { secret: 1 }, vc.aadFor('u1', 'profile', 'main'));
  for (const aad of [vc.aadFor('u2', 'profile', 'main'), vc.aadFor('u1', 'qa', 'main'), vc.aadFor('u1', 'profile', 'other')]) {
    await assert.rejects(vc.decryptJSON(dek, ct, aad), /Decryption failed/);
  }
});

test('tampering is detected (JSON and bytes)', async () => {
  const { dek } = await vc.createVault(PASS, FAST);
  const aad = vc.aadFor('u1', 'resumes', 'r1');
  const ct = await vc.encryptJSON(dek, { a: 1 }, aad);
  const parts = ct.split('.');
  const body = vc.fromB64u(parts[2]); body[0] ^= 1;
  await assert.rejects(vc.decryptJSON(dek, `${parts[0]}.${parts[1]}.${vc.toB64u(body)}`, aad), /Decryption failed/);
  const blob = await vc.encryptBytes(dek, new Uint8Array([1, 2, 3, 4]), aad);
  assert.deepEqual([...await vc.decryptBytes(dek, blob, aad)], [1, 2, 3, 4]);
  blob[20] ^= 1;
  await assert.rejects(vc.decryptBytes(dek, blob, aad), /Decryption failed/);
});

test('same plaintext encrypts differently every time (random IVs)', async () => {
  const { dek } = await vc.createVault(PASS, FAST);
  const aad = vc.aadFor('u', 'c', 'i');
  assert.notEqual(await vc.encryptJSON(dek, 'x', aad), await vc.encryptJSON(dek, 'x', aad));
});

test('DEK is non-extractable by default', async () => {
  const { dek } = await vc.createVault(PASS, FAST);
  await assert.rejects(globalThis.crypto.subtle.exportKey('raw', dek));
});

test('weak passphrases and weak KDF parameters are refused', async () => {
  await assert.rejects(vc.createVault('short', FAST), /at least 12/);
  await assert.rejects(vc.createVault('aaaaaaaaaaaaaaa', FAST), /too easy/);
  delete globalThis.__AP_TEST__;
  await assert.rejects(vc.createVault(PASS, { iterations: 1000 }), /too low/);
  globalThis.__AP_TEST__ = true;
});

test('default KDF is 600k PBKDF2 iterations', async () => {
  delete globalThis.__AP_TEST__;
  const t0 = Date.now();
  const { vault } = await vc.createVault(PASS);
  assert.equal(vault.kdf.iterations, 600000);
  await vc.unlockVault(vault, PASS);
  globalThis.__AP_TEST__ = true;
  console.log(`  600k PBKDF2 create+unlock: ${Date.now() - t0} ms`);
});
