// Workable: apply.workable.com/{account}/j/{shortcode}/apply/  (also {account}.workable.com/j/{code})

'use strict';

const dom = require('../dom');
const { fillForm } = require('./generic');

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
    return fillForm(page.mainFrame(), ctx, {
      root: 'form[data-ui="application-form"], main form, form',
      afterUploadWaitMs: 3000,
    });
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
