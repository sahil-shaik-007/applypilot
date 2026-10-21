// Workable: apply.workable.com/{account}/j/{shortcode}/apply/  (also {account}.workable.com/j/{code})

'use strict';

const path = require('path');
const dom = require('../dom');
const { fillForm } = require('./generic');
const { answerFromProfile } = require('../answers');

// Identity inputs (by input name) and the question each one answers.
const IDENTITY = { firstname: 'First name', lastname: 'Last name', email: 'Email', phone: 'Phone number', address: 'Address' };
const RESUME_SEL = 'input[type="file"][data-ui="resume"]';

// Workable keeps a saved draft per job in the browser and restores it on load: earlier names, emails,
// phones and the resume file come back pre-filled. Identity fields are therefore set from the
// candidate's own data every time, and a value with no source is flagged rather than silently kept.
async function identityHook(frame, f, ctx) {
  const name = String(f.name || '').toLowerCase();
  const label = IDENTITY[name];
  if (!label) return undefined;
  let want = answerFromProfile(label, { type: 'text', phoneNational: true }, ctx.profile, ctx.job);
  if (name === 'address') {
    // "Include your city, region, and country": no street fragments, and no name repeated (a state saved as the
    // city must not read "Andhra Pradesh, Andhra Pradesh, India").
    const parts = [];
    for (const v of [ctx.profile.city, ctx.profile.state, ctx.profile.country]) {
      const t = String(v || '').trim();
      if (t && !parts.some((x) => x.toLowerCase() === t.toLowerCase())) parts.push(t);
    }
    if (parts.length) want = parts.join(', ');
  }
  const page = String(f.value || '').trim();
  if (!want) {
    if (!page) return undefined; // nothing to give and nothing pre-filled: generic handling reports it if required
    // Not from the profile or resume, so it may belong to someone else: clear it rather than submit it.
    await dom.fillText(frame, `[data-ap-id="${f.key}"]`, '', ctx).catch(() => {});
    ctx.emit('warn', `${label} was pre-filled with "${page}", which is not in your profile or resume, so it was cleared. Enter yours.`, { question: label });
    return 'unanswered';
  }
  if (name === 'phone' && ctx.profile.phoneCountryCode) {
    // The number is typed without a country code, so the page's country picker must show the same code.
    const cc = String(ctx.profile.phoneCountryCode).replace(/\D/g, '');
    const shown = await frame.locator('button[aria-label^="Change country for phone number"]').first().getAttribute('aria-label').catch(() => '');
    if (cc && shown && !shown.includes(`+${cc})`)) {
      ctx.emit('warn', `Phone country on the form does not match your profile (+${cc}). Set it before submitting.`, { question: label });
      return 'unanswered';
    }
  }
  if (page === String(want)) return 'filled';
  if (!(await dom.fillText(frame, `[data-ap-id="${f.key}"]`, String(want), ctx))) return 'unanswered';
  ctx.emit('filled', `${label} → ${want}`, { question: label, answer: want, source: 'profile' });
  return 'filled';
}

// Runs before the page's own scripts (once per tab) and removes Workable's saved per-job drafts, so the
// form never restores a draft left by an earlier session or another person. Identity is then filled from the profile.
function clearWorkableDraft() {
  try {
    if (!/(^|\.)workable\.com$/.test(location.hostname) || sessionStorage.getItem('ap-draft-cleared')) return;
    sessionStorage.setItem('ap-draft-cleared', '1');
    Object.keys(localStorage).filter((k) => k.startsWith('evergreen-persistence-')).forEach((k) => localStorage.removeItem(k));
  } catch (e) { /* storage blocked: nothing to clear */ }
}

// True when the resume card shown on the page is the file ApplyPilot is uploading. The page shows the
// original file name (e.g. "Sahul_Resume.pdf"), not the stored copy's id-based name.
async function resumeShown(frame, resume) {
  const base = (resume && resume.fileName) || path.basename(resume.path || '');
  if (!base) return false;
  return frame.evaluate((n) => (document.body.innerText || '').includes(n), base).catch(() => false);
}

