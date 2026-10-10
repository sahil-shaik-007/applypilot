// Referral finder: LinkedIn Connections.csv imported on the phone and stored END-TO-END ENCRYPTED in
// the `network` collection (docs/MOBILE.md "Data shapes"). The CSV never leaves the device in clear.
//   network/meta      { importedAt, count, companies, chunks, source, updatedAt }
//   network/chunk-<n> { items: [{ id, name, company, position, url, connectedOn }] }   (≤ ~120 KB each)
// Email addresses from the CSV are deliberately NOT kept (not needed to find referrals).
import { parseLinkedInConnections, sameCompany, normCompany } from '@shared/csvImport.js';
import { newId } from '@shared/vaultCrypto.js';

const CHUNK_BYTES = 120 * 1024;
const short = () => newId().slice(0, 10);
const slim = (c) => ({ id: c.id || short(), name: String(c.name || '').slice(0, 120), company: String(c.company || '').slice(0, 120), position: String(c.position || '').slice(0, 160), url: /^https:\/\//i.test(c.url || '') ? String(c.url).slice(0, 300) : '', connectedOn: String(c.connectedOn || '').slice(0, 40) });

export function chunkIds(sync) { return sync.entries('network').map((r) => r.id).filter((id) => id.startsWith('chunk-')).sort((a, b) => Number(a.slice(6)) - Number(b.slice(6))); }

/** All decrypted connections (with their chunk id). */
export function allConnections(sync) {
  if (!sync) return [];
  const out = [];
  for (const id of chunkIds(sync)) for (const c of (sync.get('network', id) || {}).items || []) out.push({ ...c, chunk: id });
  return out;
}

export function peopleAt(connections, company) {
  if (!company) return [];
  return connections.filter((c) => sameCompany(c.company, company)).slice(0, 25);
}

function toChunks(items) {
  const chunks = [];
  let cur = []; let size = 0;
  for (const it of items) {
    const n = JSON.stringify(it).length + 1;
    if (cur.length && size + n > CHUNK_BYTES) { chunks.push(cur); cur = []; size = 0; }
    cur.push(it); size += n;
  }
  if (cur.length) chunks.push(cur);
  return chunks;
}

async function writeMeta(app, items, extra = {}) {
  const prev = app.sync.get('network', 'meta') || {};
  await app.put('network', 'meta', { ...prev, ...extra, count: items.length, companies: new Set(items.map((i) => normCompany(i.company))).size, chunks: chunkIds(app.sync).length, updatedAt: new Date().toISOString() });
}

/** Replaces the stored connections with the ones in a LinkedIn Connections.csv. */
export async function importConnections(app, text, source = 'Connections.csv') {
  const parsed = parseLinkedInConnections(text);
  if (!parsed.length) throw new Error("That file doesn't look like LinkedIn's Connections.csv (it needs First Name, Last Name and Company columns).");
  const items = parsed.map(slim);
  const chunks = toChunks(items);
  const old = chunkIds(app.sync);
  for (let i = 0; i < chunks.length; i++) await app.put('network', `chunk-${i}`, { items: chunks[i] });
  for (const id of old) if (Number(id.slice(6)) >= chunks.length) await app.remove('network', id);
  await writeMeta(app, items, { importedAt: new Date().toISOString(), source: String(source).slice(0, 80) });
  return { count: items.length, companies: new Set(items.map((i) => normCompany(i.company))).size };
}

/** Removes every imported connection (confirm in the UI first). */
export async function clearConnections(app) {
  for (const id of chunkIds(app.sync)) await app.remove('network', id);
  if (app.sync.get('network', 'meta')) await app.remove('network', 'meta');
}

/** Adds or edits one connection. */
export async function saveConnection(app, c) {
  const item = slim(c);
  if (!item.name.trim() || !item.company.trim()) throw new Error('Name and company are required.');
  const ids = chunkIds(app.sync);
  if (c.chunk && ids.includes(c.chunk)) {
    const cur = app.sync.get('network', c.chunk) || { items: [] };
    await app.put('network', c.chunk, { items: cur.items.map((x) => (x.id === item.id ? item : x)) });
  } else {
    const last = ids[ids.length - 1];
    const cur = last ? app.sync.get('network', last) : null;
    if (cur && JSON.stringify(cur).length + JSON.stringify(item).length < CHUNK_BYTES) await app.put('network', last, { items: [...cur.items, item] });
    else await app.put('network', `chunk-${ids.length ? Number(last.slice(6)) + 1 : 0}`, { items: [item] });
  }
  await writeMeta(app, allConnections(app.sync), app.sync.get('network', 'meta') ? {} : { importedAt: null, source: 'Added on phone' });
  return item;
}

export async function removeConnection(app, c) {
  const cur = app.sync.get('network', c.chunk);
  if (!cur) return;
  const items = cur.items.filter((x) => x.id !== c.id);
  if (items.length) await app.put('network', c.chunk, { items }); else await app.remove('network', c.chunk);
  const rest = allConnections(app.sync);
  if (rest.length) await writeMeta(app, rest); else if (app.sync.get('network', 'meta')) await app.remove('network', 'meta');
}

/** Company research links (same set as the desktop job drawer). */
export function researchLinks(job) {
  const co = job.company || '';
  const role = (job.title || '').split(/[,(-]/)[0].trim();
  const enc = encodeURIComponent;
  return [
    { id: 'people', label: `People at ${co}`, url: `https://www.linkedin.com/search/results/people/?keywords=${enc(`${co} ${role}`)}` },
    { id: 'company', label: 'Company page', url: `https://www.linkedin.com/search/results/companies/?keywords=${enc(co)}` },
    { id: 'glassdoor', label: 'Reviews (Glassdoor)', url: `https://www.google.com/search?q=${enc(`${co} reviews site:glassdoor.com`)}` },
    { id: 'ambitionbox', label: 'Reviews (AmbitionBox)', url: `https://www.google.com/search?q=${enc(`${co} reviews site:ambitionbox.com`)}` },
    { id: 'interview', label: 'Interview questions', url: `https://www.google.com/search?q=${enc(`${co} ${job.title || ''} interview questions`)}` },
    { id: 'news', label: 'Latest news', url: `https://news.google.com/search?q=${enc(co)}` },
  ];
}
