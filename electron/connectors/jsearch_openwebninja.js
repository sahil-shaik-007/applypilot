// JSearch direct from OpenWeb Ninja (same data/params as the RapidAPI listing, without RapidAPI).
// Key: setting "openwebninjaKey" — sign up at https://www.openwebninja.com/api/jsearch
// (free tier: 200 requests/month, hard limit, 1000 req/hour). Auth header: x-api-key.
const { runSearch } = require('./_jsearch');

const id = 'jsearch_openwebninja';

module.exports = {
  id,
  name: 'JSearch (OpenWeb Ninja)',
  kind: 'api',
  requiresKeys: ['openwebninjaKey'],
  homepage: 'https://www.openwebninja.com/api/jsearch',
  regions: ['global', 'in', 'us', 'gb', 'eu'],
  description: 'Google for Jobs aggregation (LinkedIn, Indeed, Glassdoor, ZipRecruiter, Naukri…) direct from OpenWeb Ninja. Key "openwebninjaKey" from https://www.openwebninja.com/api/jsearch — free tier 200 requests/month.',

  async search(params = {}, ctx = {}) {
    const keys = ctx.keys || {};
    if (!keys.openwebninjaKey) throw new Error('JSearch (OpenWeb Ninja) requires an API key (openwebninjaKey)');
    return runSearch(id, 'https://api.openwebninja.com/jsearch/search', { 'x-api-key': keys.openwebninjaKey }, { limit: 50, ...params }, keys);
  },
};
