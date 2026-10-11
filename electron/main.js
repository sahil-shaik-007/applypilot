const { app, BrowserWindow, ipcMain, dialog, shell, Notification, Tray, Menu, nativeImage, safeStorage } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const crypto = require('crypto');

const { createStore } = require('./store');
const { listConnectors, searchAll } = require('./connectors');
const { scoreJob, isExcluded, displaySkill } = require('./match');
const { isCurrentEmployer, countryOf, COUNTRIES } = require('./jobFilters');
const resumeLib = require('./resume');
const ai = require('./ai');
const license = require('./license');
const { CampaignManager } = require('./campaigns');
const windowFit = require('./windowFit');
const tailored = require('./tailoredResume');
const csvImport = require('./csvImport');
const { CloudSync } = require('./cloudSync');
let cloud = null;
const PROFILE_SCHEMA = require('./data/profile-schema.json');

// Allows isolated test profiles: APPLYPILOT_USER_DATA=C:	mpp electron .
if (process.env.APPLYPILOT_USER_DATA) app.setPath('userData', process.env.APPLYPILOT_USER_DATA);

if (!app.requestSingleInstanceLock()) { app.quit(); process.exit(0); }
app.setAppUserModelId('com.applypilot.desktop');

let win = null;
let tray = null;
let quitting = false;
let store;
let engine = null;
let manager;

const isDev = !!process.env.VITE_DEV_SERVER_URL;
const iconPath = path.join(__dirname, '..', 'build', 'icon.png');
let appIcon = null; // NativeImage, loaded once (works from inside app.asar for window, tray and toasts)
const getIcon = () => { if (!appIcon) { appIcon = nativeImage.createFromPath(iconPath); } return appIcon.isEmpty() ? undefined : appIcon; };

// ---------- secrets ----------
function enc(v) {
  if (!v) return '';
  if (safeStorage.isEncryptionAvailable()) return `enc:${safeStorage.encryptString(v).toString('base64')}`;
  return `b64:${Buffer.from(v).toString('base64')}`;
}
function dec(v) {
  if (!v) return '';
  try {
    if (v.startsWith('enc:')) return safeStorage.decryptString(Buffer.from(v.slice(4), 'base64'));
    if (v.startsWith('b64:')) return Buffer.from(v.slice(4), 'base64').toString('utf8');
  } catch { return ''; }
  return v;
}
function getSettings() {
  const raw = store.settings.get();
  const keys = {};
  for (const [k, v] of Object.entries(raw.keys || {})) keys[k] = dec(v);
  return { ...raw, keys };
}
function publicSettings() {
  const raw = store.settings.get();
  const keys = {};
  for (const [k, v] of Object.entries(raw.keys || {})) {
    const d = dec(v);
    keys[k] = d ? (d.length > 8 ? `${d.slice(0, 4)}••••${d.slice(-4)}` : '••••') : '';
  }
  return { ...raw, keys };
}

function getPlan() { return license.currentPlan(store.license.get()); }

function companies() {
  let base = {};
  try { base = require('./data/companies.json'); } catch {}
  const custom = store.settings.get().customCompanies || {};
  const out = {};
  for (const k of new Set([...Object.keys(base), ...Object.keys(custom)])) {
    const seen = new Set();
    out[k] = [...(base[k] || []), ...(custom[k] || [])].filter((c) => c && c.slug && !seen.has(c.slug) && seen.add(c.slug));
  }
  return out;
}

function getEngine() {
  if (engine) return engine;
  try {
    const { ApplyEngine } = require('./apply/engine');
    engine = new ApplyEngine({
      userDataDir: app.getPath('userData'),
      getSettings: () => {
        const s = getSettings();
        // Always visible: review/assisted tabs must be seen by the user. (Hidden only for automated tests.)
        return { browserChannel: s.browserChannel, browserPath: s.browserPath, headless: process.env.APPLYPILOT_HEADLESS === '1', maxParallelBrowsers: Math.min(s.maxParallelBrowsers, getPlan().parallelBrowsers), humanDelays: s.humanDelays, slowMo: 0 };
      },
      log: (m) => { console.log('[engine]', m); logToFile('info', `[engine] ${m}`); },
    });
  } catch (e) {
    console.error('Apply engine failed to load', e);
    engine = null;
  }
  return engine;
}

function emit(channel, payload) {
  if (win && !win.isDestroyed()) win.webContents.send('event', { channel, payload });
}
// ---------- local log file (no personal data: messages are app events/errors only) ----------
const logLines = [];
function logToFile(level, msg) {
  const line = `${new Date().toISOString()} [${level}] ${String(msg).replace(/[\r\n]+/g, ' ').slice(0, 2000)}`;
  logLines.push(line); if (logLines.length > 2000) logLines.shift();
  try {
    const dir = path.join(app.getPath('userData'), 'logs');
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, 'applypilot.log');
    if (fs.existsSync(file) && fs.statSync(file).size > 2 * 1024 * 1024) fs.renameSync(file, path.join(dir, 'applypilot.1.log'));
    fs.appendFileSync(file, line + '\n');
  } catch { /* logging must never crash the app */ }
}
process.on('uncaughtException', (e) => logToFile('error', `uncaught: ${e && e.stack ? e.stack : e}`));
process.on('unhandledRejection', (e) => logToFile('error', `unhandled: ${e && e.stack ? e.stack : e}`));

function notify(title, body) {
  if (!store.settings.get().notifications || !Notification.isSupported()) return;
  const n = new Notification({ title, body, icon: getIcon(), silent: false });
  n.on('click', () => windowFit.reveal(win));
  n.show();
}