// Uploads the selected resume into Workable's resume input, replacing any restored draft file.
async function attachResume(frame, ctx) {
  const file = ctx.resume && ctx.resume.path;
  if (!file) return false;
  for (let i = 0; i < 2; i++) {
    if (!(await frame.locator(RESUME_SEL).count().catch(() => 0))) return false;
    await dom.uploadFile(frame, RESUME_SEL, file, ctx, ctx.resume.fileName).catch(() => {});
    await dom.sleep(3000);
    if (await resumeShown(frame, ctx.resume)) return true;
  }
  return false;
}

module.exports = {
  id: 'workable',
  autoSubmit: true,
  match(job, url) { return (job && job.ats === 'workable') || /workable\.com/.test(url || ''); },
  resolveUrl(job) {
    const url = job.applyUrl || job.url || '';
    let m = /^https?:\/\/apply\.workable\.com\/j\/([A-Z0-9]+)/i.exec(url);
    if (m) return `https://apply.workable.com/j/${m[1]}/apply`;
    m = /^https?:\/\/apply\.workable\.com\/([^/?#]+)\/j\/([A-Z0-9]+)/i.exec(url);
    if (m) return `https://apply.workable.com/${m[1]}/j/${m[2]}/apply/`;
    m = /^https?:\/\/([^.]+)\.workable\.com\/j(?:obs)?\/([A-Z0-9]+)/i.exec(url);
    if (m && m[1] !== 'apply' && m[1] !== 'www') return `https://apply.workable.com/${m[1]}/j/${m[2]}/apply/`;
    return url;
  },
  async prepare(page, ctx) {
    await dom.rejectCookies(page);
    const f = page.mainFrame();
    let found = await dom.waitForAny(f, ['form[data-ui="application-form"]', 'input[name="firstname"]', 'input[name="email"]'], 12000);
    if (!found) {
      const btn = f.locator('a[data-ui="overview-apply-now"], a:has-text("Apply for this job"), button:has-text("Apply for this job")').first();
      if (await btn.count()) {
        ctx.emit('step', 'Opening the application form');
        await btn.click({ timeout: 5000 }).catch(() => {});
        found = await dom.waitForAny(f, ['form[data-ui="application-form"]', 'input[name="firstname"]', 'input[name="email"]'], 15000);
      }
    }
    await dom.rejectCookies(page);
  },
  async fill(page, ctx) {
    const frame = page.mainFrame();
    await attachResume(frame, ctx);
    const result = await fillForm(frame, ctx, {
      root: 'form[data-ui="application-form"], main form, form',
      afterUploadWaitMs: 3000,
      fieldHook: identityHook,
      phoneNational: true,
    });
    // The draft can be restored after the upload, so confirm the resume is still the one attached.
    if (ctx.resume && ctx.resume.path) {
      const ok = (await resumeShown(frame, ctx.resume)) || (await attachResume(frame, ctx));
      if (!ok) result.unanswered = [...(result.unanswered || []), { question: 'Resume (could not be attached; attach it yourself)', required: true }];
    }
    return result;
  },
  draftInitScript: clearWorkableDraft,
  // "Open & finish": fills only name, email, phone and address from the profile (or resume). No resume upload,
  // no questions and nothing submitted; the user completes the rest in the tab.
  async prefillIdentity(page, ctx) {
    const frame = page.mainFrame();
    const fields = await dom.scanFields(frame, { root: 'form[data-ui="application-form"], main form, form' });
    for (const f of fields) {
      if (!IDENTITY[String(f.name || '').toLowerCase()]) continue;
      await identityHook(frame, f, ctx);
    }
  },
  async submit(page, ctx) {
    if (!ctx.allowSubmit) throw new dom.SubmitGuardError('submit() called without allowSubmit');
    const btn = page.locator('button[data-ui="apply-button"], form button[type=submit]:has-text("Submit")').first();
    if (!(await btn.count())) return false;
    await btn.scrollIntoViewIfNeeded().catch(() => {});
    await btn.click({ timeout: 10000 });
    return true;
  },
  async isConfirmation(page) {
    const ok = await page.locator('[data-ui="application-success"], [data-ui="success"]').first().isVisible().catch(() => false);
    return ok || dom.genericConfirmation(page);
  },
};
