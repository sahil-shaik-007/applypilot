// Desktop side of ApplyPilot Cloud: zero-knowledge sync with the web/phone app (see docs/CLOUD.md).
//
// Linking: the user creates a one-time code on the website, enters it here with their vault
// passphrase. We redeem the code for a device token, download the (wrapped) vault, unwrap the
// data key locally, and keep token + key encrypted with Windows DPAPI (safeStorage).
// Every record we upload is AES-256-GCM encrypted on this PC; the server only sees ciphertext.
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');

let vcPromise = null;
const vc = () => (vcPromise ||= import(pathToFileURL(path.join(__dirname, '..', 'web', 'shared', 'vaultCrypto.js')).href));

const COLLECTIONS = ['profile', 'resumes', 'applications', 'qa', 'outbox', 'savedJobs'];
const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');

class CloudSync {
  constructor({ store, manager, emit, notify, encrypt, decrypt, log = () => {}, deviceName }) {
    Object.assign(this, { store, manager, emit, notify, encrypt, decrypt, log, deviceName });
    this.timer = null;
    this.running = false;
    this.dek = null;
  }

  get s() { return this.store.cloud.get(); }

  status() {
    const c = this.s;
    return { linked: !!c.tokenEnc, serverUrl: c.serverUrl || '', email: c.email || null, deviceName: c.deviceName || null, lastSyncAt: c.lastSyncAt || null, lastError: c.lastError || null, stats: c.stats || null, syncing: this.running };
  }

