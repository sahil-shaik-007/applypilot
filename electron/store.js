// Tiny JSON document store. Each collection is one file in <userData>/data, loaded once,
// mutated in memory and flushed atomically (write tmp + rename) on a short debounce.
const fs = require('fs');
const path = require('path');

class Collection {
  constructor(file, defaults) {
    this.file = file;
    this.data = defaults;
    this.timer = null;
    try {
      if (fs.existsSync(file)) this.data = { ...defaults, ...JSON.parse(fs.readFileSync(file, 'utf8')) };
    } catch (e) {
      // Corrupt file: keep a copy for recovery and start fresh.
      try { fs.copyFileSync(file, `${file}.corrupt-${Date.now()}`); } catch {}
    }
  }
  get() { return this.data; }
  set(data) { this.data = data; this.save(); return data; }
  update(fn) { const r = fn(this.data); this.save(); return r; }
  save() {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.flush(), 250);
  }
  flush() {
    clearTimeout(this.timer);
    const body = JSON.stringify(this.data, null, 1);
    // Safety net: before a much smaller version overwrites a real file, keep a copy (newest 3 are kept), so a
    // silent loss of data can always be recovered from <file>.bak-<time>.
    try {
      if (fs.existsSync(this.file)) {
        const old = fs.statSync(this.file).size;
        if (old > 2048 && body.length < old * 0.2) {
          fs.copyFileSync(this.file, `${this.file}.bak-${Date.now()}`);
          const dir = path.dirname(this.file);
          const prefix = `${path.basename(this.file)}.bak-`;
          const olds = fs.readdirSync(dir).filter((f) => f.startsWith(prefix)).sort();
          olds.slice(0, Math.max(0, olds.length - 3)).forEach((f) => { try { fs.unlinkSync(path.join(dir, f)); } catch { /* ignore */ } });
        }
      }
    } catch { /* the guard must never block saving */ }
    const tmp = `${this.file}.tmp`;
    fs.writeFileSync(tmp, body);
    fs.renameSync(tmp, this.file);
  }
}

const DEFAULT_SETTINGS = {
  onboarded: false,
  theme: 'dark',
  browserChannel: 'msedge',
  browserPath: '',
  headless: false,
  humanDelays: true,
  maxParallelBrowsers: 3,
  defaultApplyMode: 'review',
  submitDelaySeconds: 30, // cancel window before every auto-submit
  dailyApplyLimit: 40,
  minMatchScore: 55,
  enabledSources: null, // null = all free sources
  keys: {},
  aiModel: 'claude-opus-5-5',
  aiProvider: 'anthropic', // 'anthropic' (your API key) | 'local' (Ollama, LM Studio, … on this PC or LAN)
  localAi: { baseUrl: 'http://localhost:11434/v1', model: '' },
  aiAutoCoverLetter: true,
  aiAnswerQuestions: true,
  notifications: true,
  customCompanies: { greenhouse: [], lever: [], ashby: [], workable: [], smartrecruiters: [], recruitee: [] },
};

