/* global chrome */
'use strict';

const $ = (id) => document.getElementById(id);
const show = (id, on = true) => $(id).classList.toggle('hidden', !on);
const send = (msg) => new Promise((resolve) => chrome.runtime.sendMessage(msg, (r) => resolve(r || { ok: false, error: chrome.runtime.lastError ? chrome.runtime.lastError.message : 'No response' })));
const SOURCE_NAMES = { linkedin: 'LinkedIn', indeed: 'Indeed', naukri: 'Naukri', glassdoor: 'Glassdoor', wellfound: 'Wellfound', foundit: 'foundit', instahyre: 'Instahyre', greenhouse: 'Greenhouse', lever: 'Lever', ashby: 'Ashby', workable: 'Workable', smartrecruiters: 'SmartRecruiters', recruitee: 'Recruitee', workday: 'Workday', web: 'Web' };

let tabId = null;
let job = null;

function setMsg(id, text, kind) {
  const el = $(id);
  el.textContent = text;
  el.className = `msg ${kind || ''}`;
  show(id, !!text);
}
function pill(text, kind, title) {
  const s = document.createElement('span');
  s.className = `pill ${kind || ''}`;
  s.textContent = text;
  if (title) s.title = title;
  return s;
}
function conn(state, text) {
  $('connDot').className = `dot ${state}`;
  $('connText').textContent = text;
}

async function currentTabId() {
  const qp = new URLSearchParams(location.search).get('tabId'); // used when the popup is opened as a page (tests)
  if (qp) return Number(qp);
  const [t] = await chrome.tabs.query({ active: true, currentWindow: true });
  return t ? t.id : null;
}

function renderScore(score) {
  if (!score || !score.match) return;
  const m = score.match;
  const ring = $('scoreRing');
  ring.classList.remove('hidden', 'good', 'mid', 'low');
  ring.classList.add(m.score >= 70 ? 'good' : m.score >= 50 ? 'mid' : 'low');
  $('scoreValue').textContent = m.score;
  $('ringBar').style.strokeDashoffset = String(97.4 * (1 - Math.max(0, Math.min(100, m.score)) / 100));

  const el = $('elig');
  el.replaceChildren();
  const e = score.eligibility || {};
  if (e.scam && e.scam.length) el.appendChild(pill('Possible scam', 'red', e.scam.join(', ')));
  if (m.sponsorship === 'offered') el.appendChild(pill('Visa sponsorship', 'green'));
  else if (m.sponsorship === 'not-offered') el.appendChild(pill('No visa sponsorship', (m.reasons || []).some((r) => /you need sponsorship/.test(r)) ? 'red' : 'amber'));
  if (e.regions && e.regions.length) {
    const blocked = (e.blockers || []).some((b) => /^Remote only/.test(b));
    el.appendChild(pill(`Remote: ${e.regions.join('/')} only`, blocked ? 'red' : 'blue', blocked ? 'Outside your country' : ''));
  }
  for (const b of e.blockers || []) if (/^Posting is in/.test(b)) el.appendChild(pill(b, 'amber'));
  if (e.ok && !(e.scam || []).length) el.appendChild(pill('Eligible', 'green', 'No scam, language or region blockers found'));
  for (const f of (m.flags || []).filter((x) => /stale|short description/i.test(x))) el.appendChild(pill(f.replace(/ — .*/, ''), 'amber', f));

  const r = $('reasons');
  r.replaceChildren(...(m.reasons || []).slice(0, 4).map((t) => { const li = document.createElement('li'); li.textContent = t; return li; }));
  const sk = $('skills');
  sk.replaceChildren();
  if ((m.matchedSkills || []).length) { const b = document.createElement('b'); b.textContent = 'Matched: '; sk.append(b, document.createTextNode(m.matchedSkills.slice(0, 6).join(', '))); }
  if ((m.missingSkills || []).length) { sk.appendChild(document.createElement('br')); const b = document.createElement('b'); b.textContent = 'Missing: '; sk.append(b, document.createTextNode(m.missingSkills.slice(0, 5).join(', '))); }
  if (score.existing) { $('existing').textContent = `Already in your tracker · ${score.existing.status}`; show('existing'); $('saveBtn').textContent = 'Update in ApplyPilot'; }
}

function renderExtraction(ex) {
  show('loading', false);
  if (ex.ok && (ex.isJobPage || !ex.form.looksLikeApplication)) {
    job = ex.job;
    $('jobSource').textContent = `${SOURCE_NAMES[job.source] || job.source} · ${ex.confidence} confidence`;
    $('jobTitle').textContent = job.title;
    $('jobMeta').textContent = [job.company, job.location, job.salaryText].filter(Boolean).join(' · ');
    show('jobCard');
  } else if (!ex.form.looksLikeApplication) show('noJob');
  if (ex.form.fieldCount >= 2) {
    $('formFields').textContent = `${ex.form.fieldCount} fields${ex.form.hasResumeUpload ? ' · resume upload' : ''}`;
    show('formCard');
    if (ex.form.looksLikeApplication && job) $('jobCard').after($('formCard'));
  }
  if (ex.embeddedForms && ex.embeddedForms.length) {
    $('embeddedList').replaceChildren(...ex.embeddedForms.map((u) => {
      const li = document.createElement('li'); const a = document.createElement('a');
      a.href = u; a.textContent = new URL(u).hostname + new URL(u).pathname.slice(0, 40);
      a.addEventListener('click', (e) => { e.preventDefault(); chrome.tabs.create({ url: u }); });
      li.appendChild(a); return li;
    }));
    show('embedded');
  }
}

