#!/usr/bin/env node
// Dry-run of the auto-apply engine against live Greenhouse / Lever / Ashby postings.
// Fills the forms with a FAKE profile, screenshots them and reports filled / unanswered
// fields. It NEVER submits: mode 'dryrun' makes submit() unreachable, form submits are
// cancelled in-page, non-GET requests (except uploads) are aborted, and below every
// adapter's submit() is additionally replaced by a function that throws.
//
// Usage: node scripts/apply-dryrun.js [greenhouse|lever|ashby ...] [--headed] [--url=<applyUrl>]

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { ApplyEngine, ADAPTERS } = require('../electron/apply/engine');
const { makeJob, fetchJson } = require('../electron/connectors/_util');

const args = process.argv.slice(2);
const headed = args.includes('--headed');
const only = args.filter((a) => !a.startsWith('--'));
const customUrl = (args.find((a) => a.startsWith('--url=')) || '').slice(6);

// Hard safety net: no adapter may submit during a dry run.
for (const a of Object.values(ADAPTERS)) {
  a.submit = async () => { throw new Error('SAFETY: submit() was called during a dry run'); };
}

const OUT = path.join(os.tmpdir(), 'applypilot-dryrun');
fs.mkdirSync(OUT, { recursive: true });

function makePdf(file) {
  const text = 'Test Candidate - Software Engineer - test@example.com - This is a dummy resume used for automated dry-run testing.';
  const stream = `BT /F1 11 Tf 50 750 Td (${text.replace(/[()\\]/g, '')}) Tj ET`;
  const objs = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  let pdf = '%PDF-1.4\n';
  const offsets = [];
  objs.forEach((o, i) => { offsets.push(pdf.length); pdf += `${i + 1} 0 obj\n${o}\nendobj\n`; });
  const xref = pdf.length;
  pdf += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offsets.map((o) => String(o).padStart(10, '0') + ' 00000 n \n').join('')}`;
  pdf += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  fs.writeFileSync(file, pdf, 'latin1');
  return file;
}

const profile = {
  firstName: 'Test', lastName: 'Candidate', preferredName: 'Test', email: 'test@example.com',
  phoneCountryCode: '+1', phone: '4155550123', nationality: 'American',
  addressLine1: '1 Example Street', city: 'San Francisco', state: 'California', postalCode: '94105', country: 'United States', timezone: 'America/Los_Angeles',
  linkedin: 'https://www.linkedin.com/in/test-candidate-example', github: 'https://github.com/test-candidate-example', portfolio: 'https://example.com/portfolio', website: 'https://example.com',
  authorizedCountries: ['United States'], needsSponsorship: 'No', workAuthUS: 'US Citizen', willingToRelocate: 'Yes',
  over18: 'Yes', backgroundCheckOk: 'Yes', drugTestOk: 'Yes', hasDriversLicense: 'Yes', securityClearance: 'None',
  desiredTitles: ['Software Engineer'], jobTypes: ['Full-time'], workModes: ['Remote', 'Hybrid'],
  salaryCurrency: 'USD', salaryPeriod: 'Yearly', expectedSalaryMin: 150000, expectedSalaryMax: 180000, noticePeriodDays: 14, travelPercent: 10,
  headline: 'Software engineer · 6 yrs · TypeScript/Node/AWS', currentTitle: 'Senior Software Engineer', currentCompany: 'Example Corp', totalYearsExperience: 6, seniority: 'Senior',
  summary: 'Software engineer with six years of experience building web platforms.',
  skills: ['JavaScript', 'TypeScript', 'React', 'Node.js', 'AWS', 'Python', 'PostgreSQL'], skillYears: 'JavaScript: 6\nTypeScript: 4\nPython: 3\nAWS: 3',
  languages: ['English (Native)', 'Spanish (Conversational)'],
  workHistory: [{ company: 'Example Corp', title: 'Senior Software Engineer', startDate: '2021-01', current: true }],
  education: [{ school: 'Example State University', degree: "Bachelor's", field: 'Computer Science', startDate: '2014-09', endDate: '2018-06', gpa: '3.6' }],
  gender: 'Decline to self-identify', pronouns: 'Decline to self-identify', hispanicLatino: 'Decline to self-identify', race: 'Decline to self-identify', veteranStatus: 'Decline to self-identify', disabilityStatus: 'Decline to self-identify',
  howDidYouHear: 'Company website', whyInterested: 'I am excited by the product and the engineering challenges of this team.', additionalInfo: '',
  previouslyEmployedHere: 'No', hasNonCompete: 'No',
};

async function pickJobs() {
  if (customUrl) return [makeJob('custom', { title: 'Custom', company: 'Custom', url: customUrl, applyUrl: customUrl, externalId: 'custom' })];
  const jobs = [];
  const want = (k) => !only.length || only.includes(k);
  if (want('greenhouse')) {
    try {
      const d = await fetchJson('https://boards-api.greenhouse.io/v1/boards/gitlab/jobs');
      const j = d.jobs[0];
      jobs.push(makeJob('greenhouse', { externalId: j.id, title: j.title, company: 'GitLab', location: j.location && j.location.name, url: j.absolute_url, applyUrl: j.absolute_url, ats: 'greenhouse', atsMeta: { boardToken: 'gitlab', jobId: j.id } }));
    } catch (e) { console.error('greenhouse fetch failed', e.message); }
  }
  if (want('lever')) {
    try {
      const d = await fetchJson('https://api.lever.co/v0/postings/palantir?mode=json');
      const j = d[0];
      jobs.push(makeJob('lever', { externalId: j.id, title: j.text, company: 'Palantir', location: j.categories && j.categories.location, url: j.hostedUrl, applyUrl: j.applyUrl, ats: 'lever' }));
    } catch (e) { console.error('lever fetch failed', e.message); }
  }
  if (want('ashby')) {
    try {
      const d = await fetchJson('https://api.ashbyhq.com/posting-api/job-board/ramp');
      const j = d.jobs[0];
      jobs.push(makeJob('ashby', { externalId: j.id, title: j.title, company: 'Ramp', location: j.location, url: j.jobUrl, applyUrl: j.applyUrl, ats: 'ashby' }));
    } catch (e) { console.error('ashby fetch failed', e.message); }
  }
  return jobs;
}

(async () => {
  const resumePath = makePdf(path.join(OUT, 'Test_Candidate_Resume.pdf'));
  const engine = new ApplyEngine({
    userDataDir: OUT,
    getSettings: () => ({ browserChannel: 'msedge', headless: !headed, maxParallelBrowsers: 3, humanDelays: false }),
    log: (m) => { if (process.env.DEBUG) console.log(m); },
  });
  const avail = await engine.isAvailable();
  console.log('browser:', avail);
  if (!avail.ok) process.exit(1);

  const jobs = await pickJobs();
  console.log(`\nDry-running ${jobs.length} job(s) in parallel …\n`);
  const asked = {};
  const results = await Promise.all(jobs.map(async (job) => {
    const t0 = Date.now();
    asked[job.id] = [];
    const res = await engine.applyToJob({
      job, profile, mode: 'dryrun',
      resume: { path: resumePath, fileName: 'Test_Candidate_Resume.pdf', text: 'Test Candidate resume' },
      coverLetterText: 'Dear hiring team,\n\nThis is a dry-run test cover letter.\n\nTest Candidate',
      answerQuestion: async (q, info) => { asked[job.id].push(`${q.slice(0, 90)} [${info.type}${info.required ? ', required' : ''}]`); return null; },
      onEvent: (ev) => { if (process.env.VERBOSE || ev.type === 'error') console.log(`  [${job.ats}] ${ev.type}: ${ev.message}`); },
    });
    return { job, res, ms: Date.now() - t0 };
  }));
  await engine.close();

  let failed = 0;
  for (const { job, res, ms } of results) {
    console.log('='.repeat(100));
    console.log(`${String(job.ats || "generic").toUpperCase()}  ${job.company} — ${job.title}`);
    console.log(`  url:        ${res.url}`);
    console.log(`  status:     ${res.status}  (${(ms / 1000).toFixed(1)}s)  ${res.message}`);
    console.log(`  filled:     ${res.filledCount}`);
    console.log(`  screenshot: ${res.screenshotPath}`);
    console.log(`  unanswered (${res.unanswered.length}):`);
    for (const u of res.unanswered) console.log(`    - ${u.required ? '[required] ' : ''}${u.question.slice(0, 110)}`);
    console.log(`  asked app (${asked[job.id].length}):`);
    for (const q of asked[job.id]) console.log(`    ? ${q}`);
    if (res.status === 'failed') failed++;
  }
  process.exit(failed ? 2 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
