// We Work Remotely — one of the largest remote job boards. Public RSS feeds, no key.
const { fetchText, htmlToText, matchesQuery, matchesLocation, makeJob, pool } = require('./_util');
const { parseRssItems, decodeEntities, dedupe } = require('./_helpers');

const id = 'weworkremotely';
const FEEDS = [
  'remote-jobs',
  'categories/remote-full-stack-programming-jobs',
  'categories/remote-back-end-programming-jobs',
  'categories/remote-front-end-programming-jobs',
  'categories/remote-programming-jobs',
  'categories/remote-devops-sysadmin-jobs',
  'categories/remote-design-jobs',
  'categories/remote-product-jobs',
  'categories/remote-customer-support-jobs',
  'categories/remote-sales-and-marketing-jobs',
  'categories/remote-management-and-finance-jobs',
  'categories/all-other-remote-jobs',
];

module.exports = {
  id,
  name: 'We Work Remotely',
  kind: 'feed',
  requiresKeys: [],
  homepage: 'https://weworkremotely.com',
  regions: ['remote', 'global'],
  description: 'Remote jobs from weworkremotely.com via its public RSS feeds (all categories). No key. Remote-only.',

  async search({ query = '', location = '', remote = 'any', limit = 50 } = {}, ctx = {}) {
    if (remote === 'onsite') return [];
    const xmls = await pool(FEEDS, 4, (f) => fetchText(`https://weworkremotely.com/${f}.rss`, { timeout: 25000 }));
    if (!xmls.some(Boolean)) throw new Error('We Work Remotely feeds unavailable');
    const jobs = [];
    for (const xml of xmls) {
      if (!xml) continue;
      for (const it of parseRssItems(xml)) {
        const rawTitle = decodeEntities(it.get('title'));
        const idx = rawTitle.indexOf(':');
        const company = idx > 0 ? rawTitle.slice(0, idx).trim() : '';
        const title = idx > 0 ? rawTitle.slice(idx + 1).trim() : rawTitle;
        const link = it.get('link') || it.get('guid');
        if (!link || !title) continue;
        const region = decodeEntities(it.get('region'));
        const country = decodeEntities(it.get('country'));
        const state = decodeEntities(it.get('state'));
        const where = [region, country].filter(Boolean).join(', ');
        const skills = decodeEntities(it.get('skills')).split(/,\s*|\s+and\s+/).map((s) => s.trim()).filter(Boolean);
        jobs.push(makeJob(id, {
          externalId: link.replace(/^https?:\/\/[^/]+/, ''),
          title,
          company,
          companyLogo: it.attr('media:content', 'url') || null,
          location: where ? `Remote (${where})` : 'Remote',
          remote: true,
          employmentType: decodeEntities(it.get('type')) || null,
          description: htmlToText(it.get('description')),
          url: link,
          tags: [decodeEntities(it.get('category')), ...skills.slice(0, 12), state].filter(Boolean),
          postedAt: it.get('pubDate') || null,
        }));
      }
    }
    return dedupe(jobs)
      .filter((j) => matchesQuery(j, query) && matchesLocation(j, location, remote))
      .sort((a, b) => String(b.postedAt).localeCompare(String(a.postedAt)))
      .slice(0, limit);
  },
};