async function save(status) {
  if (!job) return;
  $('saveBtn').disabled = true; $('queueBtn').disabled = true;
  setMsg('saveMsg', 'Saving…', '');
  const r = await send({ type: 'save', tabId, job, status });
  $('saveBtn').disabled = false; $('queueBtn').disabled = false;
  if (!r.ok) { setMsg('saveMsg', r.error, 'err'); return; }
  const d = r.data;
  renderScore({ match: d.match, eligibility: d.eligibility });
  setMsg('saveMsg', d.duplicate ? `Already in ApplyPilot (${d.status}). Score refreshed.` : `Saved to ApplyPilot${d.status === 'queued' ? ' · in your Review queue' : ' · in Applications'} · ${d.match ? d.match.score : '?'}% match`, 'ok');
  $('saveBtn').textContent = 'Saved ✓';
}

async function autofill() {
  $('fillBtn').disabled = true;
  setMsg('fillMsg', 'Filling…', '');
  const r = await send({ type: 'autofill', tabId });
  $('fillBtn').disabled = false;
  if (!r.ok) { setMsg('fillMsg', r.error, 'err'); return; }
  const d = r.data;
  const parts = [`Filled ${d.filled} field${d.filled === 1 ? '' : 's'}`];
  if (d.resume && d.resume.attached) parts.push(`attached ${d.resume.fileName}`);
  if (d.prefilled) parts.push(`${d.prefilled} already filled`);
  if (d.skippedSensitive) parts.push(`${d.skippedSensitive} sensitive skipped`);
  let text = `${parts.join(' · ')}. Review, then click Submit yourself.`;
  if (d.resume && d.resume.reason) text += ` Resume: ${d.resume.reason}.`;
  if (d.captcha) text += ` ${d.captcha} detected — complete it yourself.`;
  setMsg('fillMsg', text, d.captcha || d.unanswered.length ? 'warn' : 'ok');
  if (d.unanswered.length) {
    $('needsList').replaceChildren(...d.unanswered.slice(0, 12).map((u) => {
      const li = document.createElement('li');
      li.textContent = u.question;
      if (u.required) { const s = document.createElement('span'); s.className = 'req'; s.textContent = ' *'; li.appendChild(s); }
      return li;
    }));
    show('needs');
  }
}

async function learn() {
  const r = await send({ type: 'saveTypedAnswers', tabId });
  if (!r.ok) { setMsg('learnMsg', r.error, 'err'); return; }
  if (r.data.none) setMsg('learnMsg', 'Type your answers into the highlighted fields first.', 'warn');
  else setMsg('learnMsg', `Saved to your Answer bank: ${r.data.added} new${r.data.updated ? `, ${r.data.updated} updated` : ''}. ApplyPilot will reuse them.`, 'ok');
}

async function init() {
  $('openOptions').addEventListener('click', () => chrome.runtime.openOptionsPage());
  $('optionsLink').addEventListener('click', (e) => { e.preventDefault(); chrome.runtime.openOptionsPage(); });
  $('saveBtn').addEventListener('click', () => save());
  $('queueBtn').addEventListener('click', () => save('queued'));
  $('fillBtn').addEventListener('click', autofill);
  $('learnBtn').addEventListener('click', learn);

  tabId = await currentTabId();
  const st = await send({ type: 'status' });
  const s = st.ok ? st.data : { paired: false, appRunning: false };
  const paired = s.paired && !s.error;
  if (paired) conn('on', s.profile && s.profile.name ? s.profile.name : 'Connected');
  else if (s.paired && s.code === 'offline') conn('off', 'App not running');
  else conn('off', s.appRunning ? 'Not paired' : 'App not running');
  if (!paired) {
    $('unpairedText').textContent = s.code === 'offline' ? 'Start the ApplyPilot desktop app to save jobs and autofill forms.' : s.appRunning ? 'Pair this browser with the ApplyPilot desktop app to save jobs and autofill forms.' : 'Install and open the ApplyPilot desktop app, then pair this browser.';
    show('unpaired');
  }
  const r = await send({ type: 'inspect', tabId });
  if (!r.ok) { show('loading', false); setMsg('error', r.error, 'err'); return; }
  renderExtraction(r.data.extraction);
  if (r.data.score) renderScore(r.data.score);
  if (!paired) { $('saveBtn').disabled = true; $('queueBtn').disabled = true; $('fillBtn').disabled = true; }
}

init();
