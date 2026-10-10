// ApplyPilot extension service worker: owns the bridge connection and runs the two flows
// (save job / autofill) on the tab the user invoked the extension on (activeTab).
/* global chrome, importScripts, ApBridge */
'use strict';
importScripts('lib/bridge-client.js');

const DEFAULT_SETTINGS = { attachResume: true, highlight: true, learn: true, defaultStatus: 'saved', overwrite: false };
async function getSettings() { return { ...DEFAULT_SETTINGS, ...((await chrome.storage.local.get(['settings'])).settings || {}) }; }

async function inject(tabId, files) {
  await chrome.scripting.executeScript({ target: { tabId }, files });
}
async function run(tabId, func, args = []) {
  const [r] = await chrome.scripting.executeScript({ target: { tabId }, func, args });
  if (!r) throw new Error('This page cannot be read by extensions');
  return r.result;
}
function friendly(e) {
  const m = String((e && e.message) || e);
  if (/Cannot access|cannot be scripted|chrome:\/\/|edge:\/\/|extensions gallery|Missing host permission|The extensions gallery/i.test(m)) return 'Browser pages and extension stores can\'t be read. Open a job posting or application form.';
  return m;
}

async function extract(tabId) {
  await inject(tabId, ['content/extract.js']);
  return run(tabId, () => globalThis.__apExtract());
}

const flows = {
  async status() {
    const p = await ApBridge.apStore.get();
    if (!p) {
      const port = await ApBridge.apDiscover();
      return { paired: false, appRunning: !!port };
    }
    try { return { paired: true, appRunning: true, port: p.port, ...(await ApBridge.apCall('/status')) }; } catch (e) { return { paired: e.code !== 'unpaired', appRunning: e.code !== 'offline', error: e.message, code: e.code }; }
  },
  async pair({ code }) { const p = await ApBridge.apPair(code); return { paired: true, port: p.port, appVersion: p.appVersion }; },
  async unpair() {
    try { await ApBridge.apCall('/unpair', { method: 'POST', body: {} }); } catch { /* app offline: forget locally anyway */ }
    await ApBridge.apStore.clear();
    return { paired: false };
  },
  // Extract the job on the tab and (when paired) score it without saving.
  async inspect({ tabId }) {
    const extraction = await extract(tabId);
    let score = null; let scoreError = null;
    if (extraction.ok && extraction.job.title) {
      try { score = await ApBridge.apCall('/score', { method: 'POST', body: { job: extraction.job } }); } catch (e) { scoreError = { message: e.message, code: e.code }; }
    }
    return { extraction, score, scoreError };
  },
  async save({ tabId, job, status }) {
    const s = await getSettings();
    const j = job || (await extract(tabId)).job;
    if (!j || !j.title) throw new Error('No job found on this page.');
    return ApBridge.apCall('/jobs', { method: 'POST', body: { job: j, status: status || s.defaultStatus } });
  },
  async autofill({ tabId }) {
    const s = await getSettings();
    const ex = await extract(tabId).catch(() => null);
    const job = ex && ex.job ? ex.job : {};
    const qs = new URLSearchParams({ title: job.title || '', company: job.company || '' }).toString();
    const data = await ApBridge.apCall(`/autofill-data?${qs}`);
    const p = data.profile || {};
    const coverLetterText = p.coverLetterTemplate ? fillTemplate(p.coverLetterTemplate, job, p) : null;
    await inject(tabId, ['content/shared.js', 'content/autofill.js']);
    const result = await run(tabId, (payload) => globalThis.__apAutofill(payload), [{
      profile: p, answers: data.answers, job: { title: job.title, company: job.company, location: job.location }, coverLetterText,
      options: { highlight: s.highlight, learn: s.learn, overwrite: s.overwrite },
    }]);
    result.resume = null;
    const needsResume = (result.fileFields || []).some((f) => f.kind === 'resume' && !f.hasFile);
    if (needsResume && s.attachResume && (data.resumes || []).length) {
      // Resume bytes are requested only now, only for this tab, and only because a resume upload field is present.
      const withFile = await ApBridge.apCall(`/autofill-data?${qs}&resume=${encodeURIComponent(data.suggestedResumeId || 'auto')}`);
      if (withFile.resumeFile) result.resume = await run(tabId, (f) => globalThis.__apAttachResume(f), [withFile.resumeFile]);
    } else if (needsResume) {
      result.resume = { attached: 0, reason: (data.resumes || []).length ? 'Resume attaching is off in options' : 'No resume in ApplyPilot yet' };
    }
    if (result.resume && result.resume.attached) result.filled += result.resume.attached;
    result.embeddedForms = ex ? ex.embeddedForms : [];
    return result;
  },
  async saveTypedAnswers({ tabId }) {
    const items = await run(tabId, () => (globalThis.__apCollectAnswers ? globalThis.__apCollectAnswers() : []));
    if (!items || !items.length) return { added: 0, updated: 0, none: true };
    return ApBridge.apCall('/answers', { method: 'POST', body: { items } });
  },
  async settings({ patch }) {
    if (patch) await chrome.storage.local.set({ settings: { ...(await getSettings()), ...patch } });
    return getSettings();
  },
};

