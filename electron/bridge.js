// Local HTTP bridge between the ApplyPilot desktop app and the ApplyPilot browser extension
// (Chrome / Edge, Manifest V3). See docs/EXTENSION.md.
//
//   const bridge = await startBridge({ store, manager, scoreJob, eligibility, getProfile, getAnswers, notify, log });
//   bridge.port                 -> the port it listens on (127.0.0.1 only, 47823-47833)
//   bridge.getPairingCode()     -> { code: '123456', expiresAt }   (show it in Settings -> Browser extension)
//   bridge.resetPairing()       -> new code, old one invalid
//   bridge.listPairings()       -> [{ id, extensionId, name, browser, createdAt, lastSeenAt }]
//   bridge.revokePairing(id)    -> removes one paired browser (its token stops working immediately)
//   await bridge.stop()
//
// Security model
//   * Listens on 127.0.0.1 only. Host header must be 127.0.0.1:<port> or localhost:<port> (blocks DNS rebinding).
//   * Every request must carry Origin: chrome-extension://<32 a-p chars>. Web pages (https://...) are rejected,
//     so a website can never talk to the bridge even though it is on localhost.
//   * Pairing: the desktop shows a 6-digit code (10-minute lifetime, single use, 5 wrong guesses -> new code).
//     POST /pair exchanges it for a random 256-bit bearer token. Only the SHA-256 of the token is stored, together
//     with the extension ID it was issued to. Every other endpoint needs `Authorization: Bearer <token>` AND
//     the Origin of that same extension ID.
//   * No CORS wildcard: CORS headers (only needed for preflights) echo the exact, allowed extension origin.
//   * JSON only, strict size limits, per-token rate limit, short timeouts, no-store responses.
//   * Resume file bytes are only returned when explicitly requested (/autofill-data with resume=<id|auto>).
//   * GET endpoints (/status, /autofill-data) also accept POST with a JSON body. Chrome omits Origin on extension
//     GETs, so the extension always uses POST and the Origin requirement never has to be relaxed.
'use strict';

const http = require('http');
const crypto = require('crypto');
const fs = require('fs');

const PORTS = Array.from({ length: 11 }, (_, i) => 47823 + i); // 47823-47833
const CODE_TTL_MS = 10 * 60 * 1000;
const MAX_CODE_ATTEMPTS = 5;
const RATE_PER_MIN = 240;
const LIMITS = { default: 64 * 1024, '/jobs': 512 * 1024, '/score': 512 * 1024, '/answers': 256 * 1024 };
const MAX_RESUME_BYTES = 10 * 1024 * 1024;
const EXT_ORIGIN = /^chrome-extension:\/\/([a-p]{32})$/;
const SETTINGS_KEY = 'browserExtension';

const sha256 = (s) => crypto.createHash('sha256').update(String(s)).digest();
const now = () => new Date().toISOString();
const str = (v, max) => (v == null ? '' : String(v)).replace(/\u0000/g, '').slice(0, max).trim();

class HttpError extends Error {
  constructor(status, message, extra) { super(message); this.status = status; this.extra = extra; }
}

// ---------------------------------------------------------------- job normalisation
function canonicalUrl(u) {
  try {
    const url = new URL(String(u));
    if (!/^https?:$/.test(url.protocol)) return '';
    url.hash = '';
    // Drop tracking parameters but keep identifiers such as ?currentJobId=, ?jk=, ?gh_jid=.
    for (const k of [...url.searchParams.keys()]) if (/^(utm_|ref|refid|trk|trackingid|src|source|from|position|pagenum|origin|lipi|eBP|tk|vjs|sid)$/i.test(k) || /^utm_/i.test(k)) url.searchParams.delete(k);
    return url.toString();
  } catch { return ''; }
}

function detectAts(url) {
  const u = String(url || '');
  if (/greenhouse\.io/.test(u)) return 'greenhouse';
  if (/lever\.co/.test(u)) return 'lever';
  if (/ashbyhq\.com/.test(u)) return 'ashby';
  if (/workable\.com/.test(u)) return 'workable';
  if (/smartrecruiters\.com/.test(u)) return 'smartrecruiters';
  if (/recruitee\.com/.test(u)) return 'recruitee';
  if (/myworkdayjobs\.com/.test(u)) return 'workday';
  if (/linkedin\.com/.test(u)) return 'linkedin';
  if (/indeed\./.test(u)) return 'indeed';
  if (/naukri\.com/.test(u)) return 'naukri';
  return null;
}

