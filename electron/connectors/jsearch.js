// JSearch via RapidAPI — real-time Google for Jobs aggregation (LinkedIn, Indeed, Glassdoor, ZipRecruiter,
// Naukri, company sites...). The broadest single source.
// Key: setting "rapidapiKey" — subscribe at https://rapidapi.com/letscrape-6bRBa3QguO5/api/jsearch
// (free BASIC plan ≈200 requests/month; each extra page in num_pages counts). NOTE: as of late Sep 2026 the
// RapidAPI listing stopped accepting NEW subscriptions — new users should use the direct OpenWeb Ninja
// connector (jsearch_openwebninja.js, key "openwebninjaKey"). Existing RapidAPI subscriptions keep working.
const { runSearch } = require('./_jsearch');

const id = 'jsearch';

module.exports = {
  id,
  name: 'JSearch (RapidAPI)',
  kind: 'api',
  requiresKeys: ['rapidapiKey'],
  homepage: 'https://rapidapi.com/letscrape-6bRBa3QguO5/api/jsearch',
  regions: ['global', 'in', 'us', 'gb', 'eu'],
  description: 'Google for Jobs aggregation (LinkedIn, Indeed, Glassdoor, ZipRecruiter, Naukri…). Needs a RapidAPI key ("rapidapiKey") from https://rapidapi.com/letscrape-6bRBa3QguO5/api/jsearch — free plan ≈200 requests/month. New RapidAPI sign-ups were closed in Sep 2026; use "JSearch (OpenWeb Ninja)" instead if you cannot subscribe.',

  async search(params = {}, ctx = {}) {
    const keys = ctx.keys || {};
    if (!keys.rapidapiKey) throw new Error('JSearch requires a RapidAPI key (rapidapiKey)');
    return runSearch(id, 'https://jsearch.p.rapidapi.com/search', {
      'X-RapidAPI-Key': keys.rapidapiKey,
      'X-RapidAPI-Host': 'jsearch.p.rapidapi.com',
    }, { limit: 50, ...params }, keys);
  },
};
