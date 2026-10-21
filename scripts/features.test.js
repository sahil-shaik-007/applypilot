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
  await check('posted-within-hours takes any period; the older days setting still works', async () => {
    const h = new Date(now - 30 * 3600000).toISOString(); // 30 hours ago
    assert.ok(jf.matchesWindow({ postedAt: h }, { postedWithinHours: 36, now }), '30h inside a 36h window');
    assert.ok(!jf.matchesWindow({ postedAt: h }, { postedWithinHours: 24, now }), '30h outside a 24h window');
    assert.ok(jf.matchesWindow({ postedAt: new Date(now - 5 * 86400000).toISOString() }, { postedWithinHours: 15 * 24, now }), 'custom 15 days');
    assert.ok(!jf.matchesWindow({ postedAt: new Date(now - 5 * 86400000).toISOString() }, { postedWithinDays: 3, now }), 'legacy 3 days');
    assert.ok(jf.matchesWindow({ postedAt: new Date(now - 2 * 86400000).toISOString() }, { postedWithinHours: 0, postedWithinDays: 0, now }), '0 means any time');
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

  console.log('\nExperience gap');
  const { isExcluded } = require(path.join(ROOT, 'electron', 'match'));
  await check('a fresher is not queued for roles asking for 5+ years; roles near their level stay', async () => {
    const senior = { title: 'Embedded Engineer', description: 'We need 5-6 years of experience in embedded C and RTOS.', location: 'Bengaluru, India' };
    const near = { title: 'Graduate Engineer Trainee', description: 'Entry level. 0-1 years of experience.', location: 'Bengaluru, India' };
    const fresher = { totalYearsExperience: 0, country: 'India' };
    assert.ok(/Asks for ~5\+ years/.test(isExcluded(senior, { profile: fresher }) || ''), 'senior role should be excluded');
    assert.strictEqual(isExcluded(near, { profile: fresher }), null, 'entry role should stay');
    assert.strictEqual(isExcluded(senior, { profile: { ...fresher, totalYearsExperience: 4 } }), null, 'within 2 years of the ask stays');
    assert.strictEqual(isExcluded(senior, { profile: fresher, campaign: { skipExperienceGap: false } }), null, 'can be switched off');
    assert.strictEqual(isExcluded(senior, { profile: { country: 'India' } }), null, 'unknown experience never excludes');
  });

  await check('a fresher never sees Senior / Staff / Principal / Lead titles; trainee and junior titles stay', async () => {
    const fresher = { totalYearsExperience: 0, country: 'India' };
    const title = (t, d = '') => ({ title: t, description: d, location: 'India' });
    for (const t of ['Senior Engineer, Tech support', 'Associate Staff Engineer', 'Lead Developer', 'Associate Principal Engineer']) assert.ok(/Senior-level/.test(isExcluded(title(t), { profile: fresher }) || ''), t + ' should be excluded');
    for (const t of ['Graduate Engineer Trainee', 'Junior Linux Kernel Engineer', 'Associate Engineer', 'Senior Trainee Engineer', 'Internal Systems Engineer']) assert.strictEqual(isExcluded(title(t), { profile: fresher }), null, t + ' should stay');
    assert.strictEqual(isExcluded(title('Senior Engineer'), { profile: { ...fresher, totalYearsExperience: 4 } }), null, 'only for 0-1 years');
    assert.strictEqual(isExcluded(title('Senior Engineer'), { profile: fresher, campaign: { skipExperienceGap: false } }), null, 'can be switched off');
    assert.strictEqual(isExcluded(title('Senior Engineer'), { profile: { country: 'India' } }), null, 'unknown experience never excludes');
  });

  await check('the resume reader takes only labelled personal details (birth date, nationality, languages known, state) and no stray values', async () => {
    const resumeLib = require(path.join(ROOT, 'electron', 'resume'));
    const t = 'SHAIK SAHUL\nEmail :a.b@example.com Mobile:+91-6302803424\nTECHNICAL SKILL SET\n- Languages : C, Basics of Python\nPERSONAL INFORMATION\nName : Shaik Sahul\nDate of Birth : 2nd November 2000.\nNationality : INDIAN.\nLanguages Known : English, Hindi and Telugu\nAddress : D-N0: 2-175/1\nJandrapet,\nPrakasam District\nAndhra Pradesh.';
    const g = resumeLib.guessProfile(t);
    assert.strictEqual(g.dateOfBirth, '2000-11-02');
    assert.strictEqual(g.nationality, 'Indian');
    assert.deepStrictEqual(g.languages, ['English', 'Hindi', 'Telugu']);
    assert.strictEqual(g.state, 'Andhra Pradesh');
    assert.strictEqual(g.country, 'India');
    const none = resumeLib.guessProfile('Jane Doe\nSkills: Python\nBorn in 1990. Languages: C, Go');
    assert.ok(!none.dateOfBirth && !none.languages && !none.state, 'nothing is guessed without a label');
    assert.ok(!resumeLib.guessProfile('Date of Birth : 2nd November 2026').dateOfBirth, 'a birth year in the future or under 15 years ago is refused');
  });

  console.log('\nResume and apply fixes found in a live run');
  const resumeLib = require(path.join(ROOT, 'electron', 'resume'));
  const domLib = require(path.join(ROOT, 'electron', 'apply', 'dom'));
  await check('a fresher resume gets no inflated experience (date of birth and school years are not work)', async () => {
    const fresher = 'SHAIK SAHUL\nEmail : a@b.c\n\nEDUCATIONAL PROFILE\nB. Tech (ECE) 2019- 23\nInter 2016 - 19\n\nPERSONAL INFORMATION\nDate of Birth : 2nd November 2000.';
    assert.strictEqual(resumeLib.guessProfile(fresher).totalYearsExperience, undefined);
    const worker = 'Jane\n\nWORK EXPERIENCE\nAcme  Jan 2019 - Present\n\nEDUCATION\nB.Tech 2012 - 2016';
    assert.strictEqual(resumeLib.guessProfile(worker).totalYearsExperience, new Date().getFullYear() - 2019);
  });
  await check('education is read from a table-style fresher resume (degree, branch, college, years) and never invented', async () => {
    const t = 'EDUCATIONAL PROFILE\nCOURSE INSTITUTION BOARD / UNIVERSITY PERCENTAGE YEAR OF PASSING\nB. Tech\n\n(ECE)\n\nST. ANN\u2019S COLLEGE OF\n\nENGINEERING &\n\nTECHNOLOGY,\n\nCHIRALA.\n\nJNTU\n\nKakinada\n60% 2019- 23\n\nInter (MPC)\nSRI MEDHA V JUNIOR COLLEGE, CHIRALA.\n62.7% 2016 - 19';
    const e = resumeLib.guessEducation(t);
    assert.strictEqual(e.length, 1, `expected one college degree, got ${JSON.stringify(e)}`);
    assert.strictEqual(e[0].degree, "Bachelor's");
    assert.strictEqual(e[0].field, 'Electronics and Communication Engineering');
    assert.ok(/ANN\u2019S COLLEGE OF ENGINEERING/.test(e[0].school));
    assert.strictEqual(e[0].endDate, '2023');
    assert.strictEqual(e[0].gpa, '');
    assert.deepStrictEqual(resumeLib.guessEducation('SKILLS\nPython\nEXPERIENCE\nAcme 2019-2023'), []);
  });
  await check('a site that refuses automated visitors is recognised; real forms and ordinary text are not', async () => {
    const page = (text) => ({ frames: () => [{ evaluate: async () => text }] });
    assert.ok(/restricted/i.test(await domLib.detectBotBlock(page('Access is temporarily restricted\nWe detected unusual activity from your device or network.\nAutomated (bot) activity on your network'))));
    assert.strictEqual(await domLib.detectBotBlock(page('Apply\nFirst name\nLast name\nEmail\n'.repeat(150))), null);
    assert.strictEqual(await domLib.detectBotBlock(page('Responsibilities: manage access control systems.')), null);
  });
  await check('resume repair prefers the install copy, so employers see the original file name source', async () => {
    const os = require('os'); const fs = require('fs');
    const { createStore } = require(path.join(ROOT, 'electron', 'store'));
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ap-feat-'));
    const st = createStore(dir);
    fs.writeFileSync(path.join(dir, 'resumes', 'abc.pdf'), Buffer.alloc(100, 1));
    st.resumes.set({ items: [{ id: 'abc', name: 'r', fileName: 'My_Resume.pdf', path: 'C:\\somewhere\\else\\abc.pdf' }] });
    assert.strictEqual(resumeLib.repairResumePaths(st), 1);
    assert.ok(st.resumes.get().items[0].path.startsWith(dir));
    st.flushAll(); fs.rmSync(dir, { recursive: true, force: true });
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
