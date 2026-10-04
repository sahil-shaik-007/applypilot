const { app, BrowserWindow, ipcMain, dialog, shell, Notification, Tray, Menu, nativeImage, safeStorage } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const crypto = require('crypto');

const { createStore } = require('./store');
const { listConnectors, searchAll } = require('./connectors');
const { scoreJob, isExcluded, displaySkill } = require('./match');
const resumeLib = require('./resume');
const ai = require('./ai');
const license = require('./license');
const { CampaignManager } = require('./campaigns');
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
      log: (m) => console.log('[engine]', m),
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
function notify(title, body) {
  if (!store.settings.get().notifications || !Notification.isSupported()) return;
  const n = new Notification({ title, body, icon: getIcon(), silent: false });
  n.on('click', () => { if (win) { win.show(); win.focus(); } });
  n.show();
}

// ---------- window ----------
function createWindow() {
  win = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 1080,
    minHeight: 700,
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
  win.once('ready-to-show', () => win.show());
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
    { label: 'Open ApplyPilot', click: () => { win.show(); win.focus(); } },
    { label: 'Pause all campaigns', click: () => manager.stopAll() },
    { type: 'separator' },
    { label: 'Quit', click: () => { quitting = true; app.quit(); } },
  ]));
  tray.on('click', () => { win.show(); win.focus(); });
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
  let list = items.map((j) => ({ ...j, description: (j.description || '').slice(0, 4000), appStatus: applied.get(j.id) || null }));
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
      { sources: params.sources && params.sources.length ? params.sources : s.enabledSources, keys: s.keys, companies: companies(), onProgress: (p) => emit('search:progress', { searchId, ...p }) },
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
  handle('applications:openScreenshot', (id) => { const a = store.applications.get().items.find((x) => x.id === id); if (a && a.screenshotPath) shell.openPath(a.screenshotPath); });

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

  handle('activity:list', () => store.activity.get().items.slice(0, 300));
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
    if (!manager.canUseAi()) throw new Error(s.keys.anthropic ? `Daily AI limit for the ${getPlan().label} plan reached. Upgrade for unlimited AI.` : 'Add your Anthropic API key in Settings → AI first.');
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
    if (!getSettings().keys.anthropic) return resumeLib.guessProfile(r.text);
    return aiCall(ai.parseResume, { resumeText: r.text });
  });
  handle('ai:testKey', async () => {
    const s = getSettings();
    try { await ai.testKey({ apiKey: s.keys.anthropic, model: 'claude-haiku-4-5' }); return true; } catch (e) { throw new Error(ai.errMessage(e)); }
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
    if (e && e.openUrl) return e.openUrl(url);
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
  manager = new CampaignManager({ store, getEngine, ai, getPlan, emit, notify, companies });
  manager.settings = () => getSettings();
  registerIpc();
  createWindow();
  createTray();
  if (process.argv.includes('--hidden')) win.once('ready-to-show', () => win.hide());
  resumeLib.migrateResumes(store).then(() => emit('resumes:changed', store.resumes.get().items.map((r) => r.id))).catch(() => {});
  setTimeout(() => manager.resumeAll(), 4000);
  setInterval(followUpTick, 60 * 60 * 1000);
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

app.on('second-instance', () => { if (win) { if (win.isMinimized()) win.restore(); win.show(); win.focus(); } });
app.on('before-quit', () => { quitting = true; try { manager && manager.stopAll(); } catch {} try { store && store.flushAll(); } catch {} });
app.on('will-quit', async () => { try { engine && engine.close && (await engine.close()); } catch {} });
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
