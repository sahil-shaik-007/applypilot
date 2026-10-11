// Truthful tailored resume on the phone (parity with electron/tailoredResume.js):
//   1. Claude rewrites the real resume for one job (RESUME_DOC_SCHEMA, straight from this device to Anthropic)
//   2. verifyTruthful() (generated from the desktop module) removes anything not in the source
//   3. pdf-lib renders a single-column, text-only, ATS-friendly A4 PDF
//   4. the PDF is encrypted (vault DEK) and stored as a blob; the application gets `tailored`
// The upload for that application then uses this PDF instead of the base resume.
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { verifyTruthful, docToText } from '@shared/tailoredResume.js';
import { newId } from '@shared/vaultCrypto.js';
import { tailoredResumeDoc, DEFAULT_MODEL } from './ai.js';
import { ensureApplication, patchApplication, getApplication } from './apply.js';
import { getProfile, pickResumeFor, profileIdOf } from './profiles.js';
import { loadPdfjs } from './resumeParse.js';

// ---------------------------------------------------------------- WinAnsi-safe text (standard fonts)
const CP1252 = new Set('€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ');
const MAP = { '→': '->', '←': '<-', '≥': '>=', '≤': '<=', '✓': '-', '✔': '-', '★': '*', '₹': 'INR ', '₩': 'KRW ', '₦': 'NGN ', '−': '-', '‑': '-', '‐': '-', '•': '•', ' ': ' ', ' ': ' ', '​': '', '\t': ' ' };
export function winAnsi(s) {
  let out = '';
  for (const ch of String(s ?? '').normalize('NFC')) {
    const c = ch.codePointAt(0);
    if ((c >= 0x20 && c <= 0x7e) || (c >= 0xa0 && c <= 0xff) || CP1252.has(ch)) { out += ch; continue; }
    if (MAP[ch] !== undefined) { out += MAP[ch]; continue; }
    const base = ch.normalize('NFKD').replace(/[̀-ͯ]/g, '');
    out += base && [...base].every((b) => { const k = b.codePointAt(0); return k >= 0x20 && k <= 0x7e; }) ? base : (c === 10 ? ' ' : '');
  }
  return out.replace(/\s+/g, ' ').trim();
}

// ---------------------------------------------------------------- PDF layout
const A4 = [595.28, 841.89];
const M = 42; // ~15 mm margins

/** Renders a verified resume doc to an ATS-friendly PDF (Uint8Array). */
export async function renderResumePdf(doc) {
  const pdf = await PDFDocument.create();
  const reg = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const ital = await pdf.embedFont(StandardFonts.HelveticaOblique);
  const ink = rgb(0.07, 0.07, 0.07);
  const grey = rgb(0.2, 0.2, 0.2);
  const W = A4[0] - M * 2;
  let page = pdf.addPage(A4);
  let y = A4[1] - M;

  const ensure = (h) => { if (y - h < M) { page = pdf.addPage(A4); y = A4[1] - M; } };
  const wrap = (text, font, size, width) => {
    const words = winAnsi(text).split(' ').filter(Boolean);
    const lines = [];
    let line = '';
    for (const w of words) {
      const tryLine = line ? `${line} ${w}` : w;
      if (font.widthOfTextAtSize(tryLine, size) <= width) { line = tryLine; continue; }
      if (line) lines.push(line);
      // hard-break words longer than the line
      let rest = w;
      while (font.widthOfTextAtSize(rest, size) > width && rest.length > 1) {
        let k = rest.length;
        while (k > 1 && font.widthOfTextAtSize(rest.slice(0, k), size) > width) k--;
        lines.push(rest.slice(0, k)); rest = rest.slice(k);
      }
      line = rest;
    }
    if (line) lines.push(line);
    return lines;
  };
  const text = (t, { font = reg, size = 10.5, color = ink, x = M, width = W, lead = 1.35, after = 0 } = {}) => {
    for (const l of wrap(t, font, size, width)) {
      ensure(size * lead);
      y -= size * lead;
      page.drawText(l, { x, y: y + size * 0.25, size, font, color });
    }
    y -= after;
  };
  const heading = (t) => {
    ensure(34);
    y -= 12;
    text(t.toUpperCase(), { font: bold, size: 11, after: 2 });
    page.drawLine({ start: { x: M, y: y + 1 }, end: { x: M + W, y: y + 1 }, thickness: 0.7, color: rgb(0.6, 0.6, 0.6) });
    y -= 5;
  };
  const twoCol = (left, right, font = bold, size = 10.5) => {
    const rw = right ? font.widthOfTextAtSize(winAnsi(right), size) : 0;
    const lines = wrap(left, font, size, W - rw - 10);
    lines.forEach((l, i) => {
      ensure(size * 1.35);
      y -= size * 1.35;
      page.drawText(l, { x: M, y: y + size * 0.25, size, font, color: ink });
      if (i === 0 && right) page.drawText(winAnsi(right), { x: M + W - rw, y: y + size * 0.25, size, font, color: ink });
    });
  };
  const bullets = (items) => {
    for (const b of items) {
      const lines = wrap(b, reg, 10.5, W - 14);
      lines.forEach((l, i) => {
        ensure(14.2);
        y -= 14.2;
        if (i === 0) page.drawText('•', { x: M + 3, y: y + 2.6, size: 10.5, font: reg, color: ink });
        page.drawText(l, { x: M + 14, y: y + 2.6, size: 10.5, font: reg, color: ink });
      });
    }
  };

  text(doc.name || 'Resume', { font: bold, size: 20, lead: 1.2 });
  if (doc.headline) text(doc.headline, { size: 11, color: grey, after: 1 });
  if ((doc.contact || []).length) text(doc.contact.join('  |  '), { size: 9.5, color: grey });
  if (doc.summary) { heading('Summary'); text(doc.summary); }
  if ((doc.skills || []).length) { heading('Skills'); text(doc.skills.join(' · ')); }
  if ((doc.experience || []).length) {
    heading('Experience');
    for (const e of doc.experience) {
      twoCol(`${e.title || ''}${e.company ? ` — ${e.company}` : ''}`, e.dates);
      if (e.location) text(e.location, { font: ital, size: 10, color: grey });
      bullets(e.bullets || []);
      y -= 5;
    }
  }
  if ((doc.projects || []).length) {
    heading('Projects');
    for (const p of doc.projects) { text(`${p.name}${p.details ? ` — ${p.details}` : ''}`, { after: 3 }); }
  }
  if ((doc.education || []).length) {
    heading('Education');
    for (const e of doc.education) {
      twoCol(`${e.degree || ''}${e.school ? ` — ${e.school}` : ''}`, e.dates);
      if (e.details) text(e.details, { font: ital, size: 10, color: grey });
      y -= 3;
    }
  }
  if ((doc.certifications || []).length) { heading('Certifications'); bullets(doc.certifications); }

  pdf.setTitle(winAnsi(`${doc.name || 'Resume'} — Resume`));
  pdf.setAuthor(winAnsi(doc.name || ''));
  pdf.setCreator('ApplyPilot');
  pdf.setProducer('ApplyPilot (pdf-lib)');
  return pdf.save({ useObjectStreams: false });
}

