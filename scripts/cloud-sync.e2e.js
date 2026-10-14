#!/usr/bin/env node
/*
 * End-to-end test of phone ↔ desktop zero-knowledge sync against the real ApplyPilot Cloud server.
 *
 *   node scripts/cloud-sync.e2e.js            # dev build of the desktop app
 *   node scripts/cloud-sync.e2e.js --exe <ApplyPilot.exe>
 *
 * Starts the server (web/server) on a spare port with a throwaway SQLite DB and dev login, plays
 * the "phone" with plain HTTP + the shared vault crypto, and drives the real Electron app.
 * Proves: linking, encrypted push/pull, outbox → desktop queue, phone edits flowing back, and
 * that the server database never contains readable personal data.
 */
const { _electron } = require('playwright-core');
const { spawn, execSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { pathToFileURL } = require('url');

const ROOT = path.join(__dirname, '..');
const EXE = (() => { const i = process.argv.indexOf('--exe'); return i > 0 ? process.argv[i + 1] : null; })();
const PORT = 8799;
const ORIGIN = 'http://localhost:5174';
const BASE = `http://localhost:${PORT}`;
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'ap-cloud-e2e-'));
const DB = path.join(TMP, 'cloud.db');
const PASS = 'correct horse battery staple 42';
const results = [];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const assert = (c, m) => { if (!c) throw new Error(m || 'assertion failed'); };
async function check(name, fn) {
  const t0 = Date.now();
  try { const note = await fn(); results.push({ name, ok: true }); console.log(`  ✔ ${name}${note ? ` — ${note}` : ''} (${Date.now() - t0} ms)`); } catch (e) { results.push({ name, ok: false, note: e.message }); console.log(`  ✘ ${name} — ${e.message}`); }
}

// ---------------------------------------------------------------- "phone" HTTP client with a cookie jar
const jar = {};
function cookieHeader() { return Object.entries(jar).map(([k, v]) => `${k}=${v}`).join('; '); }
function storeCookies(res) {
  for (const c of res.headers.getSetCookie ? res.headers.getSetCookie() : []) {
    const [kv] = c.split(';'); const i = kv.indexOf('='); jar[kv.slice(0, i)] = kv.slice(i + 1);
  }
}
async function phone(method, p, body, raw) {
  const headers = { Origin: ORIGIN, Cookie: cookieHeader() };
  if (method !== 'GET') headers['X-CSRF-Token'] = jar.ap_csrf || '';
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const res = await fetch(`${BASE}${p}`, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined });
  storeCookies(res);
  if (raw) return res;
  const data = await res.json().catch(() => ({}));
  if (!res.ok && res.status !== 409) throw new Error(`${method} ${p} → ${res.status} ${data.error || ''}`);
  return { status: res.status, data };
}

