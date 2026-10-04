// Resume import: copy file into app storage, extract plain text, and heuristically pull profile fields.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { extractSkills, displaySkill } = require('./match');

async function extractText(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const buf = fs.readFileSync(filePath);
  if (ext === '.pdf') {
    const pdf = require('pdf-parse/lib/pdf-parse.js');
    const out = await pdf(buf);
    return out.text || '';
  }
  if (ext === '.docx') {
    const mammoth = require('mammoth');
    const out = await mammoth.extractRawText({ buffer: buf });
    return out.value || '';
  }
  if (['.txt', '.md', '.rtf'].includes(ext)) return buf.toString('utf8');
  throw new Error('Unsupported resume format. Use PDF, DOCX or TXT.');
}

function guessProfile(text) {
  const t = text.replace(/\r/g, '');
  const lines = t.split('\n').map((l) => l.trim()).filter(Boolean);
  const out = {};
  const email = t.match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/);
  if (email) out.email = email[0];
  // Phone: optional +country code, then 10-11 digits possibly split by spaces/dashes/brackets.
  const phone = [...t.matchAll(/(\+\d{1,3}[\s.-]?)?\(?\d{2,5}\)?(?:[\s.-]?\d{2,5}){1,3}/g)]
    .map((m) => m[0]).find((p) => { const d = p.replace(/\D/g, ''); return d.length >= 10 && d.length <= 13 && !/^(19|20)\d{2}\D/.test(p); });
  if (phone) {
    const p = phone.trim();
    const cc = p.match(/^\+\d{1,3}/);
    if (cc) { out.phoneCountryCode = cc[0]; out.phone = p.slice(cc[0].length).replace(/[^\d]/g, ''); }
    else out.phone = p.replace(/[^\d]/g, '');
  }
  const url = (re) => { const m = t.match(re); return m ? (m[0].startsWith('http') ? m[0] : `https://${m[0]}`) : undefined; };
  out.linkedin = url(/(https?:\/\/)?(www\.)?linkedin\.com\/in\/[A-Za-z0-9_\-%]+\/?/i);
  out.github = url(/(https?:\/\/)?(www\.)?github\.com\/[A-Za-z0-9_\-]+\/?/i);
  out.leetcode = url(/(https?:\/\/)?(www\.)?(leetcode\.com|hackerrank\.com)\/[A-Za-z0-9_\-/]+/i);
  // Name: first short line with 2-4 capitalised words and no digits/@.
  const nameLine = lines.slice(0, 6).find((l) => /^[A-Za-z][A-Za-z.'-]+(\s+[A-Za-z][A-Za-z.'-]+){1,3}$/.test(l) && l.length < 40 && !/resume|curriculum|vitae/i.test(l));
  if (nameLine) {
    const parts = nameLine.split(/\s+/).map((p) => p[0].toUpperCase() + p.slice(1).toLowerCase());
    out.firstName = parts[0];
    out.lastName = parts[parts.length - 1];
    if (parts.length > 2) out.middleName = parts.slice(1, -1).join(' ');
  }
  // Experience: explicit "X years" mention, else span of years in date ranges.
  const exp = t.match(/(\d{1,2})\+?\s*(?:years|yrs)\s+(?:of\s+)?(?:professional\s+|industry\s+|work\s+)?experience/i);
  if (exp) out.totalYearsExperience = parseInt(exp[1], 10);
  else {
    const years = [...t.matchAll(/\b(19[89]\d|20[0-3]\d)\b/g)].map((m) => +m[1]);
    const hasPresent = /present|current|till date|now/i.test(t);
    if (years.length >= 2) {
      const span = (hasPresent ? new Date().getFullYear() : Math.max(...years)) - Math.min(...years);
      if (span > 0 && span < 40) out.totalYearsExperience = span;
    }
  }
  out.skills = extractSkills(t).map(displaySkill);
  Object.keys(out).forEach((k) => out[k] === undefined && delete out[k]);
  return out;
}

async function importResume(store, srcPath, meta = {}) {
  const id = crypto.randomUUID();
  const ext = path.extname(srcPath).toLowerCase();
  const fileName = path.basename(srcPath);
  const dest = path.join(store.resumesDir, `${id}${ext}`);
  fs.copyFileSync(srcPath, dest);
  let text = '';
  let parseError = null;
  try { text = await extractText(dest); } catch (e) { parseError = e.message; }
  const item = {
    id,
    name: meta.name || fileName.replace(/\.[^.]+$/, ''),
    fileName,
    path: dest,
    ext,
    size: fs.statSync(dest).size,
    text,
    skills: extractSkills(text),
    roles: meta.roles || [],
    isDefault: false,
    parseError,
    createdAt: new Date().toISOString(),
    stats: { applied: 0, responses: 0, interviews: 0 },
  };
  store.resumes.update((d) => {
    if (!d.items.length) item.isDefault = true;
    d.items.push(item);
  });
  return { resume: item, guessed: text ? guessProfile(text) : {} };
}

function deleteResume(store, id) {
  store.resumes.update((d) => {
    const r = d.items.find((x) => x.id === id);
    if (r) { try { fs.unlinkSync(r.path); } catch {} }
    d.items = d.items.filter((x) => x.id !== id);
    if (d.items.length && !d.items.some((x) => x.isDefault)) d.items[0].isDefault = true;
  });
}

// Picks the best resume for a job: explicit campaign choice > role tag match > skill overlap > default.
function pickResume(store, { resumeId, job } = {}) {
  const items = store.resumes.get().items;
  if (!items.length) return null;
  if (resumeId && resumeId !== 'auto') return items.find((r) => r.id === resumeId) || null;
  if (job) {
    const title = (job.title || '').toLowerCase();
    const tagged = items.find((r) => (r.roles || []).some((role) => role && title.includes(role.toLowerCase())));
    if (tagged) return tagged;
    const jobSkills = new Set(extractSkills(`${job.title} ${job.description}`));
    let best = null; let bestN = -1;
    for (const r of items) {
      const n = (r.skills || []).filter((s) => jobSkills.has(s)).length;
      if (n > bestN) { best = r; bestN = n; }
    }
    if (bestN > 0) return best;
  }
  return items.find((r) => r.isDefault) || items[0];
}

module.exports = { importResume, deleteResume, pickResume, extractText, guessProfile };
