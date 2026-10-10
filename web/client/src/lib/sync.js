// Encrypted sync layer. Every record is encrypted on this device with the vault DEK
// (AES-256-GCM, AAD = aadFor(userId, collection, id)) before it leaves the browser.
// Decrypted data lives ONLY in this object's memory and is dropped on lock/logout.
import { encryptJSON, decryptJSON, encryptBytes, decryptBytes, aadFor } from '@shared/vaultCrypto.js';
import { api, ApiError } from './api.js';

export const COLLECTIONS = ['profile', 'resumes', 'applications', 'qa', 'settings', 'outbox', 'savedJobs', 'campaigns', 'network'];
const ID_RE = /^[a-zA-Z0-9_-]{1,64}$/;

const isPlainObject = (v) => v && typeof v === 'object' && !Array.isArray(v);

/** Default merge on conflict: remote fields we didn't touch survive, our fields win (LWW per record). */
export function defaultMerge(remote, local) {
  if (!isPlainObject(remote) || !isPlainObject(local)) return local;
  const out = { ...remote, ...local };
  if (isPlainObject(remote.values) && isPlainObject(local.values)) out.values = { ...remote.values, ...local.values };
  return out;
}

export class Sync {
  constructor(userId, dek) {
    this.userId = userId;
    this.dek = dek;
    this.records = new Map(); // "collection/id" -> { collection, id, data, version, updatedAt }
    this.since = 0;
    this.listeners = new Set();
    this.chains = new Map(); // per-record write serialisation
    this.undecryptable = 0;
    this.closed = false;
  }

