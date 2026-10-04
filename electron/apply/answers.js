// Deterministic, profile-based answers to common application-form questions.
//
//   answerFromProfile(question, fieldInfo, profile, job) -> string | string[] | null
//     fieldInfo = { type: 'text'|'textarea'|'select'|'radio'|'checkbox'|'number',
//                   options: string[], required, inputType, name, id, placeholder,
//                   autocomplete, coverLetterText, single (single checkbox) }
//   bestOption(options, desired) -> option string | null   (fuzzy option matcher)
//
// Returns null whenever we are not confident, so the caller can fall back to
// Q&A memory / AI or leave the question for the user.

'use strict';

// ---------------------------------------------------------------------------
// text utils
// ---------------------------------------------------------------------------
function norm(s) {
  return String(s == null ? '' : s)
    .toLowerCase()
    .normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .replace(/[’‘`]/g, "'")
    .replace(/[^a-z0-9+#.%$'/ -]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
const words = (s) => norm(s).split(/[^a-z0-9+#]+/).filter(Boolean);
const STOP = new Set(['a', 'an', 'the', 'of', 'to', 'and', 'or', 'i', 'am', 'is', 'are', 'in', 'for', 'with', 'my', 'me', 'do', 'have', 'be', 'on', 'at', 'as', 'by', 'not', 'you', 'your']);
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const has = (v) => v !== undefined && v !== null && String(v).trim() !== '' && !(Array.isArray(v) && !v.length);
const arr = (v) => (Array.isArray(v) ? v : has(v) ? String(v).split(/[,;\n]/) : []).map((x) => String(x).trim()).filter(Boolean);

function yn(v, dflt = null) {
  if (v === true) return 'Yes';
  if (v === false) return 'No';
  if (!has(v)) return dflt;
  const n = norm(v);
  if (/^(yes|y|true|1)\b/.test(n)) return 'Yes';
  if (/^(no|n|false|0)\b/.test(n)) return 'No';
  return dflt;
}

// ---------------------------------------------------------------------------
// countries
// ---------------------------------------------------------------------------
const COUNTRIES = [
  ['United States', ['united states', 'united states of america', 'usa', 'u.s.a', 'u.s', 'us', 'america', 'american']],
  ['United Kingdom', ['united kingdom', 'uk', 'u.k', 'great britain', 'britain', 'england', 'scotland', 'wales', 'british']],
  ['Canada', ['canada', 'canadian']],
  ['India', ['india', 'indian', 'bharat']],
  ['Germany', ['germany', 'deutschland', 'german']],
  ['Netherlands', ['netherlands', 'holland', 'the netherlands', 'dutch']],
  ['Ireland', ['ireland', 'irish']],
  ['France', ['france', 'french']],
  ['Spain', ['spain', 'spanish', 'espana']],
  ['Italy', ['italy', 'italian']],
  ['Portugal', ['portugal']],
  ['Poland', ['poland', 'polish']],
  ['Sweden', ['sweden', 'swedish']],
  ['Switzerland', ['switzerland', 'swiss']],
  ['Austria', ['austria']],
  ['Belgium', ['belgium']],
  ['Denmark', ['denmark']],
  ['Norway', ['norway']],
  ['Finland', ['finland']],
  ['Singapore', ['singapore', 'singaporean']],
  ['Australia', ['australia', 'australian']],
  ['New Zealand', ['new zealand']],
  ['Japan', ['japan', 'japanese']],
  ['China', ['china', 'chinese']],
  ['Israel', ['israel', 'israeli']],
  ['Brazil', ['brazil', 'brasil', 'brazilian']],
  ['Mexico', ['mexico', 'mexican']],
  ['Argentina', ['argentina']],
  ['United Arab Emirates', ['united arab emirates', 'uae', 'dubai', 'abu dhabi']],
  ['Saudi Arabia', ['saudi arabia', 'ksa']],
  ['Pakistan', ['pakistan']],
  ['Bangladesh', ['bangladesh']],
  ['Sri Lanka', ['sri lanka']],
  ['Philippines', ['philippines']],
  ['Indonesia', ['indonesia']],
  ['Malaysia', ['malaysia']],
  ['Vietnam', ['vietnam', 'viet nam']],
  ['South Africa', ['south africa']],
  ['Nigeria', ['nigeria']],
  ['Kenya', ['kenya']],
  ['Egypt', ['egypt']],
  ['Turkey', ['turkey', 'turkiye']],
  ['Romania', ['romania']],
  ['Czech Republic', ['czech republic', 'czechia']],
  ['Hungary', ['hungary']],
  ['Greece', ['greece']],
  ['Ukraine', ['ukraine']],
  ['South Korea', ['south korea', 'korea']],
  ['Hong Kong', ['hong kong']],
  ['Taiwan', ['taiwan']],
  ['Estonia', ['estonia']],
  ['Lithuania', ['lithuania']],
  ['Latvia', ['latvia']],
  ['Colombia', ['colombia']],
  ['Chile', ['chile']],
];
const EU = new Set(['Germany', 'Netherlands', 'Ireland', 'France', 'Spain', 'Italy', 'Portugal', 'Poland', 'Sweden', 'Austria', 'Belgium', 'Denmark', 'Finland', 'Romania', 'Czech Republic', 'Hungary', 'Greece', 'Estonia', 'Lithuania', 'Latvia']);
const US_STATES = ['AL', 'AK', 'AZ', 'AR', 'CA', 'CO', 'CT', 'DE', 'FL', 'GA', 'HI', 'ID', 'IL', 'IN', 'IA', 'KS', 'KY', 'LA', 'ME', 'MD', 'MA', 'MI', 'MN', 'MS', 'MO', 'MT', 'NE', 'NV', 'NH', 'NJ', 'NM', 'NY', 'NC', 'ND', 'OH', 'OK', 'OR', 'PA', 'RI', 'SC', 'SD', 'TN', 'TX', 'UT', 'VT', 'VA', 'WA', 'WV', 'WI', 'WY', 'DC'];
const US_CITIES = /\b(new york|san francisco|seattle|austin|boston|chicago|los angeles|denver|atlanta|miami|washington dc|bay area|silicon valley)\b/;

// Return all canonical country names mentioned in text (in order of first mention).
function countriesIn(text, { states = false } = {}) {
  const t = ` ${norm(text).replace(/[^a-z0-9 ]+/g, ' ')} `;
  const found = [];
  for (const [name, aliases] of COUNTRIES) {
    let best = -1;
    for (const a of aliases) {
      const re = new RegExp(`\\b${esc(a.replace(/\./g, ' ').replace(/\s+/g, ' ').trim())}\\b`);
      // "us" is a common English word: only accept it in caps-like contexts handled below
      if (a === 'us') continue;
      const m = re.exec(t);
      if (m && (best < 0 || m.index < best)) best = m.index;
    }
    if (best >= 0) found.push([best, name]);
  }
  // "US"/"U.S." only when written in capitals in the raw text
  if (/\bU\.?S\.?A?\b/.test(String(text || '')) && !found.some((f) => f[1] === 'United States')) {
    found.push([String(text).search(/\bU\.?S\.?A?\b/), 'United States']);
  }
  if (states && !found.some((f) => f[1] === 'United States')) {
    const raw = String(text || '');
    const st = new RegExp(`,\\s*(${US_STATES.join('|')})\\b`).exec(raw);
    if (st || US_CITIES.test(t)) found.push([st ? st.index : 0, 'United States']);
  }
  return found.sort((a, b) => a[0] - b[0]).map((f) => f[1]).filter((v, i, a) => a.indexOf(v) === i);
}
const canonCountry = (s) => countriesIn(s, { states: true })[0] || (has(s) ? String(s).trim() : null);

// ---------------------------------------------------------------------------
// bestOption: fuzzy option matcher
// ---------------------------------------------------------------------------
const PLACEHOLDER_OPT = /^(select|choose|please select|please choose|--|—|-|pick)\b|^\s*$|^select\.\.\.$/i;

function polarity(opt) {
  const n = norm(opt);
  if (/decline|prefer not|not to (say|answer|disclose|identify|specify)|do not wish|don'?t wish|choose not|rather not|not wish to|no answer|wish not/.test(n)) return 'decline';
  if (/^(yes|y|yeah|true|i am|i do|i have|i will|i can|i agree|i consent|i acknowledge|agree|accept|correct|absolutely|sure)\b/.test(n) && !/^(i am not|i do not|i don'?t|i have not|i haven'?t|i will not|i won'?t|i can ?not|i can'?t)\b/.test(n)) return 'yes';
  if (/^(no|n|nope|false|not|never|none|i am not|i'm not|i do not|i don'?t|i have not|i haven'?t|i will not|i won'?t|i can ?not|i can'?t|i disagree|disagree|decline)\b/.test(n)) return 'no';
  return null;
}

// Parse an option like "3-5 years", "5+ years", "Less than 1 year", "10 or more" into [lo, hi].
function parseRange(opt) {
  const n = norm(opt).replace(/,/g, '');
  const nums = (n.match(/\d+(?:\.\d+)?/g) || []).map(Number);
  if (!nums.length) {
    if (/\b(no|none|zero)\b.*(experience|years?)|^none$|^no experience/.test(n)) return [0, 0.99];
    return null;
  }
  if (/less than|under|fewer than|below|up to|<|at most|maximum/.test(n)) return [0, nums[0] - (/up to|at most|maximum/.test(n) ? -0.0001 : 0.0001)];
  if (/\+|or more|more than|over|above|at least|minimum|>|plus|and up|or greater/.test(n)) {
    return /more than|over|above|>/.test(n) && !/\+|or more|at least/.test(n) ? [nums[0] + 0.0001, Infinity] : [nums[0], Infinity];
  }
  if (nums.length >= 2) return [Math.min(nums[0], nums[1]), Math.max(nums[0], nums[1]) + 0.9999];
  return [nums[0], nums[0] + 0.9999];
}

const ALIASES = [
  ['decline to self identify', ['decline to self identify', 'i don\'t wish to answer', 'prefer not to say', 'decline to answer', 'i do not wish to self identify', 'prefer not to answer', 'decline']],
  ['male', ['male', 'man']],
  ['female', ['female', 'woman']],
  ['non binary', ['non binary', 'nonbinary', 'non-binary', 'genderqueer']],
  ['bachelor\'s', ['bachelor', 'bachelors', 'b.tech', 'btech', 'b.e', 'b.sc', 'bs', 'ba', 'undergraduate', 'bachelor\'s degree']],
  ['master\'s', ['master', 'masters', 'm.tech', 'mtech', 'm.sc', 'ms', 'ma', 'graduate degree', 'master\'s degree', 'postgraduate']],
  ['phd', ['phd', 'ph.d', 'doctorate', 'doctoral']],
  ['mba', ['mba', 'master of business administration', 'master\'s']],
  ['high school', ['high school', 'secondary', 'ged', '12th']],
  ['associate', ['associate', 'associate\'s degree']],
  ['company website', ['company website', 'careers page', 'career site', 'company career', 'careers website', 'company site', 'website']],
];

const GENERIC_WORDS = new Set(['university', 'college', 'institute', 'school', 'state', 'technology', 'national', 'international', 'academy', 'company', 'website', 'years', 'year', 'experience', 'level', 'degree', 'other', 'group', 'inc', 'ltd', 'limited', 'corp']);
// at least one non-generic word of the desired value must appear in the option
function distinctiveHit(d, o) {
  const dw = words(d).filter((w) => !STOP.has(w) && !GENERIC_WORDS.has(w));
  if (!dw.length) return true;
  const ow = new Set(words(o));
  return dw.some((w) => ow.has(w));
}
function scoreOverlap(a, b) {
  const wa = words(a).filter((w) => !STOP.has(w));
  const wb = new Set(words(b).filter((w) => !STOP.has(w)));
  if (!wa.length || !wb.size) return 0;
  let hit = 0;
  for (const w of wa) if (wb.has(w) || [...wb].some((x) => x.length > 3 && w.length > 3 && (x.startsWith(w) || w.startsWith(x)))) hit++;
  return hit / Math.max(wa.length, wb.size);
}

function bestOption(options, desired) {
  if (!Array.isArray(options) || !options.length || !has(desired)) return null;
  if (Array.isArray(desired)) {
    for (const d of desired) { const r = bestOption(options, d); if (r) return r; }
    return null;
  }
  const opts = options.filter((o) => has(o) && !PLACEHOLDER_OPT.test(String(o).trim()));
  if (!opts.length) return null;
  const d = String(desired).trim();
  const nd = norm(d);
  if (!nd) return null;

  // 1. exact (normalized)
  for (const o of opts) if (norm(o) === nd) return o;

  // 2. yes / no / decline polarity
  const dp = polarity(d);
  if (dp && (/^(yes|no|true|false)$/i.test(d) || dp === 'decline')) {
    const m = opts.filter((o) => polarity(o) === dp);
    if (m.length === 1) return m[0];
    if (m.length > 1) {
      // several "Yes, <specific>" variants: prefer a bare/generic one, otherwise defer (ambiguous)
      const bare = m.find((o) => /^(yes|no|y|n)\W*$/i.test(String(o).trim()));
      if (bare) return bare;
      const generic = m.find((o) => /\b(other|not listed|not one of|none of|another|something else)\b/i.test(o));
      if (generic) return generic;
      if (m.length === 2 && dp !== 'decline') {
        const [a, b] = m.map((o) => words(o).filter((w) => !STOP.has(w)).length);
        if (Math.abs(a - b) <= 1 && a <= 4 && b <= 4) return m.sort((x, y) => x.length - y.length)[0];
        return null;
      }
      return dp === 'decline' ? m.sort((a, b) => a.length - b.length)[0] : null;
    }
    if (dp === 'decline') {
      const m2 = opts.find((o) => /decline|prefer not|not wish|don'?t wish|rather not|not to answer/i.test(o));
      if (m2) return m2;
      return null;
    }
    return null;
  }

  // 3. numeric (years etc.)
  if (/^\d+(\.\d+)?$/.test(nd)) {
    const v = Number(nd);
    const ranged = opts.map((o) => [o, parseRange(o)]).filter((x) => x[1]);
    if (ranged.length) {
      const inside = ranged.filter(([, r]) => v >= r[0] && v <= r[1]);
      if (inside.length) return inside.sort((a, b) => (a[1][1] - a[1][0]) - (b[1][1] - b[1][0]))[0][0];
    }
  }

  // 4. alias groups (gender, degrees, sources …)
  for (const [, al] of ALIASES) {
    if (al.some((a) => nd === norm(a) || nd.startsWith(norm(a) + ' '))) {
      for (const a of al) {
        const re = new RegExp(`(^|[^a-z])${esc(norm(a))}([^a-z]|$)`);
        const o = opts.find((x) => re.test(norm(x)));
        if (o) return o;
      }
    }
  }

  // 5. country aliases
  const dc = countriesIn(d, { states: false });
  if (dc.length === 1 && words(d).length <= 4) {
    const cands = opts.filter((o) => countriesIn(o)[0] === dc[0]);
    if (cands.length) return cands.sort((a, b) => a.length - b.length)[0];
  }

  // 6. word-boundary containment
  const re = new RegExp(`(^|[^a-z0-9])${esc(nd)}([^a-z0-9]|$)`);
  const contains = opts.filter((o) => re.test(norm(o)));
  if (contains.length) {
    return contains.sort((a, b) => (norm(b).startsWith(nd) - norm(a).startsWith(nd)) || a.length - b.length)[0];
  }
  const inside = opts.filter((o) => norm(o).length >= 3 && new RegExp(`(^|[^a-z0-9])${esc(norm(o))}([^a-z0-9]|$)`).test(nd));
  if (inside.length) return inside.sort((a, b) => b.length - a.length)[0];

  // 7. token overlap
  let best = null; let bs = 0;
  for (const o of opts) { const s = scoreOverlap(d, o); if (s > bs) { bs = s; best = o; } }
  if (bs >= 0.5 && distinctiveHit(d, best)) return best;
  return null;
}

// ---------------------------------------------------------------------------
// profile helpers
// ---------------------------------------------------------------------------
function skillYearsMap(p) {
  const m = new Map();
  for (const line of String(p.skillYears || '').split(/[\n;]+/)) {
    const mm = /^\s*(.+?)\s*[:=\-–]\s*(\d+(?:\.\d+)?)\s*(?:y|yrs|years?)?\s*$/i.exec(line);
    if (mm) m.set(norm(mm[1]), Number(mm[2]));
  }
  return m;
}

function totalYears(p) {
  if (has(p.totalYearsExperience)) return Number(p.totalYearsExperience);
  // derive from work history
  let months = 0;
  for (const w of p.workHistory || []) {
    const s = parseMonth(w.startDate); const e = w.current ? new Date() : parseMonth(w.endDate) || new Date();
    if (s) months += Math.max(0, (e.getFullYear() - s.getFullYear()) * 12 + e.getMonth() - s.getMonth());
  }
  return months ? Math.round(months / 12) : null;
}
function parseMonth(v) {
  if (!has(v)) return null;
  const m = /^(\d{4})-(\d{1,2})/.exec(String(v));
  if (m) return new Date(Number(m[1]), Number(m[2]) - 1, 1);
  const d = new Date(v);
  return isNaN(d) ? null : d;
}

// Find the skill a question is asking about. Returns { name, years } | { unknown: phrase } | null (generic)
function skillForQuestion(q, p) {
  const nq = ` ${norm(q)} `;
  const sy = skillYearsMap(p);
  const skills = arr(p.skills);
  const cands = [...sy.keys(), ...skills.map(norm)].filter((s) => s && s.length >= 1);
  let best = null;
  for (const s of cands) {
    const re = new RegExp(`(^|[^a-z0-9+#])${esc(s)}([^a-z0-9+#]|$)`);
    if (re.test(nq) && (!best || s.length > best.length)) best = s;
  }
  if (best) {
    const yrs = sy.has(best) ? sy.get(best) : null;
    return { name: best, years: yrs != null ? yrs : totalYears(p) };
  }
  // Is a specific (unknown) technology mentioned?
  const m = /(?:experience|years?)\s+(?:of\s+)?(?:professional\s+|hands[- ]on\s+|working\s+|work\s+)?(?:experience\s+)?(?:with|in|using|on|of|building with|developing (?:in|with)|working (?:with|in))\s+([a-z0-9+#./ -]{2,40})/.exec(norm(q));
  if (m) {
    const phrase = m[1].replace(/\b(the|a|an)\b/g, '').replace(/^\s*(experience|exp)\b\s*/, '').trim();
    // "experience as a Software Engineer" is about the role, not a technology → use total years.
    if (/^(as|in (a|an|the)?\s*(similar|related|relevant) )/.test(phrase)) return null;
    if (phrase && !/^(building|developing|writing|designing|shipping|leading|managing|working|creating|delivering|professional|relevant|related|industry|software|engineering|work|working|total|overall|full ?time|the role|this role|similar|building software|software development|development|a similar|management|leadership|people management|customer|b2b|saas|startups?|production|programming|coding)\b/.test(phrase)) {
      return { unknown: phrase };
    }
  }
  return null;
}

function highestEducation(p) {
  const order = ['high school', 'diploma', 'associate', "bachelor's", "master's", 'mba', 'phd'];
  const ed = (p.education || []).filter((e) => e && (e.degree || e.school));
  if (!ed.length) return null;
  return ed.slice().sort((a, b) => order.indexOf(norm(b.degree)) - order.indexOf(norm(a.degree)))[0];
}

function fmtDate(d, inputType) {
  if (!d) return null;
  const dt = d instanceof Date ? d : new Date(d);
  if (isNaN(dt)) return String(d);
  const iso = `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
  if (inputType === 'date') return iso;
  if (inputType === 'month') return iso.slice(0, 7);
  return iso;
}

function phoneOf(p, withCode) {
  const ph = String(p.phone || '').trim();
  if (!ph) return null;
  if (ph.startsWith('+')) {
    if (withCode === false && has(p.phoneCountryCode)) {
      const cc = String(p.phoneCountryCode).replace(/[^\d]/g, '');
      return ph.replace(/[^\d]/g, '').replace(new RegExp(`^${cc}`), '');
    }
    return ph;
  }
  if (withCode === false || !has(p.phoneCountryCode)) return ph;
  const cc = String(p.phoneCountryCode).trim();
  return `${cc.startsWith('+') ? cc : '+' + cc} ${ph}`;
}

function money(n) { return Number(n).toLocaleString('en-US'); }

// ---------------------------------------------------------------------------
// main answerer
// ---------------------------------------------------------------------------
function answerFromProfile(question, fieldInfo = {}, profile = {}, job = {}) {
  try {
    const raw = answerRaw(question, fieldInfo || {}, profile || {}, job || {});
    return finalize(raw, fieldInfo || {});
  } catch {
    return null;
  }
}

function finalize(v, fi) {
  if (!has(v)) return null;
  const opts = (fi.options || []).filter((o) => has(o));
  const type = fi.type || 'text';
  if (opts.length && (type === 'select' || type === 'radio' || type === 'checkbox')) {
    if (type === 'checkbox' && !fi.single) {
      const list = Array.isArray(v) ? v : [v];
      const out = [];
      for (const x of list) { const o = bestOption(opts, x); if (o && !out.includes(o)) out.push(o); }
      return out.length ? out : null;
    }
    if (Array.isArray(v)) return bestOption(opts, v); // ordered fallbacks
    return bestOption(opts, v);
  }
  if (Array.isArray(v)) {
    if (type === 'checkbox' && fi.single) return v[0];
    return v.join(', ');
  }
  if (type === 'number') {
    const m = /-?\d+(\.\d+)?/.exec(String(v).replace(/,/g, ''));
    return m ? m[0] : null;
  }
  return String(v);
}

function answerRaw(question, fi, p, job) {
  const qRaw = String(question || '').trim() || [fi.name, fi.id, fi.placeholder, fi.autocomplete].filter(Boolean).join(' ');
  const q = norm(qRaw);
  const hint = norm([fi.name, fi.id, fi.autocomplete].filter(Boolean).join(' ').replace(/[_\-\[\]]+/g, ' '));
  const type = fi.type || 'text';
  const isChoice = (fi.options || []).length > 0;
  const isText = type === 'text' || type === 'textarea';
  const coverText = fi.coverLetterText || job.coverLetterText || null;

  if (!q && !hint) return null;

  // ---------------- consent / legal checkboxes -----------------------------------
  if (/text message|\bsms\b|whatsapp|marketing|newsletter|promotional|subscribe/.test(q) && (isChoice || type === 'checkbox')) return 'No';
  if (type === 'checkbox' && fi.single) {
    if (/(i )?(agree|acknowledge|accept|consent|certify|confirm|attest|understand|have read|read and)|privacy (policy|notice)|terms|gdpr|data (processing|protection)|truthful|accurate/.test(q)) return 'Yes';
    if (/future (job )?opportunit|talent (pool|community|network)|keep (me|my).*(on file|informed)|contact me about/.test(q)) return 'Yes';
  }

  // ---------------- cover letter / free text --------------------------------------
  if (/cover letter|covering letter|motivation(al)? letter/.test(q) && isText) return coverText || p.whyInterested || null;
  if (isText && /why (are you|do you|would you|you)|what (excites|interests|attracts|draws) you|why .*(interested|want to (work|join)|apply|this (role|position|company|opportunity))|interest in (this|the) (role|position|company)|why .*\b(us|here)\b|motivat/.test(q) && !/how did you hear/.test(q)) {
    return p.whyInterested || coverText || null;
  }
  if (isText && /additional information|anything else|other information|is there anything|add a cover letter/.test(q)) return p.additionalInfo || coverText || null;
  if (isText && /tell us about yourself|about you\b|professional summary|^summary$|brief (bio|summary|introduction)|introduce yourself/.test(q)) return p.summary || p.headline || null;
  if (/headline/.test(q) && isText) return p.headline || (p.currentTitle && p.currentCompany ? `${p.currentTitle} at ${p.currentCompany}` : null);

  // ---------------- EEO ------------------------------------------------------------
  if (/pronunciation|pronounce/.test(q)) return null;
  if (/\bpronouns?\b/.test(q)) return p.pronouns || 'Decline to self-identify';
  if (/transgender|sexual orientation|lgbt/.test(q)) return 'Decline to self-identify';
  if (/hispanic|latin[oax]/.test(q) && !/race/.test(q.replace(/hispanic or latino/, ''))) {
    const v = p.hispanicLatino || 'Decline to self-identify';
    return v;
  }
  if (/\bgender\b|\bsex\b/.test(q) && !/sexual/.test(q)) return p.gender || 'Decline to self-identify';
  if (/\brace\b|ethnic/.test(q)) return p.race || 'Decline to self-identify';
  if (/veteran|military service|armed forces/.test(q)) {
    const v = p.veteranStatus || 'Decline to self-identify';
    if (isChoice && /not a protected veteran/i.test(v)) return [v, 'I am not a protected veteran', 'not a veteran', 'No'];
    if (isChoice && /am a protected veteran/i.test(v)) return [v, 'I identify as one or more of the classifications of protected veteran', 'Yes'];
    return v;
  }
  if (/disabilit/.test(q)) {
    const v = p.disabilityStatus || 'Decline to self-identify';
    if (isChoice && /^no/i.test(v)) return [v, 'No, I do not have a disability', 'No'];
    if (isChoice && /^yes/i.test(v)) return [v, 'Yes, I have a disability', 'Yes'];
    return v;
  }

  // ---------------- names -----------------------------------------------------------
  if (/pronunciation|pronounce/.test(q)) return null;
  if (/preferred (first )?name|name you'?d prefer|nickname|what (should|would you like|do you want) (us|we) to call|go by|known as/.test(q)) return p.preferredName || p.firstName || null;
  // Contact/name rules only fire on short label-like prompts (or explicit "what is your …"),
  // so e.g. "the secret word from our onboarding email" is never answered with an address.
  const labelish = q.length <= 60 && !/\?/.test(qRaw) &&
    !/^(what|which|who|whom|why|how|when|where|describe|tell|have|do|did|are|were|is|will|would|can|could|please (describe|explain|tell))\b/.test(q);
  const asksMine = labelish || (/^(what is|what's|whats|enter|provide|please (enter|provide|share)) (your|the candidate'?s|applicant'?s)\b/.test(q) && q.length <= 90);
  if (asksMine && /first name|given name|forename|^fname$|\bfirst\b.*\bname/.test(q)) return p.firstName || null;
  if (!q && /first ?name|fname|given/.test(hint)) return p.firstName || null;
  if (asksMine && /last name|surname|family name|^lname$/.test(q)) return p.lastName || null;
  if (!q && /last ?name|lname|surname/.test(hint)) return p.lastName || null;
  if (asksMine && /middle name/.test(q)) return p.middleName || null;
  if (asksMine && /(full|legal|your|candidate|applicant) name|^name$|^name \(|^full name/.test(q) && !/company|school|employer|reference|manager|recruiter|referr/.test(q)) {
    return [p.firstName, /legal/.test(q) ? p.middleName : null, p.lastName].filter(has).join(' ') || null;
  }

  // ---------------- contact ---------------------------------------------------------
  if (asksMine && /e-?mail/.test(q) && !/reference|referr|manager|confirm.*different/.test(q)) return p.email || null;
  if (/country code|dial(ing)? code|phone code|calling code/.test(q) && !/number/.test(q)) {
    if (isChoice) return [p.country, p.phoneCountryCode].filter(has);
    return p.phoneCountryCode || null;
  }
  if (asksMine && /phone|mobile|cell|telephone|contact number|whatsapp number/.test(q) && !/reference|screen|interview|call with/.test(q)) {
    if (/without (the )?country code|national|local/.test(q) || fi.phoneNational) return phoneOf(p, false);
    return phoneOf(p, /country code|international|with code/.test(q) ? true : undefined);
  }

  // ---------------- links ------------------------------------------------------------
  const linkCtx = !isChoice && type !== 'checkbox' && type !== 'number' &&
    (!/^(have|do|did|are|were|is|will|would|can|could|how|why|what (is|are) your (experience|thoughts))\b/.test(q) || /\b(url|link|profile|handle|username)\b/.test(q));
  if (linkCtx) {
    if (/linked ?in/.test(q)) return p.linkedin || null;
    if (/github|git hub/.test(q)) return p.github || null;
    if (/gitlab|bitbucket/.test(q)) return p.github || null;
    if (/leetcode|hackerrank|codeforces|kaggle/.test(q)) return p.leetcode || null;
    if (/dribbble|behance/.test(q)) return p.dribbble || p.portfolio || null;
    if (/twitter|\bx\.com\b|\bx profile/.test(q)) return p.twitter || null;
    if (/portfolio/.test(q)) return p.portfolio || p.website || p.github || null;
    if (/(personal )?(website|web site|blog|homepage)\b/.test(q) && !/company website|our website|how did you hear/.test(q)) return p.website || p.portfolio || p.github || null;
    if (/^(other )?(url|link|links)$|other (link|url|website|profile)|online profile/.test(q)) return p.otherLink || p.portfolio || p.website || p.github || null;
  }

  // ---------------- authorization / visa ------------------------------------------------
  const qCountries = countriesIn(qRaw, { states: true });
  const jobCountries = countriesIn(`${job.location || ''}`, { states: true });
  const authList = arr(p.authorizedCountries).map(canonCountry).filter(Boolean);
  const isAuthorizedIn = (c) => {
    if (!c) return null;
    if (authList.includes(c)) return true;
    if (c === 'European Union' && authList.some((x) => EU.has(x))) return true;
    const statusFor = { 'United States': p.workAuthUS, 'United Kingdom': p.workAuthUK, Canada: p.workAuthCanada };
    let st = statusFor[c];
    if (EU.has(c)) st = p.workAuthEU;
    if (has(st) && !/not applicable/i.test(st)) return !/need sponsorship/i.test(st);
    if (authList.length) return false;
    if (has(p.country) && canonCountry(p.country) === c) return true;
    return null;
  };

  if (/sponsor|visa (status|support|transfer)|(require|need).*\bvisa\b|h-?1b|work permit.*(require|need)|immigration support/.test(q) && !/(do you|currently) (hold|have) .*visa/.test(q)) {
    const target = qCountries[0] || jobCountries[0];
    let need = yn(p.needsSponsorship);
    if (target) {
      const auth = isAuthorizedIn(target);
      if (auth === true) need = (target === 'United States' && /h-?1b|opt|tn \/|other visa/i.test(p.workAuthUS || '')) ? 'Yes' : 'No';
      else if (auth === false) need = 'Yes';
    }
    if (!need) return null;
    if (isText) return need === 'Yes' ? `Yes${p.visaDetails ? ` — ${p.visaDetails}` : ''}` : 'No';
    return need;
  }
  if (/(legally )?(authori[sz]ed|eligible|entitled|permitted|right|allowed) to (work|be employed)|legally able to work|able to (legally )?work (legally|lawfully)|work authori[sz]ation|work eligibility|right to work|legal(ly)? (able|right) to work|employment eligibility/.test(q)) {
    const target = qCountries[0] || jobCountries[0] || null;
    let auth = target ? isAuthorizedIn(target) : null;
    if (auth == null) {
      if (yn(p.needsSponsorship) === 'No' && (authList.length || has(p.country))) auth = true;
      else if (!target && authList.length && yn(p.needsSponsorship) === 'Yes') auth = null;
    }
    if (auth == null) return null;
    if (isChoice && auth && target === 'United States' && has(p.workAuthUS) && !/not applicable|need/i.test(p.workAuthUS)) {
      return [p.workAuthUS, 'Yes'];
    }
    return auth ? 'Yes' : 'No';
  }
  if (/\bcitizen(ship)?\b|nationality/.test(q)) {
    if (/^(what|which)|nationality$|^citizenship$|country of citizenship/.test(q) || !isChoice && isText) return p.nationality || null;
    const c = qCountries[0];
    if (c && has(p.nationality)) {
      if (/permanent resident|green card|\bpr\b/.test(q)) {
        if (canonCountry(p.nationality) === c) return 'No';
        if (c === 'United States' && /green card/i.test(p.workAuthUS || '')) return 'Yes';
        if (!authList.includes(c)) return 'No';
        return null;
      }
      return canonCountry(p.nationality) === c ? 'Yes' : 'No';
    }
    return null;
  }
  if (/permanent resident|green card/.test(q)) {
    const c = qCountries[0];
    if (c === 'United States' && has(p.workAuthUS)) return /green card/i.test(p.workAuthUS) ? 'Yes' : (/citizen/i.test(p.workAuthUS) ? 'No' : (authList.includes(c) ? null : 'No'));
    if (c && !authList.includes(c)) return 'No';
    return null;
  }
  if (/security clearance|clearance level|active clearance/.test(q)) {
    const sc = String(p.securityClearance || '').trim();
    const hasSc = sc && !/^(none|no|n\/a|na)$/i.test(sc);
    if (isText) return sc || 'None';
    return hasSc ? 'Yes' : 'No';
  }

  // ---------------- location / relocation --------------------------------------------------
  if (/relocat/.test(q)) return yn(p.willingToRelocate);
  if (/(work|be|come) (in|from|into|to|at) (the |our )?([a-z]+ ){0,2}office|office \w* ?(days|\d+ days)|on-?site|onsite|in-office|in office|in person|commut|hybrid/.test(q) && (isChoice || /are you|would you|can you|willing|able|comfortable|open to|does this work|work for you|is this ok/.test(q))) {
    const modes = arr(p.workModes).map(norm);
    if (!modes.length) return null;
    const onsite = modes.some((m) => /on.?site/.test(m));
    const hybrid = modes.some((m) => /hybrid/.test(m));
    if (onsite) return 'Yes';
    const fullTime = /\b(five|5|every) (days|day)|full[- ]time (in|from) (the |our )?office|fully on-?site|100% on-?site|daily/.test(q);
    if (/hybrid/.test(q) || (/\b([1-4]|one|two|three|four) (days?|times)\b/.test(q) && !fullTime)) return hybrid ? 'Yes' : 'No';
    return 'No';
  }
  if (/remote/.test(q) && /(are you|would you|comfortable|open to|willing|able).*remote|work remotely/.test(q) && !/where|location|from which/.test(q)) {
    const modes = arr(p.workModes).map(norm);
    return !modes.length || modes.some((m) => /remote/.test(m)) ? 'Yes' : 'No';
  }
  if (/time ?zone/.test(q)) return p.timezone || null;
  if (/zip|postal|post code|postcode|pin ?code/.test(q)) return p.postalCode || null;
  if (/street|address line 1|^address$|mailing address|home address|address 1|residential address/.test(q)) {
    if (/line 2|address 2/.test(q)) return p.addressLine2 || null;
    return p.addressLine1 || null;
  }
  if (/address line 2|address 2|apartment|suite/.test(q)) return p.addressLine2 || null;
  if (/\bstate\b|province|region|county/.test(q) && !/united states|statement|state (your|the|why|how)/.test(q)) return p.state || null;
  if (/\bcity\b|town/.test(q) && !/ethnic/.test(q)) {
    if (/location/.test(q)) return [p.city, p.state, p.country].filter(has).join(', ') || null;
    return p.city || null;
  }
  if (/country/.test(q) && !/countries|authori|eligible|sponsor|citizen|visa|outside|travel/.test(q)) {
    return p.country || null;
  }
  if (/(current|your|home) location|where (are you|do you) (currently )?(located|based|live|reside)|location \(city\)|^location$|where .* (plan on |planning to )?(work|working) from|based in|currently reside|place of residence|^residence/.test(q)) {
    return [p.city, p.state, p.country].filter(has).join(', ') || null;
  }
  if (/willing to travel|travel (requirement|up to|percent|%)|ability to travel|able to travel/.test(q)) {
    if (type === 'number') return has(p.travelPercent) ? p.travelPercent : null;
    if (!has(p.travelPercent)) return null;
    const pct = Number(p.travelPercent);
    const m = /(\d+)\s*%/.exec(q);
    if (isChoice && !/^(yes|no)/i.test((fi.options || [])[0] || '')) return `${pct}%`;
    return pct > 0 && (!m || pct >= Number(m[1])) ? 'Yes' : 'No';
  }

  // ---------------- standard yes/no screeners ---------------------------------------------------
  if (/(18|eighteen)\s*(years|\+|or older)|legal (working )?age|age of majority|at least 18|over 18|minimum age/.test(q)) return yn(p.over18, 'Yes');
  if (/background (check|screening|investigation)|criminal (record|history) check/.test(q)) return yn(p.backgroundCheckOk, 'Yes');
  if (/drug (test|screen)|substance (test|screen)/.test(q)) return yn(p.drugTestOk, 'Yes');
  if (/driver'?s? licen[cs]e|driving licen[cs]e|valid licen[cs]e/.test(q)) return yn(p.hasDriversLicense);
  if (/non-?compete|non-?solicit|restrictive covenant|employment agreements?|post-?employment restriction|bound by (any|an) (agreement|contract)/.test(q)) return yn(p.hasNonCompete, 'No');
  const companyRe = job.company ? new RegExp(`\\b${esc(norm(job.company))}\\b`) : null;
  if (/(previously|ever|formerly|before|in the past) (been )?(worked|employed|work|consulted|interned)|former (employee|intern)|worked (for|at) .* before|(currently|previously) (employed|work) (by|at|for)|have you (ever )?(worked|been employed)/.test(q)) {
    if (/currently/.test(q) && companyRe && has(p.currentCompany) && companyRe.test(norm(p.currentCompany))) return 'Yes';
    return yn(p.previouslyEmployedHere, 'No');
  }
  if (/(related to|relatives?|family member|know anyone|friends?) (who )?(currently )?(work|employed|at)|related to (anyone|an employee)/.test(q)) return null;
  if (/currently employed|are you (currently )?working/.test(q)) {
    const cur = (p.workHistory || []).some((w) => w && w.current) || has(p.currentCompany);
    return cur ? 'Yes' : 'No';
  }

  // ---------------- compensation ---------------------------------------------------------------
  if (/current (salary|ctc|compensation|pay|base)|present (salary|ctc)/.test(q)) {
    if (!has(p.currentSalary)) return null;
    if (type === 'number') return p.currentSalary;
    return `${money(p.currentSalary)}${p.salaryCurrency ? ' ' + p.salaryCurrency : ''}${p.salaryPeriod ? ' (' + String(p.salaryPeriod).toLowerCase() + ')' : ''}`;
  }
  if (/salary|compensation|pay (expectation|range|requirement)|expected (ctc|pay|package)|ctc|desired (pay|rate)|rate expectation|hourly rate|remuneration/.test(q)) {
    const lo = has(p.expectedSalaryMin) ? Number(p.expectedSalaryMin) : null;
    const hi = has(p.expectedSalaryMax) ? Number(p.expectedSalaryMax) : null;
    if (lo == null && hi == null) return null;
    if (type === 'number') return /max|maximum|upper/.test(q) ? (hi ?? lo) : (lo ?? hi);
    if (isChoice) return String(lo ?? hi);
    const cur = p.salaryCurrency ? ` ${p.salaryCurrency}` : '';
    const per = p.salaryPeriod ? ` (${String(p.salaryPeriod).toLowerCase()})` : '';
    if (lo != null && hi != null && hi !== lo) return `${money(lo)} - ${money(hi)}${cur}${per}`;
    return `${money(lo ?? hi)}${cur}${per}`;
  }

  // ---------------- availability ---------------------------------------------------------------
  if (/notice period|notice (do you|you) (need|have)|how much notice/.test(q)) {
    if (!has(p.noticePeriodDays)) return null;
    const d = Number(p.noticePeriodDays);
    if (type === 'number') return /week/.test(q) ? Math.ceil(d / 7) : /month/.test(q) ? Math.ceil(d / 30) : d;
    if (isChoice) {
      const opts = fi.options;
      if (d === 0) { const o = bestOption(opts, 'Immediately') || bestOption(opts, 'Immediate') || bestOption(opts, '0'); if (o) return o; }
      const months = d / 30; const weeks = d / 7;
      const tryList = [`${d} days`, `${Math.round(months)} month${Math.round(months) === 1 ? '' : 's'}`, `${Math.round(weeks)} weeks`];
      for (const t of tryList) { const o = opts.find((x) => norm(x).includes(norm(t))); if (o) return o; }
      // range by days, then months
      for (const [v, unit] of [[d, 'day'], [months, 'month'], [weeks, 'week']]) {
        const o = opts.find((x) => new RegExp(unit).test(norm(x)) && (() => { const r = parseRange(x); return r && v >= r[0] && v <= r[1]; })());
        if (o) return o;
      }
      return null;
    }
    return d === 0 ? 'Immediately available' : `${d} days`;
  }
  if (/start date|when (can|could|would) you (start|join|begin)|earliest (start|date|availability)|available to start|availability to start|date available|join(ing)? date/.test(q)) {
    let date = has(p.availableFrom) ? new Date(p.availableFrom) : null;
    if (!date && has(p.noticePeriodDays)) date = new Date(Date.now() + Number(p.noticePeriodDays) * 864e5);
    if (!date) return null;
    if (fi.inputType === 'date' || fi.inputType === 'month') return fmtDate(date, fi.inputType);
    if (isChoice) {
      const days = Math.max(0, Math.round((date - Date.now()) / 864e5));
      if (days <= 3) return ['Immediately', 'Immediate', 'ASAP'];
      return [`${days} days`, `${Math.round(days / 7)} weeks`, `${Math.round(days / 30)} month`];
    }
    return date.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
  }

  // ---------------- experience ---------------------------------------------------------------
  if (/years?|yrs/.test(q) && /experience|worked|working|professional|using|with|in /.test(q) && !/graduat|old are you|age\b/.test(q)) {
    const sk = skillForQuestion(qRaw, p);
    let years;
    if (sk && sk.unknown) years = null;
    else if (sk) years = sk.years;
    else years = totalYears(p);
    if (years == null) return null;
    // "Do you have a minimum of 7 years …?" → Yes/No
    const thr = /(?:minimum of|at least|min(?:imum)?\.?|more than|over|\b)\s*(\d+(?:\.\d+)?)\s*\+?\s*(?:or more\s*)?(?:years?|yrs)/.exec(q);
    const yesNoQuestion = /^(do|does|have|are|is|can|will|would)\b/.test(q) || (isChoice && fi.options.every((o) => polarity(o) === 'yes' || polarity(o) === 'no'));
    if (thr && yesNoQuestion) return Number(years) >= Number(thr[1]) ? 'Yes' : 'No';
    if (type === 'number' || isChoice) return String(Math.floor(Number(years)));
    return String(Math.floor(Number(years)));
  }
  if (/(current|most recent|present|latest) (employer|company|organi[sz]ation)|^company$|^employer$|company name$|^organi[sz]ation$|current company/.test(q)) return p.currentCompany || null;
  if (/(current|most recent|present|latest) (job )?(title|role|position|designation)|^job title$|^title$|^position$|^designation$/.test(q)) return p.currentTitle || null;
  if (/seniority|career level|experience level/.test(q) && isChoice) return p.seniority || null;

  // ---------------- education ----------------------------------------------------------------
  const ed = highestEducation(p);
  if (/gpa|cgpa|grade point|percentage|grades?\b/.test(q) && !/upgrade/.test(q)) return ed && ed.gpa ? ed.gpa : null;
  if (/highest (level of )?(education|degree|qualification)|education level|level of education|degree (level|type|obtained)|^degree$|what degree|academic qualification/.test(q)) {
    if (!ed || !ed.degree) return null;
    const dg = ed.degree;
    if (isChoice) return [dg, dg.replace(/'s$/, ''), `${dg} degree`, /phd/i.test(dg) ? 'Doctorate' : null].filter(Boolean);
    return [dg, ed.field].filter(Boolean).join(' in ');
  }
  if (/do you have a (bachelor|master|degree|phd)|have you (completed|obtained|earned) a .*(degree|bachelor|master)/.test(q)) {
    if (!ed) return null;
    const order = ['high school', 'diploma', 'associate', "bachelor's", "master's", 'mba', 'phd'];
    const need = /phd|doctor/.test(q) ? 'phd' : /master/.test(q) ? "master's" : /bachelor|degree/.test(q) ? "bachelor's" : null;
    if (!need) return null;
    return order.indexOf(norm(ed.degree)) >= order.indexOf(need) ? 'Yes' : 'No';
  }
  if (/school|university|college|institution|alma mater/.test(q) && !/high school diploma/.test(q)) {
    if (!ed || !ed.school) return null;
    return isChoice ? [ed.school, 'Other', 'Not listed', 'None of the above'] : ed.school;
  }
  if (/field of study|major|discipline|area of study|speciali[sz]ation|concentration/.test(q)) return ed ? ed.field || null : null;
  if (/graduat(ion|e) (year|date)|year of graduation|when did you graduate/.test(q)) {
    if (!ed || !ed.endDate) return null;
    if (fi.inputType === 'date' || fi.inputType === 'month') return fmtDate(parseMonth(ed.endDate), fi.inputType);
    return String(ed.endDate).slice(0, 4);
  }

  // ---------------- languages -----------------------------------------------------------------
  const langs = arr(p.languages).map((l) => l.replace(/\s*\(.*?\)\s*/g, '').trim()).filter(Boolean);
  if (/language/.test(q) && /(speak|languages? (skill|you|spoken|proficien)|which languages|what languages|check all)/.test(q)) {
    if (!langs.length) return null;
    return type === 'checkbox' && !fi.single ? langs : langs.join(', ');
  }
  const lvlAsk = /(level|proficiency|fluency) (of|in) (english|hindi|german|french|spanish|dutch|italian|portuguese|japanese|mandarin|chinese|arabic|korean|polish|swedish)|(english|hindi|german|french|spanish|dutch|italian|portuguese|japanese|mandarin|chinese|arabic|korean|polish|swedish) (level|proficiency|skills?)\b/.exec(q);
  if (lvlAsk) {
    const lang = lvlAsk[3] || lvlAsk[4];
    const entry = arr(p.languages).find((x) => norm(x).includes(lang));
    if (!entry) return isChoice ? ['None', 'No knowledge', 'Beginner', 'Basic', 'A1'] : null;
    const lvl = norm((/\(([^)]+)\)/.exec(entry) || [])[1] || 'fluent');
    const ladder = /native|mother|bilingual/.test(lvl) ? ['Native', 'Native or bilingual', 'Bilingual', 'Mother tongue', 'C2', 'Fluent', 'Proficient', 'Advanced', 'Expert']
      : /fluent|c1|c2|advanced|proficient|professional/.test(lvl) ? ['Fluent', 'Full professional', 'Professional working', 'C1', 'Advanced', 'Proficient', 'Business fluent']
        : /intermediate|conversational|working|b1|b2/.test(lvl) ? ['Intermediate', 'Conversational', 'Professional working', 'Limited working', 'B2', 'B1', 'Good']
          : ['Basic', 'Beginner', 'Elementary', 'A2', 'A1'];
    return isChoice ? ladder : ladder[0];
  }
  const langAsk =/(speak|fluent|fluency|proficien\w*|native|business level|working knowledge)\s.*?\b(english|hindi|german|french|spanish|dutch|italian|portuguese|japanese|mandarin|chinese|arabic|korean|polish|swedish|russian|turkish|tamil|telugu|kannada|marathi|bengali|urdu)\b|\b(english|hindi|german|french|spanish|dutch|italian|portuguese|japanese|mandarin|chinese|arabic|korean|polish|swedish|russian|turkish)\b\s.*?(fluen|proficien|speak)/.exec(q);
  if (langAsk && langs.length) {
    const l = langAsk[2] || langAsk[3];
    return langs.some((x) => norm(x).includes(l)) ? 'Yes' : 'No';
  }

  // ---------------- source ---------------------------------------------------------------------
  if (/how (did )?you (hear|heard|find|found|learn|learned|come across|came across)|where did you (hear|find|see|learn)|source of (application|referral)|referral source|how were you referred|^source$/.test(q)) {
    const v = p.howDidYouHear || 'Company website';
    if (isChoice) return [v, 'Company website', 'Company Career Site', 'Careers page', 'Career site', 'Website', 'Job board', 'LinkedIn', 'Other'];
    return v;
  }
  if (/referred by|referrer|referral name|who referred|employee referral/.test(q)) {
    if (isChoice) return 'No';
    return null;
  }

  // ---------------- misc --------------------------------------------------------------------------
  if (/date of birth|birth ?date|\bdob\b/.test(q)) return has(p.dateOfBirth) ? fmtDate(p.dateOfBirth, fi.inputType || 'date') : null;
  if (/employment type|type of employment|job type|full[- ]time.*part[- ]time/.test(q) && isChoice) return arr(p.jobTypes);
  if (/are you (open|willing|available) to work full[- ]time|full[- ]time (position|role|employment)\?/.test(q)) {
    const jt = arr(p.jobTypes).map(norm);
    return !jt.length || jt.some((x) => /full/.test(x)) ? 'Yes' : 'No';
  }
  if (/certif/.test(q) && isText && (p.certifications || []).length) return p.certifications.map((c) => [c.name, c.issuer].filter(Boolean).join(' — ')).join('; ');

  // Name-attribute fallbacks when the label is useless
  if (hint) {
    if (/\bfirst ?name\b|fname|given/.test(hint)) return p.firstName || null;
    if (/\blast ?name\b|lname|surname|family/.test(hint)) return p.lastName || null;
    if (/^name$|full ?name/.test(hint)) return [p.firstName, p.lastName].filter(has).join(' ') || null;
    if (/email/.test(hint)) return p.email || null;
    if (/phone|tel|mobile/.test(hint)) return phoneOf(p);
    if (/linkedin/.test(hint)) return p.linkedin || null;
    if (/github/.test(hint)) return p.github || null;
    if (/portfolio|website/.test(hint)) return p.portfolio || p.website || null;
    if (/\borg\b|company/.test(hint)) return p.currentCompany || null;
    if (/address-level2|city/.test(hint)) return p.city || null;
    if (/postal|zip/.test(hint)) return p.postalCode || null;
    if (/country/.test(hint)) return p.country || null;
  }
  return null;
}

module.exports = { answerFromProfile, bestOption, norm, polarity, parseRange, countriesIn };
