// The Muse — US-centric jobs at well-known companies (onsite, hybrid and remote). Free public API, no key
// required (an optional key only raises rate limits). Docs: https://www.themuse.com/developers/api/v2
const { fetchJson, htmlToText, matchesQuery, matchesLocation, makeJob, pool } = require('./_util');

const id = 'themuse';
const PAGES = 6; // 20 jobs per page

// Map free-text queries onto The Muse's category taxonomy so local filtering has relevant input.
const CATEGORY_RULES = [
  [/data (analyst|analytics)|business intelligence|\bbi\b|analytics/i, 'Data and Analytics'],
  [/data scien|machine learning|\bml\b|\bai\b/i, 'Data and Analytics'],
  [/product manag|product owner/i, 'Product Management'],
  [/project manag|program manag|scrum/i, 'Project Management'],
  [/design|ux|ui\b/i, 'Design and UX'],
  [/software|developer|engineer|devops|sre|frontend|backend|full.?stack|programmer|qa\b|test/i, 'Software Engineering'],
  [/sales|account exec|business develop/i, 'Sales'],
  [/recruit|talent|\bhr\b|human resources|people/i, 'Human Resources and Recruitment'],
  [/account|finance|financial|audit|tax/i, 'Accounting and Finance'],
  [/customer (service|support|success)/i, 'Customer Service'],
  [/writ|editor|content/i, 'Writing and Editing'],
  [/operations|business analyst|strategy/i, 'Business Operations'],
];

module.exports = {
  id,
  name: 'The Muse',
  kind: 'api',
  requiresKeys: [],
  homepage: 'https://www.themuse.com',
  regions: ['us', 'global', 'remote'],
  description: 'Jobs at well-known (mostly US) companies, incl. "Flexible / Remote". Free public API, no key. Filtered locally by query.',

  async search({ query = '', location = '', remote = 'any', limit = 50 } = {}, ctx = {}) {
    const category = (CATEGORY_RULES.find(([re]) => re.test(query)) || [])[1];
    const base = new URLSearchParams();
    if (category) base.set('category', category);
    if (remote === 'remote') base.set('location', 'Flexible / Remote');
    if (ctx.keys?.themuseKey) base.set('api_key', ctx.keys.themuseKey);
    const pages = Array.from({ length: PAGES }, (_, i) => i + 1);
    const results = await pool(pages, 3, (p) => fetchJson(`https://www.themuse.com/api/public/jobs?${base}&page=${p}`));
    if (!results.some(Boolean)) throw new Error('The Muse API request failed');
    const out = [];
    const seen = new Set();
    for (const res of results) {
      for (const r of res?.results || []) {
        if (!r?.id || seen.has(r.id)) continue;
        seen.add(r.id);
        const locs = (r.locations || []).map((l) => l.name).filter(Boolean);
        const isRemote = locs.some((l) => /remote|flexible/i.test(l));
        const job = makeJob(id, {
          externalId: r.id,
          title: r.name,
          company: r.company?.name,
          companyLogo: null, // not included in the jobs payload
          location: locs.join('; '),
          remote: isRemote,
          employmentType: r.type === 'external' ? null : r.type || null,
          description: htmlToText(r.contents),
          url: r.refs?.landing_page,
          tags: [...(r.levels || []).map((l) => l.name), ...(r.categories || []).map((c) => c.name), ...(r.tags || []).map((t) => t.name || t)].filter(Boolean),
          postedAt: r.publication_date || null,
        });
        // Match on title only: The Muse's category tags are too broad (e.g. retail roles tagged "Software Engineering").
        if (!matchesQuery({ title: job.title, tags: [] }, query) || !matchesLocation(job, location, remote)) continue;
        out.push(job);
      }
    }
    return out.sort((a, b) => String(b.postedAt).localeCompare(String(a.postedAt))).slice(0, limit);
  },
};