// ---------- window ----------
function createWindow() {
  const saved = store.settings.get().windowState;
  const bounds = windowFit.initialBounds(saved);
  win = new BrowserWindow({
    ...bounds,
    minWidth: windowFit.MIN.width,
    minHeight: windowFit.MIN.height,
    backgroundColor: '#0a0a0a',
    show: false,
    title: 'ApplyPilot',
    icon: getIcon(),
    titleBarStyle: 'hidden',
    titleBarOverlay: { color: '#0a0a0a', symbolColor: '#a3a3a3', height: 40 },
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: true,
    },
  });
  win.once('ready-to-show', () => { if (saved && saved.maximized) win.maximize(); win.show(); });
  // Never let the window extend under the taskbar (see windowFit.js).
  const recheck = windowFit.attach(win, {
    log: (m) => console.log(m),
    onSave: (state) => { store.settings.get().windowState = state; store.settings.save(); },
  });
  ipcMain.removeHandler('window:fit');
  ipcMain.handle('window:fit', () => { recheck('renderer'); return true; });
  if (isDev) win.loadURL(process.env.VITE_DEV_SERVER_URL);
  else win.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));

  // External links open in the user's default browser.
  win.webContents.setWindowOpenHandler(({ url }) => { if (/^https?:/.test(url)) shell.openExternal(url); return { action: 'deny' }; });
  win.webContents.on('will-navigate', (e, url) => { if (!url.startsWith('file:') && !url.startsWith(process.env.VITE_DEV_SERVER_URL || '§')) { e.preventDefault(); shell.openExternal(url); } });

  win.on('close', (e) => {
    // Keep campaigns running in the tray.
    if (!quitting && manager && manager.runners.size > 0) {
      e.preventDefault();
      win.hide();
      if (!store.settings.get().trayHintShown) {
        notify('ApplyPilot is still running', 'Your campaigns keep applying in the background. Right-click the tray icon to quit.');
        store.settings.update((s) => { s.trayHintShown = true; });
      }
    }
  });
}

function createTray() {
  const icon = getIcon();
  if (!icon) return;
  tray = new Tray(icon.resize({ width: 16, height: 16 }));
  tray.setToolTip('ApplyPilot');
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Open ApplyPilot', click: () => windowFit.reveal(win) },
    { label: 'Pause all campaigns', click: () => manager.stopAll() },
    { type: 'separator' },
    { label: 'Quit', click: () => { quitting = true; app.quit(); } },
  ]));
  tray.on('click', () => windowFit.reveal(win));
}

// ---------- IPC ----------
function handle(channel, fn) {
  ipcMain.handle(channel, async (_e, ...args) => {
    try { return { ok: true, data: await fn(...args) }; } catch (e) { return { ok: false, error: e && e.message ? e.message : String(e) }; }
  });
}

function jobsForUi(filter = {}) {
  const items = Object.values(store.jobs.get().items);
  const applied = new Map(store.applications.get().items.map((a) => [a.jobId, a.status]));
  let list = items.map((j) => ({ ...j, description: (j.description || '').slice(0, 4000), appStatus: applied.get(j.id) || null, country: countryOf(j) }));
  if (filter.campaignId) list = list.filter((j) => (j.campaignIds || []).includes(filter.campaignId));
  if (filter.ids) { const s = new Set(filter.ids); list = list.filter((j) => s.has(j.id)); }
  list.sort((a, b) => (b.match?.score || 0) - (a.match?.score || 0));
  return list.slice(0, filter.limit || 1500);
}

