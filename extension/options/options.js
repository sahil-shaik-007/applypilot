/* global chrome */
'use strict';

const $ = (id) => document.getElementById(id);
const send = (msg) => new Promise((resolve) => chrome.runtime.sendMessage(msg, (r) => resolve(r || { ok: false, error: chrome.runtime.lastError ? chrome.runtime.lastError.message : 'No response' })));
function msg(text, kind) { const el = $('pairMsg'); el.textContent = text; el.className = `msg ${kind || ''}`; el.classList.toggle('hidden', !text); }

async function refresh() {
  const r = await send({ type: 'status' });
  const s = r.ok ? r.data : {};
  const paired = !!(s.paired && !s.error);
  $('pairForm').classList.toggle('hidden', paired);
  $('pairedBox').classList.toggle('hidden', !paired);
  if (paired) {
    $('pairedText').textContent = `Connected to ApplyPilot${s.version ? ` ${s.version}` : ''}`;
    $('pairedMeta').textContent = [s.profile && s.profile.name ? `Profile: ${s.profile.name}` : 'Profile not filled in yet', `${s.resumes || 0} resume${s.resumes === 1 ? '' : 's'}`, `${s.answers || 0} saved answers`, `port ${s.port}`].join(' · ');
  } else if (s.paired && s.code === 'offline') {
    msg('Paired, but the ApplyPilot desktop app is not running right now.', 'warn');
    $('pairForm').classList.add('hidden'); $('pairedBox').classList.remove('hidden');
    $('pairedText').textContent = 'Paired (app offline)';
  } else if (!s.appRunning) msg('ApplyPilot desktop app is not running. Open it to pair.', 'warn');
  else msg('', '');
  return paired;
}

async function pair() {
  const code = $('code').value.replace(/\D/g, '');
  if (code.length !== 6) { msg('Enter the 6-digit code from ApplyPilot → Settings → Browser extension.', 'err'); return; }
  $('pairBtn').disabled = true;
  msg('Pairing…', '');
  const r = await send({ type: 'pair', code });
  $('pairBtn').disabled = false;
  if (!r.ok) { msg(r.error, 'err'); return; }
  $('code').value = '';
  msg('Paired. Open any job posting and click the ApplyPilot icon.', 'ok');
  refresh().then((p) => p && msg('Paired. Open any job posting and click the ApplyPilot icon.', 'ok'));
}

async function loadSettings() {
  const r = await send({ type: 'settings' });
  const s = r.ok ? r.data : {};
  for (const k of ['attachResume', 'highlight', 'learn', 'overwrite']) {
    $(k).checked = !!s[k];
    $(k).addEventListener('change', () => send({ type: 'settings', patch: { [k]: $(k).checked } }));
  }
  for (const el of document.querySelectorAll('input[name=defaultStatus]')) {
    el.checked = el.value === (s.defaultStatus || 'saved');
    el.addEventListener('change', () => el.checked && send({ type: 'settings', patch: { defaultStatus: el.value } }));
  }
}

$('pairBtn').addEventListener('click', pair);
$('code').addEventListener('keydown', (e) => { if (e.key === 'Enter') pair(); });
$('unpairBtn').addEventListener('click', async () => { await send({ type: 'unpair' }); msg('Unpaired. This browser can no longer reach ApplyPilot.', 'ok'); refresh(); });
loadSettings();
refresh();
