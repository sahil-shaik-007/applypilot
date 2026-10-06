// End-to-end zero-knowledge check: the client encrypts with web/shared/vaultCrypto.js, the server
// stores and returns opaque data, a second device decrypts — and the database never holds plaintext.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as vc from '../../shared/vaultCrypto.js';
import { startTestServer, Client } from './helpers.js';

const PASS = 'violet tangerine submarine 42';
const ITER = { iterations: 100000 }; // minimum the module accepts without test flags; keeps the test fast

const MARKERS = {
  name: 'Priya Plaintextova',
  email: 'priya.marker@secret-domain.org',
  key: 'sk-ant-PLAINTEXT-MARKER-0123456789',
  answer: 'I am authorized to work in Atlantis',
  resume: 'RESUME-BYTES-MARKER-%PDF-1.7',
};

test('client-side vault → upload → second device re-downloads and decrypts; server sees only ciphertext', async () => {
  const t = await startTestServer();
  try {
    // ---- phone / web: sign in, create the vault, encrypt and upload records + a blob
    const web = t.client();
    const user = await web.devLogin('zk-user@example.com');
    const { vault, dek, recoveryKey } = await vc.createVault(PASS, ITER);
    assert.equal((await web.put('/api/vault', { vault, baseVersion: null })).status, 200);

    const profile = { values: { fullName: MARKERS.name, email: MARKERS.email } };
    const settings = { anthropicKey: MARKERS.key, aiModel: 'claude', preferences: {} };
    const qaId = vc.newId();
    const qa = { id: qaId, question: 'Work authorization?', answer: MARKERS.answer, source: 'user', uses: 1 };
    const blobId = vc.newId();
    const resumeBytes = new TextEncoder().encode(`${MARKERS.resume} ${'x'.repeat(5000)}`);
    const encBlob = await vc.encryptBytes(dek, resumeBytes, vc.aadFor(user.id, 'blob', blobId));
    const resumeId = vc.newId();
    const resume = { id: resumeId, name: 'Main', fileName: 'cv.pdf', ext: 'pdf', size: resumeBytes.length, text: MARKERS.name, blobId };

    const records = [['profile', 'main', profile], ['settings', 'main', settings], ['qa', qaId, qa], ['resumes', resumeId, resume]];
    for (const [col, id, value] of records) {
      const ciphertext = await vc.encryptJSON(dek, value, vc.aadFor(user.id, col, id));
      const r = await web.put(`/api/items/${col}/${id}`, { ciphertext, baseVersion: null });
      assert.equal(r.status, 200, `${col}/${id}`);
    }
    const up = await web.req('PUT', `/api/blobs/${blobId}`, { body: encBlob, headers: { 'content-type': 'application/octet-stream' } });
    assert.equal(up.status, 200);

    // ---- desktop: link with a code, then unlock with the passphrase and decrypt everything
    const { code } = (await web.post('/api/devices/link-code', {})).json;
    const desk = new Client(t.url, { origin: null });
    desk.bearer = (await desk.post('/api/devices/redeem', { code, name: 'Desktop' })).json.deviceToken;
    const me = (await desk.get('/api/me')).json;
    assert.equal(me.user.id, user.id);
    assert.equal(me.hasVault, true);
    const gv = (await desk.get('/api/vault')).json;
    const dek2 = await vc.unlockVault(gv.vault, PASS);
    await assert.rejects(vc.unlockVault(gv.vault, 'wrong passphrase here'), /Wrong passphrase/);
    const items = (await desk.get('/api/items')).json.items;
    assert.equal(items.length, records.length);
    const byKey = Object.fromEntries(items.map((i) => [`${i.collection}/${i.id}`, i]));
    for (const [col, id, value] of records) {
      const it = byKey[`${col}/${id}`];
      assert.deepEqual(await vc.decryptJSON(dek2, it.ciphertext, vc.aadFor(me.user.id, col, id)), value);
    }
    const dl = await desk.req('GET', `/api/blobs/${blobId}`, { raw: true });
    const plain = await vc.decryptBytes(dek2, new Uint8Array(dl.buf), vc.aadFor(me.user.id, 'blob', blobId));
    assert.deepEqual(Buffer.from(plain), Buffer.from(resumeBytes));

    // Recovery key also unlocks the downloaded vault.
    const dek3 = await vc.unlockWithRecovery(gv.vault, recoveryKey);
    assert.deepEqual(await vc.decryptJSON(dek3, byKey['profile/main'].ciphertext, vc.aadFor(user.id, 'profile', 'main')), profile);

    // A server (or attacker with DB access) moving ciphertext to another location is detected by AAD.
    await desk.put('/api/items/qa/moved', { ciphertext: byKey['profile/main'].ciphertext, baseVersion: null });
    const moved = (await desk.get('/api/items?collection=qa')).json.items.find((i) => i.id === 'moved');
    await assert.rejects(vc.decryptJSON(dek2, moved.ciphertext, vc.aadFor(user.id, 'qa', 'moved')), /Decryption failed/);
    await assert.rejects(vc.decryptJSON(dek2, moved.ciphertext, vc.aadFor('another-user', 'profile', 'main')), /Decryption failed/);

    // ---- the database holds no plaintext: check every row of every table and the raw files
    const db = t.rawDb();
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map((r) => r.name);
    let dump = '';
    for (const name of tables) {
      for (const row of db.prepare(`SELECT * FROM "${name}"`).all()) {
        dump += JSON.stringify(row, (k, v) => (v instanceof Uint8Array ? Buffer.from(v).toString('latin1') : v));
      }
    }
    db.close();
    const raw = [t.dbPath, `${t.dbPath}-wal`].filter((f) => fs.existsSync(f)).map((f) => fs.readFileSync(f).toString('latin1')).join('');
    for (const [what, marker] of Object.entries(MARKERS)) {
      assert.ok(!dump.includes(marker), `rows contain plaintext ${what}`);
      assert.ok(!raw.includes(marker), `database file contains plaintext ${what}`);
    }
    assert.ok(!dump.includes(PASS) && !raw.includes(PASS), 'passphrase never stored');
    assert.ok(!dump.includes(recoveryKey) && !raw.includes(recoveryKey.replace(/-/g, '')), 'recovery key never stored');
    assert.ok(!dump.includes(desk.bearer) && !raw.includes(desk.bearer), 'device token never stored');
    assert.ok(!dump.includes(web.jar.get('__Host-ap_session')), 'session token never stored');
  } finally { await t.stop(); }
});
