// SmartRecruiters: jobs.smartrecruiters.com/{Company}/{postingId}  →  one-click apply UI
// (jobs.smartrecruiters.com/oneclick-ui/company/{Company}/publication/{uuid}). The form is built
// from web components (open shadow DOM); the scanner and Playwright CSS selectors pierce it.

'use strict';

const dom = require('../dom');
const { fillForm } = require('./generic');

module.exports = {
  id: 'smartrecruiters',
  autoSubmit: true,
  match(job, url) { return (job && job.ats === 'smartrecruiters') || /smartrecruiters\.com/.test(url || ''); },
  resolveUrl(job) {
    const url = job.applyUrl || job.url || '';
    const meta = job.atsMeta || {};
    const company = meta.company || meta.companyIdentifier || (/smartrecruiters\.com\/([^/?#]+)\//i.exec(url) || [])[1];
    const uuid = meta.uuid || meta.publicationId || null;
    if (company && uuid && !/oneclick-ui/.test(url)) return `https://jobs.smartrecruiters.com/oneclick-ui/company/${company}/publication/${uuid}?dcr_ci=${company}`;
    return url;
  },
  async prepare(page, ctx) {
    await dom.rejectCookies(page);
    const f = page.mainFrame();
    if (!/oneclick-ui/.test(page.url())) {
      const a = f.locator('a[href*="oneclick-ui"], a#st-apply, a:has-text("I\'m interested"), button:has-text("I\'m interested"), a:has-text("Apply")').first();
      const href = await a.getAttribute('href', { timeout: 8000 }).catch(() => null);
      if (href && /^https?:|^\//.test(href)) {
        ctx.emit('step', 'Opening the SmartRecruiters application form');
        await page.goto(new URL(href, page.url()).toString(), { waitUntil: 'domcontentloaded', timeout: 60000 });
      } else if (await a.count()) {
        await a.click({ timeout: 5000 }).catch(() => {});
      }
    }
    await dom.waitForAny(page.mainFrame(), ['input#first-name-input', 'input[name="firstName"]', 'oc-oneclick-form', 'input[type=email]'], 25000);
    await dom.rejectCookies(page);
  },
  async fill(page, ctx) {
    return fillForm(page.mainFrame(), ctx, {
      exclude: ['header', 'footer', 'oc-footer'],
      afterUploadWaitMs: 4000,
    });
  },
  async submit(page, ctx) {
    if (!ctx.allowSubmit) throw new dom.SubmitGuardError('submit() called without allowSubmit');
    const btn = page.locator('button[data-test="footer-submit"], oc-footer button:has-text("Submit"), button:has-text("Submit")').first();
    if (!(await btn.count())) return false;
    await btn.scrollIntoViewIfNeeded().catch(() => {});
    await btn.click({ timeout: 10000 });
    return true;
  },
  async isConfirmation(page) {
    if (/\/(success|confirmation|thank)/i.test(page.url())) return true;
    return dom.genericConfirmation(page);
  },
};
