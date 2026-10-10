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
    qa: c('qa', { items: [] }), // { id, question, answer, uses, updatedAt }
    activity: c('activity', { items: [] }),
    license: c('license', { key: null }),
    platforms: c('platform-usage', { used: {} }),
    network: c('network', { items: [], importedAt: null }), // LinkedIn connections (local only)
    cloud: c('cloud', {}), // phone/web sync link (token + data key are DPAPI-encrypted)
    careerPages: c('career-pages', { items: [] }), // any company careers pages the user watches
  };
  // Make sure new default settings keys appear after upgrades.
  store.settings.data = { ...DEFAULT_SETTINGS, ...store.settings.data, keys: { ...(store.settings.data.keys || {}) } };
  store.flushAll = () => Object.values(store).forEach((v) => v instanceof Collection && v.flush());
  return store;
}

module.exports = { createStore, DEFAULT_SETTINGS };