(async () => {
  const vc = await import(pathToFileURL(path.join(ROOT, 'web', 'shared', 'vaultCrypto.js')).href);
  console.log(`Cloud sync E2E — server :${PORT}, desktop ${EXE || 'dev build'}`);
  const server = spawn(process.execPath, ['server/index.js'], {
    cwd: path.join(ROOT, 'web'),
    env: { ...process.env, PORT: String(PORT), APP_ORIGIN: ORIGIN, DATABASE_PATH: DB, AP_DEV_LOGIN: '1', NODE_ENV: 'development' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let serverLog = '';
  server.stdout.on('data', (d) => { serverLog += d; });
  server.stderr.on('data', (d) => { serverLog += d; });
  for (let i = 0; i < 50; i++) { try { if ((await fetch(`${BASE}/api/health`)).ok) break; } catch {} await sleep(200); }

  let app; let page;
  const call = (ch, ...a) => page.evaluate(([c, x]) => window.api.call(c, ...x), [ch, a]);
  let userId; let dek;
  try {
    console.log('\n▸ Phone: sign in, create vault, link code');
    let code;
    await check('phone signs in and creates a zero-knowledge vault', async () => {
      const { data } = await phone('POST', '/api/auth/dev', { email: 'priya.test@example.com' });
      userId = data.user.id;
      const created = await vc.createVault(PASS);
      dek = created.dek;
      await phone('PUT', '/api/vault', { vault: created.vault, baseVersion: null });
      const me = await phone('GET', '/api/me');
      assert(me.data.hasVault, 'vault not stored');
    });
    await check('phone creates a one-time link code', async () => {
      const { data } = await phone('POST', '/api/devices/link-code', {});
      code = data.code;
      assert(/^[A-Z0-9]{8}$/.test(code), code);
    });

    console.log('\n▸ Desktop: link and push');
    const env = { ...process.env, APPLYPILOT_USER_DATA: path.join(TMP, 'desktop'), APPLYPILOT_HEADLESS: '1' };
    app = EXE ? await _electron.launch({ executablePath: EXE, args: [], env }) : await _electron.launch({ executablePath: require('electron'), args: [ROOT], env, cwd: ROOT });
    page = await app.firstWindow();
    await page.waitForSelector('h1', { timeout: 30000 });
    await call('settings:update', { onboarded: true });
    await call('profile:save', { firstName: 'Priya', lastName: 'Sharma', email: 'priya.sharma.secret@example.com', phone: '9876543210', city: 'Bengaluru', country: 'India', skills: ['Python', 'SQL'], totalYearsExperience: 5 });
    fs.writeFileSync(path.join(TMP, 'cv.txt'), 'Priya Sharma\npriya.sharma.secret@example.com\nData analyst, 5 years of experience in SQL, Python, Tableau.\n');
    await call('resumes:importPaths', [path.join(TMP, 'cv.txt')]);
    await call('qa:save', { question: 'What is your notice period?', answer: '30 days' });

    await check('wrong passphrase is rejected locally (nothing linked)', async () => {
      let err = '';
      try { await call('cloud:link', { serverUrl: BASE, code, passphrase: 'definitely wrong passphrase' }); } catch (e) { err = e.message; }
      assert(/Wrong passphrase/.test(err), err);
      // The code was consumed by the failed attempt only if redeemed before unlocking; create a fresh one.
      code = (await phone('POST', '/api/devices/link-code', {})).data.code;
    });
    await check('desktop links with code + passphrase and syncs', async () => {
      const st = await call('cloud:link', { serverUrl: BASE, code, passphrase: PASS });
      assert(st.linked && st.email === 'priya.test@example.com', JSON.stringify(st));
      for (let i = 0; i < 40; i++) { const s = await call('cloud:status'); if (s.lastSyncAt && !s.syncing) return `${s.stats.pushed} records pushed`; await sleep(500); }
      throw new Error('sync did not finish');
    });
    await check('phone decrypts the desktop profile, resume and answers', async () => {
      const { data } = await phone('GET', '/api/items');
      const byCol = (c) => data.items.filter((i) => i.collection === c && !i.deleted);
      const prof = await vc.decryptJSON(dek, byCol('profile')[0].ciphertext, vc.aadFor(userId, 'profile', 'main'));
      assert(prof.values.email === 'priya.sharma.secret@example.com', 'profile mismatch');
      const res = byCol('resumes')[0];
      const meta = await vc.decryptJSON(dek, res.ciphertext, vc.aadFor(userId, 'resumes', res.id));
      const blob = new Uint8Array(await (await phone('GET', `/api/blobs/${meta.blobId}`, undefined, true)).arrayBuffer());
      const file = new TextDecoder().decode(await vc.decryptBytes(dek, blob, vc.aadFor(userId, 'blob', meta.blobId)));
      assert(/Data analyst/.test(file), 'resume file mismatch');
      const qa = await vc.decryptJSON(dek, byCol('qa')[0].ciphertext, vc.aadFor(userId, 'qa', byCol('qa')[0].id));
      assert(qa.answer === '30 days', 'qa mismatch');
      return `${data.items.length} encrypted records`;
    });
    await check('server database contains no readable personal data', async () => {
      await sleep(300);
      const bytes = fs.readFileSync(DB);
      const wal = fs.existsSync(`${DB}-wal`) ? fs.readFileSync(`${DB}-wal`) : Buffer.alloc(0);
      const all = Buffer.concat([bytes, wal]).toString('latin1');
      for (const secret of ['priya.sharma.secret', 'Sharma', '9876543210', 'Tableau', '30 days', 'notice period']) assert(!all.includes(secret), `found "${secret}" in the server DB`);
      return `checked ${(all.length / 1024).toFixed(0)} KB`;
    });

    console.log('\n▸ Phone → desktop');
    await check('a job sent from the phone lands in the desktop Review queue', async () => {
      const job = { id: 'greenhouse:test-123', title: 'Data Analyst', company: 'Acme Analytics', location: 'Remote', remote: true, url: 'https://example.com/job', applyUrl: 'https://example.com/job', source: 'greenhouse', description: 'SQL and Python for dashboards.' };
      const id = vc.newId();
      const ciphertext = await vc.encryptJSON(dek, { jobId: job.id, job, resumeId: null, mode: 'review', createdAt: Date.now(), from: 'web' }, vc.aadFor(userId, 'outbox', id));
      await phone('PUT', `/api/items/outbox/${id}`, { ciphertext, baseVersion: null });
      await call('cloud:sync');
      const apps = await call('applications:list');
      const a = apps.find((x) => x.jobId === job.id);
      assert(a && a.status === 'queued' && a.campaignName === 'Sent from phone', JSON.stringify(a && a.status));
      const left = (await phone('GET', '/api/items?collection=outbox')).data.items.filter((i) => !i.deleted);
      assert(!left.length, 'outbox item not removed after pickup');
    });
    await check('a job sent for a second profile keeps the details of that profile, separate from the first', async () => {
      const job = { id: 'greenhouse:test-456', title: 'Data Analyst', company: 'Acme Analytics', location: 'Remote', remote: true, url: 'https://example.com/job2', applyUrl: 'https://example.com/job2', source: 'greenhouse', description: 'SQL and Python.' };
      const mine = vc.newId(); const bro = vc.newId();
      const base = { jobId: job.id, job, resumeId: null, mode: 'review', createdAt: Date.now(), from: 'web' };
      const send = async (id, body) => phone('PUT', `/api/items/outbox/${id}`, { ciphertext: await vc.encryptJSON(dek, body, vc.aadFor(userId, 'outbox', id)), baseVersion: null });
      await send(mine, { ...base, profileId: 'main', profile: { label: 'Me', values: { firstName: 'Ava', lastName: 'Tester', email: 'ava@example.com' } } });
      await send(bro, { ...base, profileId: 'bro1', profile: { label: 'Brother', values: { firstName: 'Ben', lastName: 'Tester', email: 'ben@example.com' } } });
      await call('cloud:sync');
      const apps = (await call('applications:list')).filter((x) => x.jobId === job.id);
      assert(apps.length === 2, `expected one application per profile, got ${apps.length}`);
      const m = apps.find((x) => (x.profileId || 'main') === 'main');
      const b = apps.find((x) => x.profileId === 'bro1');
      assert(m && m.profile && m.profile.values.firstName === 'Ava', 'first profile details missing');
      assert(b && b.profile && b.profile.values.firstName === 'Ben' && b.profile.values.email === 'ben@example.com', 'second profile details missing');
    });
    await check('a profile edit on the phone reaches the desktop', async () => {
      const { data } = await phone('GET', '/api/items?collection=profile');
      const cur = data.items[0];
      const prof = await vc.decryptJSON(dek, cur.ciphertext, vc.aadFor(userId, 'profile', 'main'));
      prof.values.city = 'Hyderabad';
      prof._updatedAt = Date.now() + 1000;
      await phone('PUT', '/api/items/profile/main', { ciphertext: await vc.encryptJSON(dek, prof, vc.aadFor(userId, 'profile', 'main')), baseVersion: cur.version });
      await call('cloud:sync');
      const b = await call('app:bootstrap');
      assert(b.profile.values.city === 'Hyderabad', b.profile.values.city);
    });
    await check('a PWA-style profile edit (no _updatedAt, server time only) reaches the desktop', async () => {
      const { data } = await phone('GET', '/api/items?collection=profile');
      const cur = data.items[0];
      const prof = await vc.decryptJSON(dek, cur.ciphertext, vc.aadFor(userId, 'profile', 'main'));
      const values = { ...prof.values, city: 'Chennai' };
      await sleep(50);
      await phone('PUT', '/api/items/profile/main', { ciphertext: await vc.encryptJSON(dek, { values }, vc.aadFor(userId, 'profile', 'main')), baseVersion: cur.version });
      await call('cloud:sync');
      const b = await call('app:bootstrap');
      assert(b.profile.values.city === 'Chennai', b.profile.values.city);
    });
    await check('true conflict: both edited → the laptop keeps its edit and pushes it to the phone', async () => {
      const b0 = await call('app:bootstrap');
      await call('profile:save', { ...b0.profile.values, city: 'Pune' }); // local edit, not yet synced
      const { data } = await phone('GET', '/api/items?collection=profile');
      const cur = data.items[0];
      const prof = await vc.decryptJSON(dek, cur.ciphertext, vc.aadFor(userId, 'profile', 'main'));
      await phone('PUT', '/api/items/profile/main', { ciphertext: await vc.encryptJSON(dek, { values: { ...prof.values, city: 'Delhi' } }, vc.aadFor(userId, 'profile', 'main')), baseVersion: cur.version });
      await call('cloud:sync');
      const b = await call('app:bootstrap');
      assert(b.profile.values.city === 'Pune', `desktop has ${b.profile.values.city}`);
      const after = (await phone('GET', '/api/items?collection=profile')).data.items[0];
      const onServer = await vc.decryptJSON(dek, after.ciphertext, vc.aadFor(userId, 'profile', 'main'));
      assert(onServer.values.city === 'Pune', `server has ${onServer.values.city}`);
    });
    await check('a tampered ciphertext from the server is rejected, not applied', async () => {
      const { data } = await phone('GET', '/api/items?collection=qa');
      const it = data.items[0];
      const parts = it.ciphertext.split('.'); const body = vc.fromB64u(parts[2]); body[3] ^= 1;
      await phone('PUT', `/api/items/qa/${it.id}`, { ciphertext: `${parts[0]}.${parts[1]}.${vc.toB64u(body)}`, baseVersion: it.version });
      await call('cloud:sync');
      const qa = (await call('qa:list')).find((q) => q.id === it.id);
      assert(qa && qa.answer === '30 days', 'tampered record was applied');
    });
    await check('revoking the device on the web makes the desktop unlink itself', async () => {
      const { data } = await phone('GET', '/api/devices');
      for (const d of data.devices) await phone('DELETE', `/api/devices/${d.id}`);
      await call('cloud:sync');
      const st = await call('cloud:status');
      assert(!st.linked, JSON.stringify(st));
    });
  } catch (e) {
    console.log('FATAL', e);
  } finally {
    try { await app.close(); } catch {}
    const exited = new Promise((r) => server.once('exit', r));
    server.kill();
    await Promise.race([exited, sleep(5000)]);
  }
  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  if (failed.length) console.log(serverLog.split('\n').slice(-15).join('\n'));
  try { fs.rmSync(TMP, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 }); } catch { /* temp dir; Windows may still hold a handle */ }
  process.exit(failed.length ? 1 : 0);
})();
