// Greenhouse: new job-boards.greenhouse.io (React / react-select) and legacy
// boards.greenhouse.io (#application_form) forms, plus company-site embeds (?gh_jid=…).

'use strict';

const dom = require('../dom');
const { fillForm } = require('./generic');

function parseGh(url, job) {
  const meta = (job && job.atsMeta) || {};
  let token = meta.boardToken || meta.board || meta.token || meta.company || null;
  let id = meta.jobId || meta.id || null;
  try {
    const u = new URL(url);
    let m = /^\/([^/]+)\/jobs\/(\d+)/.exec(u.pathname);
    if (/greenhouse\.io$/.test(u.hostname) && m && m[1] !== 'embed') { token = m[1]; id = m[2]; }
    if (/greenhouse\.io$/.test(u.hostname) && /\/embed\/job_app/.test(u.pathname)) {
      token = u.searchParams.get('for') || token; id = u.searchParams.get('token') || id;
    }
    if (u.searchParams.get('gh_jid')) id = u.searchParams.get('gh_jid');
    m = /\/v1\/boards\/([^/]+)\/jobs\/(\d+)/.exec(u.pathname);
    if (m) { token = m[1]; id = m[2]; }
  } catch { /* not a URL */ }
  if (!id && job && /^\d+$/.test(String(job.externalId || ''))) id = String(job.externalId);
  return { token, id };
}

const containerRules = [
  { container: '.field-wrapper, .select__container, .text-input-wrapper, .input-wrapper', label: 'label' },
  { container: '#application_form .field, #application-form .field', label: 'label' },
];

async function fillCoverLetterText(page, frame, ctx) {
  if (!ctx.coverLetterText) return false;
  try {
    // New boards: the cover letter group has an "Enter manually" button that reveals a textarea.
    const group = frame.locator('div.file-upload:has(#cover_letter), [class*="file-upload"]:has(input#cover_letter)').first();
    if (await group.count()) {
      const btn = group.locator('button:has-text("Enter manually")').first();
      if (await btn.count()) {
        await dom.safeClick(btn, ctx);
        const ta = frame.locator('textarea#cover_letter_text, textarea[id*="cover_letter"], textarea[name*="cover_letter"]').first();
        await ta.waitFor({ state: 'visible', timeout: 4000 });
        await ta.fill(ctx.coverLetterText);
        return true;
      }
    }
    // Legacy boards: "or enter manually" link with data-source="paste"
    const legacy = frame.locator('#cover_letter_fieldset a[data-source="paste"], [data-field="cover_letter"] a[data-source="paste"]').first();
    if (await legacy.count()) {
      await legacy.click({ timeout: 3000 });
      const ta = frame.locator('textarea[name="job_application[cover_letter_text]"], #cover_letter_text').first();
      await ta.waitFor({ state: 'visible', timeout: 4000 });
      await ta.fill(ctx.coverLetterText);
      return true;
    }
  } catch (e) {
    ctx.log(`greenhouse cover letter: ${e.message}`);
  }
  return false;
}

module.exports = {
  id: 'greenhouse',
  autoSubmit: true,
  match(job, url) {
    return (job && job.ats === 'greenhouse') || /greenhouse\.io/.test(url || '') || /[?&]gh_jid=/.test(url || '');
  },
  resolveUrl(job) {
    const url = job.applyUrl || job.url || '';
    const { token, id } = parseGh(url, job);
    if (token && id) return `https://job-boards.greenhouse.io/${token}/jobs/${id}`;
    return url;
  },
  async prepare(page, ctx) {
    // Company-site embed: jump to the Greenhouse-hosted form.
    if (!/greenhouse\.io/.test(page.url())) {
      const src = await page.locator('iframe#grnhse_iframe, iframe[src*="greenhouse.io"]').first().getAttribute('src', { timeout: 8000 }).catch(() => null);
      if (src) {
        const { token, id } = parseGh(src, ctx.job);
        const target = token && id ? `https://job-boards.greenhouse.io/${token}/jobs/${id}` : src;
        ctx.emit('step', 'Opening the Greenhouse-hosted application form');
        await page.goto(target, { waitUntil: 'domcontentloaded', timeout: 60000 });
      }
    }
    await dom.waitForAny(page.mainFrame(), ['#application-form', '#application_form', 'form input#first_name', 'input#first_name'], 20000);
  },
  async fill(page, ctx) {
    const frame = await dom.bestFormFrame(page);
    let coverDone = false;
    const res = await fillForm(frame, ctx, {
      containerRules,
      exclude: ['.iti__dropdown-content', '[aria-hidden="true"]'],
      phoneNational: false,
      fieldHook: async (fr, f) => {
        // phone country picker of intl-tel-input is handled by typing the +code into the phone input
        if (f.kind === 'file' ) return undefined;
        if (/cover letter/i.test(f.question || '') && f.kind === 'textarea' && ctx.coverLetterText) {
          await dom.fillText(fr, `[data-ap-id="${f.key}"]`, ctx.coverLetterText, ctx);
          coverDone = true;
          return 'filled';
        }
        return undefined;
      },
    });
    if (!coverDone && await fillCoverLetterText(page, frame, ctx)) {
      res.filledCount++;
      ctx.emit('filled', 'Cover letter → (entered manually as text)', { question: 'Cover Letter', source: 'app' });
    }
    // The cover-letter file input is optional on almost every board: drop it from "unanswered" when text was provided
    res.unanswered = res.unanswered.filter((u) => !(/cover letter/i.test(u.question) && ctx.coverLetterText));
    return res;
  },
  async submit(page, ctx) {
    if (!ctx.allowSubmit) throw new dom.SubmitGuardError('submit() called without allowSubmit');
    const frame = await dom.bestFormFrame(page);
    const btn = frame.locator('#application-form button[type=submit], form button[type=submit]:has-text("Submit"), #submit_app, input#submit_app, button:has-text("Submit application")').first();
    if (!(await btn.count())) return false;
    await btn.scrollIntoViewIfNeeded().catch(() => {});
    await btn.click({ timeout: 10000 });
    return true;
  },
  async isConfirmation(page) {
    if (/\/confirmation|\/thanks|application_confirmation/.test(page.url())) return true;
    return dom.genericConfirmation(page);
  },
  _parse: parseGh,
};