function createStore(baseDir) {
  const dir = path.join(baseDir, 'data');
  fs.mkdirSync(dir, { recursive: true });
  fs.mkdirSync(path.join(baseDir, 'resumes'), { recursive: true });
  const c = (name, defaults) => new Collection(path.join(dir, `${name}.json`), defaults);
  const store = {
    dir: baseDir,
    resumesDir: path.join(baseDir, 'resumes'),
    settings: c('settings', DEFAULT_SETTINGS),
    profile: c('profile', { values: {}, updatedAt: null }),
    resumes: c('resumes', { items: [] }),
    campaigns: c('campaigns', { items: [] }),
    jobs: c('jobs', { items: {} }), // id -> job (+ score, campaignIds, firstSeen)
    applications: c('applications', { items: [] }),
    qa: c('qa', { items: [] }), // { id, question, answer, uses, updatedAt, profileId? } (no profileId = shared with every profile)
    activity: c('activity', { items: [] }),
    license: c('license', { key: null }),
    platforms: c('platform-usage', { used: {} }),
    network: c('network', { items: [], importedAt: null }), // LinkedIn connections (local only)
    cloud: c('cloud', {}), // phone/web sync link (token + data key are DPAPI-encrypted)
    careerPages: c('career-pages', { items: [] }), // any company careers pages the user watches
    profiles: c('profiles', { items: [] }), // extra people (synced from the phone/web vault): { id, label, values, createdAt, updatedAt }
  };
  // Make sure new default settings keys appear after upgrades.
  store.settings.data = { ...DEFAULT_SETTINGS, ...store.settings.data, keys: { ...(store.settings.data.keys || {}) } };

  // The profile an application is for. 'main' (or no id, or an unknown id) is the global profile/main record.
  store.resolveProfile = (id) => {
    const pid = id && id !== 'main' ? String(id) : 'main';
    if (pid !== 'main') {
      const p = store.profiles.get().items.find((x) => x.id === pid);
      if (p) return { id: pid, label: p.label || 'Profile', values: p.values || {} };
    }
    return { id: 'main', label: 'Main profile', values: store.profile.get().values || {} };
  };
  // Resumes usable for a profile: shared ones (profileId null) and ones tagged for that profile.
  store.resumesFor = (id) => {
    const pid = id && id !== 'main' ? String(id) : 'main';
    return store.resumes.get().items.filter((r) => !r.profileId || r.profileId === pid);
  };
  // Every profile, main first: [{ id, label, isDefault }]. Values are not included (see resolveProfile).
  store.profileList = () => [
    { id: 'main', label: 'Main profile', isDefault: true },
    ...store.profiles.get().items.map((p) => ({ id: p.id, label: p.label || 'Profile', isDefault: false })),
  ];
  // True when id is 'main' or an extra profile that exists on this PC.
  store.hasProfile = (id) => !id || id === 'main' || store.profiles.get().items.some((p) => p.id === String(id));
  // Answer-bank records one profile may use: its own (profileId === id) and shared ones (no profileId).
  // Never another profile's. Records written before profiles existed have no profileId, so they stay shared.
  store.qaFor = (id) => {
    const pid = id && id !== 'main' ? String(id) : 'main';
    return store.qa.get().items.filter((q) => !q.profileId || q.profileId === pid);
  };
  store.flushAll = () => Object.values(store).forEach((v) => v instanceof Collection && v.flush());

  // ---- rolling backups of the data folder: <userData>/backups/<time>/*.json (newest 10 kept)
  store.backupDir = path.join(baseDir, 'backups');
  const countOf = (file, pick) => { try { return pick(JSON.parse(fs.readFileSync(file, 'utf8'))); } catch { return 0; } };
  const items = (d) => (Array.isArray(d && d.items) ? d.items.length : (d && d.items ? Object.keys(d.items).length : 0));
  const summarize = (folder) => ({
    resumes: countOf(path.join(folder, 'resumes.json'), items),
    campaigns: countOf(path.join(folder, 'campaigns.json'), items),
    applications: countOf(path.join(folder, 'applications.json'), items),
    answers: countOf(path.join(folder, 'qa.json'), items),
    profileFields: countOf(path.join(folder, 'profile.json'), (d) => Object.values((d && d.values) || {}).filter((v) => v !== '' && v != null && !(Array.isArray(v) && !v.length)).length),
  });
  const meaningful = (s) => s.resumes + s.campaigns + s.applications + s.answers + s.profileFields > 0;
  const sameFiles = (a, b) => {
    const names = fs.readdirSync(a).filter((f) => f.endsWith('.json'));
    return names.length > 0 && names.every((f) => { try { return fs.readFileSync(path.join(a, f)).equals(fs.readFileSync(path.join(b, f))); } catch { return false; } });
  };
  const listNames = () => (fs.existsSync(store.backupDir) ? fs.readdirSync(store.backupDir).filter((n) => /^\d{4}-\d{2}-\d{2}T[\d-]+Z$/.test(n)).sort() : []);
  // Copies the current data files. Skips an empty profile (nothing to protect, and it must never push a good
  // backup out) and an unchanged copy. Returns the backup name, or null when nothing was written.
  store.backupNow = (reason = 'auto') => {
    try {
      store.flushAll();
      if (!meaningful(summarize(dir))) return null;
      const names = listNames();
      if (names.length && sameFiles(dir, path.join(store.backupDir, names[names.length - 1]))) return null;
      const name = new Date().toISOString().replace(/[:.]/g, '-');
      const to = path.join(store.backupDir, name);
      fs.mkdirSync(to, { recursive: true });
      for (const f of fs.readdirSync(dir)) if (f.endsWith('.json')) fs.copyFileSync(path.join(dir, f), path.join(to, f));
      // The resume files themselves (top level of the resumes folder), so a restore does not leave empty records.
      try {
        const rs = path.join(baseDir, 'resumes');
        const toR = path.join(to, 'resumes');
        for (const f of fs.readdirSync(rs)) {
          const src = path.join(rs, f);
          if (!fs.statSync(src).isFile() || fs.statSync(src).size > 15 * 1024 * 1024) continue;
          fs.mkdirSync(toR, { recursive: true });
          fs.copyFileSync(src, path.join(toR, f));
        }
      } catch { /* a backup without resume files is still useful */ }
      fs.writeFileSync(path.join(to, 'backup.txt'), `${reason}\n`);
      // Keep the newest 10 and always the richest one, so a run of poorer backups after a loss can never push the
      // good copy out.
      const all = listNames();
      const score = (n) => { const x = summarize(path.join(store.backupDir, n)); return x.applications * 3 + x.resumes * 4 + x.campaigns * 2 + x.answers + x.profileFields; };
      const best = all.reduce((a, n) => (score(n) > score(a) ? n : a), all[0]);
      all.slice(0, Math.max(0, all.length - 10)).filter((n) => n !== best).forEach((n) => { try { fs.rmSync(path.join(store.backupDir, n), { recursive: true, force: true }); } catch { /* ignore */ } });
      return name;
    } catch { return null; }
  };
  store.listBackups = () => listNames().reverse().map((name) => {
    let reason = 'auto';
    try { reason = fs.readFileSync(path.join(store.backupDir, name, 'backup.txt'), 'utf8').trim() || 'auto'; } catch { /* ignore */ }
    return { name, at: name.replace(/T(\d{2})-(\d{2})-(\d{2})-\d+Z$/, 'T$1:$2:$3Z'), reason, ...summarize(path.join(store.backupDir, name)) };
  });
  // Puts a backup's files back into the data folder. The caller restarts the app afterwards (no flush in between).
  store.restoreBackup = (name) => {
    if (!listNames().includes(String(name))) throw new Error('Backup not found');
    store.backupNow('before-restore');
    const from = path.join(store.backupDir, String(name));
    for (const f of fs.readdirSync(from)) if (f.endsWith('.json')) fs.copyFileSync(path.join(from, f), path.join(dir, f));
    // Bring back resume files that are missing (never overwrite one that is there).
    try {
      const fromR = path.join(from, 'resumes');
      const toR = path.join(baseDir, 'resumes');
      fs.mkdirSync(toR, { recursive: true });
      if (fs.existsSync(fromR)) for (const f of fs.readdirSync(fromR)) if (!fs.existsSync(path.join(toR, f))) fs.copyFileSync(path.join(fromR, f), path.join(toR, f));
    } catch { /* the data files are restored either way */ }
    return true;
  };
  return store;
}

module.exports = { createStore, DEFAULT_SETTINGS };
