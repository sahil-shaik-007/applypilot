// Ashby: jobs.ashbyhq.com/{org}/{jobId}/application  (React form, Yes/No button groups,
// location autocomplete combobox, "Autofill from resume" pane which we deliberately skip).

'use strict';

const dom = require('../dom');
const { fillForm } = require('./generic');

module.exports = {
  id: 'ashby',
  autoSubmit: true,
  match(job, url) { return (job && job.ats === 'ashby') || /ashbyhq\.com/.test(url || ''); },
  resolveUrl(job) {
    const url = job.applyUrl || job.url || '';
    const m = /^(https?:\/\/jobs\.ashbyhq\.com\/[^/?#]+\/[0-9a-f-]{36})/i.exec(url);
    return m ? `${m[1]}/application` : url;
  },
  async prepare(page) {
    const f = page.mainFrame();
    if (!/\/application/.test(page.url())) {
      const tab = f.locator('a[href$="/application"], [role=tab]:has-text("Application")').first();
      if (await tab.count()) await tab.click({ timeout: 5000 }).catch(() => {});
    }
    await dom.waitForAny(f, ['.ashby-application-form-container', 'input#_systemfield_name', 'input#_systemfield_email'], 25000);
  },
  async fill(page, ctx) {
    return fillForm(page.mainFrame(), ctx, {
      containerRules: [{ container: '.ashby-application-form-field-entry', label: '.ashby-application-form-question-title' }],
      exclude: ['.ashby-application-form-autofill-pane', '.ashby-job-posting-header'],
      afterUploadWaitMs: 3000,
    });
  },
  async submit(page, ctx) {
    if (!ctx.allowSubmit) throw new dom.SubmitGuardError('submit() called without allowSubmit');
    const btn = page.locator('button.ashby-application-form-submit-button, button:has-text("Submit Application")').first();
    if (!(await btn.count())) return false;
    await btn.scrollIntoViewIfNeeded().catch(() => {});
    await btn.click({ timeout: 10000 });
    return true;
  },
  async isConfirmation(page) {
    const ok = await page.locator('.ashby-application-form-success-container, [class*="successContainer"]').first().isVisible().catch(() => false);
    return ok || dom.genericConfirmation(page);
  },
};
