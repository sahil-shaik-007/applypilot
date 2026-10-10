// ApplyPilot background runner (@capacitor/background-runner). Not a browser: no DOM, no modules, no
// URLSearchParams/AbortController. Available: fetch, setTimeout, console, CapacitorKV,
// CapacitorNotifications, CapacitorDevice. Each event runs in a fresh context; state lives in CapacitorKV.
//
// Events
//   checkJobs       (scheduled by the OS, ~every 60 min, see capacitor.config.json) -> searches each
//                   watched campaign query, compares with the last-seen job ids and notifies
//                   "N new matches for <role>"
//   configure       (from the app)  { apiBase, token, scoped, queries? }
//   status          (from the app)  -> { lastRun, lastResult, configured, queries }
//   consumePending  (from the app)  -> { pending: [{ campaignId, label, jobIds, at }] } and clears it
//   clear           (from the app, on sign-out)
//
// Privacy: KV (SharedPreferences / UserDefaults) holds ONLY the API base, a bearer token and the
// campaign search queries (role, location, remote). The server sees those queries anyway when it
// searches; no profile, resume or answers are stored here. Scoring needs the encrypted profile and the
// vault key, which never leave the app's memory, so "matches" here are new search results; the app
// scores them (and drops poor fits) when it opens.

var K = { config: 'ap.bg.config', seen: 'ap.bg.seen.', last: 'ap.bg.lastRun', result: 'ap.bg.lastResult', pending: 'ap.bg.pending' };
var MAX_SEEN = 500;
var MAX_QUERIES = 8;

function kvGet(key) {
  try { var r = CapacitorKV.get(key); var v = r && typeof r === 'object' ? r.value : r; return v == null ? null : String(v); } catch (e) { return null; }
}
function kvJSON(key, dflt) { var v = kvGet(key); if (!v) return dflt; try { return JSON.parse(v); } catch (e) { return dflt; } }
function kvSet(key, val) { try { CapacitorKV.set(key, typeof val === 'string' ? val : JSON.stringify(val)); } catch (e) { /* ignore */ } }
function kvRemove(key) { try { CapacitorKV.remove(key); } catch (e) { /* ignore */ } }

function withTimeout(p, ms) {
  return Promise.race([p, new Promise(function (_, rej) { setTimeout(function () { rej(new Error('timeout')); }, ms); })]);
}
function hashInt(s) { var h = 7; for (var i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0; return (Math.abs(h) % 2000000000) + 1; }
function qs(o) {
  var out = [];
  for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k) && o[k] != null && o[k] !== '') out.push(encodeURIComponent(k) + '=' + encodeURIComponent(String(o[k])));
  return out.join('&');
}

function online() {
  try { var n = CapacitorDevice.getNetworkStatus(); return !n || n.connected !== false; } catch (e) { return true; }
}

async function searchOnce(cfg, q) {
  var url = cfg.apiBase.replace(/\/+$/, '') + '/api/jobs/search?' + qs({ q: q.q, location: q.location, remote: q.remote || 'any' });
  var res = await withTimeout(fetch(url, { method: 'GET', headers: { Authorization: 'Bearer ' + cfg.token, Accept: 'application/json' } }), 15000);
  if (res.status === 401 || res.status === 403) { var e = new Error('auth'); e.auth = true; throw e; }
  if (!res.ok) throw new Error('HTTP ' + res.status);
  var data = await res.json();
  return (data && data.jobs) || [];
}

