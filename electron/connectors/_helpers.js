// Extra helpers shared by job-source connectors (not a connector itself: the loader skips "_" files).

const COUNTRY_PATTERNS = [
  ['in', /\b(india|bengaluru|bangalore|mumbai|bombay|delhi|new delhi|ncr|gurgaon|gurugram|noida|hyderabad|chennai|madras|pune|kolkata|calcutta|ahmedabad|kochi|cochin|jaipur|chandigarh|trivandrum|thiruvananthapuram|coimbatore|indore|bhubaneswar|nagpur|lucknow|vizag|visakhapatnam|mysore|mysuru|mangalore|vadodara|surat)\b/],
  ['gb', /\b(uk|united kingdom|england|scotland|wales|london|manchester|birmingham|edinburgh|glasgow|leeds|bristol|cambridge|oxford|liverpool|belfast)\b/],
  ['us', /\b(usa|u\.s\.a?\.?|united states|america|new york|nyc|san francisco|sf bay|bay area|seattle|austin|boston|chicago|los angeles|denver|atlanta|dallas|houston|miami|washington,? dc|san jose|palo alto|mountain view)\b|,\s*(ca|ny|wa|tx|ma|il|co|ga|fl|nj|va|pa|nc|or|az|mn|mi|oh|ut|md)\b/],
  ['ca', /\b(canada|toronto|vancouver|montreal|ottawa|calgary|edmonton|waterloo)\b/],
  ['au', /\b(australia|sydney|melbourne|brisbane|perth|adelaide|canberra)\b/],
  ['nz', /\b(new zealand|auckland|wellington|christchurch)\b/],
  ['de', /\b(germany|deutschland|berlin|munich|münchen|hamburg|frankfurt|cologne|köln|stuttgart|düsseldorf|dusseldorf)\b/],
  ['fr', /\b(france|paris|lyon|marseille|toulouse|lille|nantes)\b/],
  ['nl', /\b(netherlands|holland|amsterdam|rotterdam|utrecht|eindhoven|the hague)\b/],
  ['es', /\b(spain|españa|madrid|barcelona|valencia|seville|sevilla|malaga|málaga)\b/],
  ['it', /\b(italy|italia|milan|milano|rome|roma|turin|torino)\b/],
  ['pl', /\b(poland|polska|warsaw|warszawa|krakow|kraków|wroclaw|wrocław|gdansk|gdańsk|poznan|poznań|lodz|łódź)\b/],
  ['at', /\b(austria|österreich|vienna|wien|graz)\b/],
  ['ch', /\b(switzerland|schweiz|suisse|zurich|zürich|geneva|genève|basel|lausanne)\b/],
  ['be', /\b(belgium|brussels|bruxelles|antwerp|ghent)\b/],
  ['ie', /\b(ireland|dublin|cork|galway)\b/],
  ['pt', /\b(portugal|lisbon|lisboa|porto)\b/],
  ['sg', /\b(singapore)\b/],
  ['ae', /\b(uae|united arab emirates|dubai|abu dhabi)\b/],
  ['za', /\b(south africa|johannesburg|cape town|durban|pretoria)\b/],
  ['br', /\b(brazil|brasil|são paulo|sao paulo|rio de janeiro)\b/],
  ['mx', /\b(mexico|méxico|mexico city|guadalajara|monterrey)\b/],
  ['jp', /\b(japan|tokyo|osaka)\b/],
  ['ph', /\b(philippines|manila|cebu)\b/],
  ['my', /\b(malaysia|kuala lumpur)\b/],
  ['se', /\b(sweden|stockholm|gothenburg|malmö)\b/],
];

// Best-effort ISO-3166 alpha-2 (lowercase) from a free-text location. Returns null if unknown.
function detectCountry(location) {
  if (!location) return null;
  const l = ` ${String(location).toLowerCase()} `;
  for (const [cc, re] of COUNTRY_PATTERNS) if (re.test(l)) return cc;
  return null;
}

const COUNTRY_ONLY_RE = /^(india|usa|us|u.s.a?.?|united states( of america)?|america|uk|u.k.|united kingdom|great britain|england|canada|australia|new zealand|germany|deutschland|france|netherlands|holland|spain|italy|poland|austria|switzerland|belgium|ireland|portugal|singapore|uae|united arab emirates|south africa|brazil|mexico|japan|philippines|malaysia|sweden|europe|eu|emea|apac|asia|latam)$/i;

