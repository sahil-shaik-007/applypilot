// Per-job tailored resumes: AI rewrites the candidate's real resume for one job, we verify it
// introduced nothing new, then render an ATS-friendly PDF that is uploaded for that application.
const fs = require('fs');
const path = require('path');
const { extractSkills } = require('./match');

const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9+#.]+/g, ' ').trim();

/**
 * Removes anything the AI could have invented: skills not present in the source, roles at
 * companies that don't appear in the source, schools/certifications not in the source, and
 * bullets that mention a skill the candidate doesn't have.
 */
function verifyTruthful(doc, sourceText, profile = {}) {
  const src = norm(`${sourceText}\n${JSON.stringify(profile)}`);
  const known = new Set([...extractSkills(sourceText), ...(profile.skills || []).flatMap((s) => extractSkills(s).concat(norm(s)))]);
  const removed = [];
  const inventedSkills = (text) => extractSkills(text).filter((s) => !known.has(s));

  const skills = [];
  for (const s of doc.skills || []) {
    const ex = extractSkills(s);
    // Dictionary skills must be in the source; other phrases must have every word stem in it.
    const stem = (w) => w.replace(/(ing|es|s)$/, '');
    const ok = ex.length ? ex.every((x) => known.has(x)) : norm(s).split(' ').filter((w) => w.length > 2).every((w) => src.includes(stem(w)));
    if (ok) skills.push(s); else removed.push(`skill "${s}"`);
  }
  const experience = [];
  for (const e of doc.experience || []) {
    if (e.company && !src.includes(norm(e.company))) { removed.push(`role at "${e.company}"`); continue; }
    const bullets = [];
    for (const b of e.bullets || []) {
      const bad = inventedSkills(b);
      if (bad.length) removed.push(`bullet mentioning ${bad.join(', ')}`); else bullets.push(b);
    }
    experience.push({ ...e, bullets });
  }
  const projects = (doc.projects || []).filter((p) => {
    const bad = inventedSkills(`${p.name} ${p.details}`);
    if (bad.length) { removed.push(`project detail mentioning ${bad.join(', ')}`); return false; }
    return true;
  });
  const education = (doc.education || []).filter((e) => {
    if (e.school && !src.includes(norm(e.school))) { removed.push(`education "${e.school}"`); return false; }
    return true;
  });
  const certifications = (doc.certifications || []).filter((c) => {
    if (!src.includes(norm(c).split(' ').slice(0, 3).join(' '))) { removed.push(`certification "${c}"`); return false; }
    return true;
  });
  let summary = doc.summary || '';
  const badSummary = inventedSkills(summary);
  if (badSummary.length) {
    summary = summary.split(/(?<=[.!?])\s+/).filter((s) => !inventedSkills(s).length).join(' ');
    removed.push(`summary claim about ${badSummary.join(', ')}`);
  }
  return { doc: { ...doc, summary, skills, experience, projects, education, certifications }, removed };
}