function fillTemplate(tpl, job, p) {
  return String(tpl || '').replace(/\{(\w+)\}/g, (m, k) => ({
    company: job.company, title: job.title, firstName: p.firstName, lastName: p.lastName,
    skills: (p.skills || []).slice(0, 5).join(', '), years: p.totalYearsExperience,
  }[k] ?? m));
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || typeof msg !== 'object') return false;
  // Answers learned when you submit a form (sent by content/autofill.js).
  if (msg.type === 'learnAnswers') {
    if (!sender.tab || sender.id !== chrome.runtime.id) return false;
    getSettings().then((s) => (s.learn ? ApBridge.apCall('/answers', { method: 'POST', body: { items: (msg.items || []).slice(0, 50) } }) : null)).catch(() => {});
    return false;
  }
  // Everything else comes from our own popup / options pages only.
  if (sender.id !== chrome.runtime.id || sender.tab && !String(sender.url || '').startsWith(chrome.runtime.getURL(''))) return false;
  const fn = flows[msg.type];
  if (!fn) return false;
  Promise.resolve().then(() => fn(msg))
    .then((data) => sendResponse({ ok: true, data }))
    .catch((e) => sendResponse({ ok: false, error: friendly(e), code: e && e.code }));
  return true;
});

// Keyboard shortcuts (also grant activeTab): Alt+Shift+S save job, Alt+Shift+F autofill.
chrome.commands.onCommand.addListener(async (command, tab) => {
  const tabId = tab && tab.id;
  if (!tabId) return;
  const say = (text, warn) => chrome.scripting.executeScript({
    target: { tabId },
    func: (t, w) => {
      const d = document.createElement('div');
      d.style.cssText = `position:fixed;z-index:2147483647;right:16px;bottom:16px;background:#0a0a0a;color:#fafafa;border:1px solid rgba(255,255,255,.16);border-left:3px solid ${w ? '#fbbf24' : '#6366f1'};border-radius:10px;padding:10px 14px;font:13px/1.45 Inconsolata,ui-monospace,Consolas,monospace;max-width:340px`;
      d.textContent = t;
      document.documentElement.appendChild(d);
      setTimeout(() => d.remove(), 6000);
    },
    args: [text, !!warn],
  }).catch(() => {});
  try {
    if (command === 'save-job') {
      const r = await flows.save({ tabId });
      say(r.duplicate ? `ApplyPilot: already in your tracker (${r.status}).` : `ApplyPilot: saved · ${r.match ? r.match.score : '?'}% match${r.eligibility && !r.eligibility.ok ? ` · ${r.eligibility.blockers[0]}` : ''}`, r.eligibility && !r.eligibility.ok);
    } else if (command === 'autofill') {
      await flows.autofill({ tabId }); // the content script shows its own summary
    }
  } catch (e) { say(`ApplyPilot: ${friendly(e)}`, true); }
});

chrome.runtime.onInstalled.addListener(async (d) => {
  if (d.reason === 'install' && !(await ApBridge.apStore.get())) chrome.runtime.openOptionsPage();
});