function registerIpc() {
  handle('app:bootstrap', () => ({
    version: app.getVersion(),
    settings: publicSettings(),
    profile: store.profile.get(),
    profileSchema: PROFILE_SCHEMA,
    resumes: store.resumes.get().items.map(({ text, ...r }) => ({ ...r, skills: (r.skills || []).map(displaySkill), textLength: (text || '').length })),
    campaigns: store.campaigns.get().items,
    applications: store.applications.get().items,
    qa: store.qa.get().items,
    activity: store.activity.get().items.slice(0, 200),
    plan: getPlan(),
    connectors: listConnectors(getSettings().keys),
    aiModels: ai.MODELS,
    countries: COUNTRIES,
    platformUsage: store.platforms.get().used,
    companyCounts: Object.fromEntries(Object.entries(companies()).map(([k, v]) => [k, v.length])),
    userDataDir: app.getPath('userData'),
  }));

  handle('platforms:list', () => { try { return require('./data/platforms.json'); } catch { return []; } });
  handle('platforms:markUsed', (id) => store.platforms.update((d) => { d.used[id] = new Date().toISOString(); return d.used; }));
  handle('connectors:list', () => listConnectors(getSettings().keys));
  handle('companies:counts', () => Object.fromEntries(Object.entries(companies()).map(([k, v]) => [k, v.length])));

  // settings
  handle('settings:update', (patch) => {
    const { keys, ...rest } = patch || {};
    if (rest.aiProvider && !['anthropic', 'local'].includes(rest.aiProvider)) throw new Error('Unknown AI provider.');
    if (rest.localAi) {
      const url = String(rest.localAi.baseUrl || ai.LOCAL_DEFAULT_URL).trim();
      if (!/^https?:\/\/[^\s]+$/i.test(url)) throw new Error('The local AI address must start with http:// or https://, e.g. http://localhost:11434/v1');
      rest.localAi = { baseUrl: url.replace(/\/+$/, ''), model: String(rest.localAi.model || '').trim().slice(0, 120) };
    }
    store.settings.update((s) => Object.assign(s, rest));
    return publicSettings();
  });
  handle('settings:setKey', (name, value) => {
    store.settings.update((s) => { s.keys = { ...(s.keys || {}), [name]: enc((value || '').trim()) }; });
    return { settings: publicSettings(), connectors: listConnectors(getSettings().keys) };
  });

  // profile
  handle('profile:save', (values) => store.profile.set({ values, updatedAt: new Date().toISOString() }));

  // resumes
  const resumeOut = (r) => { const { text, ...rest } = r; return { ...rest, skills: (rest.skills || []).map(displaySkill), textLength: (text || '').length }; };
  // Imports each file independently: one bad/duplicate file never blocks the others.
  const importPaths = async (paths) => {
    const plan = getPlan();
    const results = [];
    const errors = [];
    for (const p of paths) {
      if (store.resumes.get().items.length >= plan.resumes) { errors.push(`Your ${plan.label} plan stores up to ${plan.resumes} resumes — delete one or upgrade.`); break; }
      try {
        const { resume, guessed } = await resumeLib.importResume(store, p);
        results.push({ resume: resumeOut(resume), guessed });
      } catch (e) { errors.push(e.message); }
    }
    return { results, errors };
  };
  handle('resumes:pick', async () => {
    const r = await dialog.showOpenDialog(win, { title: 'Upload resume', properties: ['openFile', 'multiSelections'], filters: [{ name: 'Resumes', extensions: ['pdf', 'docx', 'txt', 'md'] }] });
    if (r.canceled) return { results: [], errors: [] };
    return importPaths(r.filePaths);
  });
  handle('resumes:importPaths', (paths) => importPaths(paths));
  handle('resumes:update', (id, patch) => {
    store.resumes.update((d) => {
      if (patch.isDefault) d.items.forEach((x) => { x.isDefault = false; });
      const r = d.items.find((x) => x.id === id);
      if (r) Object.assign(r, (({ name, roles, isDefault, notes }) => ({ name, roles, isDefault, notes }))({ ...r, ...patch }));
    });
    return store.resumes.get().items.map(resumeOut);
  });
  handle('resumes:delete', (id) => { resumeLib.deleteResume(store, id); return store.resumes.get().items.map(resumeOut); });
  handle('resumes:reparse', async (id) => resumeOut(await resumeLib.reparseResume(store, id)));
  handle('resumes:open', (id) => { const r = store.resumes.get().items.find((x) => x.id === id); if (r) shell.openPath(r.path); });
  handle('resumes:text', (id) => (store.resumes.get().items.find((x) => x.id === id) || {}).text || '');
  handle('resumes:list', () => store.resumes.get().items.map(resumeOut));

  // jobs
  handle('jobs:search', async (params) => {
    const s = getSettings();
    const profile = store.profile.get().values || {};
    const searchId = params.searchId || crypto.randomUUID();
    const { jobs, stats } = await searchAll(
      { query: params.query, location: params.location || '', remote: params.remote || 'any', limit: 80 },
      { sources: params.sources && params.sources.length ? params.sources : s.enabledSources, keys: s.keys, companies: companies(), careerPages: store.careerPages.get().items, onProgress: (p) => emit('search:progress', { searchId, ...p }) },
    );
    const scored = jobs.map((job) => {
      const resume = resumeLib.pickResume(store, { job });
      return { ...job, match: scoreJob(job, { resumeText: resume ? resume.text : '', profile, campaign: { roles: [params.query] } }), excluded: isExcluded(job, { profile }) };
    });
    store.jobs.update((d) => {
      for (const j of scored) d.items[j.id] = { ...j, firstSeen: d.items[j.id]?.firstSeen || new Date().toISOString(), campaignIds: d.items[j.id]?.campaignIds || [] };
    });
    return { jobs: jobsForUi({ ids: scored.map((j) => j.id) }), stats };
  });
  handle('jobs:list', (filter) => jobsForUi(filter));
  handle('jobs:get', (id) => store.jobs.get().items[id] || null);
  // Market salary range for similar roles, computed locally from every job ApplyPilot has seen.
  handle('insights:salary', (jobId) => {
    const all = store.jobs.get().items;
    const job = all[jobId] || (store.applications.get().items.find((a) => a.jobId === jobId) || {}).job;
    if (!job) return null;
    const words = (t) => new Set(String(t || '').toLowerCase().replace(/(senior|sr|junior|jr|lead|staff|principal|ii|iii|iv|i)/g, ' ').split(/[^a-z0-9+#]+/).filter((w) => w.length > 1));
    const target = words(job.title);
    const cur = job.salaryCurrency || null;
    const mids = [];
    for (const j of Object.values(all)) {
      if (!(j.salaryMin || j.salaryMax) || (cur && j.salaryCurrency && j.salaryCurrency !== cur)) continue;
      const w = words(j.title); let inter = 0; target.forEach((x) => w.has(x) && inter++);
      if (!target.size || inter / target.size < 0.6) continue;
      const lo = j.salaryMin || j.salaryMax; const hi = j.salaryMax || j.salaryMin;
      mids.push({ v: (lo + hi) / 2, cur: j.salaryCurrency || cur });
    }
    if (mids.length < 5) return { count: mids.length };
    const currency = cur || mids[0].cur;
    const vals = mids.filter((m) => !currency || m.cur === currency).map((m) => m.v).sort((a, b) => a - b);
    const q = (p) => vals[Math.min(vals.length - 1, Math.max(0, Math.round(p * (vals.length - 1))))];
    return { count: vals.length, currency, p25: q(0.25), median: q(0.5), p75: q(0.75) };
  });
  handle('jobs:save', (jobId) => {
    const job = store.jobs.get().items[jobId];
    if (!job) throw new Error('Job not found');
    const existing = store.applications.get().items.find((a) => a.jobId === jobId);
    if (existing) return existing;
    return manager.createApplication({ job, match: job.match, resume: resumeLib.pickResume(store, { job }), campaign: null, status: 'saved' });
  });
  handle('jobs:apply', async (jobId, opts = {}) => {
    const job = store.jobs.get().items[jobId];
    if (!job) throw new Error('Job not found');
    let app = store.applications.get().items.find((a) => a.jobId === jobId);
    const resume = resumeLib.pickResume(store, { resumeId: opts.resumeId, job });
    if (!resume) throw new Error('Upload a resume first (Resumes tab).');
    if (isCurrentEmployer(job, store.profile.get().values || {})) throw new Error(`${job.company} is where you work today, so ApplyPilot won't apply there. Change this in Profile → work history if that's out of date.`);
    if (!app) app = manager.createApplication({ job, match: job.match, resume, campaign: null, status: 'queued' });
    else manager.patchApp(app.id, { resumeId: resume.id, resumeName: resume.name });
    manager.applyApplication(app.id, { mode: opts.mode || getSettings().defaultApplyMode });
    return app;
  });

  // campaigns
  handle('campaigns:save', (c) => {
    let out;
    store.campaigns.update((d) => {
      if (c.id) { const cur = d.items.find((x) => x.id === c.id); if (cur) { Object.assign(cur, c, { updatedAt: new Date().toISOString() }); out = cur; } }
      if (!out) {
        out = { id: crypto.randomUUID(), status: 'paused', phase: 'idle', stats: { found: 0, applied: 0, skipped: 0, failed: 0 }, createdAt: new Date().toISOString(), intervalMinutes: 60, minScore: 55, dailyLimit: 25, mode: 'review', remote: 'any', resumeId: 'auto', coverLetter: 'ai', ...c, id: crypto.randomUUID() };
        d.items.push(out);
      }
    });
    emit('campaign:update', out);
    return out;
  });
  handle('campaigns:delete', (id) => { manager.stop(id); store.campaigns.update((d) => { d.items = d.items.filter((x) => x.id !== id); }); return store.campaigns.get().items; });
  handle('campaigns:start', (id) => { manager.start(id); return manager.campaign(id); });
  handle('campaigns:stop', (id) => { manager.stop(id); return manager.campaign(id); });
  handle('campaigns:list', () => store.campaigns.get().items);

  // applications
  handle('applications:list', () => store.applications.get().items);
  handle('applications:update', (id, patch) => {
    const allowed = (({ status, notes, followUpAt, coverLetter, resumeId, interviewAt, salaryOffered }) => ({ status, notes, followUpAt, coverLetter, resumeId, interviewAt, salaryOffered }))(patch);
    Object.keys(allowed).forEach((k) => allowed[k] === undefined && delete allowed[k]);
    if (allowed.status === 'applied') allowed.appliedAt = new Date().toISOString();
    if (allowed.resumeId) { const r = store.resumes.get().items.find((x) => x.id === allowed.resumeId); if (r) allowed.resumeName = r.name; }
    if (['interview', 'offer'].includes(allowed.status)) {
      const a = store.applications.get().items.find((x) => x.id === id);
      if (a && a.resumeId) store.resumes.update((d) => { const r = d.items.find((x) => x.id === a.resumeId); if (r) r.stats = { ...(r.stats || {}), [allowed.status === 'offer' ? 'offers' : 'interviews']: ((r.stats || {})[allowed.status === 'offer' ? 'offers' : 'interviews'] || 0) + 1 }; });
    }
    return manager.patchApp(id, allowed, allowed.status ? { type: 'status', message: `Moved to ${allowed.status}` } : null);
  });
  handle('applications:delete', (id) => { store.applications.update((d) => { d.items = d.items.filter((x) => x.id !== id); }); return true; });
  handle('applications:deleteMany', (ids) => { const set = new Set(ids || []); store.applications.update((d) => { d.items = d.items.filter((x) => !set.has(x.id)); }); return true; });
  handle('applications:approve', (ids, mode) => { (Array.isArray(ids) ? ids : [ids]).forEach((id) => manager.applyApplication(id, { mode })); return true; });
  handle('applications:cancel', (id) => manager.cancelApplication(id));
  handle('applications:hold', (id) => manager.resolvePendingSubmit(id, false));
  handle('applications:submitNow', (id) => manager.resolvePendingSubmit(id, true));
  handle('applications:openScreenshot', (id) => { const a = store.applications.get().items.find((x) => x.id === id); if (a && a.screenshotPath) shell.openPath(a.screenshotPath); });

  // Review queue: dismiss one open question from one application. Any answer saved for it stays in the Answer bank.
  // Matches on the same normalised text the Review queue card uses to list the questions.
  const normQuestion = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  handle('applications:dismissQuestion', (id, question) => {
    const a = store.applications.get().items.find((x) => x.id === id);
    if (!a) throw new Error('Application not found');
    const key = normQuestion(question);
    return manager.patchApp(id, { unanswered: (a.unanswered || []).filter((u) => normQuestion(u && u.question) !== key) });
  });

  // Q&A memory
  handle('qa:save', (item) => {
    store.qa.update((d) => {
      const cur = item.id && d.items.find((x) => x.id === item.id);
      if (cur) Object.assign(cur, item, { source: item.answer ? (cur.source === 'pending' ? 'you' : cur.source) : cur.source, updatedAt: new Date().toISOString() });
      else d.items.unshift({ id: crypto.randomUUID(), uses: 0, source: 'you', ...item, updatedAt: new Date().toISOString() });
    });
    return store.qa.get().items;
  });
  handle('qa:list', () => store.qa.get().items);
  handle('qa:delete', (id) => { store.qa.update((d) => { d.items = d.items.filter((x) => x.id !== id); }); return store.qa.get().items; });

  // ---- Network: LinkedIn connections for the referral finder (stays on this PC)
  handle('network:import', async () => {
    const r = await dialog.showOpenDialog(win, { title: 'Import LinkedIn Connections.csv', properties: ['openFile'], filters: [{ name: 'CSV', extensions: ['csv'] }] });
    if (r.canceled) return null;
    const items = csvImport.parseLinkedInConnections(csvImport.readText(r.filePaths[0]));
    if (!items.length) throw new Error("That file doesn't look like LinkedIn's Connections.csv (needs First Name, Last Name and Company columns).");
    store.network.set({ items, importedAt: new Date().toISOString() });
    return { count: items.length, companies: new Set(items.map((i) => csvImport.normCompany(i.company))).size };
  });
  handle('network:importText', (text) => {
    const items = csvImport.parseLinkedInConnections(text);
    if (!items.length) throw new Error('No connections found in that CSV.');
    store.network.set({ items, importedAt: new Date().toISOString() });
    return { count: items.length };
  });
  handle('network:stats', () => ({ count: store.network.get().items.length, importedAt: store.network.get().importedAt }));
  handle('network:clear', () => { store.network.set({ items: [], importedAt: null }); return true; });
  handle('network:forCompany', (company) => store.network.get().items.filter((c) => csvImport.sameCompany(c.company, company)).slice(0, 25));

  // ---- Import applications from Teal / Huntr / Simplify / any spreadsheet CSV
  const importTracker = (text, source) => {
    const { items, columns } = csvImport.parseTrackerCsv(text);
    const existing = new Set(store.applications.get().items.map((a) => `${(a.job.company || '').toLowerCase()}|${(a.job.title || '').toLowerCase()}`));
    let added = 0;
    store.applications.update((d) => {
      for (const it of items) {
        const key = `${it.company.toLowerCase()}|${it.title.toLowerCase()}`;
        if (existing.has(key)) continue;
        existing.add(key);
        const now = new Date().toISOString();
        d.items.push({
          id: crypto.randomUUID(), jobId: `import:${crypto.randomUUID()}`, campaignId: null, campaignName: `Imported (${source})`, resumeId: null, resumeName: null, score: null,
          job: { title: it.title, company: it.company, location: it.location, url: it.url, applyUrl: it.url, source: 'import', salaryText: it.salaryText },
          status: it.status, notes: it.notes, appliedAt: it.appliedAt || (it.status !== 'saved' ? now : null),
          events: [{ t: now, type: 'imported', message: `Imported from ${source}` }], createdAt: it.appliedAt || now, updatedAt: now,
        });
        added++;
      }
    });
    return { added, skipped: items.length - added, columns };
  };
  handle('applications:import', async () => {
    const r = await dialog.showOpenDialog(win, { title: 'Import applications (CSV from Teal, Huntr, Simplify or a spreadsheet)', properties: ['openFile'], filters: [{ name: 'CSV', extensions: ['csv'] }] });
    if (r.canceled) return null;
    const out = importTracker(csvImport.readText(r.filePaths[0]), path.basename(r.filePaths[0]));
    return { ...out, applications: store.applications.get().items };
  });
  handle('applications:importText', (text, source) => ({ ...importTracker(text, source || 'CSV'), applications: store.applications.get().items }));

  // ---- Work-search log (e.g. for unemployment-benefit programs)
  handle('data:exportWorkLog', async (fromIso) => {
    const r = await dialog.showSaveDialog(win, { title: 'Export work-search log', defaultPath: `work-search-log-${new Date().toISOString().slice(0, 10)}.csv`, filters: [{ name: 'CSV', extensions: ['csv'] }] });
    if (r.canceled) return false;
    const from = fromIso ? new Date(fromIso) : new Date(Date.now() - 28 * 86400000);
    const q = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const rows = [['Date', 'Employer', 'Position', 'Contact method', 'Website / URL', 'Location', 'Result']];
    const apps = store.applications.get().items.filter((a) => a.appliedAt && new Date(a.appliedAt) >= from).sort((a, b) => new Date(a.appliedAt) - new Date(b.appliedAt));
    for (const a of apps) rows.push([new Date(a.appliedAt).toLocaleDateString(), a.job.company, a.job.title, 'Online application', a.job.applyUrl || a.job.url, a.job.location, { applied: 'Applied — awaiting response', interview: 'Interview', offer: 'Offer received', rejected: 'Not selected' }[a.status] || a.status]);
    fs.writeFileSync(r.filePath, rows.map((row) => row.map(q).join(',')).join('\r\n'));
    return { path: r.filePath, count: apps.length };
  });

  handle('activity:list', () => store.activity.get().items.slice(0, 300));
  // ---- Phone & web (zero-knowledge sync, see docs/CLOUD.md)
  handle('cloud:status', () => cloud.status());
  handle('cloud:link', (o) => cloud.link(o));
  handle('cloud:unlink', () => cloud.unlink());
  handle('cloud:sync', () => cloud.syncNow());
  // ---- About / updates / diagnostics
  handle('app:about', () => ({ version: app.getVersion(), electron: process.versions.electron, chrome: process.versions.chrome, node: process.versions.node, platform: `${os.platform()} ${os.release()}`, arch: process.arch, packaged: app.isPackaged }));
  handle('app:checkUpdates', async () => {
    if (!app.isPackaged) return { status: 'dev', message: 'Updates are checked in installed builds only.' };
    try {
      const { autoUpdater } = require('electron-updater');
      const r = await autoUpdater.checkForUpdates();
      const latest = r && r.updateInfo ? r.updateInfo.version : null;
      if (latest && latest !== app.getVersion()) return { status: 'available', version: latest, message: `Version ${latest} is downloading — it installs when you restart ApplyPilot.` };
      return { status: 'latest', version: app.getVersion(), message: `You're on the latest version (${app.getVersion()}).` };
    } catch (e) { logToFile('warn', `update check failed: ${e.message}`); return { status: 'error', message: 'Could not check for updates right now.' }; }
  });
  handle('app:exportDiagnostics', async () => {
    const r = await dialog.showSaveDialog(win, { title: 'Save diagnostics for support', defaultPath: `applypilot-diagnostics-${new Date().toISOString().slice(0, 10)}.json`, filters: [{ name: 'JSON', extensions: ['json'] }] });
    if (r.canceled) return false;
    const s = store.settings.get();
    const counts = { resumes: store.resumes.get().items.length, campaigns: store.campaigns.get().items.length, applications: store.applications.get().items.length, qa: store.qa.get().items.length, jobsCached: Object.keys(store.jobs.get().items).length };
    const byStatus = {};
    for (const a of store.applications.get().items) byStatus[a.status] = (byStatus[a.status] || 0) + 1;
    const diag = {
      generatedAt: new Date().toISOString(), version: app.getVersion(), electron: process.versions.electron, platform: `${os.platform()} ${os.release()} ${process.arch}`,
      plan: getPlan().plan, settings: { ...s, keys: Object.fromEntries(Object.keys(s.keys || {}).map((k) => [k, s.keys[k] ? 'set' : ''])), windowState: undefined },
      counts, applicationsByStatus: byStatus, connectors: listConnectors(getSettings().keys).map((c) => ({ id: c.id, ready: c.ready })),
      cloud: cloud ? (({ linked, serverUrl, lastSyncAt, lastError }) => ({ linked, serverUrl, lastSyncAt, lastError }))(cloud.status()) : null,
      recentLog: logLines.slice(-300),
      note: 'Contains no profile, resume, application contents, API keys or license key.',
    };
    fs.writeFileSync(r.filePath, JSON.stringify(diag, null, 1));
    return r.filePath;
  });
  // Interview → calendar file (.ics) that Outlook/Google/Apple Calendar can import.
  handle('applications:exportIcs', async (id) => {
    const a = store.applications.get().items.find((x) => x.id === id);
    if (!a || !a.interviewAt) throw new Error('Set an interview date first.');
    const start = new Date(a.interviewAt);
    const end = new Date(start.getTime() + 60 * 60000);
    const fmt = (d) => d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
    const esc = (t) => String(t || '').replace(/[\\;,]/g, (c) => `\\${c}`).replace(/\n/g, '\\n');
    const ics = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//ApplyPilot//EN', 'BEGIN:VEVENT', `UID:${a.id}@applypilot`, `DTSTAMP:${fmt(new Date())}`, `DTSTART:${fmt(start)}`, `DTEND:${fmt(end)}`,
      `SUMMARY:${esc(`Interview: ${a.job.title} at ${a.job.company}`)}`, `DESCRIPTION:${esc(`${a.job.applyUrl || a.job.url || ''}\n${a.notes || ''}`)}`,
      'BEGIN:VALARM', 'TRIGGER:-PT60M', 'ACTION:DISPLAY', 'DESCRIPTION:Interview in 1 hour', 'END:VALARM', 'END:VEVENT', 'END:VCALENDAR'].join('\r\n');
    const r = await dialog.showSaveDialog(win, { title: 'Save interview to calendar', defaultPath: `interview-${(a.job.company || 'company').replace(/[^\w-]+/g, '_')}.ics`, filters: [{ name: 'Calendar', extensions: ['ics'] }] });
    if (r.canceled) return false;
    fs.writeFileSync(r.filePath, ics);
    shell.openPath(r.filePath);
    return r.filePath;
  });
  // ---- Career pages: watch ANY company's careers page (see electron/careerPages.js)
  const careerLib = () => require('./careerPages');
  const cpPublic = (p) => ({ ...p, jobsPreview: undefined });
  handle('careerPages:list', () => store.careerPages.get().items.map(cpPublic));
  handle('careerPages:inspect', async (url) => {
    let u;
    try { u = new URL(String(url || '').trim()); } catch { throw new Error('Paste a full careers page link, e.g. https://company.com/careers'); }
    if (!/^https?:$/.test(u.protocol)) throw new Error('Only http(s) links are supported.');
    const r = await careerLib().inspect(u.href);
    return { ...r, jobsPreview: (r.jobsPreview || []).slice(0, 10).map((j) => ({ id: j.id, title: j.title, location: j.location, url: j.url, ats: j.ats })) };
  });
  handle('careerPages:add', async (config) => {
    if (!config || !config.url) throw new Error('Inspect the page first.');
    if (store.careerPages.get().items.some((p) => p.url === config.url)) throw new Error('This careers page is already being watched.');
    const page = { ...config, jobsPreview: undefined, id: crypto.randomUUID(), addedAt: new Date().toISOString(), lastChecked: null, jobCount: (config.jobsPreview || []).length || config.jobCount || 0 };
    store.careerPages.update((d) => { d.items.push(page); });
    return store.careerPages.get().items.map(cpPublic);
  });
  handle('careerPages:update', (id, patch) => {
    store.careerPages.update((d) => { const p = d.items.find((x) => x.id === id); if (p) Object.assign(p, (({ company, enabled }) => ({ company, enabled }))({ ...p, ...patch })); });
    return store.careerPages.get().items.map(cpPublic);
  });
  handle('careerPages:remove', (id) => { store.careerPages.update((d) => { d.items = d.items.filter((x) => x.id !== id); }); return store.careerPages.get().items.map(cpPublic); });
  // Fetch every job on one watched page now, score it, and add it to the Jobs list.
  handle('careerPages:refresh', async (id) => {
    const page = store.careerPages.get().items.find((x) => x.id === id);
    if (!page) throw new Error('Careers page not found');
    const jobs = await careerLib().fetchJobs(page, { query: '', location: '', remote: 'any', limit: 300 });
    const profile = store.profile.get().values || {};
    store.jobs.update((d) => {
      for (const j of jobs) {
        const resume = resumeLib.pickResume(store, { job: j });
        d.items[j.id] = { ...j, match: scoreJob(j, { resumeText: resume ? resume.text : '', profile }), firstSeen: d.items[j.id]?.firstSeen || new Date().toISOString(), campaignIds: d.items[j.id]?.campaignIds || [] };
      }
    });
    store.careerPages.update((d) => { const p = d.items.find((x) => x.id === id); if (p) { p.lastChecked = new Date().toISOString(); p.jobCount = jobs.length; p.lastError = null; } });
    return { count: jobs.length, jobs: jobsForUi({ ids: jobs.map((j) => j.id) }), pages: store.careerPages.get().items.map(cpPublic) };
  });
  handle('activity:clear', () => { store.activity.update((d) => { d.items = []; }); return true; });
  // Privacy: wipe every ApplyPilot file on this PC (profile, resumes, applications, keys, browser profile) and restart fresh.
  handle('data:reset', async () => {
    manager.stopAll();
    try { if (engine && engine.close) await engine.close(); } catch {}
    engine = null;
    store.flushAll();
    const dir = app.getPath('userData');
    for (const name of ['data', 'resumes', 'screenshots', 'browser-profile']) {
      try { fs.rmSync(path.join(dir, name), { recursive: true, force: true }); } catch {}
    }
    quitting = true;
    app.relaunch();
    app.exit(0);
  });

  // AI
  const aiCall = async (fn, args) => {
    const s = getSettings();
    if (!manager.aiReady()) throw new Error(s.aiProvider === 'local' ? 'Choose a local AI model in Settings → AI first.' : 'Add your Anthropic API key in Settings → AI first.');
    if (!manager.canUseAi()) throw new Error(`Daily AI limit for the ${getPlan().label} plan reached. Upgrade for unlimited AI.`);
    // args may be a thunk so the key/limit check above runs before any lookups that could fail.
    const resolved = typeof args === 'function' ? args() : args;
    try { return await fn({ ...manager.aiArgs(), ...resolved }); } catch (e) { throw new Error(ai.errMessage(e)); }
  };
  const ctxFor = (jobId, resumeId) => {
    const job = store.jobs.get().items[jobId] || (store.applications.get().items.find((a) => a.jobId === jobId) || {}).job;
    if (!job) throw new Error('Job not found');
    const resume = resumeLib.pickResume(store, { resumeId, job });
    return { job, profile: store.profile.get().values || {}, resumeText: resume ? resume.text : '' };
  };
  handle('ai:coverLetter', (jobId, resumeId, tone) => aiCall(ai.coverLetter, () => ({ ...ctxFor(jobId, resumeId), tone })));
  handle('ai:tailor', (jobId, resumeId) => aiCall(ai.tailorResume, () => ctxFor(jobId, resumeId)));
  handle('ai:interviewPrep', (jobId, resumeId) => aiCall(ai.interviewPrep, () => ctxFor(jobId, resumeId)));
  handle('ai:outreach', (jobId, kind) => aiCall(ai.outreach, () => ({ ...ctxFor(jobId), kind })));
  // Follow-up email: AI when available, otherwise a solid template.
  handle('ai:followUp', async (appId) => {
    const a = store.applications.get().items.find((x) => x.id === appId);
    if (!a) throw new Error('Application not found');
    const p = store.profile.get().values || {};
    const days = a.appliedAt ? Math.max(1, Math.round((Date.now() - new Date(a.appliedAt)) / 86400000)) : 7;
    if (manager.canUseAi()) {
      try { return await ai.outreach({ ...manager.aiArgs(), job: a.job, profile: p, resumeText: '', kind: 'followup', days }); } catch { /* fall back */ }
    }
    return `Subject: Following up on my ${a.job.title} application

Hi ${a.job.company} team,

I applied for the ${a.job.title} role ${days} days ago and wanted to reiterate my interest. With ${p.totalYearsExperience || 'several'} years of experience in ${(p.skills || []).slice(0, 3).join(', ') || 'this field'}, I'm confident I can contribute quickly. I'd welcome the chance to discuss how I can help your team.

Thank you for your time,
${[p.firstName, p.lastName].filter(Boolean).join(' ')}${p.phone ? `
${p.phoneCountryCode || ''} ${p.phone}` : ''}${p.linkedin ? `
${p.linkedin}` : ''}`;
  });
  // AI-tailored, verified resume PDF for one job (attached to its application when there is one).
  handle('resume:tailor', async (jobId, resumeId) => {
    if (!manager.aiReady()) throw new Error(getSettings().aiProvider === 'local' ? 'Choose a local AI model in Settings → AI to tailor resumes.' : 'Add your Anthropic API key in Settings → AI to tailor resumes.');
    if (!manager.canUseAi()) throw new Error(`Daily AI limit for the ${getPlan().label} plan reached.`);
    const ctx = ctxFor(jobId, resumeId);
    const resume = resumeLib.pickResume(store, { resumeId, job: ctx.job });
    let r;
    try { r = await tailored.generate({ ai, aiArgs: manager.aiArgs(), job: { ...ctx.job, id: jobId }, profile: ctx.profile, resume, outDir: path.join(app.getPath('userData'), 'resumes', 'tailored') }); } catch (e) { throw new Error(ai.errMessage(e)); }
    const appRec = store.applications.get().items.find((a) => a.jobId === jobId);
    if (appRec) manager.patchApp(appRec.id, { tailored: { ...r, baseResumeId: resume.id } }, { type: 'step', message: `Tailored resume created from "${resume.name}"` });
    return { ...r, attachedTo: appRec ? appRec.id : null };
  });
  handle('ai:customJob', (fn, jobText, resumeId) => {
    const job = { title: 'Pasted job', company: '', description: jobText };
    const resume = resumeLib.pickResume(store, { resumeId, job });
    const map = { coverLetter: ai.coverLetter, tailor: ai.tailorResume, interviewPrep: ai.interviewPrep };
    if (!map[fn]) throw new Error('Unknown AI action');
    return aiCall(map[fn], { job, profile: store.profile.get().values || {}, resumeText: resume ? resume.text : '' });
  });
  handle('ai:parseResume', async (resumeId) => {
    const r = store.resumes.get().items.find((x) => x.id === resumeId);
    if (!r || !r.text) throw new Error('Resume has no readable text');
    if (!manager.aiReady()) return resumeLib.guessProfile(r.text);
    return aiCall(ai.parseResume, { resumeText: r.text });
  });
  handle('ai:testKey', async () => {
    const s = getSettings();
    try { await ai.testKey({ apiKey: s.keys.anthropic, model: 'claude-haiku-4-5' }); return true; } catch (e) { throw new Error(ai.errMessage(e)); }
  });
  // Local model: list what the server at this address has installed (also proves it's reachable).
  handle('ai:localModels', async (baseUrl) => {
    try { return await ai.localModels(baseUrl); } catch (e) { throw new Error(e.message); }
  });
  // Plain-English job search: the AI plans, the app checks real open postings.
  handle('discover:run', async (prompt) => {
    if (!manager.aiReady()) throw new Error(getSettings().aiProvider === 'local' ? 'Choose a local AI model in Settings → AI first.' : 'Add your Anthropic API key in Settings → AI to use plain-English search.');
    if (!manager.canUseAi()) throw new Error(`Daily AI limit for the ${getPlan().label} plan reached.`);
    const { discover } = require('./discover');
    const s = getSettings();
    const profile = store.profile.get().values || {};
    const scoreFor = (job) => { const r = resumeLib.pickResume(store, { job }); return scoreJob(job, { resumeText: r ? r.text : '', profile }); };
    let r;
    try {
      r = await discover(prompt, {
        aiArgs: manager.aiArgs(), keys: s.keys, companies: companies(), careerPages: store.careerPages.get().items, scoreFor,
        log: (m) => logToFile('info', `[discover] ${m}`), onProgress: (p) => emit('search:progress', { searchId: 'discover', ...p }),
      });
    } catch (e) { throw new Error(ai.errMessage(e)); }
    store.jobs.update((d) => {
      for (const j of r.jobs) { const prev = d.items[j.id]; d.items[j.id] = { ...j, firstSeen: prev ? prev.firstSeen : new Date().toISOString(), campaignIds: prev ? prev.campaignIds || [] : [] }; }
    });
    store.activity.update((d) => { d.items.unshift({ id: crypto.randomUUID(), t: new Date().toISOString(), type: 'discover', message: `Plain-English search "${String(prompt).slice(0, 80)}": ${r.jobs.length} open role(s)` }); d.items.length = Math.min(d.items.length, 800); });
    return { ...r, jobs: jobsForUi({ ids: r.jobs.map((j) => j.id) }) };
  });

  // license
  handle('license:activate', async (key) => {
    const rec = await license.activate(key, `${os.hostname()} (${os.userInfo().username})`);
    store.license.update((d) => { Object.assign(d, { revoked: false }, rec); });
    return getPlan();
  });
  handle('license:startTrial', () => {
    store.license.update((d) => { if (!d.trialStartedAt) d.trialStartedAt = new Date().toISOString(); });
    return getPlan();
  });
  handle('license:remove', () => { store.license.update((d) => { d.key = null; d.provider = null; d.instanceId = null; }); return getPlan(); });
  handle('license:get', () => getPlan());

  // browser / system
  handle('browser:check', async () => { const e = getEngine(); return e && e.isAvailable ? e.isAvailable() : { ok: false, error: 'Engine not available' }; });
  handle('browser:open', async (url) => {
    const e = getEngine();
    if (e && e.openUrl) {
      // Application pages are opened with the user's own profile and resume (never a saved browser draft).
      const job = [...Object.values(store.jobs.get().items || {}), ...store.applications.get().items.map((a) => a.job)].find((j) => j && (j.applyUrl || j.url) === url) || { applyUrl: url, url };
      const r = await e.openUrl(url, { job, profile: store.profile.get().values || {}, resume: resumeLib.pickResume(store, { job }) });
      if (r && r.warnings && r.warnings.length) notify('Check your application details', r.warnings[0]);
      return true;
    }
    return shell.openExternal(url);
  });
  handle('shell:open', (url) => shell.openExternal(url));
  handle('shell:openPath', (p) => shell.openPath(p));

  handle('data:export', async () => {
    const r = await dialog.showSaveDialog(win, { title: 'Export ApplyPilot backup', defaultPath: `applypilot-backup-${new Date().toISOString().slice(0, 10)}.json`, filters: [{ name: 'JSON', extensions: ['json'] }] });
    if (r.canceled) return false;
    const data = { version: 1, exportedAt: new Date().toISOString(), profile: store.profile.get(), campaigns: store.campaigns.get(), applications: store.applications.get(), qa: store.qa.get(), resumes: store.resumes.get().items.map(({ path: p, ...x }) => x) };
    fs.writeFileSync(r.filePath, JSON.stringify(data, null, 1));
    return r.filePath;
  });
  handle('data:exportCsv', async () => {
    const r = await dialog.showSaveDialog(win, { title: 'Export applications (CSV)', defaultPath: `applications-${new Date().toISOString().slice(0, 10)}.csv`, filters: [{ name: 'CSV', extensions: ['csv'] }] });
    if (r.canceled) return false;
    const q = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const rows = [['Company', 'Title', 'Location', 'Status', 'Score', 'Resume', 'Campaign', 'Source', 'Applied at', 'URL', 'Notes']];
    for (const a of store.applications.get().items) rows.push([a.job.company, a.job.title, a.job.location, a.status, a.score, a.resumeName, a.campaignName, a.job.source, a.appliedAt, a.job.applyUrl || a.job.url, a.notes]);
    fs.writeFileSync(r.filePath, rows.map((row) => row.map(q).join(',')).join('\r\n'));
    return r.filePath;
  });
  handle('app:setLoginItem', (on) => { app.setLoginItemSettings({ openAtLogin: !!on, args: ['--hidden'] }); store.settings.update((s) => { s.openAtLogin = !!on; }); return true; });
}

// Daily follow-up reminders for applications that went quiet.
// Morning digest: one notification a day summarising what needs attention.
function digestTick() {
  const now = new Date();
  const today = now.toISOString().slice(0, 10);
  const s = store.settings.get();
  if (now.getHours() < 9 || s.lastDigest === today || !store.settings.get().onboarded) return;
  const apps = store.applications.get().items;
  const since = Date.now() - 86400000;
  const fresh = apps.filter((a) => a.status === 'queued' && new Date(a.createdAt).getTime() > since).length;
  const needs = apps.filter((a) => a.status === 'awaiting-you').length;
  const follow = apps.filter((a) => a.status === 'applied' && a.followUpAt && new Date(a.followUpAt) < now).length;
  const pendingQ = store.qa.get().items.filter((q) => !q.answer).length;
  store.settings.update((x) => { x.lastDigest = today; });
  if (!fresh && !needs && !follow && !pendingQ) return;
  const parts = [fresh && `${fresh} new match${fresh > 1 ? 'es' : ''}`, needs && `${needs} form${needs > 1 ? 's' : ''} ready to submit`, follow && `${follow} follow-up${follow > 1 ? 's' : ''} due`, pendingQ && `${pendingQ} question${pendingQ > 1 ? 's' : ''} to answer`].filter(Boolean);
  notify('Your ApplyPilot morning digest', parts.join(' · '));
}

function followUpTick() {
  const due = store.applications.get().items.filter((a) => a.status === 'applied' && a.followUpAt && new Date(a.followUpAt) < new Date() && !a.followUpNotified);
  if (!due.length) return;
  notify('Time to follow up', `${due.length} application${due.length > 1 ? 's' : ''} had no response for a week. Open ApplyPilot to send a quick follow-up.`);
  store.applications.update((d) => d.items.forEach((a) => { if (due.some((x) => x.id === a.id)) a.followUpNotified = true; }));
  emit('followups', due.map((a) => a.id));
}

app.whenReady().then(() => {
  store = createStore(app.getPath('userData'));
  // Every new install starts with a 7-day Pro trial (no card), so onboarding is never blocked by Free limits.
  store.license.update((d) => { if (!d.trialStartedAt && !d.key) d.trialStartedAt = new Date().toISOString(); });
  manager = new CampaignManager({ store, getEngine, ai, getPlan, emit, notify, companies, tailoredDir: path.join(app.getPath('userData'), 'resumes', 'tailored') });
  manager.settings = () => getSettings();
  cloud = new CloudSync({ store, manager, emit, notify, encrypt: enc, decrypt: dec, log: (m) => logToFile('info', `[cloud] ${m}`), deviceName: `ApplyPilot desktop — ${os.hostname()}` });
  cloud.start();
  setTimeout(() => cloud.syncNow().catch(() => {}), 8000);
  registerIpc();
  createWindow();
  createTray();
  if (process.argv.includes('--hidden')) win.once('ready-to-show', () => win.hide());
  resumeLib.migrateResumes(store).then(() => emit('resumes:changed', store.resumes.get().items.map((r) => r.id))).catch(() => {});
  setTimeout(() => manager.resumeAll(), 4000);
  setInterval(followUpTick, 60 * 60 * 1000);
  setInterval(digestTick, 15 * 60 * 1000);
  setTimeout(digestTick, 60000);
  setTimeout(followUpTick, 30000);
  // Online license re-validation (keeps a 14-day offline grace window).
  license.revalidate(store.license.get()).then((patch) => { if (Object.keys(patch).length) store.license.update((d) => Object.assign(d, patch)); emit('plan', getPlan()); });
  if (!isDev) {
    try {
      const { autoUpdater } = require('electron-updater');
      autoUpdater.checkForUpdatesAndNotify().catch(() => {});
    } catch {}
  }
});

app.on('second-instance', () => windowFit.reveal(win));
app.on('before-quit', () => { quitting = true; try { manager && manager.stopAll(); } catch {} try { store && store.flushAll(); } catch {} });
app.on('will-quit', async () => { try { engine && engine.close && (await engine.close()); } catch {} });
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
