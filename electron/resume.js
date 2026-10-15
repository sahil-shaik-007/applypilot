// Resume import: copy file into app storage, extract plain text, and heuristically pull profile fields.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { extractSkills, displaySkill } = require('./match');

// Modern pdf.js text extraction that rebuilds spaces and line breaks from glyph positions.
// Many resume builders (Canva, Word "Save as PDF", LaTeX) place each word separately with no
// space characters, which older extractors glue together ("ProficientinPythonandSQL").
async function pdfjsText(buf) {
  const { pathToFileURL } = require('url');
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  pdfjs.GlobalWorkerOptions.workerSrc = pathToFileURL(require.resolve('pdfjs-dist/legacy/build/pdf.worker.mjs')).href;
  const task = pdfjs.getDocument({ data: new Uint8Array(buf), isEvalSupported: false, verbosity: 0 });
  const doc = await task.promise;
  const pages = [];
  for (let n = 1; n <= Math.min(doc.numPages, 12); n++) {
    const page = await doc.getPage(n);
    const content = await page.getTextContent();
    let out = '';
    let prev = null;
    for (const it of content.items) {
      if (typeof it.str !== 'string') continue;
      const [, , , , x, y] = it.transform;
      const h = Math.abs(it.transform[3]) || it.height || 10;
      if (prev) {
        const sameLine = Math.abs(y - prev.y) < h * 0.5;
        if (!sameLine) out += '\n';
        else {
          const gap = x - (prev.x + prev.w);
          if (gap > h * 0.18 && !/\s$/.test(out) && !/^\s/.test(it.str)) out += ' ';
        }
      }
      out += it.str;
      if (it.hasEOL) out += '\n';
      prev = { x, y, w: it.width || 0 };
    }
    pages.push(out);
    page.cleanup();
  }
  await task.destroy();
  return pages.join('\n\n').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n');
}

function avgWordLength(t) {
  const toks = (t || '').split(/\s+/).filter(Boolean);
  return toks.length ? t.replace(/\s/g, '').length / toks.length : 0;
}

async function extractText(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const buf = fs.readFileSync(filePath);
  if (ext === '.pdf') {
    let text = '';
    try { text = await pdfjsText(buf); } catch (e) { console.warn("pdf.js extraction failed:", e.message); text = ""; }
    // Fall back to the legacy parser if pdf.js produced nothing usable.
    if (!text.trim() || avgWordLength(text) > 15) {
      try {
        const pdf = require('pdf-parse/lib/pdf-parse.js');
        const legacy = (await pdf(buf)).text || '';
        if (!text.trim() || avgWordLength(legacy) < avgWordLength(text)) text = legacy;
      } catch { /* keep pdf.js result */ }
    }
    return text;
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
  const hash = crypto.createHash('sha1').update(fs.readFileSync(srcPath)).digest('hex');
  const dup = store.resumes.get().items.find((r) => {
    if (!r.hash) { try { r.hash = crypto.createHash('sha1').update(fs.readFileSync(r.path)).digest('hex'); } catch { return false; } }
    return r.hash === hash;
  });
  if (dup) throw new Error(`"${path.basename(srcPath)}" is already uploaded as "${dup.name}".`);
  const ext0 = path.extname(srcPath).toLowerCase();
  if (!['.pdf', '.docx', '.txt', '.md', '.rtf'].includes(ext0)) throw new Error(`"${path.basename(srcPath)}" isn't a supported resume. Use PDF, DOCX or TXT.`);
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
    hash,
    parserVersion: PARSER_VERSION,
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
  if (resumeId && resumeId !== 'auto') {
    const chosen = items.find((r) => r.id === resumeId);
    if (chosen) return chosen;
    // The chosen resume was deleted: fall back to automatic selection instead of failing.
  }
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

const PARSER_VERSION = 2; // bump when text extraction improves so stored resumes get re-read

// Re-extract a stored resume's text with the current parser (keeps name, roles, stats).
async function reparseResume(store, id) {
  const r = store.resumes.get().items.find((x) => x.id === id);
  if (!r) throw new Error('Resume not found');
  let text = '';
  let parseError = null;
  try { text = await extractText(r.path); } catch (e) { parseError = e.message; }
  store.resumes.update((d) => {
    const cur = d.items.find((x) => x.id === id);
    if (cur) Object.assign(cur, { text, skills: extractSkills(text), parseError, parserVersion: PARSER_VERSION });
  });
  return store.resumes.get().items.find((x) => x.id === id);
}

// A resume record keeps the absolute path of its file. After data is moved or restored from a backup that path can
// point somewhere that no longer exists; the file itself is in this install's own resumes folder under the same name.
function repairResumePaths(store) {
  let fixed = 0;
  store.resumes.update((d) => {
    for (const r of d.items) {
      if (!r.path) continue;
      const here = path.join(store.resumesDir, path.basename(String(r.path).replace(/\\/g, '/')));
      // Always prefer this install's own copy of the file over a path somewhere else.
      if (path.resolve(r.path) !== path.resolve(here) && fs.existsSync(here)) { r.path = here; fixed++; }
    }
  });
  return fixed;
}

// One-time upgrade of resumes parsed by an older extractor.
async function migrateResumes(store) {
  repairResumePaths(store);
  for (const r of store.resumes.get().items) {
    if ((r.parserVersion || 1) < PARSER_VERSION) { try { await reparseResume(store, r.id); } catch { /* keep old text */ } }
  }
}

module.exports = { importResume, deleteResume, pickResume, extractText, guessProfile, reparseResume, migrateResumes, repairResumePaths, PARSER_VERSION };
