// "Describe the jobs you want" — a plain-English request becomes real, open job postings.
//
//   "List data analyst roles at Stripe and Notion where they sponsor work visas"
//     1. The AI (cloud or your local model) turns the request into a plan: companies, role words,
//        visa requirement and countries. It may also suggest a careers URL for a company.
//     2. Every connected job source is searched, and only postings from the named companies are kept.
//        A suggested careers URL is used only if that page actually loads and lists jobs.
//     3. Roles, visa sponsorship and countries are checked on each posting.
// The AI never supplies a job. Each result is a posting we read from a live source, so it can be
// applied for like any other job (and the closed-job check still runs before anything is sent).

const { searchAll, loadConnectors } = require('./connectors');
const careerPages = require('./careerPages');
const { sponsorshipSignal } = require('./match');
const { normCompany, countryOf } = require('./jobFilters');
const ai = require('./ai');

const tokens = (s) => String(s || '').toLowerCase().split(/[^a-z0-9+#.]+/).filter((w) => w.length > 1);

// Same company after normalizing: equal, or one name contains the other as whole words (5+ letters).
function sameCompany(x, y) {
  if (!x || !y) return false;
  if (x === y) return true;
  const [a, b] = x.length <= y.length ? [x, y] : [y, x];
  return a.length >= 5 && ` ${b} `.includes(` ${a} `);
}

function companyMatches(job, wanted) {
  const jc = normCompany(job.company);
  if (!jc) return null;
  for (const [key, name] of wanted) if (sameCompany(jc, key)) return name;
  return null;
}

function roleMatches(job, roles) {
  if (!roles.length) return true;
  const hay = new Set(tokens(`${job.title} ${(job.tags || []).join(' ')}`));
  return roles.some((r) => tokens(r).every((t) => hay.has(t)));
}

// deps: { aiArgs, keys, companies, careerPages (saved pages), scoreFor(job) -> match, log, onProgress }
async function discover(prompt, deps) {
  const text = String(prompt || '').trim();
  if (text.length < 8) throw new Error('Describe what you want, e.g. "data analyst jobs at Stripe that sponsor visas".');
  const plan = await ai.planDiscovery({ ...deps.aiArgs, prompt: text });

  const wanted = new Map();
  for (const c of plan.companies || []) {
    const key = normCompany(c.name);
    if (key) wanted.set(key, c.name.trim());
  }
  if (!wanted.size) throw new Error('No company was named. Add one, e.g. "… at Stripe".');
  const roles = (plan.roles || []).map((r) => String(r).trim()).filter(Boolean);
  const countries = (plan.countries || []).map((c) => String(c).trim()).filter(Boolean);

  // 1. Company job boards only (ATS boards and your career pages): aggregators can't be filtered by company.
  // Only the boards of the named companies are read, which keeps this to seconds rather than minutes.
  const atsSources = loadConnectors().filter((c) => c.kind === 'ats').map((c) => c.id);
  const boards = {};
  for (const [ats, list] of Object.entries(deps.companies || {})) {
    boards[ats] = (list || []).filter((b) => {
      const key = normCompany(b.name || b.slug);
      const slugKey = normCompany(String(b.slug || '').replace(/[-_.]+/g, ' '));
      return [...wanted.keys()].some((w) => sameCompany(key, w) || sameCompany(slugKey, w));
    });
  }
  const { jobs: fromBoards } = await searchAll(
    { query: '', location: '', remote: 'any', limit: 3000 },
    { sources: atsSources, keys: deps.keys, companies: boards, careerPages: deps.careerPages || [], log: deps.log || (() => {}), onProgress: deps.onProgress, timeoutMs: 150000 },
  );

  // 2. Suggested careers pages, but only when they really load and list jobs.
  const fromPages = [];
  const pageNotes = [];
  for (const c of plan.companies || []) {
    if (!c.careersUrl) continue;
    try {
      const cfg = await careerPages.inspect(c.careersUrl);
      const jobs = await careerPages.fetchJobs({ ...cfg, company: c.name.trim() }, { limit: 300 });
      fromPages.push(...jobs);
      pageNotes.push({ company: c.name.trim(), url: c.careersUrl, count: jobs.length });
    } catch (e) {
      pageNotes.push({ company: c.name.trim(), url: c.careersUrl, count: 0, error: e.message });
    }
  }

  // 3. Keep postings from the named companies that match the role, visa and country requirements.
  const seen = new Set();
  const kept = [];
  const perCompany = {};
  for (const job of [...(fromBoards || []), ...fromPages]) {
    if (!job || !job.id || seen.has(job.id)) continue;
    const name = companyMatches(job, wanted);
    if (!name) continue;
    if (!roleMatches(job, roles)) continue;
    if (plan.requireVisaSponsorship && sponsorshipSignal(job) === 'not-offered') continue;
    if (countries.length && !countries.includes(countryOf(job))) continue;
    seen.add(job.id);
    perCompany[name] = (perCompany[name] || 0) + 1;
    const match = deps.scoreFor ? deps.scoreFor(job) : undefined;
    kept.push({ ...job, company: job.company || name, match, discoveredFor: text, discoveredAt: new Date().toISOString() });
  }
  kept.sort((a, b) => ((b.match && b.match.score) || 0) - ((a.match && a.match.score) || 0));

  const missing = [...wanted.values()].filter((n) => !perCompany[n]);
  return { plan: { ...plan, companies: [...wanted.values()], roles, countries }, jobs: kept, perCompany, missing, pageNotes };
}

module.exports = { discover, companyMatches, roleMatches };
