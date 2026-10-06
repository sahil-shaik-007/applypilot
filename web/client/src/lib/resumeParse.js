// In-browser resume text extraction. Files never leave the device unencrypted.
// PDF: pdf.js with position-based spacing (same algorithm as electron/resume.js) so resumes made
// with Canva / Word / LaTeX that place each word separately don't come out glued together.
// DOCX: mammoth (browser build). TXT/MD: UTF-8 decode.
import { extractSkills, displaySkill } from '@shared/match.js';

export const ACCEPT = '.pdf,.docx,.txt,.md,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain';
export const MAX_BYTES = 5 * 1024 * 1024; // encrypted blob must stay under the server's 6 MB limit

let pdfjsPromise = null;
async function loadPdfjs() {
  if (!pdfjsPromise) {
    pdfjsPromise = Promise.all([
      import('pdfjs-dist/legacy/build/pdf.mjs'),
      import('pdfjs-dist/legacy/build/pdf.worker.min.mjs?url'),
    ]).then(([pdfjs, worker]) => { pdfjs.GlobalWorkerOptions.workerSrc = worker.default; return pdfjs; });
  }
  return pdfjsPromise;
}

async function pdfText(bytes) {
  const pdfjs = await loadPdfjs();
  const task = pdfjs.getDocument({ data: bytes.slice(), isEvalSupported: false, verbosity: 0, disableFontFace: true });
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

async function docxText(bytes) {
  const mod = await import('mammoth/mammoth.browser.min.js');
  const mammoth = mod.default || mod;
  const ab = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  const out = await mammoth.extractRawText({ arrayBuffer: ab });
  return out.value || '';
}

export function extOf(name) { const m = String(name).toLowerCase().match(/\.([a-z0-9]+)$/); return m ? `.${m[1]}` : ''; }

/** Returns { text, skills, parseError } */
export async function extractResume(fileName, bytes) {
  const ext = extOf(fileName);
  let text = '';
  let parseError = null;
  try {
    if (ext === '.pdf') text = await pdfText(bytes);
    else if (ext === '.docx') text = await docxText(bytes);
    else if (['.txt', '.md'].includes(ext)) text = new TextDecoder().decode(bytes);
    else throw new Error('Unsupported resume format. Use PDF, DOCX or TXT.');
  } catch (e) { parseError = e.message || String(e); }
  text = text.replace(/\u0000/g, '').trim();
  return { text, skills: extractSkills(text), parseError };
}

export const prettySkills = (skills = []) => skills.map(displaySkill);
