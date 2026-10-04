// Hacker News "Ask HN: Who is hiring?" — monthly thread of direct-from-company postings (startups, many remote).
// Uses the free HN Algolia API (no key): https://hn.algolia.com/api
const { fetchJson, htmlToText, matchesLocation, makeJob } = require('./_util');
const { decodeEntities, parseSalaryText, detectCountry } = require('./_helpers');

const id = 'hn_whoishiring';
const API = 'https://hn.algolia.com/api/v1';

const ROLE_RE = /(engineer|developer|\bdev\b|scientist|analyst|manager|designer|architect|\blead\b|director|head of|\bvp\b|intern|researcher|\bsre\b|devops|programmer|consultant|specialist|founding|\bcto\b|recruiter|administrator|technician|writer|marketer|product|\bml\b|\bai\b|full.?stack|backend|back-end|frontend|front-end|\bqa\b|mobile|ios|android|security|support|sales|operations|ops\b)/i;
const LOC_RE = /(remote|onsite|on-site|on site|hybrid|in-office|in office|relocat|\b[A-Z][a-z]+,\s*[A-Z]{2}\b|worldwide|anywhere|\b(us|usa|uk|eu|emea|apac|europe|canada|india)\b)/i;
const URL_RE = /https?:|www\.|^[\w-]+\.(com|io|ai|co|dev|org|net|app|xyz|tech|so|sh)\b/i;
const SALARY_RE = /[$€£₹]|\b\d{2,3}\s?k\b|\bequity\b|\bsalary\b|\bcomp\b/i;
const TYPE_RE = /\b(full[- ]?time|part[- ]?time|contract(or)?|freelance|intern(ship)?s?|permanent|ft|pt)\b/i;

function parseComment(hit) {
  const html = decodeEntities(hit.comment_text || '');
  const headerHtml = html.split(/<p>/i)[0];
  const header = htmlToText(headerHtml).replace(/\s+/g, ' ').trim();
  const parts = header.split(/\s*[|•]\s*/).map((s) => s.trim()).filter(Boolean);
  let company = '';
  let title = '';
  const locs = [];
  let salaryText = '';
  let employmentType = '';
  if (parts.length >= 2) {
    company = parts[0].replace(/\(.*?\)/g, '').trim();
    for (const p of parts.slice(1)) {
      if (TYPE_RE.test(p) && p.length < 25 && !/engineer|developer|scientist|designer|manager/i.test(p)) { employmentType = employmentType || p; continue; }
      if (!title && ROLE_RE.test(p) && !URL_RE.test(p) && p.length < 160) { title = p; continue; }
      if (SALARY_RE.test(p) && /\d/.test(p)) { salaryText = salaryText || p; continue; }
      if (TYPE_RE.test(p) && p.length < 40) { employmentType = employmentType || p; continue; }
      if (URL_RE.test(p)) continue;
      if (LOC_RE.test(p) || detectCountry(p)) locs.push(p);
    }
  } else {
    title = header.length <= 140 ? header : '';
  }
  if (!title) {
    // No role in the header: look for a short role-like line in the body (often a list of openings).
    const lines = htmlToText(html.slice(headerHtml.length)).split(/\n|•/).map((l) => l.trim()).filter(Boolean);
    const roleLine = lines.find((l) => l.length <= 90 && ROLE_RE.test(l) && !URL_RE.test(l) && !/[.!?]$/.test(l));
    title = roleLine ? roleLine.replace(/[:\-–]+$/, '').trim() : 'Open roles (see post)';
  }
  const hrefs = [...html.matchAll(/href="([^"]+)"/gi)].map((m) => m[1]).filter((u) => /^https?:/i.test(u) && !/ycombinator\.com/.test(u));
  const atsLink = hrefs.find((u) => /greenhouse\.io|lever\.co|ashbyhq\.com|workable\.com|smartrecruiters|recruitee|myworkdayjobs|careers|jobs/i.test(u));
  return { company, title, location: locs.join(' | '), salaryText, employmentType, header, html, applyUrl: atsLink || hrefs[0] || null };
}

module.exports = {
  id,
  name: 'HN Who is Hiring',
  kind: 'feed',
  requiresKeys: [],
  homepage: 'https://news.ycombinator.com/submitted?id=whoishiring',
  regions: ['global', 'us', 'eu', 'remote'],
  description: 'Monthly Hacker News "Who is hiring?" thread: direct postings from startups & tech companies. Free (HN Algolia API), no key.',

  async search({ query = '', location = '', remote = 'any', limit = 50 } = {}, ctx = {}) {
    const stories = await fetchJson(`${API}/search_by_date?tags=story,author_whoishiring&hitsPerPage=10`);
    const threads = (stories?.hits || []).filter((h) => /who is hiring/i.test(h.title || '')).slice(0, 2);
    if (!threads.length) throw new Error('Could not find a recent "Who is hiring?" thread');
    const out = [];
    const seen = new Set();
    for (const thread of threads) {
      const storyId = Number(thread.objectID);
      const params = new URLSearchParams({ tags: `comment,story_${storyId}`, hitsPerPage: '1000' });
      if (query) params.set('query', query);
      const res = await fetchJson(`${API}/search?${params}`);
      const hits = (res?.hits || []).filter((h) => Number(h.parent_id) === storyId && h.comment_text);
      hits.sort((a, b) => (b.created_at_i || 0) - (a.created_at_i || 0));
      for (const h of hits) {
        if (seen.has(h.objectID)) continue;
        seen.add(h.objectID);
        const p = parseComment(h);
        const sal = parseSalaryText(p.salaryText);
        const isRemote = /\bremote\b/i.test(p.header) && !/\bno remote\b|not remote/i.test(p.header);
        const job = makeJob(id, {
          externalId: h.objectID,
          title: p.title || 'Role (see post)',
          company: p.company || h.author,
          location: p.location || (isRemote ? 'Remote' : ''),
          remote: isRemote,
          employmentType: p.employmentType || null,
          salaryMin: sal.min,
          salaryMax: sal.max,
          salaryCurrency: sal.currency,
          salaryText: p.salaryText || null,
          description: htmlToText(p.html),
          url: `https://news.ycombinator.com/item?id=${h.objectID}`,
          applyUrl: p.applyUrl || `https://news.ycombinator.com/item?id=${h.objectID}`,
          tags: ['Hacker News', (thread.title || '').replace(/^Ask HN:\s*/i, '')],
          postedAt: h.created_at || null,
        });
        if (!matchesLocation(job, location, remote)) continue;
        out.push(job);
        if (out.length >= limit) return out;
      }
    }
    return out;
  },
};
