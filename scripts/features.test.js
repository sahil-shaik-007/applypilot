#!/usr/bin/env node
/*
 * Unit checks for the 1.3 features (no UI, no network except a local mock AI server):
 *   - country, posted-date, month and found-time filters (electron/jobFilters.js)
 *   - "never apply at your current employer" (electron/jobFilters.js)
 *   - plain-English discovery matching: companies, roles (electron/discover.js)
 *   - local AI models: OpenAI-compatible calls, JSON extraction, clear errors (electron/ai.js)
 *
 *   node scripts/features.test.js
 */
const assert = require('assert');
const http = require('http');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const jf = require(path.join(ROOT, 'electron', 'jobFilters'));
const { companyMatches, roleMatches } = require(path.join(ROOT, 'electron', 'discover'));
const ai = require(path.join(ROOT, 'electron', 'ai'));

let passed = 0;
const failures = [];
async function check(name, fn) {
  try { await fn(); passed++; console.log(`  ✔ ${name}`); } catch (e) { failures.push(name); console.log(`  ✘ ${name}: ${e.message}`); }
}

// Mock OpenAI-compatible server: lists one model and answers chat calls with JSON or text.
function mockServer(port) {
  const seen = [];
  const srv = http.createServer((req, res) => {
    let body = '';
    req.on('data', (d) => { body += d; });
    req.on('end', () => {
      res.setHeader('Content-Type', 'application/json');
      if (req.url === '/v1/models') return res.end(JSON.stringify({ data: [{ id: 'llama3.1:8b' }, { id: 'qwen2.5:7b' }] }));
      const b = JSON.parse(body || '{}');
      seen.push(b);
      const wantsJson = /Request:/.test(b.messages[1].content);
      // Some local models wrap the JSON in prose; the app must still read it.
      const content = wantsJson
        ? `Here is the plan:\n${JSON.stringify({ companies: [{ name: 'Stripe', careersUrl: '' }], roles: ['data analyst'], requireVisaSponsorship: true, countries: ['India'], note: 'ok' })}`
        : 'Hello from the local model';
      res.end(JSON.stringify({ choices: [{ message: { content } }] }));
    });
  });
  return new Promise((resolve) => srv.listen(port, '127.0.0.1', () => resolve({ srv, seen })));
}