const esc = (s) => String(s || '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// Single-column, text-only layout with standard headings: what ATS parsers read best.
function renderHtml(doc) {
  const section = (title, body) => (body ? `<h2>${title}</h2>${body}` : '');
  return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(doc.name)} — Resume</title><style>
    @page { size: A4; margin: 14mm 15mm; }
    body { font-family: Calibri, Arial, Helvetica, sans-serif; font-size: 10.5pt; line-height: 1.35; color: #111; margin: 0; }
    h1 { font-size: 20pt; margin: 0; letter-spacing: .2px; }
    .headline { font-size: 11pt; color: #333; margin: 2px 0 4px; }
    .contact { font-size: 9.5pt; color: #333; }
    h2 { font-size: 11pt; text-transform: uppercase; letter-spacing: .8px; border-bottom: 1px solid #999; padding-bottom: 2px; margin: 12px 0 6px; }
    .role { margin: 0 0 7px; page-break-inside: avoid; }
    .role-head { display: flex; justify-content: space-between; gap: 8px; font-weight: bold; }
    .role-sub { color: #333; font-style: italic; }
    ul { margin: 3px 0 0 16px; padding: 0; } li { margin: 1px 0; }
    .skills { margin: 0; }
  </style></head><body>
    <h1>${esc(doc.name)}</h1>
    ${doc.headline ? `<div class="headline">${esc(doc.headline)}</div>` : ''}
    <div class="contact">${(doc.contact || []).map(esc).join(' &nbsp;|&nbsp; ')}</div>
    ${section('Summary', doc.summary ? `<p style="margin:0">${esc(doc.summary)}</p>` : '')}
    ${section('Skills', doc.skills && doc.skills.length ? `<p class="skills">${doc.skills.map(esc).join(' · ')}</p>` : '')}
    ${section('Experience', (doc.experience || []).map((e) => `<div class="role"><div class="role-head"><span>${esc(e.title)}${e.company ? ` — ${esc(e.company)}` : ''}</span><span>${esc(e.dates)}</span></div>${e.location ? `<div class="role-sub">${esc(e.location)}</div>` : ''}<ul>${(e.bullets || []).map((b) => `<li>${esc(b)}</li>`).join('')}</ul></div>`).join(''))}
    ${section('Projects', (doc.projects || []).map((p) => `<div class="role"><b>${esc(p.name)}</b> — ${esc(p.details)}</div>`).join(''))}
    ${section('Education', (doc.education || []).map((e) => `<div class="role"><div class="role-head"><span>${esc(e.degree)}${e.school ? ` — ${esc(e.school)}` : ''}</span><span>${esc(e.dates)}</span></div>${e.details ? `<div class="role-sub">${esc(e.details)}</div>` : ''}</div>`).join(''))}
    ${section('Certifications', (doc.certifications || []).length ? `<ul>${doc.certifications.map((c) => `<li>${esc(c)}</li>`).join('')}</ul>` : '')}
  </body></html>`;
}

function docToText(doc) {
  return [doc.name, doc.headline, (doc.contact || []).join(' | '), doc.summary, (doc.skills || []).join(', '),
    ...(doc.experience || []).flatMap((e) => [`${e.title} ${e.company} ${e.dates}`, ...(e.bullets || [])]),
    ...(doc.projects || []).map((p) => `${p.name}: ${p.details}`),
    ...(doc.education || []).map((e) => `${e.degree} ${e.school} ${e.dates} ${e.details}`),
    ...(doc.certifications || [])].filter(Boolean).join('\n');
}

async function htmlToPdf(html, outPath) {
  const { BrowserWindow } = require('electron');
  const w = new BrowserWindow({ show: false, width: 900, height: 1200, webPreferences: { sandbox: true, javascript: false } });
  try {
    await w.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
    const pdf = await w.webContents.printToPDF({ pageSize: 'A4', printBackground: false, preferCSSPageSize: true });
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, pdf);
    return outPath;
  } finally {
    w.destroy();
  }
}

/**
 * Generates a verified tailored resume PDF for a job.
 * @returns {{ path, fileName, text, changes, removed, createdAt }}
 */
async function generate({ ai, aiArgs, job, profile, resume, outDir }) {
  if (!resume || !resume.text) throw new Error('This resume has no readable text to tailor.');
  const raw = await ai.tailoredResumeDoc({ ...aiArgs, job, profile, resumeText: resume.text });
  const { doc, removed } = verifyTruthful(raw, resume.text, profile);
  if (!doc.experience.length && !doc.skills.length) throw new Error('The tailored resume came back empty — try again.');
  const safe = (s) => String(s || '').replace(/[^A-Za-z0-9]+/g, '_').replace(/^_|_$/g, '');
  const fileName = `${safe(profile.firstName) || 'Resume'}_${safe(profile.lastName)}_${safe(job.company).slice(0, 30) || 'Tailored'}.pdf`.replace(/__+/g, '_');
  const out = path.join(outDir, `${safe(job.id || job.title).slice(0, 60)}-${Date.now().toString(36)}`, fileName);
  await htmlToPdf(renderHtml(doc), out);
  return { path: out, fileName, text: docToText(doc), changes: raw.changes || [], removed, createdAt: new Date().toISOString() };
}

module.exports = { generate, verifyTruthful, renderHtml, docToText, htmlToPdf };