const SOURCES = new Set(['linkedin', 'indeed', 'naukri', 'glassdoor', 'wellfound', 'foundit', 'instahyre', 'greenhouse', 'lever', 'ashby', 'workable', 'smartrecruiters', 'recruitee', 'workday', 'web']);

/** Validates and normalises a job posted by the extension into ApplyPilot's Job shape (see connectors/_util.js). */
function normalizeJob(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new HttpError(400, 'Body must contain a "job" object');
  const title = str(raw.title, 300);
  const url = canonicalUrl(raw.url);
  if (!title) throw new HttpError(422, 'Job title is missing — open the job posting itself and try again.');
  if (!url) throw new HttpError(422, 'Job URL must be http(s)');
  const applyUrl = canonicalUrl(raw.applyUrl) || url;
  const num = (v) => (v == null || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));
  let postedAt = null;
  if (raw.postedAt) { const d = new Date(raw.postedAt); if (!Number.isNaN(d.getTime()) && d.getTime() < Date.now() + 86400000) postedAt = d.toISOString(); }
  const source = SOURCES.has(String(raw.source)) ? String(raw.source) : 'web';
  const externalId = str(raw.externalId, 200) || crypto.createHash('sha1').update(url).digest('hex').slice(0, 20);
  const location = str(raw.location, 300);
  return {
    id: `ext:${source}:${externalId}`,
    source,
    externalId,
    title,
    company: str(raw.company, 200),
    companyLogo: canonicalUrl(raw.companyLogo) || null,
    location,
    remote: !!raw.remote || /remote|anywhere|worldwide|work from home|wfh/i.test(location),
    employmentType: str(raw.employmentType, 60) || null,
    salaryMin: num(raw.salaryMin),
    salaryMax: num(raw.salaryMax),
    salaryCurrency: str(raw.salaryCurrency, 8).toUpperCase() || null,
    salaryText: str(raw.salaryText, 200) || null,
    description: str(raw.description, 12000),
    url,
    applyUrl,
    ats: detectAts(applyUrl) || detectAts(url),
    atsMeta: null,
    tags: Array.isArray(raw.tags) ? raw.tags.slice(0, 20).map((t) => str(t, 60)).filter(Boolean) : [],
    postedAt,
    savedFrom: 'browser-extension',
    extractedBy: Array.isArray(raw.extractedBy) ? raw.extractedBy.slice(0, 6).map((t) => str(t, 30)) : [],
  };
}

// ---------------------------------------------------------------- answers
const qTokens = (s) => new Set(String(s || '').toLowerCase().replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter((w) => w.length > 2));
function similarity(a, b) {
  const A = qTokens(a); const B = qTokens(b);
  if (!A.size || !B.size) return 0;
  let inter = 0; A.forEach((w) => B.has(w) && inter++);
  return inter / (A.size + B.size - inter);
}