async function checkJobs() {
  var cfg = kvJSON(K.config, null);
  if (!cfg || !cfg.apiBase || !cfg.token || !cfg.queries || !cfg.queries.length) return { ok: false, reason: 'not-configured' };
  if (!online()) return { ok: false, reason: 'offline' };
  var started = Date.now();
  var notes = [];
  var errors = 0;
  var pending = kvJSON(K.pending, []);
  // Group the queries by campaign so one campaign makes at most one notification.
  var byCampaign = {};
  cfg.queries.slice(0, MAX_QUERIES).forEach(function (q) { var id = q.campaignId || q.q; (byCampaign[id] = byCampaign[id] || []).push(q); });
  for (var cid in byCampaign) {
    if (Date.now() - started > 24000) break; // iOS gives ~30 s
    var qsList = byCampaign[cid];
    var seenKey = K.seen + hashInt(cid);
    var seenArr = kvJSON(seenKey, null);
    var firstRun = !seenArr;
    var seen = {};
    (seenArr || []).forEach(function (id) { seen[id] = 1; });
    var fresh = [];
    for (var i = 0; i < qsList.length; i++) {
      try {
        var jobs = await searchOnce(cfg, qsList[i]);
        for (var j = 0; j < jobs.length; j++) {
          var job = jobs[j];
          if (job && job.id && !seen[job.id]) { seen[job.id] = 1; fresh.push(job); }
        }
      } catch (e) {
        if (e && e.auth) { kvSet(K.result, { at: Date.now(), ok: false, reason: 'auth' }); return { ok: false, reason: 'auth' }; }
        errors++;
      }
    }
    var ids = fresh.map(function (x) { return x.id; }).concat(seenArr || []).slice(0, MAX_SEEN);
    kvSet(seenKey, ids);
    if (!firstRun && fresh.length) {
      var label = qsList[0].label || qsList[0].q;
      notes.push({ campaignId: cid, label: label, jobs: fresh });
      pending.push({ campaignId: cid, label: label, jobIds: fresh.slice(0, 50).map(function (x) { return x.id; }), at: Date.now() });
    }
  }
  kvSet(K.pending, pending.slice(-20));
  var list = notes.map(function (n) {
    var c = n.jobs.length;
    var top = n.jobs.slice(0, 3).map(function (x) { return (x.title || 'Job') + (x.company ? ' at ' + x.company : ''); }).join(' · ');
    return {
      id: hashInt('notify:' + n.campaignId),
      title: c + ' new match' + (c === 1 ? '' : 'es') + ' for ' + n.label,
      body: top + (c > 3 ? ' and ' + (c - 3) + ' more' : '') + '. Open ApplyPilot to score and review them.',
      autoCancel: true,
      extra: { type: 'campaign-matches', campaignId: n.campaignId },
    };
  });
  if (list.length) { try { CapacitorNotifications.schedule(list); } catch (e) { /* notifications off */ } }
  var result = { at: Date.now(), ok: true, notified: list.length, newJobs: notes.reduce(function (a, n) { return a + n.jobs.length; }, 0), errors: errors };
  kvSet(K.last, String(Date.now()));
  kvSet(K.result, result);
  return result;
}

addEventListener('checkJobs', async function (resolve, reject) {
  try { resolve(await checkJobs()); } catch (e) { console.error('[applypilot] checkJobs failed: ' + (e && e.message)); reject(e); }
});

addEventListener('configure', function (resolve, reject, args) {
  try {
    var a = args || {};
    var cur = kvJSON(K.config, {}) || {};
    var base = String(a.apiBase || cur.apiBase || '');
    if (!/^https:\/\/[^/\s]+$/.test(base) && !/^http:\/\/(localhost|127\.0\.0\.1|10\.0\.2\.2|192\.168\.\d+\.\d+)(:\d+)?$/.test(base)) { resolve({ ok: false, reason: 'bad-api-base' }); return; }
    var token = String(a.token || cur.token || '');
    if (!/^[A-Za-z0-9_-]{20,200}$/.test(token)) { resolve({ ok: false, reason: 'bad-token' }); return; }
    var queries = Array.isArray(a.queries) ? a.queries.slice(0, MAX_QUERIES).map(function (q) {
      return { q: String(q.q || '').slice(0, 120), location: String(q.location || '').slice(0, 120), remote: q.remote === 'remote' || q.remote === 'onsite' ? q.remote : 'any', campaignId: String(q.campaignId || '').slice(0, 64), label: String(q.label || q.q || '').slice(0, 60) };
    }).filter(function (q) { return q.q; }) : (cur.queries || []);
    kvSet(K.config, { apiBase: base, token: token, scoped: !!a.scoped, queries: queries, updatedAt: Date.now() });
    resolve({ ok: true, queries: queries.length });
  } catch (e) { reject(e); }
});

addEventListener('status', function (resolve) {
  var cfg = kvJSON(K.config, null);
  var last = kvGet(K.last);
  resolve({ configured: !!(cfg && cfg.token), queries: cfg && cfg.queries ? cfg.queries.length : 0, lastRun: last ? Number(last) : null, lastResult: kvJSON(K.result, null), pending: (kvJSON(K.pending, []) || []).length });
});

addEventListener('consumePending', function (resolve) {
  var p = kvJSON(K.pending, []) || [];
  kvSet(K.pending, []);
  resolve({ pending: p });
});

addEventListener('clear', function (resolve) {
  var cfg = kvJSON(K.config, null);
  if (cfg && cfg.queries) cfg.queries.forEach(function (q) { kvRemove(K.seen + hashInt(q.campaignId || q.q)); });
  [K.config, K.last, K.result, K.pending].forEach(kvRemove);
  resolve({ ok: true });
});
