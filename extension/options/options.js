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

// ---- web app: which page may drive "Apply in browser" (docs/WEB-BRIDGE.md)
function webMsg(text, kind) { const el = $('webMsg'); el.textContent = text; el.className = `msg ${kind || ''}`; el.classList.toggle('hidden', !text); }
function renderWeb(w) {
  const custom = w.custom || [];
  $('webDot').className = `dot ${custom.length ? 'on' : ''}`;
  $('webText').textContent = custom.length ? 'Web app: connected' : 'Web app: not set';
  const ago = (ms) => { const m = Math.round((Date.now() - ms) / 60000); return m < 1 ? 'just now' : m < 60 ? `${m} min ago` : `${Math.round(m / 60)} h ago`; };
  const rows = [...custom.map((o) => ({ o, own: true })), ...(w.builtin || []).map((o) => ({ o, own: false }))].map(({ o, own }) => {
    const li = document.createElement('li'); li.className = 'row';
    const s = document.createElement('span'); s.className = 'grow'; s.style.flex = '1';
    s.textContent = `${o}${own ? '' : ' (built-in, local development)'}${(w.seen || {})[o] ? ` · seen ${ago(w.seen[o])}` : ''}`;
    li.appendChild(s);
    if (own) {
      const b = document.createElement('button'); b.className = 'btn ghost'; b.textContent = 'Remove';
      b.addEventListener('click', async () => { const r = await send({ type: 'webAppRemove', origin: o }); if (r.ok) renderWeb(r.data); else webMsg(r.error, 'err'); });
      li.appendChild(b);
    }
    return li;
  });
  $('webList').replaceChildren(...rows);
}
async function addWeb() {
  let origin;
  try {
    const u = new URL($('webOrigin').value.trim());
    if (u.protocol !== 'https:' && !(u.protocol === 'http:' && /^(localhost|127\.0\.0\.1)$/.test(u.hostname))) throw new Error('scheme');
    origin = u.origin;
  } catch { webMsg('Enter the address of your ApplyPilot web app, starting with https:// (or http://localhost).', 'err'); return; }
  // Asked first, straight from the click. Addresses the extension already covers are granted without a prompt.
  let granted = false;
  try { granted = (await chrome.permissions.contains({ origins: [`${origin}/*`] })) || (await chrome.permissions.request({ origins: [`${origin}/*`] })); } catch { granted = false; }
  if (!granted) { webMsg('Permission for this address was not granted.', 'err'); return; }
  const r = await send({ type: 'webAppAdd', origin });
  if (!r.ok) { webMsg(r.error, 'err'); return; }
  $('webOrigin').value = '';
  renderWeb(r.data);
  webMsg('Added. Reload the web app if it was already open, then use Apply in browser.', 'ok');
}
async function loadWeb() { const r = await send({ type: 'webApps' }); if (r.ok) renderWeb(r.data); }

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
$('webAdd').addEventListener('click', addWeb);
$('webOrigin').addEventListener('keydown', (e) => { if (e.key === 'Enter') addWeb(); });
loadSettings();
loadWeb();
refresh();