  key(c, id) { return `${c}/${id}`; }
  subscribe(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  emit() { for (const fn of this.listeners) fn(); }
  close() { this.closed = true; this.records.clear(); this.dek = null; this.listeners.clear(); }

  get(c, id) { const r = this.records.get(this.key(c, id)); return r ? r.data : undefined; }
  list(c) { const out = []; for (const r of this.records.values()) if (r.collection === c) out.push(r.data); return out; }
  entries(c) { const out = []; for (const r of this.records.values()) if (r.collection === c) out.push(r); return out; }
  meta(c, id) { return this.records.get(this.key(c, id)); }

  aad(c, id) { return aadFor(this.userId, c, id); }

  async decryptItem(it) {
    try { return await decryptJSON(this.dek, it.ciphertext, this.aad(it.collection, it.id)); } catch { this.undecryptable++; return undefined; }
  }

  async ingest(items) {
    let changed = false;
    for (const it of items) {
      const k = this.key(it.collection, it.id);
      if (it.deleted || !it.ciphertext) {
        if (this.records.delete(k)) changed = true;
        continue;
      }
      const cur = this.records.get(k);
      if (cur && cur.version === it.version) continue;
      const data = await this.decryptItem(it);
      if (data === undefined || this.closed) continue;
      this.records.set(k, { collection: it.collection, id: it.id, data, version: it.version, updatedAt: it.updatedAt });
      changed = true;
    }
    return changed;
  }

  /** Pulls everything (first call) or only changes since the last pull. */
  async pull({ full = false } = {}) {
    const qs = !full && this.since ? `?since=${encodeURIComponent(this.since)}` : '';
    const res = await api(`/items${qs}`);
    if (this.closed) return false;
    const changed = await this.ingest(res.items || []);
    if (res.now) this.since = res.now;
    if (changed) this.emit();
    return changed;
  }

  async fetchOne(c, id) {
    const res = await api(`/items?collection=${encodeURIComponent(c)}`);
    return (res.items || []).find((x) => x.id === id) || null;
  }

  serial(k, fn) {
    const prev = this.chains.get(k) || Promise.resolve();
    const next = prev.catch(() => {}).then(fn);
    this.chains.set(k, next.finally(() => { if (this.chains.get(k) === next) this.chains.delete(k); }));
    return next;
  }

  /**
   * Encrypts and stores a record with optimistic concurrency. On 409 it refetches the current
   * server copy, merges (merge(remote, local)), and retries.
   */
  put(c, id, data, { merge = defaultMerge } = {}) {
    if (!ID_RE.test(id)) return Promise.reject(new Error(`Invalid record id "${id}"`));
    const k = this.key(c, id);
    // Optimistic local update so the UI reflects the change immediately.
    const before = this.records.get(k);
    this.records.set(k, { collection: c, id, data, version: before ? before.version : null, updatedAt: Date.now(), pending: true });
    this.emit();
    return this.serial(k, async () => {
      let local = data;
      for (let attempt = 0; attempt < 4; attempt++) {
        if (this.closed) throw new Error('Vault is locked');
        const cur = this.records.get(k);
        const baseVersion = cur && cur.version != null ? cur.version : null;
        const ciphertext = await encryptJSON(this.dek, local, this.aad(c, id));
        try {
          const res = await api(`/items/${c}/${id}`, { method: 'PUT', body: { ciphertext, baseVersion } });
          this.records.set(k, { collection: c, id, data: local, version: res.version, updatedAt: res.updatedAt });
          this.emit();
          return local;
        } catch (e) {
          if (!(e instanceof ApiError) || e.status !== 409) {
            if (before) this.records.set(k, before); else this.records.delete(k);
            this.emit();
            throw e;
          }
          // Conflict: get the server's copy (from the 409 body or a refetch), merge, retry.
          let remoteItem = e.data && e.data.current && typeof e.data.current === 'object' ? { collection: c, id, ...e.data.current } : null;
          if (!remoteItem || remoteItem.version == null) remoteItem = await this.fetchOne(c, id);
          if (!remoteItem) { this.records.set(k, { collection: c, id, data: local, version: null }); continue; }
          const remote = remoteItem.deleted || !remoteItem.ciphertext ? undefined : await this.decryptItem({ ...remoteItem, collection: c, id });
          local = remote === undefined ? local : merge(remote, local);
          this.records.set(k, { collection: c, id, data: local, version: remoteItem.version, updatedAt: remoteItem.updatedAt });
        }
      }
      throw new Error('Could not save: the record keeps changing on another device. Try again.');
    });
  }

  remove(c, id) {
    const k = this.key(c, id);
    const before = this.records.get(k);
    this.records.delete(k);
    this.emit();
    return this.serial(k, async () => {
      try { await api(`/items/${c}/${id}`, { method: 'DELETE' }); } catch (e) {
        if (e instanceof ApiError && e.status === 404) return;
        if (before) { this.records.set(k, before); this.emit(); }
        throw e;
      }
    });
  }

  // ---------------------------------------------------------------- blobs (encrypted file bytes)
  async putBlob(blobId, bytes) {
    if (!ID_RE.test(blobId)) throw new Error('Invalid blob id');
    const enc = await encryptBytes(this.dek, bytes, this.aad('blob', blobId));
    return api(`/blobs/${blobId}`, { method: 'PUT', body: enc, raw: true });
  }
  async getBlob(blobId) {
    const enc = await api(`/blobs/${blobId}`, { binary: true });
    return decryptBytes(this.dek, enc, this.aad('blob', blobId));
  }
  async deleteBlob(blobId) {
    try { await api(`/blobs/${blobId}`, { method: 'DELETE' }); } catch (e) { if (!(e instanceof ApiError) || e.status !== 404) throw e; }
  }
}

/** Record ids must match ^[a-zA-Z0-9_-]{1,64}$; job ids like "greenhouse:acme:123" are hashed. */
export async function safeId(raw) {
  const s = String(raw || '');
  if (ID_RE.test(s)) return s;
  const h = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)));
  let b = '';
  for (const x of h.subarray(0, 18)) b += String.fromCharCode(x);
  return `j_${btoa(b).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')}`;
}

export async function sha256Hex(bytes) {
  const h = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  return [...h].map((x) => x.toString(16).padStart(2, '0')).join('');
}
