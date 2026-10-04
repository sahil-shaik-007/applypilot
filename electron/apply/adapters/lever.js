// Lever: jobs.lever.co/{company}/{postingId}/apply  (also jobs.eu.lever.co)

'use strict';

const dom = require('../dom');
const { fillForm } = require('./generic');

module.exports = {
  id: 'lever',
  autoSubmit: true,
  match(job, url) { return (job && job.ats === 'lever') || /lever\.co\//.test(url || ''); },
  resolveUrl(job) {
    const url = job.applyUrl || job.url || '';
    const m = /^(https?:\/\/jobs\.(?:eu\.)?lever\.co\/[^/?#]+\/[0-9a-f-]{36})/i.exec(url);
    return m ? `${m[1]}/apply` : url;
  },
  async prepare(page) {
    await dom.waitForAny(page.mainFrame(), ['form#application-form', 'input[name="email"]', '.application-form'], 20000);
  },
  async fill(page, ctx) {
    const frame = page.mainFrame();
    const p = ctx.profile || {};
    const res = await fillForm(frame, ctx, {
      containerRules: [{ container: 'li.application-question', label: '.application-label' }],
      exclude: ['.posting-header', '.main-footer'],
      afterUploadWaitMs: 4000, // Lever parses the resume and pre-fills fields
      fieldHook: async (fr, f) => {
        // Location: free text with an async suggestion list; pick the first suggestion.
        if (f.name === 'location' || /location-input/.test(f.id || '')) {
          const loc = [p.city, p.state, p.country].filter(Boolean).join(', ') || p.city;
          if (!loc) return 'unanswered';
          const ok = await dom.typeAndPickSuggestion(fr, `[data-ap-id="${f.key}"]`, p.city ? `${p.city}${p.country ? ', ' + p.country : ''}` : loc,
            '.dropdown-location, .location-dropdown .dropdown-item, [class*="dropdown-results"] [class*="location"], .dropdown-results > div', ctx);
          if (!ok) await dom.fillText(fr, `[data-ap-id="${f.key}"]`, loc, ctx);
          ctx.emit('filled', `Current location → ${loc}`, { question: 'Current location', answer: loc, source: 'profile' });
          return 'filled';
        }
        return undefined;
      },
    });
    return res;
  },
  async submit(page, ctx) {
    if (!ctx.allowSubmit) throw new dom.SubmitGuardError('submit() called without allowSubmit');
    const btn = page.locator('#btn-submit, button[data-qa="btn-submit"], button.template-btn-submit').first();
    if (!(await btn.count())) return false;
    await btn.scrollIntoViewIfNeeded().catch(() => {});
    await btn.click({ timeout: 10000 });
    return true;
  },
  async isConfirmation(page) {
    if (/\/thanks(\b|\/|\?|$)/.test(page.url())) return true;
    return dom.genericConfirmation(page);
  },
};