const safe = (s) => String(s || '').replace(/[^A-Za-z0-9]+/g, '_').replace(/^_|_$/g, '');
export function tailoredFileName(profile = {}, job = {}) {
  return `${safe(profile.firstName) || 'Resume'}_${safe(profile.lastName)}_${safe(job.company).slice(0, 30) || 'Tailored'}.pdf`.replace(/__+/g, '_');
}

/**
 * Generates (or regenerates) the verified tailored PDF for a job and attaches it to the job's
 * application (created as 'saved' if needed). Returns the updated application.
 */
export async function generateTailored(app, { job, resumeId = 'auto', applicationId, profileId, onStep = () => {} }) {
  const apiKey = app.settings.anthropicKey;
  if (!apiKey) throw new Error('Add your Anthropic API key in AI studio to tailor resumes.');
  const appRec = applicationId ? getApplication(app, applicationId) : await ensureApplication(app, job, { resumeId, profileId });
  // Uses the profile of the application (the person it is for).
  const pid = profileIdOf(appRec);
  const resume = pickResumeFor(app, job, resumeId !== 'auto' ? resumeId : (appRec.resumeId || 'auto'), pid);
  if (!resume || !(resume.text || '').trim()) throw new Error('This resume has no readable text to tailor. Upload a PDF/DOCX with selectable text.');
  const profile = getProfile(app, pid).values || {};
  onStep('Rewriting your resume for this job');
  const raw = await tailoredResumeDoc({ apiKey, model: app.settings.aiModel || DEFAULT_MODEL, job, profile, resumeText: resume.text });
  onStep('Checking every claim against your real resume');
  const { doc, removed } = verifyTruthful(raw, resume.text, profile);
  if (!doc.experience.length && !doc.skills.length) throw new Error('The tailored resume came back empty. Try again.');
  onStep('Rendering an ATS-friendly PDF');
  const bytes = await renderResumePdf(doc);
  onStep('Encrypting and saving');
  const blobId = newId();
  await app.sync.putBlob(blobId, bytes);
  const cur = getApplication(app, appRec.id);
  const old = cur && cur.tailored && cur.tailored.blobId;
  const tailored = { fileName: tailoredFileName(profile, job), blobId, size: bytes.length, text: docToText(doc), doc, changes: raw.changes || [], removed, createdAt: new Date().toISOString(), baseResumeId: resume.id, baseResumeName: resume.name };
  const next = await patchApplication(app, appRec.id, { tailored }, `Tailored resume ready${removed.length ? ` (${removed.length} unsupported claim(s) removed)` : ''}`);
  if (old && old !== blobId) app.sync.deleteBlob(old).catch(() => {});
  return { application: next, tailored, bytes };
}

/** Deletes the tailored PDF of an application (blob + field). */
export async function deleteTailored(app, applicationId) {
  const cur = getApplication(app, applicationId);
  if (!cur || !cur.tailored) return;
  const blob = cur.tailored.blobId;
  await patchApplication(app, applicationId, { tailored: null }, 'Tailored resume deleted');
  if (blob) await app.sync.deleteBlob(blob).catch(() => {});
}

/** Rasterises PDF pages (pdf.js) to PNG data URLs for an in-app preview (CSP allows data: images). */
export async function previewPages(bytes, { scale = 1.4, max = 3 } = {}) {
  const pdfjs = await loadPdfjs();
  const task = pdfjs.getDocument({ data: bytes.slice(), isEvalSupported: false, verbosity: 0 });
  const docu = await task.promise;
  const out = [];
  for (let n = 1; n <= Math.min(docu.numPages, max); n++) {
    const pg = await docu.getPage(n);
    const vp = pg.getViewport({ scale });
    const canvas = document.createElement('canvas');
    canvas.width = Math.ceil(vp.width); canvas.height = Math.ceil(vp.height);
    await pg.render({ canvasContext: canvas.getContext('2d'), viewport: vp, canvas }).promise;
    out.push(canvas.toDataURL('image/png'));
    pg.cleanup();
  }
  const pages = docu.numPages;
  await task.destroy();
  return { images: out, pages };
}
