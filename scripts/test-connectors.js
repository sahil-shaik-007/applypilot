#!/usr/bin/env node
// Live smoke test for job-source connectors in electron/connectors.
//
// Usage:
//   node scripts/test-connectors.js                       # all no-key connectors, query "software engineer"
//   node scripts/test-connectors.js -q "data analyst" -l "India" -r remote -n 10
//   node scripts/test-connectors.js --only remotive,himalayas
//   node scripts/test-connectors.js --all-queries          # run "software engineer", "data analyst", "product manager"
//   KEYS='{"rapidapiKey":"..."}' node scripts/test-connectors.js --only jsearch   # test a keyed connector
//
// Connectors with requiresKeys are skipped unless all their keys are present in the KEYS env JSON.
// Exit code is 1 if any tested connector throws or returns 0 jobs for the default query.
const fs = require('fs');
const path = require('path');

const DIR = path.join(__dirname, '..', 'electron', 'connectors');

function arg(name, def) {
  const i = process.argv.indexOf(name);
  return i > -1 && process.argv[i + 1] !== undefined ? process.argv[i + 1] : def;
}

const opts = {
  query: arg('-q', 'software engineer'),
  location: arg('-l', ''),
  remote: arg('-r', 'any'),
  limit: Number(arg('-n', 20)),
  only: (arg('--only', '') || '').split(',').map((s) => s.trim()).filter(Boolean),
  allQueries: process.argv.includes('--all-queries'),
  verbose: process.argv.includes('-v'),
};
let keys = {};
try { keys = process.env.KEYS ? JSON.parse(process.env.KEYS) : {}; } catch (e) { console.error('KEYS env is not valid JSON'); process.exit(2); }

const files = fs.readdirSync(DIR).filter((f) => f.endsWith('.js') && f !== 'index.js' && !f.startsWith('_'));
const connectors = [];
for (const f of files) {
  try {
    const m = require(path.join(DIR, f));
    if (m && m.id && typeof m.search === 'function') connectors.push(m);
    else console.warn(`! ${f}: not a connector (missing id/search)`);
  } catch (e) {
    console.error(`! ${f}: failed to load: ${e.message}`);
  }
}

function validate(job) {
  const problems = [];
  for (const k of ['id', 'source', 'title', 'url']) if (!job[k]) problems.push(`missing ${k}`);
  if (job.postedAt && Number.isNaN(Date.parse(job.postedAt))) problems.push('bad postedAt');
  if (job.salaryMin != null && typeof job.salaryMin !== 'number') problems.push('salaryMin not number');
  if (typeof job.description !== 'string') problems.push('description not string');
  if (/<\/?(p|div|br|li|ul)\b/i.test(job.description || '')) problems.push('description has HTML');
  return problems;
}

(async () => {
  const queries = opts.allQueries ? ['software engineer', 'data analyst', 'product manager'] : [opts.query];
  const selected = connectors.filter((c) => (!opts.only.length || opts.only.includes(c.id)));
  const runnable = selected.filter((c) => (c.requiresKeys || []).every((k) => keys[k]) && (c.kind !== 'ats' || opts.only.includes(c.id)));
  const skipped = selected.filter((c) => !runnable.includes(c));
  if (skipped.length) console.log(`Skipping (keys required / ATS): ${skipped.map((c) => `${c.id}[${(c.requiresKeys || []).join(',') || c.kind}]`).join(', ')}\n`);

  let failures = 0;
  for (const query of queries) {
    console.log(`=== query="${query}" location="${opts.location}" remote=${opts.remote} limit=${opts.limit} ===`);
    const results = await Promise.all(runnable.map(async (c) => {
      const t0 = Date.now();
      try {
        const jobs = await c.search({ query, location: opts.location, remote: opts.remote, limit: opts.limit }, { keys, companies: {}, log: (...a) => opts.verbose && console.log(`  [${c.id}]`, ...a) });
        return { c, jobs: jobs || [], ms: Date.now() - t0 };
      } catch (e) {
        return { c, error: e, ms: Date.now() - t0 };
      }
    }));
    for (const { c, jobs, error, ms } of results.sort((a, b) => a.c.id.localeCompare(b.c.id))) {
      if (error) {
        failures++;
        console.log(`FAIL ${c.id.padEnd(16)} ${String(ms).padStart(6)}ms  ERROR: ${error.message}`);
        continue;
      }
      const bad = jobs.flatMap((j) => validate(j).map((p) => `${j.id}: ${p}`));
      const overLimit = jobs.length > opts.limit;
      const status = jobs.length === 0 ? 'EMPTY' : bad.length || overLimit ? 'WARN' : 'OK';
      if (jobs.length === 0 && query === queries[0]) failures++;
      const first = jobs[0];
      const sal = jobs.filter((j) => j.salaryMin || j.salaryMax).length;
      console.log(`${status.padEnd(5)}${c.id.padEnd(16)} ${String(ms).padStart(6)}ms  ${String(jobs.length).padStart(3)} jobs (${sal} w/ salary)` +
        (first ? `  | ${first.title} @ ${first.company || '?'} [${first.location || '-'}] ${first.url}` : ''));
      if (bad.length) console.log(`      problems: ${bad.slice(0, 3).join('; ')}${bad.length > 3 ? ` (+${bad.length - 3})` : ''}`);
      if (overLimit) console.log(`      returned more than limit (${jobs.length} > ${opts.limit})`);
      if (opts.verbose) for (const j of jobs.slice(0, 5)) console.log(`      - ${j.title} @ ${j.company} | ${j.location} | ${j.salaryText || ''} | ${j.postedAt}`);
    }
    console.log('');
  }
  process.exitCode = failures ? 1 : 0;
})();
