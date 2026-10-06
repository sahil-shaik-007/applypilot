// CSV helpers: RFC 4180 parser, LinkedIn Connections import, and tracker imports (Teal, Huntr,
// Simplify, spreadsheets) with automatic column detection.
const fs = require('fs');

function parseCsv(text) {
  const rows = [];
  let row = []; let field = ''; let q = false;
  const s = String(text).replace(/^﻿/, '');
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (q) {
      if (c === '"') { if (s[i + 1] === '"') { field += '"'; i++; } else q = false; } else field += c;
    } else if (c === '"') q = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && s[i + 1] === '\n') i++;
      row.push(field); field = '';
      if (row.some((x) => x.trim() !== '')) rows.push(row);
      row = [];
    } else field += c;
  }
  row.push(field);
  if (row.some((x) => x.trim() !== '')) rows.push(row);
  return rows;
}

// Turns rows into objects keyed by header, starting at the first row that looks like a header.
function toRecords(rows, isHeader) {
  const hi = rows.findIndex(isHeader);
  if (hi < 0) return { headers: [], records: [] };
  const headers = rows[hi].map((h) => h.trim());
  const records = rows.slice(hi + 1).map((r) => Object.fromEntries(headers.map((h, i) => [h, (r[i] || '').trim()])));
  return { headers, records };
}

// ---------------------------------------------------------------- LinkedIn connections
// LinkedIn → Settings → Data privacy → Get a copy of your data → Connections → Connections.csv
// Columns: First Name, Last Name, URL, Email Address, Company, Position, Connected On (after a "Notes:" preamble).
function parseLinkedInConnections(text) {
  const { records } = toRecords(parseCsv(text), (r) => r.some((c) => /^first name$/i.test(c.trim())) && r.some((c) => /^company$/i.test(c.trim())));
  return records
    .map((r) => ({
      name: [r['First Name'], r['Last Name']].filter(Boolean).join(' '),
      url: r.URL || r.Url || '',
      email: r['Email Address'] || '',
      company: r.Company || '',
      position: r.Position || '',
      connectedOn: r['Connected On'] || '',
    }))
    .filter((c) => c.name && c.company);
}

const SUFFIX = /\b(inc|llc|ltd|limited|pvt|private|plc|gmbh|corp|corporation|co|company|technologies|technology|tech|labs|solutions|services|software|systems|global|group|india|holdings|the)\b/g;
function normCompany(s) {
  return String(s || '').toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9 ]+/g, ' ').replace(SUFFIX, ' ').replace(/\s+/g, ' ').trim();
}
function sameCompany(a, b) {
  const x = normCompany(a); const y = normCompany(b);
  if (!x || !y) return false;
  if (x === y) return true;
  const [short, long] = x.length < y.length ? [x, y] : [y, x];
  return short.length >= 4 && (long.startsWith(`${short} `) || long === short);
}

// ---------------------------------------------------------------- tracker import
const COLS = {
  company: [/^company( name)?$/i, /\bemployer\b/i, /\borgani[sz]ation\b/i, /^company\b/i],
  title: [/\b(job )?title\b/i, /\bposition\b/i, /\brole\b/i, /^job( name)?$/i],
  url: [/url|link/i],
  status: [/^status$/i, /^stage$/i, /^state$/i, /^list$/i],
  date: [/applied( on| at| date)?$/i, /^date( applied)?$/i, /created/i, /^added/i],
  location: [/location|city/i],
  salary: [/salary|compensation|pay/i],
  notes: [/notes?|description|comments?/i],
};
function detectColumns(headers) {
  const map = {};
  for (const [key, patterns] of Object.entries(COLS)) {
    const h = headers.find((x) => patterns.some((p) => p.test(x)));
    if (h) map[key] = h;
  }
  return map;
}
function mapStatus(s) {
  const v = String(s || '').toLowerCase();
  if (/offer|accepted|hired/.test(v)) return 'offer';
  if (/interview|screen|onsite|assessment|test|final/.test(v)) return 'interview';
  if (/reject|declin|archiv|closed|no response|ghost|withdraw/.test(v)) return 'rejected';
  if (/appl/.test(v)) return 'applied';
  if (/wish|save|bookmark|interested|todo|to apply/.test(v)) return 'saved';
  return 'applied';
}
function parseTrackerCsv(text) {
  const rows = parseCsv(text);
  const { headers, records } = toRecords(rows, (r) => { const m = detectColumns(r.map((c) => c.trim())); return !!(m.company && m.title); });
  const cols = detectColumns(headers);
  if (!cols.company || !cols.title) throw new Error('Could not find "Company" and "Title/Position" columns in this CSV.');
  const items = records.filter((r) => r[cols.company] && r[cols.title]).map((r) => {
    const d = cols.date ? new Date(r[cols.date]) : null;
    return {
      company: r[cols.company], title: r[cols.title], url: cols.url ? r[cols.url] : '', status: mapStatus(cols.status ? r[cols.status] : 'applied'),
      appliedAt: d && !isNaN(d) ? d.toISOString() : null, location: cols.location ? r[cols.location] : '', salaryText: cols.salary ? r[cols.salary] : '', notes: cols.notes ? r[cols.notes].slice(0, 2000) : '',
    };
  });
  return { columns: cols, items };
}

const readText = (p) => fs.readFileSync(p, 'utf8');

module.exports = { parseCsv, parseLinkedInConnections, sameCompany, normCompany, parseTrackerCsv, detectColumns, mapStatus, readText };
