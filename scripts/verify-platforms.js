#!/usr/bin/env node
// Re-runnable health check for electron/data/platforms.json (the job-site directory).
//
//   node scripts/verify-platforms.js                  # check every platform
//   node scripts/verify-platforms.js --ids naukri,reed
//   node scripts/verify-platforms.js --region india   # only one region
//   node scripts/verify-platforms.js --file other.json --out report.json --concurrency 6
//
// For every entry it fetches the homepage (`url`) and the search deep link (`searchUrl`, and
// `remoteSearchUrl` when present) filled with a sample query, using a desktop-browser UA.
// Each URL is classified as:
//   ok        2xx HTML page (for search links: the sample query also appears in the page or the
//             final URL, i.e. the site really parsed the template)
//   ok-weak   2xx but the query isn't visible (client-rendered SPA): template plausible, review by hand
//   redirect  a search link that bounced to the bare homepage (template probably broken)
//   blocked   403/429/503/999 or a bot-wall (Cloudflare, Akamai, captcha). Normal for big sites;
//             treat as alive and confirm the pattern by hand / from the site's own URLs
//   notfound  404/410
//   error     DNS / TLS / timeout / connection failure (site dead or moved)
//   skipped   Google/X/Reddit/LinkedIn-content search helpers (they always bot-wall scripts)
// The JSON report goes to --out (default: <os tmp>/applypilot-platforms-report.json) and a
// summary is printed. Exit code is 0 unless the script itself crashes.

const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const argv = process.argv.slice(2);
const opt = (name, def) => { const i = argv.indexOf(`--${name}`); return i >= 0 ? argv[i + 1] : def; };
const FILE = path.resolve(opt('file', path.join(ROOT, 'electron', 'data', 'platforms.json')));
const OUT = path.resolve(opt('out', path.join(os.tmpdir(), 'applypilot-platforms-report.json')));
const CONCURRENCY = Number(opt('concurrency', process.env.VERIFY_CONCURRENCY || 8));
const IDS = opt('ids', '') ? new Set(opt('ids').split(',').map((s) => s.trim())) : null;
const REGION = opt('region', '');
const TIMEOUT = Number(opt('timeout', 25000));
const QUERY = opt('q', 'software engineer');

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
const HEADERS = {
  'User-Agent': UA,
  Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9',
};
// A typical city per region for the {loc} placeholder.
const CITY = {
  global: 'London', india: 'Bengaluru', us: 'New York', uk: 'London', europe: 'Berlin', canada: 'Toronto',
  australia: 'Sydney', 'middle-east': 'Dubai', asia: 'Singapore', latam: 'Mexico City', africa: 'Nairobi',
};
const SKIP_HOSTS = /(^|\.)(google\.com|x\.com|twitter\.com|reddit\.com)$/;
const SKIP_PATHS = /linkedin\.com\/search\/results\/content/;
const BOTWALL = /cf-chl-|challenge-platform|cf_chl_opt|Attention Required! \| Cloudflare|Just a moment\.\.\.|captcha|px-captcha|_Incapsula_Resource|Access Denied|Request unsuccessful\. Incapsula|perimeterx|datadome|Pardon Our Interruption|are you a robot|bot detection/i;

function fill(tpl, q, loc) {
  return tpl.replace(/\{q\}/g, encodeURIComponent(q)).replace(/\{loc\}/g, encodeURIComponent(loc));
}

async function fetchPage(url) {
  const t0 = Date.now();
  try {
    const res = await fetch(url, { headers: HEADERS, redirect: 'follow', signal: AbortSignal.timeout(TIMEOUT) });
    let body = '';
    try {
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      while (body.length < 1_500_000) {
        const { done, value } = await reader.read();
        if (done) break;
        body += dec.decode(value, { stream: true });
      }
      try { reader.cancel(); } catch { /* ignore */ }
    } catch { /* partial body is fine */ }
    const title = (body.match(/<title[^>]*>([\s\S]{0,200}?)<\/title>/i) || [])[1];
    return { status: res.status, finalUrl: res.url, body, title: title ? title.replace(/\s+/g, ' ').trim() : null, ms: Date.now() - t0, server: res.headers.get('server') || '' };
  } catch (e) {
    const cause = e.cause?.code || e.cause?.message || '';
    return { status: 0, error: `${e.name}: ${e.message}${cause ? ` (${cause})` : ''}`, ms: Date.now() - t0 };
  }
}

