#!/usr/bin/env node
// Offline self-test of the ApplyEngine control flow against a LOCAL fixture page (file://),
// so the auto-submit path can be exercised without contacting any real employer.
//   1. auto    → fills + submits the local form → expects 'submitted'
//   2. dryrun  → fills, never submits (fixture records submit attempts) → expects 0 submits
//   3. review  → fills, user "closes the tab" → expects 'filled-awaiting-user'
//   4. abort   → AbortSignal fired while running → expects 'failed' / Cancelled
//   5. auto with a required question the profile can't answer → falls back to review behaviour
// Usage: node scripts/apply-selftest.js [--headed]

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { pathToFileURL } = require('url');
const { ApplyEngine } = require('../electron/apply/engine');

const OUT = path.join(os.tmpdir(), 'applypilot-selftest');
fs.mkdirSync(OUT, { recursive: true });
const resumePath = path.join(OUT, 'resume.pdf');
fs.writeFileSync(resumePath, '%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj 2 0 obj<</Type/Pages/Kids[]/Count 0>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n');

const fixture = (extraRequired) => `<!doctype html><html><head><meta charset="utf-8"><title>Fixture</title></head><body>
<form id="application-form">
  <label for="first_name">First Name*</label><input id="first_name" required>
  <label for="last_name">Last Name*</label><input id="last_name" required>
  <label for="email">Email*</label><input id="email" type="email" required>
  <label for="phone">Phone</label><input id="phone" type="tel">
  <label for="resume">Resume/CV*</label><input id="resume" type="file" required>
  <label for="spons">Will you now or in the future require visa sponsorship?*</label>
  <select id="spons" required><option value="">Select...</option><option>Yes</option><option>No</option></select>
  <fieldset><legend>Are you legally authorized to work in the United States?*</legend>
    <label><input type="radio" name="auth" value="y" required> Yes</label><label><input type="radio" name="auth" value="n"> No</label></fieldset>
  <label><input type="checkbox" id="privacy" required> I agree to the privacy policy</label>
  ${extraRequired ? '<label for="secret">What is the secret word from our onboarding email?*</label><input id="secret" required>' : ''}
  <button type="submit" id="submit_app">Submit application</button>
</form>
<script>
  window.__submits = 0;
  document.getElementById('application-form').addEventListener('submit', (e) => {
    e.preventDefault(); window.__submits++;
    if (!e.target.checkValidity()) return;
    document.body.innerHTML = '<h1>Thank you for applying!</h1><p>Your application has been submitted.</p>';
  });
</script></body></html>`;

const f1 = path.join(OUT, 'fixture.html'); fs.writeFileSync(f1, fixture(false));
const f2 = path.join(OUT, 'fixture-extra.html'); fs.writeFileSync(f2, fixture(true));

const profile = { firstName: 'Test', lastName: 'Candidate', email: 'test@example.com', phoneCountryCode: '+1', phone: '4155550123', country: 'United States', authorizedCountries: ['United States'], needsSponsorship: 'No' };
const job = (file, id) => ({ id: `selftest:${id}`, title: 'Fixture', company: 'Fixture Co', ats: 'greenhouse', applyUrl: pathToFileURL(file).toString(), url: pathToFileURL(file).toString(), location: 'Remote, United States' });

(async () => {
  const engine = new ApplyEngine({
    userDataDir: OUT,
    getSettings: () => ({ browserChannel: 'msedge', headless: !process.argv.includes('--headed'), maxParallelBrowsers: 2, humanDelays: false }),
    log: (m) => { if (process.env.DEBUG) console.log(m); },
  });
  const results = [];
  const check = (name, cond, extra) => { results.push([name, !!cond]); console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? '  — ' + extra : ''}`); };
  const base = { profile, resume: { path: resumePath, fileName: 'resume.pdf' }, answerQuestion: async () => null };

  // 2. dryrun first (fixture counts submit attempts in the page)
  {
    let pageRef = null;
    const ctxPages = () => (engine._context ? engine._context.pages() : []);
    const r = await engine.applyToJob({ ...base, job: job(f1, 'dry'), mode: 'dryrun', onEvent: (e) => { if (e.type === 'filled' && !pageRef) pageRef = ctxPages().slice(-1)[0]; } });
    check('dryrun: fills and does not submit', r.status === 'filled-awaiting-user' && r.filledCount >= 8, `${r.status} filled=${r.filledCount} unanswered=${JSON.stringify(r.unanswered)}`);
  }
  // 1. auto
  {
    const r = await engine.applyToJob({ ...base, job: job(f1, 'auto'), mode: 'auto' });
    check('auto: submits local fixture', r.status === 'submitted', `${r.status} filled=${r.filledCount} ${r.message} screenshot=${!!r.screenshotPath}`);
  }
  // 3. review → user closes tab
  {
    const r = await engine.applyToJob({
      ...base, job: job(f1, 'review'), mode: 'review',
      onEvent: (e) => { if (e.type === 'needs-user') setTimeout(() => { for (const p of engine._context.pages()) if (/fixture\.html/.test(p.url())) p.close().catch(() => {}); }, 1500); },
    });
    check('review: tab closed → filled-awaiting-user', r.status === 'filled-awaiting-user', `${r.status} ${r.message}`);
  }
  // 4. abort
  {
    const ac = new AbortController();
    const p = engine.applyToJob({ ...base, job: job(f1, 'abort'), mode: 'review', signal: ac.signal, onEvent: (e) => { if (e.type === 'needs-user') setTimeout(() => ac.abort(), 500); } });
    const r = await p;
    check('abort: cancelled', r.status === 'failed' && /cancel/i.test(r.message), `${r.status} ${r.message}`);
  }
  // 5. auto with an unanswerable required question → not submitted, handed to user
  {
    const r = await engine.applyToJob({
      ...base, job: job(f2, 'auto-missing'), mode: 'auto',
      onEvent: (e) => { if (e.type === 'needs-user') setTimeout(() => { for (const pg of engine._context.pages()) if (/fixture-extra/.test(pg.url())) pg.close().catch(() => {}); }, 1000); },
    });
    check('auto + missing required → needs-attention, not submitted', r.status === 'needs-attention' && r.unanswered.some((u) => u.required), `${r.status} unanswered=${JSON.stringify(r.unanswered)}`);
  }
  await engine.close();
  const failed = results.filter((x) => !x[1]).length;
  console.log(`\n${results.length - failed}/${results.length} passed`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