// True when the location is just a country/region name (so a server-side country filter is enough).
function isCountryOnly(location) {
  return COUNTRY_ONLY_RE.test(String(location || '').trim());
}

const CURRENCY_SIGNS = [
  [/₹|\binr\b|\brs\.?\s|\blpa\b|\blakhs?\b/i, 'INR'],
  [/£|\bgbp\b/i, 'GBP'],
  [/€|\beur\b/i, 'EUR'],
  [/\bcad\b|ca\$/i, 'CAD'],
  [/\baud\b|a\$/i, 'AUD'],
  [/\bpln\b|zł/i, 'PLN'],
  [/\bchf\b/i, 'CHF'],
  [/\bsgd\b|s\$/i, 'SGD'],
  [/\$|\busd\b/i, 'USD'],
];

// Parse a human salary string ("$120k - $150k", "€60,000–80,000", "25-35 LPA") into numbers.
function parseSalaryText(text) {
  const out = { min: null, max: null, currency: null };
  if (!text) return out;
  const s = String(text);
  for (const [re, cur] of CURRENCY_SIGNS) if (re.test(s)) { out.currency = cur; break; }
  const lakh = /\blpa\b|\blakhs?\b/i.test(s);
  const raw = [];
  const re = /(\d{1,3}(?:,\d{2,3})+|\d+(?:\.\d+)?)\s*(k|m|lpa|lakhs?|l)?\b/gi;
  let m;
  while ((m = re.exec(s)) && raw.length < 2) {
    raw.push({ v: parseFloat(m[1].replace(/,/g, '')), unit: (m[2] || '').toLowerCase() });
  }
  // "$180-220k": a bare number followed by one with a unit shares that unit.
  if (raw.length === 2 && !raw[0].unit && raw[1].unit && raw[0].v < 1000) raw[0].unit = raw[1].unit;
  const nums = [];
  for (const { v: v0, unit } of raw) {
    let v = v0;
    if (unit === 'k') v *= 1000;
    else if (unit === 'm') v *= 1000000;
    else if (unit.startsWith('l') || (lakh && v < 500)) v *= 100000;
    if (v >= 1000) nums.push(Math.round(v));
  }
  if (!nums.length) return out;
  out.min = Math.min(...nums);
  out.max = nums.length > 1 ? Math.max(...nums) : null;
  return out;
}

function toArray(x) {
  if (x == null) return [];
  return Array.isArray(x) ? x : [x];
}

function dedupe(jobs) {
  const seen = new Set();
  return jobs.filter((j) => {
    const k = j.id;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

// Minimal RSS item parser (no deps). Returns [{ raw, get(tag) }].
function parseRssItems(xml) {
  const items = [];
  const re = /<item\b[^>]*>([\s\S]*?)<\/item>/gi;
  let m;
  while ((m = re.exec(xml))) {
    const raw = m[1];
    items.push({
      raw,
      get(tag) {
        const esc = tag.replace(/[:.]/g, (c) => `\\${c}`);
        const mm = raw.match(new RegExp(`<${esc}\\b[^>]*>([\\s\\S]*?)<\\/${esc}>`, 'i'));
        if (!mm) return '';
        return mm[1].replace(/^\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*$/, '$1').trim();
      },
      attr(tag, attr) {
        const esc = tag.replace(/[:.]/g, (c) => `\\${c}`);
        const mm = raw.match(new RegExp(`<${esc}\\b[^>]*\\b${attr}="([^"]*)"`, 'i'));
        return mm ? mm[1] : '';
      },
    });
  }
  return items;
}

function decodeEntities(s) {
  return String(s || '')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#x27;|&#39;|&apos;/g, "'")
    .replace(/&#x2F;/gi, '/').replace(/&#(\d+);/g, (m, n) => String.fromCharCode(+n))
    .replace(/&#x([0-9a-f]+);/gi, (m, n) => String.fromCharCode(parseInt(n, 16)))
    .replace(/&amp;/g, '&');
}

module.exports = { detectCountry, isCountryOnly, parseSalaryText, toArray, dedupe, parseRssItems, decodeEntities };
