// Recruitee: {company}.recruitee.com/o/{slug}  →  /o/{slug}/c/new  (also custom career domains)

'use strict';

const dom = require('../dom');
const { fillForm } = require('./generic');

module.exports = {
  id: 'recruitee',
  autoSubmit: true,
  match(job, url) { return (job && job.ats === 'recruitee') || /recruitee\.com/.test(url || ''); },
  resolveUrl(job) {
    const url = job.applyUrl || job.url || '';
    const m = /^(https?:\/\/[^/]+\/o\/[^/?#]+)\/?(?:[?#].*)?$/i.exec(url);
    return m ? `${m[1]}/c/new` : url;
  },
  async prepare(page, ctx) {
    await dom.rejectCookies(page);
    const f = page.mainFrame();
    let found = await dom.waitForAny(f, ['form input[name="candidate[email]"]', 'form input[type=email]'], 12000);
    if (!found) {
      const btn = f.locator('a[href$="/c/new"], a:has-text("Apply for this job"), button:has-text("Apply for this job")').first();
      if (await btn.count()) {
        ctx.emit('step', 'Opening the application form');
        await btn.click({ timeout: 5000 }).catch(() => {});
        found = await dom.waitForAny(f, ['form input[name="candidate[email]"]', 'form input[type=email]'], 15000);
      }
    }
  },
  async fill(page, ctx) {
    return fillForm(page.mainFrame(), ctx, {
      root: 'form[data-testid="application-form"], form.application-form, main form, form',
      afterUploadWaitMs: 2000,
    });
  },
  async submit(page, ctx) {
    if (!ctx.allowSubmit) throw new dom.SubmitGuardError('submit() called without allowSubmit');
    const btn = page.locator('form button[type=submit]').last();
    if (!(await btn.count())) return false;
    await btn.scrollIntoViewIfNeeded().catch(() => {});
    await btn.click({ timeout: 10000 });
    return true;
  },
  async isConfirmation(page) { return dom.genericConfirmation(page); },
};
