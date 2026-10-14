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
    const tmp = `${this.file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(this.data, null, 1));
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
  return store;
}

module.exports = { createStore, DEFAULT_SETTINGS };
