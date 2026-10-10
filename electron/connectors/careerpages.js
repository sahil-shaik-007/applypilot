// Careers pages the user added in Settings -> Career pages (any company; see ../careerPages.js).
const { pool } = require('./_util');

module.exports = {
  id: 'careerpages',
  name: 'Your career pages',
  kind: 'ats',
  requiresKeys: [],
  homepage: null,
  regions: ['global'],
  description: 'Every company careers page you added yourself. ATS-backed pages are auto-apply capable.',
  async search({ query, location, remote, limit } = {}, ctx = {}) {
    const pages = (ctx.careerPages || []).filter((p) => p && p.enabled !== false);
    if (!pages.length) return [];
    const { fetchJobs } = require('../careerPages');
    const lists = await pool(pages, 6, (p) => fetchJobs(p, { query, location, remote, limit: 300 }).catch((e) => { ctx.log && ctx.log(`careerpages: ${p.url}: ${e.message}`); return []; }));
    return lists.flat().filter(Boolean).slice(0, Math.max(limit || 100, 200));
  },
};