// curl fallback: many CDNs fingerprint Node's TLS stack and wall it while letting curl through.
const { execFile } = require('child_process');
let curlOk = null;
function curlPage(url) {
  return new Promise((resolve) => {
    if (curlOk === false) return resolve(null);
    const tmp = path.join(os.tmpdir(), `ap-vp-${process.pid}-${Math.random().toString(36).slice(2)}.html`);
    const t0 = Date.now();
    const a = ['-s', '-L', '--compressed', '--max-time', String(Math.ceil(TIMEOUT / 1000)), '-o', tmp, '-w', '%{http_code} %{url_effective}',
      '-A', UA, '-H', `Accept: ${HEADERS.Accept}`, '-H', `Accept-Language: ${HEADERS['Accept-Language']}`, url];
    execFile('curl', a, { windowsHide: true, timeout: TIMEOUT + 5000 }, (err, stdout) => {
      if (err && err.code === 'ENOENT') { curlOk = false; return resolve(null); }
      curlOk = true;
      let body = '';
      try { body = fs.readFileSync(tmp, 'utf8').slice(0, 1_500_000); fs.unlinkSync(tmp); } catch { /* none */ }
      const m = String(stdout || '').match(/^(\d{3}) (.*)$/);
      if (!m || m[1] === '000') return resolve({ status: 0, error: `curl: ${err ? err.message.split('\n')[0] : 'no response'}`, ms: Date.now() - t0 });
      const title = (body.match(/<title[^>]*>([\s\S]{0,200}?)<\/title>/i) || [])[1];
      resolve({ status: Number(m[1]), finalUrl: m[2], body, title: title ? title.replace(/\s+/g, ' ').trim() : null, ms: Date.now() - t0, via: 'curl' });
    });
  });
}

function classify(r, { search, q, homepage }) {
  if (r.status === 0) return 'error';
  if (r.status === 404 || r.status === 410) return 'notfound';
  if ([401, 403, 429, 503, 999, 202].includes(r.status) && (r.status !== 202 || BOTWALL.test(r.body))) return 'blocked';
  if (r.status >= 400) return r.status >= 500 ? 'error' : 'blocked';
  if (BOTWALL.test(r.body.slice(0, 20000)) && r.body.length < 60000) return 'blocked';
  if (!search) return 'ok';
  // Search link: did we end up on the bare homepage?
  try {
    const f = new URL(r.finalUrl);
    const h = new URL(homepage);
    const qs = f.search.length > 1;
    if (!qs && (f.pathname === '/' || f.pathname === '') && f.pathname !== new URL(r.requested).pathname) return 'redirect';
    void h;
  } catch { /* ignore */ }
  const words = q.toLowerCase().split(/\s+/);
  const hay = (decodeURIComponent(r.finalUrl || '') + ' ' + r.body).toLowerCase();
  const inBody = words.every((w) => r.body.toLowerCase().includes(w));
  if (inBody) return 'ok';
  if (words.every((w) => hay.includes(w))) return 'ok-weak';
  return 'ok-weak';
}