// ---------------------------------------------------------------- bridge
async function startBridge(opts = {}) {
  const { store, manager } = opts;
  if (!store) throw new Error('startBridge: store is required');
  const log = opts.log || (() => {});
  const notify = opts.notify || (() => {});
  const emit = opts.emit || (() => {});
  const scoreJob = opts.scoreJob || require('./match').scoreJob;
  const eligibilityFn = opts.eligibility || require('./eligibility').eligibility;
  const pickResume = opts.pickResume || ((s, o) => require('./resume').pickResume(s, o));
  const getProfile = opts.getProfile || (() => (store.profile.get().values || {}));
  const getAnswers = opts.getAnswers || (() => store.qa.get().items);
  const appVersion = opts.appVersion || '';
  const ports = opts.ports || PORTS;
  const allowIds = opts.allowedExtensionIds ? new Set(opts.allowedExtensionIds) : null; // optional: restrict pairing to store-published IDs

  // ---- persisted pairings (token hashes only)
  const cfg = () => {
    const s = store.settings.get();
    if (!s[SETTINGS_KEY] || !Array.isArray(s[SETTINGS_KEY].pairings)) s[SETTINGS_KEY] = { pairings: [] };
    return s[SETTINGS_KEY];
  };
  const savePairings = (fn) => store.settings.update((s) => { if (!s[SETTINGS_KEY] || !Array.isArray(s[SETTINGS_KEY].pairings)) s[SETTINGS_KEY] = { pairings: [] }; fn(s[SETTINGS_KEY].pairings); });

  // ---- pairing code (memory only)
  let pairing = null; // { code, expiresAt, attempts }
  const newCode = () => {
    pairing = { code: String(crypto.randomInt(0, 1000000)).padStart(6, '0'), expiresAt: Date.now() + CODE_TTL_MS, attempts: 0 };
    return pairing;
  };
  const getPairingCode = () => {
    if (!pairing || Date.now() > pairing.expiresAt) newCode();
    return { code: pairing.code, expiresAt: new Date(pairing.expiresAt).toISOString() };
  };
  const resetPairing = () => { newCode(); return getPairingCode(); };
  const listPairings = () => cfg().pairings.map(({ tokenHash, ...p }) => p);
  const revokePairing = (id) => { let removed = false; savePairings((list) => { const i = list.findIndex((p) => p.id === id || p.extensionId === id); if (i >= 0) { list.splice(i, 1); removed = true; } }); return removed; };

  // ---- rate limiting
  const buckets = new Map(); // key -> { t, n }
  const rateOk = (key, limit = RATE_PER_MIN) => {
    const t = Math.floor(Date.now() / 60000);
    const b = buckets.get(key);
    if (!b || b.t !== t) { buckets.set(key, { t, n: 1 }); if (buckets.size > 500) buckets.clear(); return true; }
    b.n++;
    return b.n <= limit;
  };

  let port = null;

  const send = (res, status, body, origin) => {
    const data = Buffer.from(JSON.stringify(body));
    const headers = {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Length': data.length,
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer',
    };
    if (origin) { headers['Access-Control-Allow-Origin'] = origin; headers.Vary = 'Origin'; }
    res.writeHead(status, headers);
    res.end(data);
  };

  const readJson = (req, limit) => new Promise((resolve, reject) => {
    const ct = String(req.headers['content-type'] || '');
    if (!/^application\/json\b/i.test(ct)) { reject(new HttpError(415, 'Content-Type must be application/json')); req.resume(); return; }
    const declared = Number(req.headers['content-length'] || 0);
    if (declared > limit) { reject(new HttpError(413, `Body too large (max ${limit} bytes)`)); req.resume(); return; }
    const chunks = []; let size = 0; let done = false;
    req.on('data', (c) => {
      if (done) return;
      size += c.length;
      if (size > limit) { done = true; reject(new HttpError(413, `Body too large (max ${limit} bytes)`)); req.resume(); return; }
      chunks.push(c);
    });
    req.on('end', () => {
      if (done) return;
      done = true;
      try {
        const v = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
        if (!v || typeof v !== 'object' || Array.isArray(v)) throw new Error('not an object');
        resolve(v);
      } catch { reject(new HttpError(400, 'Invalid JSON body')); }
    });
    req.on('error', () => { if (!done) { done = true; reject(new HttpError(400, 'Read error')); } });
  });

  const authenticate = (req, extId) => {
    const m = /^Bearer ([A-Za-z0-9_-]{40,100})$/.exec(String(req.headers.authorization || ''));
    if (!m) return null;
    const h = sha256(m[1]);
    const p = cfg().pairings.find((x) => {
      const stored = Buffer.from(x.tokenHash || '', 'hex');
      return stored.length === h.length && crypto.timingSafeEqual(stored, h);
    });
    if (!p || p.extensionId !== extId) return null;
    return p;
  };

  const touch = (p) => {
    // Avoid rewriting settings.json on every request: update lastSeenAt at most once a minute.
    if (p.lastSeenAt && Date.now() - new Date(p.lastSeenAt).getTime() < 60000) return;
    savePairings((list) => { const x = list.find((y) => y.id === p.id); if (x) x.lastSeenAt = now(); });
  };

  // ---- domain helpers
  const findApplication = (job) => {
    const key = `${(job.company || '').toLowerCase().trim()}|${(job.title || '').toLowerCase().trim()}`;
    return store.applications.get().items.find((a) => a.jobId === job.id
      || (a.job && canonicalUrl(a.job.url) && canonicalUrl(a.job.url) === job.url)
      || (job.company && a.job && `${(a.job.company || '').toLowerCase().trim()}|${(a.job.title || '').toLowerCase().trim()}` === key)) || null;
  };
  const evaluate = (job) => {
    const profile = getProfile() || {};
    const resume = pickResume(store, { job });
    const match = scoreJob(job, { resumeText: resume ? resume.text || '' : '', profile, campaign: {} });
    const elig = (match && match.eligibility) || eligibilityFn(job, profile);
    return { match, eligibility: elig, resume };
  };
  const publicMatch = (m) => (m ? { score: m.score, breakdown: m.breakdown, matchedSkills: m.matchedSkills, missingSkills: m.missingSkills, reasons: m.reasons, flags: m.flags, sponsorship: m.sponsorship } : null);
  const appSummary = (a) => (a ? { id: a.id, status: a.status, score: a.score, createdAt: a.createdAt } : null);

  // ---- routes
  const routes = {
    'GET /status': (ctx) => {
      const p = getProfile() || {};
      const resumes = store.resumes.get().items || [];
      return {
        ok: true, app: 'ApplyPilot', bridge: 1, version: appVersion, paired: true, pairedAt: ctx.pairing.createdAt,
        profile: { name: [p.firstName, p.lastName].filter(Boolean).join(' '), complete: !!(p.firstName && p.email) },
        resumes: resumes.length,
        answers: (getAnswers() || []).filter((q) => q.answer).length,
      };
    },
    'POST /score': async (ctx) => {
      const body = await readJson(ctx.req, LIMITS['/score']);
      const job = normalizeJob(body.job);
      const { match, eligibility: elig, resume } = evaluate(job);
      return { match: publicMatch(match), eligibility: elig, resumeName: resume ? resume.name : null, existing: appSummary(findApplication(job)) };
    },
    'POST /jobs': async (ctx) => {
      const body = await readJson(ctx.req, LIMITS['/jobs']);
      const job = normalizeJob(body.job);
      const status = body.status === 'queued' ? 'queued' : 'saved';
      const existing = findApplication(job);
      const { match, eligibility: elig, resume } = evaluate(job);
      store.jobs.update((d) => {
        const prev = d.items[job.id];
        d.items[job.id] = { ...job, match, firstSeen: prev ? prev.firstSeen : now(), campaignIds: prev ? prev.campaignIds || [] : [] };
      });
      if (existing) return { applicationId: existing.id, duplicate: true, status: existing.status, match: publicMatch(match), eligibility: elig };
      if (!manager || typeof manager.createApplication !== 'function') throw new HttpError(503, 'ApplyPilot is still starting — try again in a moment');
      const app = manager.createApplication({ job, match, resume, campaign: null, status });
      try {
        if (typeof manager.patchApp === 'function') manager.patchApp(app.id, { campaignName: 'Browser extension' }, { type: 'step', message: `Saved from the browser (${job.source})` });
        if (typeof manager.log === 'function') manager.log('saved', `Saved from browser: ${job.title}${job.company ? ` at ${job.company}` : ''} (${match ? match.score : '?'}%)`, { applicationId: app.id });
      } catch { /* cosmetic */ }
      notify('Saved from your browser', `${job.title}${job.company ? ` at ${job.company}` : ''} — ${match ? match.score : '?'}% match`);
      emit('extension:jobSaved', { applicationId: app.id, jobId: job.id });
      log(`[bridge] saved job ${job.id} -> application ${app.id}`);
      return { applicationId: app.id, duplicate: false, status, match: publicMatch(match), eligibility: elig };
    },
    'GET /autofill-data': (ctx) => {
      const q = { get: (k) => ctx.param(k) };
      // The tracked application for this job (matched by its apply/listing URL) decides whose profile is used.
      const canon = (u) => String(u || '').trim().toLowerCase().replace(/[?#].*$/, '').replace(/\/+$/, '');
      const wantUrl = canon(q.get('url'));
      const apps = store.applications.get().items || [];
      const app = wantUrl ? apps.find((a) => a.job && [a.job.applyUrl, a.job.url].some((u) => canon(u) && canon(u) === wantUrl)) : null;
      const profile = (app && app.profile && app.profile.values) || getProfile() || {};
      const answers = (getAnswers() || []).filter((x) => x && x.question && x.answer).slice(0, 1000)
        .map((x) => ({ id: x.id, question: str(x.question, 500), answer: typeof x.answer === 'string' ? x.answer.slice(0, 5000) : x.answer, options: Array.isArray(x.options) ? x.options.slice(0, 50) : [] }));
      const items = store.resumes.get().items || [];
      const job = { title: str(q.get('title'), 300), description: str(q.get('keywords'), 2000), company: str(q.get('company'), 200) };
      const suggested = items.length ? pickResume(store, { job: job.title ? job : undefined }) : null;
      const resumes = items.map((r) => ({ id: r.id, name: r.name, fileName: r.fileName, ext: r.ext, size: r.size, isDefault: !!r.isDefault }));
      const application = app ? {
        id: app.id, status: app.status, profileId: app.profileId || 'main', profileLabel: (app.profile && app.profile.label) || 'Me',
        resumeId: app.resumeId || null, resumeName: app.resumeName || null,
      } : null;
      const out = { profile, answers, resumes, suggestedResumeId: suggested ? suggested.id : null, application };
      const want = q.get('resume');
      if (want) {
        const r = want === 'auto' ? suggested : items.find((x) => x.id === want);
        if (!r) throw new HttpError(404, 'Resume not found');
        let buf;
        try { buf = fs.readFileSync(r.path); } catch { throw new HttpError(404, 'Resume file is missing on disk — re-upload it in ApplyPilot'); }
        if (buf.length > MAX_RESUME_BYTES) throw new HttpError(413, 'Resume file is larger than 10 MB');
        const mime = { '.pdf': 'application/pdf', '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', '.txt': 'text/plain', '.md': 'text/markdown', '.rtf': 'application/rtf' }[r.ext] || 'application/octet-stream';
        out.resumeFile = { id: r.id, fileName: r.fileName, mime, size: buf.length, base64: buf.toString('base64') };
      }
      return out;
    },
    'POST /answers': async (ctx) => {
      const body = await readJson(ctx.req, LIMITS['/answers']);
      const list = Array.isArray(body.items) ? body.items : [];
      if (!list.length) throw new HttpError(400, 'items[] is required');
      if (list.length > 50) throw new HttpError(413, 'At most 50 answers per request');
      let added = 0; let updated = 0;
      store.qa.update((d) => {
        for (const it of list) {
          const question = str(it && it.question, 500);
          const answer = Array.isArray(it && it.answer) ? it.answer.slice(0, 20).map((x) => str(x, 300)).join(', ') : str(it && it.answer, 5000);
          if (question.length < 2 || !answer) continue;
          const options = Array.isArray(it.options) ? it.options.slice(0, 50).map((x) => str(x, 200)).filter(Boolean) : [];
          const cur = d.items.find((x) => x.question.trim().toLowerCase() === question.toLowerCase()) || d.items.find((x) => similarity(x.question, question) >= 0.85);
          if (cur) {
            if (cur.answer && cur.source !== 'pending' && !it.overwrite) continue; // never silently replace an answer you wrote in the app
            Object.assign(cur, { answer, options: options.length ? options : cur.options || [], source: 'browser', updatedAt: now() });
            updated++;
          } else {
            d.items.unshift({ id: crypto.randomUUID(), question, answer, options, source: 'browser', uses: 0, updatedAt: now() });
            added++;
          }
        }
      });
      if (added || updated) emit('qa:changed', { added, updated });
      return { added, updated };
    },
    'POST /unpair': (ctx) => { revokePairing(ctx.pairing.id); emit('extension:paired', listPairings()); return { ok: true }; },
  };

  const handlePair = async (req, res, origin, extId) => {
    if (!rateOk(`pair|${req.socket.remoteAddress}`, 30)) throw new HttpError(429, 'Too many pairing attempts — wait a minute');
    if (allowIds && !allowIds.has(extId)) throw new HttpError(403, 'This extension is not allowed to pair');
    const body = await readJson(req, LIMITS.default);
    const code = String(body.code || '').replace(/\D/g, '');
    if (!pairing || Date.now() > pairing.expiresAt) throw new HttpError(401, 'No pairing code is active — open ApplyPilot → Settings → Browser extension to get a new code');
    const ok = code.length === 6 && crypto.timingSafeEqual(Buffer.from(code), Buffer.from(pairing.code));
    if (!ok) {
      pairing.attempts++;
      if (pairing.attempts >= MAX_CODE_ATTEMPTS) { pairing = null; throw new HttpError(401, 'Too many wrong codes — ApplyPilot generated a new code'); }
      throw new HttpError(401, 'Wrong pairing code');
    }
    pairing = null; // single use
    const token = crypto.randomBytes(32).toString('base64url'); // 256-bit
    const rec = {
      id: crypto.randomUUID(), extensionId: extId, tokenHash: sha256(token).toString('hex'),
      name: str(body.name, 80) || 'ApplyPilot extension', browser: str(body.browser, 80) || '', createdAt: now(), lastSeenAt: now(),
    };
    savePairings((list) => {
      // One token per extension install: re-pairing replaces the old token.
      for (let i = list.length - 1; i >= 0; i--) if (list[i].extensionId === extId) list.splice(i, 1);
      list.push(rec);
      if (list.length > 10) list.splice(0, list.length - 10);
    });
    store.flushAll && store.flushAll();
    log(`[bridge] paired extension ${extId} (${rec.browser})`);
    notify('Browser extension connected', `${rec.browser || 'Your browser'} can now save jobs and autofill forms with ApplyPilot.`);
    emit('extension:paired', listPairings());
    send(res, 200, { token, pairingId: rec.id, app: 'ApplyPilot', version: appVersion }, origin);
  };

  const server = http.createServer(async (req, res) => {
    let origin = null;
    try {
      const host = String(req.headers.host || '');
      if (host !== `127.0.0.1:${port}` && host !== `localhost:${port}`) throw new HttpError(403, 'Bad Host');
      const o = String(req.headers.origin || '');
      const om = EXT_ORIGIN.exec(o);
      if (!om) throw new HttpError(403, 'Only the ApplyPilot browser extension may use this bridge');
      const extId = om[1];
      const url = new URL(req.url, `http://127.0.0.1:${port}`);
      const isKnown = cfg().pairings.some((p) => p.extensionId === extId);
      if (isKnown || url.pathname === '/pair') origin = o; // CORS only ever echoes an allowed extension origin

      if (req.method === 'OPTIONS') {
        if (!origin) throw new HttpError(403, 'Unknown extension');
        res.writeHead(204, {
          'Access-Control-Allow-Origin': origin, Vary: 'Origin', 'Access-Control-Allow-Methods': 'GET, POST',
          'Access-Control-Allow-Headers': 'Authorization, Content-Type', 'Access-Control-Max-Age': '600', 'Content-Length': 0,
        });
        res.end();
        return;
      }
      if (req.method === 'POST' && url.pathname === '/pair') { await handlePair(req, res, origin, extId); return; }

      // GET routes are also reachable with POST + JSON body: Chrome omits the Origin header on extension GETs
      // that bypass CORS, so the extension uses POST for every call and the Origin check can stay strict.
      const direct = routes[`${req.method} ${url.pathname}`];
      const alias = !direct && req.method === 'POST' ? routes[`GET ${url.pathname}`] : null;
      const route = direct || alias;
      if (!route) throw new HttpError(404, 'Not found');
      const p = authenticate(req, extId);
      if (!p) throw new HttpError(401, 'Not paired', { app: 'ApplyPilot', paired: false });
      if (!rateOk(`tok|${p.id}`)) throw new HttpError(429, 'Too many requests');
      touch(p);
      const body = alias ? await readJson(req, LIMITS.default) : {};
      const param = (k) => (body[k] != null ? String(body[k]) : url.searchParams.get(k));
      const out = await route({ req, url, pairing: p, param });
      send(res, 200, out, origin);
    } catch (e) {
      const status = e instanceof HttpError ? e.status : 500;
      if (status === 500) log(`[bridge] error: ${e && e.stack ? e.stack : e}`);
      try { send(res, status, { error: status === 500 ? 'Internal error' : e.message, ...(e.extra || {}) }, origin); } catch { /* socket gone */ }
    }
  });
  server.requestTimeout = 15000;
  server.headersTimeout = 8000;
  server.keepAliveTimeout = 2000;
  server.maxHeadersCount = 40;

  const listen = (p) => new Promise((resolve, reject) => {
    const onErr = (e) => { server.off('listening', onOk); reject(e); };
    const onOk = () => { server.off('error', onErr); resolve(p); };
    server.once('error', onErr);
    server.once('listening', onOk);
    server.listen(p, '127.0.0.1');
  });
  let lastErr = null;
  for (const p of ports) {
    try { await listen(p); port = server.address().port; break; } catch (e) { lastErr = e; if (e.code !== 'EADDRINUSE' && e.code !== 'EACCES') throw e; }
  }
  if (port == null) throw new Error(`ApplyPilot bridge: no free port in ${ports[0]}-${ports[ports.length - 1]} (${lastErr && lastErr.code})`);
  log(`[bridge] listening on http://127.0.0.1:${port}`);

  return {
    port,
    getPairingCode,
    resetPairing,
    listPairings,
    revokePairing,
    stop: () => new Promise((resolve) => { server.close(() => resolve()); if (server.closeAllConnections) server.closeAllConnections(); }),
  };
}

module.exports = { startBridge, normalizeJob, canonicalUrl, PORTS };
