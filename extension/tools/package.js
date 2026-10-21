#!/usr/bin/env node
// Builds extension/dist/applypilot-extension.zip for the Chrome Web Store and Microsoft Edge Add-ons.
//   node extension/tools/package.js
// Checks: generated files (shared.js, apply-engine.js, ats.js) in sync with the app code, manifest permissions are the minimal set,
// no remote code (no http(s) script/src references), then zips everything except tools/, store/, dist/.
'use strict';

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { TARGETS } = require('./sync-shared');

const EXT = path.join(__dirname, '..');
const DIST = path.join(EXT, 'dist');
const EXCLUDE_DIRS = new Set(['tools', 'store', 'dist', 'node_modules', '.git']);
const EXCLUDE_FILES = /(^|\/)(\.DS_Store|Thumbs\.db|.*\.map|.*\.md)$/;

// ---------------------------------------------------------------- tiny zip writer (deflate, no deps)
const CRC_TABLE = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
function crc32(buf) { let c = 0xffffffff; for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }
function dosTime(d) {
  return { time: (d.getHours() << 11) | (d.getMinutes() << 5) | Math.floor(d.getSeconds() / 2), date: ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate() };
}
function zip(entries) {
  const locals = []; const centrals = []; let offset = 0;
  const { time, date } = dosTime(new Date(2026, 0, 1)); // fixed timestamp -> reproducible zips
  for (const { name, data } of entries) {
    const nameBuf = Buffer.from(name, 'utf8');
    const deflated = zlib.deflateRawSync(data, { level: 9 });
    const useDeflate = deflated.length < data.length;
    const body = useDeflate ? deflated : data;
    const crc = crc32(data);
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(0x0800, 6); lh.writeUInt16LE(useDeflate ? 8 : 0, 8);
    lh.writeUInt16LE(time, 10); lh.writeUInt16LE(date, 12); lh.writeUInt32LE(crc, 14); lh.writeUInt32LE(body.length, 18); lh.writeUInt32LE(data.length, 22);
    lh.writeUInt16LE(nameBuf.length, 26); lh.writeUInt16LE(0, 28);
    locals.push(lh, nameBuf, body);
    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(20, 4); ch.writeUInt16LE(20, 6); ch.writeUInt16LE(0x0800, 8); ch.writeUInt16LE(useDeflate ? 8 : 0, 10);
    ch.writeUInt16LE(time, 12); ch.writeUInt16LE(date, 14); ch.writeUInt32LE(crc, 16); ch.writeUInt32LE(body.length, 20); ch.writeUInt32LE(data.length, 24);
    ch.writeUInt16LE(nameBuf.length, 28); ch.writeUInt32LE(offset, 42);
    centrals.push(ch, nameBuf);
    offset += lh.length + nameBuf.length + body.length;
  }
  const cd = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, end]);
}

function walk(dir, rel = '') {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const r = rel ? `${rel}/${e.name}` : e.name;
    if (e.isDirectory()) { if (!EXCLUDE_DIRS.has(e.name)) out.push(...walk(path.join(dir, e.name), r)); } else if (!EXCLUDE_FILES.test(r)) out.push(r);
  }
  return out;
}

function checks(files) {
  const problems = [];
  for (const tg of TARGETS) {
    const rel = path.relative(EXT, tg.out).replace(/\\/g, '/');
    const cur = fs.existsSync(tg.out) ? fs.readFileSync(tg.out, 'utf8').replace(/\r\n/g, '\n') : '';
    if (cur !== tg.build()) problems.push(`${rel} is stale — run node extension/tools/sync-shared.js`);
  }
  const m = JSON.parse(fs.readFileSync(path.join(EXT, 'manifest.json'), 'utf8'));
  const perms = [...(m.permissions || [])].sort().join(',');
  if (perms !== 'activeTab,scripting,storage') problems.push(`unexpected permissions: ${perms}`);
  // https://*/* is needed to inject the auto-fill engine into employer sites for "Apply in browser" from the web app.
  if (JSON.stringify(m.host_permissions) !== '["http://127.0.0.1/*","http://localhost/*","https://*/*"]') problems.push(`unexpected host_permissions: ${JSON.stringify(m.host_permissions)}`);
  // The only static content script is the web app bridge, and only on local development addresses (other addresses are registered from the options page).
  const cs = m.content_scripts || [];
  const csOk = cs.length === 1 && JSON.stringify(cs[0].js) === '["content/webapp-bridge.js"]' && cs[0].matches.every((x) => /^http:\/\/(localhost|127\.0\.0\.1):\d+\/\*$/.test(x));
  if (cs.length && !csOk) problems.push('static content_scripts may only be the web app bridge on localhost ports');
  for (const f of files.filter((x) => /\.(html|js)$/.test(x))) {
    const t = fs.readFileSync(path.join(EXT, f), 'utf8');
    if (/<script[^>]+src=["']https?:/i.test(t) || /importScripts\(\s*['"]https?:/.test(t) || /\beval\(|new Function\(/.test(t)) problems.push(`${f}: remote or dynamic code`);
    if (/<link[^>]+href=["']https?:/i.test(t) || /@import\s+url\(["']?https?:/i.test(t)) problems.push(`${f}: remote stylesheet`);
    if (/google-analytics|googletagmanager|segment\.io|mixpanel|sentry\.io/i.test(t)) problems.push(`${f}: analytics reference`);
  }
  for (const icon of Object.values(m.icons || {})) if (!fs.existsSync(path.join(EXT, icon))) problems.push(`missing icon ${icon}`);
  return { problems, manifest: m };
}

function main() {
  const files = walk(EXT);
  const { problems, manifest } = checks(files);
  if (problems.length) { console.error(`Package checks failed:\n - ${problems.join('\n - ')}`); process.exit(1); }
  const entries = files.map((name) => ({ name, data: fs.readFileSync(path.join(EXT, name)) }));
  fs.mkdirSync(DIST, { recursive: true });
  const out = path.join(DIST, 'applypilot-extension.zip');
  fs.writeFileSync(out, zip(entries));
  console.log(`ApplyPilot extension v${manifest.version}: ${entries.length} files -> ${path.relative(process.cwd(), out)} (${(fs.statSync(out).size / 1024).toFixed(1)} KB)`);
  return out;
}

if (require.main === module) main();
module.exports = { main, zip, walk, checks };
