// Location, date and employer filters shared by campaigns, search and manual apply.
//
//  - countryOf(job): the country a posting is in, read from its location text (null when unknown).
//  - matchesWindow(job, opts): country / posted-within-days / posted-months / found-within-hours.
//  - isCurrentEmployer(job, profile): true when the posting is at a company you work for today.

// Canonical country -> terms that place a posting there. Matched as whole words, first hit wins
// (so "Remote - Warszawa - Poland" resolves to Poland via the city).
const COUNTRY_TERMS = {
  India: ['india', 'bengaluru', 'bangalore', 'hyderabad', 'pune', 'mumbai', 'bombay', 'delhi', 'new delhi', 'gurugram', 'gurgaon', 'noida', 'chennai', 'madras', 'kolkata', 'kochi', 'ahmedabad', 'jaipur', 'chandigarh', 'thiruvananthapuram', 'trivandrum', 'coimbatore', 'indore', 'ncr'],
  'United States': ['united states', 'usa', 'us', 'new york', 'nyc', 'san francisco', 'seattle', 'austin', 'boston', 'chicago', 'los angeles', 'palo alto', 'mountain view', 'sunnyvale', 'san jose', 'denver', 'atlanta', 'dallas', 'houston', 'washington dc', 'miami', 'portland'],
  'United Kingdom': ['united kingdom', 'uk', 'england', 'london', 'manchester', 'edinburgh', 'scotland', 'wales', 'cambridge', 'bristol'],
  Canada: ['canada', 'toronto', 'vancouver', 'montreal', 'calgary', 'ottawa'],
  Germany: ['germany', 'deutschland', 'berlin', 'munich', 'hamburg', 'frankfurt', 'cologne', 'stuttgart'],
  France: ['france', 'paris', 'lyon', 'toulouse'],
  Netherlands: ['netherlands', 'amsterdam', 'rotterdam', 'utrecht', 'eindhoven'],
  Ireland: ['ireland', 'dublin'],
  Spain: ['spain', 'madrid', 'barcelona'],
  Italy: ['italy', 'milan', 'rome'],
  Poland: ['poland', 'warszawa', 'warsaw', 'krakow', 'wroclaw', 'gdansk'],
  Sweden: ['sweden', 'stockholm'],
  Switzerland: ['switzerland', 'zurich', 'geneva', 'bern'],
  Singapore: ['singapore'],
  'United Arab Emirates': ['uae', 'united arab emirates', 'dubai', 'abu dhabi'],
  Australia: ['australia', 'sydney', 'melbourne', 'brisbane'],
  Japan: ['japan', 'tokyo', 'osaka'],
  China: ['china', 'shanghai', 'beijing', 'shenzhen'],
  Israel: ['israel', 'tel aviv'],
  Brazil: ['brazil', 'sao paulo'],
  Mexico: ['mexico', 'mexico city'],
  Portugal: ['portugal', 'lisbon'],
  Philippines: ['philippines', 'manila'],
  Malaysia: ['malaysia', 'kuala lumpur'],
  'South Africa': ['south africa', 'johannesburg', 'cape town'],
  Nigeria: ['nigeria', 'lagos'],
  Kenya: ['kenya', 'nairobi'],
  Egypt: ['egypt', 'cairo'],
  'Saudi Arabia': ['saudi arabia', 'riyadh'],
};
const COUNTRIES = Object.keys(COUNTRY_TERMS);

const TERM_RE = Object.entries(COUNTRY_TERMS).flatMap(([country, terms]) => terms.map((t) => ({ country, re: new RegExp(`(^|[^a-z])${t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^a-z]|$)`) })));

function norm(s) { return String(s || '').normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase(); }

function countryOf(job = {}) {
  const text = norm(job.location);
  if (!text) return null;
  let best = null;
  for (const { country, re } of TERM_RE) {
    const m = re.exec(text);
    if (m && (best === null || m.index < best.index)) best = { country, index: m.index };
  }
  return best ? best.country : null;
}

// opts: { countries: [], postedWithinDays: 0, postedMonths: [1..12], foundWithinHours: 0, now }
function matchesWindow(job = {}, opts = {}) {
  const now = opts.now || Date.now();
  const countries = (opts.countries || []).filter(Boolean);
  if (countries.length && !countries.includes(countryOf(job))) return false;
  const posted = job.postedAt ? new Date(job.postedAt) : null;
  const validPosted = posted && !Number.isNaN(posted.getTime());
  if (opts.postedWithinDays > 0) {
    if (!validPosted || now - posted.getTime() > opts.postedWithinDays * 86400000) return false;
  }
  if (opts.postedMonths && opts.postedMonths.length) {
    if (!validPosted || !opts.postedMonths.includes(posted.getMonth() + 1)) return false;
  }
  if (opts.foundWithinHours > 0) {
    const seen = job.firstSeen ? new Date(job.firstSeen).getTime() : 0;
    if (!seen || now - seen > opts.foundWithinHours * 3600000) return false;
  }
  return true;
}

// Company names are compared without legal suffixes and punctuation: "Acme Technologies Pvt. Ltd." == "acme".
const LEGAL = /\b(inc|incorporated|llc|ltd|limited|pvt|private|corp|corporation|co|company|gmbh|plc|llp|sa|ag|bv|pte|technologies|technology|tech|india|labs|group)\b/g;
function normCompany(s) {
  return norm(s).replace(LEGAL, ' ').replace(/[^a-z0-9]+/g, ' ').trim();
}

// Every employer the candidate works for right now: the current company plus open-ended work history.
function currentEmployers(profile = {}) {
  const names = new Set();
  if (profile.currentCompany) names.add(normCompany(profile.currentCompany));
  for (const w of profile.workHistory || []) {
    const open = w.current === true || /present|current|now|today/i.test(w.endDate || '') || !w.endDate;
    if (open && w.company) names.add(normCompany(w.company));
  }
  names.delete('');
  return [...names];
}

function isCurrentEmployer(job = {}, profile = {}) {
  const jc = normCompany(job.company);
  if (!jc) return false;
  return currentEmployers(profile).some((cc) => {
    if (cc === jc) return true;
    // Containment only when the shorter name is distinctive (avoids "AI" matching "AI Labs" etc.).
    const [a, b] = cc.length <= jc.length ? [cc, jc] : [jc, cc];
    return a.length >= 6 && ` ${b} `.includes(` ${a} `);
  });
}

module.exports = { COUNTRIES, countryOf, matchesWindow, normCompany, currentEmployers, isCurrentEmployer };