  // ---------------------------------------------------------------- HTTP
  async api(method, p, { json, body, raw } = {}) {
    const c = this.s;
    const token = this.decrypt(c.tokenEnc);
    const res = await fetch(`${c.serverUrl}${p}`, {
      method,
      headers: { Authorization: `Bearer ${token}`, ...(json !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(body ? { 'Content-Type': 'application/octet-stream' } : {}) },
      body: json !== undefined ? JSON.stringify(json) : body,
      signal: AbortSignal.timeout(30000),
    });
    if (raw) return res;
    const data = await res.json().catch(() => ({}));
    if (res.status === 401) { const e = new Error('This device was unlinked from your ApplyPilot account. Link it again in Settings → Phone & web.'); e.status = 401; throw e; }
    if (!res.ok && res.status !== 409) throw Object.assign(new Error(data.error || `Server error ${res.status}`), { status: res.status, data });
    return { status: res.status, data };
  }

  static normalizeUrl(u) {
    const url = new URL(String(u || '').trim());
    const local = /^(localhost|127\.0\.0\.1|\[::1\])$/.test(url.hostname);
    if (url.protocol !== 'https:' && !(local && url.protocol === 'http:')) throw new Error('The server address must use https://');
    return `${url.protocol}//${url.host}`;
  }

  // ---------------------------------------------------------------- link / unlink
  async link({ serverUrl, code, passphrase }) {
    const base = CloudSync.normalizeUrl(serverUrl);
    const res = await fetch(`${base}/api/devices/redeem`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code, name: this.deviceName }), signal: AbortSignal.timeout(20000),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `Could not redeem the code (HTTP ${res.status})`);
    const token = data.deviceToken;
    const vres = await fetch(`${base}/api/vault`, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(20000) });
    if (vres.status === 404) throw new Error('Create your vault on the website first (it asks for a passphrase after you sign in).');
    const { vault } = await vres.json();
    const { unlockVault } = await vc();
    const dek = await unlockVault(vault, passphrase, { extractable: true }); // throws 'Wrong passphrase'
    const raw = Buffer.from(await globalThis.crypto.subtle.exportKey('raw', dek));
    this.store.cloud.set({
      serverUrl: base, tokenEnc: this.encrypt(token), dekEnc: this.encrypt(raw.toString('base64')), userId: data.user.id, email: data.user.email,
      deviceName: (data.device && data.device.name) || this.deviceName, versions: {}, pushed: {}, lastPull: 0, linkedAt: new Date().toISOString(),
    });
    raw.fill(0);
    this.dek = null;
    this.start();
    this.syncNow().catch(() => {});
    return this.status();
  }

  unlink() {
    this.stop();
    this.dek = null;
    this.store.cloud.set({});
    return this.status();
  }

  async key() {
    if (this.dek) return this.dek;
    const raw = Buffer.from(this.decrypt(this.s.dekEnc), 'base64');
    const { importDek } = await vc();
    this.dek = await importDek(new Uint8Array(raw), { extractable: false });
    raw.fill(0);
    return this.dek;
  }

  start() {
    if (this.timer || !this.s.tokenEnc) return;
    this.timer = setInterval(() => this.syncNow().catch(() => {}), 60000);
  }
  stop() { clearInterval(this.timer); this.timer = null; }

  // ---------------------------------------------------------------- sync
  async syncNow() {
    if (!this.s.tokenEnc || this.running) return this.status();
    this.running = true;
    this.emit('cloud:status', this.status());
    const stats = { pushed: 0, pulled: 0, fromPhone: 0 };
    try {
      await this.pull(stats);
      await this.push(stats);
      this.store.cloud.update((c) => { c.lastSyncAt = new Date().toISOString(); c.lastError = null; c.stats = stats; });
    } catch (e) {
      this.store.cloud.update((c) => { c.lastError = e.message; });
      if (e.status === 401) this.unlink();
      this.log(`cloud sync failed: ${e.message}`);
    } finally {
      this.running = false;
      this.emit('cloud:status', this.status());
    }
    return this.status();
  }

  async encryptFor(collection, id, value) {
    const { encryptJSON, aadFor } = await vc();
    return encryptJSON(await this.key(), value, aadFor(this.s.userId, collection, id));
  }
  async decryptFrom(item) {
    const { decryptJSON, aadFor } = await vc();
    return decryptJSON(await this.key(), item.ciphertext, aadFor(this.s.userId, item.collection, item.id));
  }

  // PUT one record if it changed since we last pushed it. Desktop wins on conflict for desktop-owned data.
  async putRecord(collection, id, value, stats) {
    const k = `${collection}/${id}`;
    const hash = sha(JSON.stringify(value));
    if (this.s.pushed && this.s.pushed[k] === hash) return;
    let base = (this.s.versions || {})[k] ?? null;
    for (let attempt = 0; attempt < 2; attempt++) {
      const ciphertext = await this.encryptFor(collection, id, value);
      const r = await this.api('PUT', `/api/items/${collection}/${encodeURIComponent(id)}`, { json: { ciphertext, baseVersion: base } });
      if (r.status !== 409) {
        this.store.cloud.update((c) => { c.versions = { ...(c.versions || {}), [k]: r.data.version }; c.pushed = { ...(c.pushed || {}), [k]: hash }; });
        stats.pushed++;
        return;
      }
      base = r.data.current ? r.data.current.version : null;
    }
  }

  // The exact plaintext we sync for a local record (null if it doesn't exist locally). Push sends it,
  // and pull compares its hash with the last-synced hash to know whether the local copy changed.
  localPlain(collection, id) {
    if (collection === 'profile' && id === 'main') {
      const p = this.store.profile.get();
      return p.updatedAt ? { values: p.values, _updatedAt: Date.parse(p.updatedAt) } : null;
    }
    if (collection === 'qa') {
      const q = this.store.qa.get().items.find((x) => x.id === id);
      return q ? { ...q, _updatedAt: Date.parse(q.updatedAt || 0) || 0 } : null;
    }
    if (collection === 'applications') {
      const a = this.store.applications.get().items.find((x) => x.id === id);
      return a ? { ...a, job: { ...a.job, description: (a.job.description || '').slice(0, 2000) }, events: (a.events || []).slice(-15), screenshotPath: undefined, tailored: a.tailored ? { fileName: a.tailored.fileName, changes: a.tailored.changes } : undefined, _updatedAt: Date.parse(a.updatedAt || a.createdAt) || 0 } : null;
    }
    return null;
  }

  // Has the local copy changed since the last successful sync of this record?
  isDirty(collection, id) {
    const local = this.localPlain(collection, id);
    if (!local) return false;
    const last = (this.s.pushed || {})[`${collection}/${id}`];
    return !last || sha(JSON.stringify(local)) !== last;
  }

  markSynced(collection, id) {
    const local = this.localPlain(collection, id);
    if (local) this.store.cloud.update((c) => { c.pushed = { ...(c.pushed || {}), [`${collection}/${id}`]: sha(JSON.stringify(local)) }; });
  }

  async push(stats) {
    const profilePlain = this.localPlain('profile', 'main');
    if (profilePlain) await this.putRecord('profile', 'main', profilePlain, stats);
    for (const q of this.store.qa.get().items) await this.putRecord('qa', q.id, this.localPlain('qa', q.id), stats);
    const cutoff = Date.now() - 90 * 86400000;
    const apps = this.store.applications.get().items.filter((a) => Date.parse(a.updatedAt || a.createdAt) > cutoff).slice(0, 600);
    for (const a of apps) await this.putRecord('applications', a.id, this.localPlain('applications', a.id), stats);
    const { encryptBytes, aadFor } = await vc();
    for (const r of this.store.resumes.get().items) {
      const blobId = r.id;
      if (!(this.s.pushed || {})[`blob/${blobId}`] && fs.existsSync(r.path)) {
        const bytes = await encryptBytes(await this.key(), new Uint8Array(fs.readFileSync(r.path)), aadFor(this.s.userId, 'blob', blobId));
        await this.api('PUT', `/api/blobs/${blobId}`, { body: Buffer.from(bytes) });
        this.store.cloud.update((c) => { c.pushed = { ...(c.pushed || {}), [`blob/${blobId}`]: 'y' }; });
      }
      await this.putRecord('resumes', r.id, { id: r.id, name: r.name, fileName: r.fileName, ext: r.ext, size: r.size, text: (r.text || '').slice(0, 40000), skills: r.skills, roles: r.roles || [], isDefault: !!r.isDefault, blobId, hash: r.hash, createdAt: r.createdAt, _updatedAt: Date.parse(r.createdAt) || 0 }, stats);
    }
  }

  async pull(stats) {
    const since = this.s.lastPull || 0;
    const { data } = await this.api('GET', `/api/items?since=${since}`);
    const items = data.items || [];
    for (const it of items) {
      this.store.cloud.update((c) => { c.versions = { ...(c.versions || {}), [`${it.collection}/${it.id}`]: it.version }; });
      if (it.deleted || !it.ciphertext) continue;
      let v;
      try { v = await this.decryptFrom(it); } catch (e) { this.log(`skip undecryptable ${it.collection}/${it.id}: ${e.message}`); continue; }
      stats.pulled++;
      // Conflict rule without trusting any device clock: if this PC hasn't changed the record since
      // the last sync, the server copy (newer by definition) wins; if it has, keep ours and push it.
      const ts = v._updatedAt || it.updatedAt || Date.now();
      const c = it.collection;
      if (c === 'outbox') { await this.takeFromOutbox(it, v); stats.fromPhone++; continue; }
      if (['profile', 'qa', 'applications'].includes(c)) {
        const local = this.localPlain(c, it.id);
        if (local && sha(JSON.stringify(local)) === sha(JSON.stringify(v))) { this.markSynced(c, it.id); continue; } // our own echo
        if (this.isDirty(c, it.id)) continue; // local edits win; push() sends them next
      }
      if (c === 'profile' && it.id === 'main') {
        this.store.profile.set({ values: v.values || {}, updatedAt: new Date(ts).toISOString() });
        this.emit('profile:changed', true);
        this.markSynced(c, it.id);
      } else if (c === 'qa') {
        this.store.qa.update((d) => {
          const cur = d.items.find((q) => q.id === it.id);
          if (!cur) d.items.unshift(stripMeta(v, ts)); else Object.assign(cur, stripMeta(v, ts));
        });
        this.markSynced(c, it.id);
      } else if (c === 'applications') {
        this.store.applications.update((d) => {
          const cur = d.items.find((a) => a.id === it.id);
          if (!cur) { if (v.job) d.items.unshift(stripMeta(v, ts)); }
          else Object.assign(cur, { status: v.status || cur.status, notes: v.notes ?? cur.notes, followUpAt: v.followUpAt ?? cur.followUpAt, interviewAt: v.interviewAt ?? cur.interviewAt, updatedAt: new Date(ts).toISOString() });
        });
        this.markSynced(c, it.id);
      } else if (c === 'savedJobs') {
        const job = v.job || v;
        if (job && job.title && !this.store.applications.get().items.some((a) => a.jobId === job.id)) {
          this.manager.createApplication({ job, match: v.match || null, resume: null, campaign: null, status: 'saved' });
        }
      } else if (it.collection === 'resumes') {
        await this.pullResume(v);
      }
    }
    this.store.cloud.update((c) => { c.lastPull = data.now || Date.now(); });
    if (items.length) this.emit('cloud:pulled', { count: items.length });
  }

  async pullResume(v) {
    const local = this.store.resumes.get().items;
    if (local.some((r) => r.id === v.id || (v.hash && r.hash === v.hash))) return;
    const res = await this.api('GET', `/api/blobs/${v.blobId}`, { raw: true });
    if (!res.ok) return;
    const { decryptBytes, aadFor } = await vc();
    const bytes = await decryptBytes(await this.key(), new Uint8Array(await res.arrayBuffer()), aadFor(this.s.userId, 'blob', v.blobId));
    const dest = path.join(this.store.resumesDir, `${v.id}${v.ext || '.pdf'}`);
    fs.writeFileSync(dest, Buffer.from(bytes));
    this.store.resumes.update((d) => { d.items.push({ id: v.id, name: v.name, fileName: v.fileName, path: dest, hash: v.hash || sha(Buffer.from(bytes)), ext: v.ext, size: bytes.length, text: v.text || '', skills: v.skills || [], roles: v.roles || [], isDefault: !d.items.length, createdAt: v.createdAt || new Date().toISOString(), stats: { applied: 0, responses: 0, interviews: 0 }, parserVersion: 2 }); });
    this.emit('resumes:changed', [v.id]);
  }

  // A job sent from the phone: queue it (and start filling it if the user asked for that).
  async takeFromOutbox(it, v) {
    const { pickResume } = require('./resume');
    const { scoreJob } = require('./match');
    const job = { ...(v.job || {}), id: v.jobId || (v.job && v.job.id) };
    if (job.title && !this.store.applications.get().items.some((a) => a.jobId === job.id)) {
      const resume = pickResume(this.store, { resumeId: v.resumeId, job });
      const match = scoreJob(job, { resumeText: resume ? resume.text : '', profile: this.store.profile.get().values || {} });
      const app = this.manager.createApplication({ job, match, resume, campaign: null, status: 'queued' });
      this.manager.patchApp(app.id, { campaignName: 'Sent from phone' }, { type: 'step', message: 'Sent from your phone' });
      // "auto" = apply now on autopilot (cancel window, scam and still-open checks still apply);
      // anything else waits in the Review queue so pre-filled tabs don't pile up while you're away.
      const auto = v.mode === 'auto';
      this.notify('Job sent from your phone', `${job.title} at ${job.company} — ${auto ? 'applying on autopilot' : 'waiting in your Review queue'}`);
      if (auto) this.manager.applyApplication(app.id, { mode: 'auto' }).catch(() => {});
    }
    await this.api('DELETE', `/api/items/outbox/${encodeURIComponent(it.id)}`).catch(() => {});
  }
}

function stripMeta(v, ts) {
  const { _updatedAt, ...rest } = v;
  const t = _updatedAt || ts || Date.now();
  return { ...rest, updatedAt: typeof rest.updatedAt === 'string' ? rest.updatedAt : new Date(t).toISOString() };
}

module.exports = { CloudSync, COLLECTIONS };
