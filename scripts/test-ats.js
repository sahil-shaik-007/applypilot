#!/usr/bin/env node
// Smoke test for the ATS connectors.
//   node scripts/test-ats.js                 # all ATS connectors
//   node scripts/test-ats.js lever ashby     # selected ones
// For each connector runs "software engineer" and "product manager" (cold, then a cached
// re-run of the first query) and prints counts, timing, field coverage and 2 sample jobs.
const path = require('path');

const ALL = ['greenhouse', 'lever', 'ashby', 'workable', 'smartrecruiters', 'recruitee'];
const QUERIES = ['software engineer', 'product manager'];
const pick = process.argv.slice(2).filter((a) => !a.startsWith('-'));
const ids = pick.length ? pick : ALL;
const companies = require(path.join(__dirname, '..', 'electron', 'data', 'companies.json'));

const REQUIRED = ['id', 'source', 'title', 'company', 'url', 'applyUrl', 'ats'];

function sample(j) {
  return {
    title: j.title, company: j.company, location: j.location, remote: j.remote,
    postedAt: j.postedAt, salary: j.salaryText || (j.salaryMin ? `${j.salaryMin}-${j.salaryMax} ${j.salaryCurrency}` : null),
    applyUrl: j.applyUrl, atsMeta: j.atsMeta, description: (j.description || '').slice(0, 120).replace(/\s+/g, ' ') + '…',
  };
}

(async () => {
  const summary = [];
  let failures = 0;
  for (const id of ids) {
    const c = require(path.join(__dirname, '..', 'electron', 'connectors', `${id}.js`));
    const boards = (companies[id] || []).length;
    console.log(`\n=== ${c.name} (${boards} boards) ===`);
    const logs = [];
    const ctx = { companies, keys: {}, log: (m) => logs.push(m) };
    for (const [i, query] of QUERIES.entries()) {
      const t0 = Date.now();
      let jobs = [];
      let err = null;
      try { jobs = await c.search({ query, location: '', remote: 'any', limit: 100 }, ctx); } catch (e) { err = e; }
      const secs = (Date.now() - t0) / 1000;
      if (err) { failures++; console.log(`  "${query}": ERROR ${err.stack}`); summary.push({ id, query, error: err.message }); continue; }
      const bad = jobs.filter((j) => REQUIRED.some((k) => !j[k]));
      const withDesc = jobs.filter((j) => (j.description || '').length > 50).length;
      const withSal = jobs.filter((j) => j.salaryMin || j.salaryMax || j.salaryText).length;
      const companiesHit = new Set(jobs.map((j) => j.company)).size;
      console.log(`  "${query}": ${jobs.length} jobs from ${companiesHit} companies in ${secs.toFixed(1)}s  (desc ${withDesc}, salary ${withSal}, missing-fields ${bad.length})`);
      if (bad.length) { failures++; console.log('   missing fields example:', bad[0]); }
      if (i === 0) jobs.slice(0, 2).forEach((j) => console.log('   ', JSON.stringify(sample(j))));
      summary.push({ id, query, count: jobs.length, secs: +secs.toFixed(1), desc: withDesc, salary: withSal });
    }
    const t1 = Date.now();
    const again = await c.search({ query: QUERIES[0], limit: 100 }, ctx);
    console.log(`  cached re-run "${QUERIES[0]}": ${again.length} jobs in ${((Date.now() - t1) / 1000).toFixed(1)}s`);
    const t2 = Date.now();
    const remote = await c.search({ query: QUERIES[0], location: 'India', remote: 'any', limit: 100 }, ctx);
    console.log(`  "${QUERIES[0]}" in India: ${remote.length} jobs (${((Date.now() - t2) / 1000).toFixed(1)}s)`);
    if (logs.length) console.log('  log:', logs.join(' | '));
  }
  console.log('\nSUMMARY');
  console.table(summary);
  process.exit(failures ? 1 : 0);
})();