async function checkUrl(url, ctx) {
  let host = '';
  try { host = new URL(url).hostname; } catch { return { url, verdict: 'error', error: 'bad url' }; }
  if (ctx.search && (SKIP_HOSTS.test(host) || SKIP_PATHS.test(url))) return { url, verdict: 'skipped' };
  let r = await fetchPage(url);
  // One retry for flaky network / 5xx.
  if (r.status === 0 || r.status >= 500) { await new Promise((s) => setTimeout(s, 1500)); r = await fetchPage(url); }
  r.requested = url;
  let verdict = classify(r, ctx);
  if (['blocked', 'error'].includes(verdict)) {
    const c = await curlPage(url);
    if (c) {
      c.requested = url;
      const cv = classify(c, ctx);
      if (!['blocked', 'error'].includes(cv) || (verdict === 'error' && cv === 'blocked')) { r = c; verdict = cv; }
    }
  }
  const out = { url, verdict, status: r.status, ms: r.ms };
  if (r.via) out.via = r.via;
  try { const fh = new URL(r.finalUrl).hostname.replace(/^www\./, ''); if (fh && fh !== host.replace(/^www\./, '')) out.movedTo = fh; } catch { /* ignore */ }
  if (r.finalUrl && r.finalUrl !== url) out.finalUrl = r.finalUrl;
  if (r.title) out.title = r.title;
  if (r.error) out.error = r.error;
  if (ctx.search) out.queryInPage = r.body ? QUERY.toLowerCase().split(/\s+/).every((w) => r.body.toLowerCase().includes(w)) : false;
  return out;
}

async function runPool(items, n, fn) {
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (i < items.length) { const idx = i++; await fn(items[idx], idx); }
  }));
}

function overall(e) {
  const v = [e.home?.verdict, e.search?.verdict].filter(Boolean);
  if (v.includes('error') && (!e.search || e.search.verdict === 'error' || e.home.verdict === 'error')) return e.home.verdict === 'error' ? 'dead?' : 'search-broken';
  if (e.search && ['notfound', 'redirect', 'error'].includes(e.search.verdict)) return 'search-broken';
  if (e.home.verdict === 'notfound') return 'home-broken';
  if (v.every((x) => x === 'blocked' || x === 'skipped')) return 'blocked';
  if (v.includes('blocked')) return 'alive-partly-blocked';
  if (e.search && e.search.verdict === 'ok-weak') return 'alive-weak';
  return 'alive';
}

async function main() {
  const t0 = Date.now();
  let list = JSON.parse(fs.readFileSync(FILE, 'utf8'));
  if (IDS) list = list.filter((p) => IDS.has(p.id));
  if (REGION) list = list.filter((p) => p.region === REGION);
  const results = new Array(list.length);
  let done = 0;
  const tick = setInterval(() => console.log(`  checked ${done}/${list.length} (${((Date.now() - t0) / 1000).toFixed(0)}s)`), 15000);
  await runPool(list, CONCURRENCY, async (p, idx) => {
    const loc = CITY[p.region] || 'London';
    const e = { id: p.id, name: p.name };
    e.home = await checkUrl(p.url, { search: false, homepage: p.url });
    if (p.searchUrl) e.search = await checkUrl(fill(p.searchUrl, QUERY, loc), { search: true, q: QUERY, homepage: p.url });
    if (p.remoteSearchUrl && p.remoteSearchUrl !== p.searchUrl) e.remote = await checkUrl(fill(p.remoteSearchUrl, QUERY, loc), { search: true, q: QUERY, homepage: p.url });
    e.overall = overall(e);
    results[idx] = e;
    done++;
  });
  clearInterval(tick);
  const counts = {};
  for (const e of results) counts[e.overall] = (counts[e.overall] || 0) + 1;
  const report = { generatedAt: new Date().toISOString(), file: path.relative(ROOT, FILE), query: QUERY, total: results.length, counts, results };
  fs.writeFileSync(OUT, JSON.stringify(report, null, 2) + '\n');
  console.log(`Checked ${results.length} platforms in ${((Date.now() - t0) / 1000).toFixed(0)}s:`, counts);
  for (const e of results.filter((x) => !['alive', 'alive-weak', 'blocked', 'alive-partly-blocked'].includes(x.overall))) {
    console.log(`  ${e.overall.padEnd(14)} ${e.id.padEnd(28)} home=${e.home.verdict}/${e.home.status}${e.search ? ` search=${e.search.verdict}/${e.search.status}` : ''} ${e.home.error || e.search?.error || ''}`);
  }
  const moved = results.filter((e) => e.home.movedTo || e.search?.movedTo);
  if (moved.length) console.log('Redirected to another host (possible rebrand / domain move):');
  for (const e of moved) console.log(`  ${e.id.padEnd(28)} -> ${e.home.movedTo || e.search.movedTo}`);
  console.log(`Report: ${OUT}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