(async () => {
  console.log('ApplyPilot feature checks\n');

  console.log('Country');
  await check('detects country from city, country or remote-region text', async () => {
    assert.strictEqual(jf.countryOf({ location: 'Remote - Warszawa - Poland' }), 'Poland');
    assert.strictEqual(jf.countryOf({ location: 'bengaluru, , India' }), 'India');
    assert.strictEqual(jf.countryOf({ location: 'Remote - US only' }), 'United States');
    assert.strictEqual(jf.countryOf({ location: 'Bern' }), 'Switzerland');
  });
  await check('returns null for unknown or vague locations (never guesses)', async () => {
    assert.strictEqual(jf.countryOf({ location: 'Anywhere' }), null);
    assert.strictEqual(jf.countryOf({ location: '' }), null);
    assert.strictEqual(jf.countryOf({}), null);
  });

  console.log('\nDate, month and time windows');
  const now = Date.parse('2026-10-10T12:00:00Z');
  await check('country filter keeps only the chosen country', async () => {
    assert.ok(jf.matchesWindow({ location: 'Pune, India' }, { countries: ['India'], now }));
    assert.ok(!jf.matchesWindow({ location: 'Berlin, Germany' }, { countries: ['India'], now }));
    assert.ok(jf.matchesWindow({ location: 'Berlin' }, { countries: [], now }), 'no country filter should keep everything');
  });
  await check('posted-within-days keeps recent postings and drops old or undated ones', async () => {
    const recent = new Date(now - 2 * 86400000).toISOString();
    const old = new Date(now - 20 * 86400000).toISOString();
    assert.ok(jf.matchesWindow({ postedAt: recent }, { postedWithinDays: 7, now }));
    assert.ok(!jf.matchesWindow({ postedAt: old }, { postedWithinDays: 7, now }));
    assert.ok(!jf.matchesWindow({ postedAt: null }, { postedWithinDays: 7, now }));
  });
  await check('posted-months keeps only the chosen months', async () => {
    const oct = new Date('2026-10-03T00:00:00Z').toISOString();
    const jan = new Date('2026-01-03T00:00:00Z').toISOString();
    assert.ok(jf.matchesWindow({ postedAt: oct }, { postedMonths: [10], now }));
    assert.ok(!jf.matchesWindow({ postedAt: jan }, { postedMonths: [10], now }));
  });
  await check('found-within-hours uses when ApplyPilot first saw the job', async () => {
    assert.ok(jf.matchesWindow({ firstSeen: new Date(now - 30 * 60000).toISOString() }, { foundWithinHours: 1, now }));
    assert.ok(!jf.matchesWindow({ firstSeen: new Date(now - 5 * 3600000).toISOString() }, { foundWithinHours: 1, now }));
  });

  console.log('\nCurrent employer');
  const profile = {
    currentCompany: 'Acme Technologies Pvt. Ltd.',
    workHistory: [{ company: 'Old Studio', endDate: '2019-06', current: false }, { company: 'Zeta Systems', endDate: 'Present', current: true }],
  };
  await check('blocks the company you work for today, whatever the suffix', async () => {
    assert.ok(jf.isCurrentEmployer({ company: 'Acme' }, profile));
    assert.ok(jf.isCurrentEmployer({ company: 'ACME Technologies Inc' }, profile));
    assert.ok(jf.isCurrentEmployer({ company: 'Zeta Systems' }, profile), 'open-ended work history counts as current');
  });
  await check('does not block former employers or unrelated companies', async () => {
    assert.ok(!jf.isCurrentEmployer({ company: 'Old Studio' }, profile));
    assert.ok(!jf.isCurrentEmployer({ company: 'Acmecorp' }, { currentCompany: 'Acme Robotics' }), 'a word must match, not a prefix');
    assert.ok(!jf.isCurrentEmployer({ company: 'Globex' }, profile));
    assert.ok(!jf.isCurrentEmployer({ company: '' }, profile));
  });

  console.log('\nPlain-English discovery matching');
  await check('matches company names loosely (suffixes, case) but not unrelated names', async () => {
    const wanted = new Map([[jf.normCompany('Stripe'), 'Stripe'], [jf.normCompany('Notion Labs'), 'Notion Labs']]);
    assert.strictEqual(companyMatches({ company: 'Stripe, Inc.' }, wanted), 'Stripe');
    assert.strictEqual(companyMatches({ company: 'Notion' }, wanted), 'Notion Labs', 'a whole-word part of the name counts');
    assert.strictEqual(companyMatches({ company: 'Stripeless Ventures' }, wanted), null);
  });
  await check('role words must all appear in the title or tags', async () => {
    assert.ok(roleMatches({ title: 'Senior Data Analyst (Remote)' }, ['data analyst']));
    assert.ok(!roleMatches({ title: 'Data Engineer' }, ['data analyst']));
    assert.ok(roleMatches({ title: 'Anything' }, []), 'no role words means any role');
  });

  console.log('\nLocal AI model (OpenAI-compatible server)');
  const port = 8797;
  const { srv, seen } = await mockServer(port);
  const base = `http://127.0.0.1:${port}/v1`;
  await check('lists the models the local server has installed', async () => {
    assert.deepStrictEqual(await ai.localModels(base), ['llama3.1:8b', 'qwen2.5:7b']);
  });
  await check('a plain text answer comes back as text', async () => {
    const out = await ai.planDiscovery({ provider: 'local', localBaseUrl: base, localModel: 'llama3.1:8b', prompt: 'hi' }).catch((e) => e);
    assert.ok(out && out.companies, `planDiscovery failed: ${out && out.message}`);
  });
  await check('a plan wrapped in prose is still read as JSON', async () => {
    const plan = await ai.planDiscovery({ provider: 'local', localBaseUrl: base, localModel: 'llama3.1:8b', prompt: 'List data analyst roles at Stripe that sponsor visas in India' });
    assert.strictEqual(plan.companies[0].name, 'Stripe');
    assert.deepStrictEqual(plan.countries, ['India']);
    assert.strictEqual(plan.requireVisaSponsorship, true);
  });
  await check('the request asks for JSON (response_format) and sends the schema', async () => {
    const last = seen[seen.length - 1];
    assert.ok(last.response_format && last.response_format.type === 'json_object');
    assert.ok(/JSON Schema/.test(last.messages[0].content));
  });
  await check('a missing model name gives a clear instruction', async () => {
    await assert.rejects(ai.planDiscovery({ provider: 'local', localBaseUrl: base, localModel: '', prompt: 'x' }), /Choose a local model name/);
  });
  await check('a server that is not running gives a clear error', async () => {
    await assert.rejects(ai.localModels('http://127.0.0.1:9/v1'), /Can't reach the local AI/);
  });
  await check('only http(s) addresses are accepted', async () => {
    await assert.rejects(ai.localModels('file:///etc/passwd'), /must start with http/);
  });
  srv.closeAllConnections();
  srv.close();

  console.log(`\n${passed} passed, ${failures.length} failed`);
  process.exitCode = failures.length ? 1 : 0;
})();
