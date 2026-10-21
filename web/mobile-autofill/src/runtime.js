// ApplyPilot in-page auto-fill runtime (runs INSIDE the job's application page, in the in-app WebView).
//
// This file is not a module. web/mobile-autofill/build.mjs concatenates, inside one IIFE:
//   1. electron/apply/answers.js           -> `__answers` (answerFromProfile, bestOption, norm, ...)
//   2. __apScan / __apReadListOptions       (extracted verbatim from electron/apply/dom.js)
//   3. web/client/src/native/ats.js         (export keywords stripped)
//   4. this file
// so the field scanner and answer logic are byte-for-byte the desktop engine's.
//
// API (window.__ApplyPilotAutofill):
//   run(cfg) -> Promise<summary>     cfg = { nonce, profile, answers:[{question,answer}], resume:{name,mime,base64},
//                                            coverLetter, mode:'review'|'auto', allowSubmit, job, ats?, canAsk,
//                                            cancelWindowSec, ui, resumeAfterCaptcha }
//   cancelSubmit()                   stops a running cancel-window countdown
//   detectCaptcha(), isConfirmation(ats), scan(), version
// Events are posted to the app with window.mobileApp.postMessage({ detail: { ap:'applypilot', nonce, type, message, data } })
//   types: step | filled | question | captcha | needs-user | fill-done | countdown | submit-cancelled |
//          submit-clicked | submitted | error | ui | navigating | ask
// Messages from the app arrive as window 'messageFromNative' events: { ap:'applypilot', nonce, type:'answer'|'cancel-submit'|'fill-again'|'start', ... }
//
// Safety: password fields are never touched; clicks on anything that could submit a form are refused
// unless the submit step itself runs (allowSubmit === true, mode 'auto', allow-listed ATS, every required
// question answered, no CAPTCHA, after the cancel window).

const VERSION = '__AP_AUTOFILL_VERSION__';
if (window.__ApplyPilotAutofill && window.__ApplyPilotAutofill.version === VERSION) return;

const answerFromProfile = __answers.answerFromProfile;
const bestOption = __answers.bestOption;

const S = {
  cfg: null,
  running: null,
  submitTimer: null,
  submitArmed: false,
  submitClicked: false,
  submitted: false,
  pendingAsks: new Map(),
  bar: null,
  lastSummary: null,
  captchaWatch: null,
  unansweredEls: [],
};

class GuardError extends Error {}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const isEmptyAnswer = (a) => a == null || (typeof a === 'string' && !a.trim()) || (Array.isArray(a) && !a.length);
const cleanText = (t) => String(t || '').replace(/\s+/g, ' ').trim();

// ------------------------------------------------------------------ transport
function post(type, message, data) {
  const msg = { ap: 'applypilot', v: VERSION, nonce: S.cfg ? S.cfg.nonce : null, type, message: String(message || ''), data: data == null ? null : data, url: location.href, at: Date.now() };
  try {
    if (window.mobileApp && typeof window.mobileApp.postMessage === 'function') window.mobileApp.postMessage({ detail: msg });
  } catch { /* bridge gone */ }
  try { if (typeof window.__apTestSink === 'function') window.__apTestSink(msg); } catch { /* test hook */ }
  return msg;
}

window.addEventListener('messageFromNative', (e) => {
  const d = e && e.detail;
  if (!d || d.ap !== 'applypilot') return;
  if (S.cfg && d.nonce !== S.cfg.nonce) return;
  if (d.type === 'answer' && S.pendingAsks.has(d.id)) { const r = S.pendingAsks.get(d.id); S.pendingAsks.delete(d.id); r(d.answer); }
  else if (d.type === 'cancel-submit') cancelSubmit('app');
  else if (d.type === 'fill-again' && S.cfg) run(S.cfg, { manual: true });
  else if (d.type === 'start' && d.payload) run(d.payload);
});

function ask(question, info) {
  if (!S.cfg || !S.cfg.canAsk) return Promise.resolve(null);
  const id = `q${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
  return new Promise((resolve) => {
    const t = setTimeout(() => { S.pendingAsks.delete(id); resolve(null); }, 25000);
    S.pendingAsks.set(id, (a) => { clearTimeout(t); resolve(a); });
    post('ask', question, { id, question, type: info.type, options: info.options || [], required: !!info.required });
  });
}

// ------------------------------------------------------------------ DOM helpers
const deepAll = (sel, root = document) => {
  const out = [];
  const walk = (r) => {
    try { r.querySelectorAll(sel).forEach((e) => out.push(e)); } catch { /* bad selector */ }
    for (const el of r.querySelectorAll('*')) if (el.shadowRoot) walk(el.shadowRoot);
  };
  walk(root);
  return out;
};
const deepOne = (sel) => deepAll(sel)[0] || null;
const byKey = (k) => deepOne(`[data-ap-id="${k}"]`);
function visible(el) {
  if (!el || !el.getBoundingClientRect) return false;
  const s = getComputedStyle(el);
  if (s.display === 'none' || s.visibility === 'hidden') return false;
  const r = el.getBoundingClientRect();
  return r.width > 1 && r.height > 1;
}
function textOf(el) { return cleanText(el ? (el.innerText || el.textContent || el.value || el.getAttribute('aria-label') || '') : ''); }
/** Visible elements matching `sel` whose text matches `re`. */
function byText(sel, re) { return deepAll(sel).filter((e) => visible(e) && re.test(textOf(e))); }
async function waitForAny(sels, timeout = 15000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    for (const s of sels) { const e = deepAll(s).find(visible); if (e) return s; }
    await sleep(300);
  }
  return null;
}
function formish() { return deepAll('input:not([type=hidden]),textarea,select').filter(visible).length; }
function fire(el, type, init = {}) {
  let ev;
  if (/^(mouse|click|pointer)/.test(type)) ev = new MouseEvent(type, { bubbles: true, cancelable: true, composed: true, view: window, button: 0, ...init });
  else if (/^key/.test(type)) ev = new KeyboardEvent(type, { bubbles: true, cancelable: true, composed: true, ...init });
  else if (type === 'focus' || type === 'blur') ev = new FocusEvent(type, { bubbles: false, composed: true });
  else ev = new Event(type, { bubbles: true, cancelable: true, composed: true });
  return el.dispatchEvent(ev);
}
function scrollTo(el) { try { el.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'instant' }); } catch { try { el.scrollIntoView(); } catch { /* */ } } }
const isPassword = (el) => el && el.tagName === 'INPUT' && String(el.type).toLowerCase() === 'password';

const SUBMIT_TEXT = /\b(submit|send application|send my application|complete application|finish application|confirm application|apply now|submit application)\b/i;
/** Port of dom.assertSafe: refuse a click that could submit the application. */
function assertSafe(el) {
  const t = textOf(el);
  const isBtn = el.tagName === 'BUTTON' || (el.tagName === 'INPUT' && /submit|button|image/.test(el.type));
  const submitsForm = isBtn && (el.type === 'submit' || (el.tagName === 'BUTTON' && !el.getAttribute('type'))) && !!el.form;
  if (submitsForm || SUBMIT_TEXT.test(t)) throw new GuardError(`Blocked a click on a submit control ("${t.slice(0, 40)}")`);
}
function safeClick(el) { assertSafe(el); scrollTo(el); el.click(); }

function setNativeValue(el, v) {
  const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : el.tagName === 'SELECT' ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
  const d = Object.getOwnPropertyDescriptor(proto, 'value');
  if (d && d.set) d.set.call(el, v); else el.value = v;
}
/** React/Vue/Angular-safe text entry: native value setter + input/change events. */
async function fillText(el, value) {
  if (!el || isPassword(el)) throw new GuardError('Refusing to fill a password field');
  const v = String(value);
  try { el.focus({ preventScroll: true }); } catch { /* */ }
  setNativeValue(el, v);
  el.dispatchEvent(new InputEvent('input', { bubbles: true, composed: true, inputType: 'insertText', data: v }));
  fire(el, 'change');
  try { fire(el, 'keyup', { key: v.slice(-1) || 'a' }); } catch { /* */ }
  el.blur(); fire(el, 'blur'); fire(el, 'focusout');
  await sleep(25);
  return el.value != null && el.value !== '';
}
async function selectNative(el, optionText) {
  const want = String(optionText);
  const opt = [...el.options].find((o) => cleanText(o.textContent) === want) || [...el.options].find((o) => cleanText(o.textContent).toLowerCase() === want.toLowerCase());
  if (!opt) return false;
  setNativeValue(el, opt.value);
  opt.selected = true;
  fire(el, 'input'); fire(el, 'change');
  await sleep(25);
  return el.value === opt.value;
}
async function setChecked(el, checked) {
  if (!el) return false;
  if (el.checked === checked) return true;
  el.click();
  await sleep(40);
  if (el.checked !== checked) {
    const lab = (el.id && document.querySelector(`label[for="${CSS.escape(el.id)}"]`)) || el.closest('label');
    if (lab) { lab.click(); await sleep(40); }
  }
  if (el.checked !== checked) {
    const d = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'checked');
    d.set.call(el, checked);
    fire(el, 'input'); fire(el, 'change');
  }
  return el.checked === checked;
}
const groupOpt = (key, i) => deepOne(`[data-ap-grp="${key}"][data-ap-opt="${i}"]`);
// aria-pressed buttons and role=radio options (aria-checked) report their state back; it is read, never assumed.
async function clickPressButton(key, i) {
  const b = deepOne(`[data-ap-id="${key}"][data-ap-opt="${i}"]`);
  if (!b) return false;
  const known = b.hasAttribute('aria-pressed') || b.hasAttribute('aria-checked');
  const isOn = () => b.getAttribute('aria-pressed') === 'true' || b.getAttribute('aria-checked') === 'true';
  safeClick(b);
  await sleep(120);
  if (known && !isOn()) {
    // Some pages (Workable) only react to the option's own <label>/<input>, or to the Space key on the option.
    const inner = b.querySelector('label,input');
    if (inner) { inner.click(); await sleep(120); }
    if (!isOn()) {
      for (const t of ['keydown', 'keyup']) b.dispatchEvent(new KeyboardEvent(t, { key: ' ', code: 'Space', keyCode: 32, bubbles: true }));
      await sleep(120);
    }
  }
  return known ? isOn() : true;
}

// ------------------------------------------------------------------ comboboxes (react-select / ARIA)
const NO_OPTS = /^(no options|no results|no matches|type to search|loading|searching|start typing|no location found)/i;
function readOptions(input) { try { return __apReadListOptions(input).filter((o) => o && !NO_OPTS.test(o)); } catch { return []; } }
async function openCombo(el) {
  scrollTo(el);
  try { el.focus({ preventScroll: true }); } catch { /* */ }
  const ctrl = el.closest('[class*="control"],[class*="Control"]') || el.parentElement;
  if (ctrl) { fire(ctrl, 'mousedown'); fire(ctrl, 'mouseup'); }
  await sleep(350);
  if (!readOptions(el).length) { fire(el, 'keydown', { key: 'ArrowDown', code: 'ArrowDown', keyCode: 40 }); await sleep(300); }
}
function closeCombo(el) { fire(el, 'keydown', { key: 'Escape', code: 'Escape', keyCode: 27 }); }
async function peekComboOptions(el) {
  await openCombo(el);
  const opts = readOptions(el);
  closeCombo(el);
  await sleep(100);
  return opts;
}
async function typeInto(el, text) {
  setNativeValue(el, '');
  el.dispatchEvent(new InputEvent('input', { bubbles: true, composed: true, inputType: 'deleteContentBackward' }));
  setNativeValue(el, text);
  el.dispatchEvent(new InputEvent('input', { bubbles: true, composed: true, inputType: 'insertText', data: text }));
  fire(el, 'keydown', { key: text.slice(-1) }); fire(el, 'keyup', { key: text.slice(-1) });
}
async function pickCombo(el, { typed, chooser, firstIfNoMatch = false }) {
  await openCombo(el);
  let opts = readOptions(el);
  let choice = opts.length ? chooser(opts) : null;
  if ((!choice || opts.length > 30) && typed) {
    await typeInto(el, String(typed).slice(0, 60));
    for (let i = 0; i < 12; i++) { await sleep(400); opts = readOptions(el); if (opts.length) break; }
    await sleep(250);
    opts = readOptions(el);
    choice = opts.length ? (chooser(opts) || (firstIfNoMatch ? opts[0] : null)) : null;
  }
  if (!choice) { closeCombo(el); return null; }
  const o = document.querySelector(`[data-ap-listopt="${opts.indexOf(choice)}"]`);
  if (!o) return null;
  scrollTo(o);
  fire(o, 'mouseover'); fire(o, 'mousemove'); fire(o, 'mousedown'); fire(o, 'mouseup'); o.click();
  await sleep(250);
  return choice;
}
async function typeAndPickSuggestion(el, text, suggestionSel) {
  await typeInto(el, String(text).slice(0, 80));
  const end = Date.now() + 6000;
  while (Date.now() < end) {
    const s = deepAll(suggestionSel).find(visible);
    if (s) { await sleep(200); fire(s, 'mousedown'); s.click(); await sleep(150); return true; }
    await sleep(250);
  }
  return false;
}

// ------------------------------------------------------------------ files
function fileFromCfg(f) {
  if (!f || !f.base64) return null;
  const bin = atob(String(f.base64).replace(/^data:[^,]*,/, ''));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new File([bytes], f.name || 'resume.pdf', { type: f.mime || 'application/pdf', lastModified: Date.now() });
}
async function uploadFile(el, file) {
  const dt = new DataTransfer();
  dt.items.add(file);
  try { el.files = dt.files; } catch { /* readonly in very old engines */ }
  fire(el, 'input'); fire(el, 'change');
  await sleep(50);
  if (!(el.files && el.files.length)) {
    // Drop-zone fallback: some widgets only listen for drop on their container.
    const zone = el.closest('[class*="drop"],[class*="upload"]') || el.parentElement;
    try { zone.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt })); } catch { /* */ }
  }
  return !!(el.files && el.files.length && el.files[0].name === file.name);
}

// ------------------------------------------------------------------ answer bank (desktop campaigns.similarity)
function tokens(s) { return new Set((s || '').toLowerCase().replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter((w) => w.length > 2)); }
function similarity(a, b) {
  const A = tokens(a); const B = tokens(b);
  if (!A.size || !B.size) return 0;
  let inter = 0; A.forEach((w) => { if (B.has(w)) inter++; });
  return inter / (A.size + B.size - inter);
}
function bankAnswer(question) {
  let best = null; let bs = 0;
  for (const q of (S.cfg.answers || [])) {
    if (!q || isEmptyAnswer(q.answer)) continue;
    const s = similarity(q.question, question);
    if (s > bs) { bs = s; best = q; }
  }
  return best && bs >= 0.72 ? best.answer : null;
}

// ------------------------------------------------------------------ form filling (port of adapters/generic.js)
const RESUME_RE = /resume|résumé|\bcv\b|curriculum/i;
const COVER_RE = /cover\s*letter|motivation/i;
const LOCATIONISH = /location|city|where .* (located|based|live|work from)|address|residence/i;

function fieldType(f) {
  switch (f.kind) {
    case 'textarea': return 'textarea';
    case 'select': case 'combobox': return 'select';
    case 'radio': case 'buttons': return 'radio';
    case 'checkboxGroup': case 'checkbox': return 'checkbox';
    default: return f.inputType === 'number' ? 'number' : 'text';
  }
}

async function getAnswer(f, ctx, info) {
  let ans = answerFromProfile(f.question, info, ctx.profile, ctx.job);
  let source = 'profile';
  if (isEmptyAnswer(ans) && f.question && f.question.length > 1) {
    const hasValue = Array.isArray(f.value) ? f.value.length : !!f.value;
    if (hasValue) return { ans: null, source: 'prefilled' };
    ans = bankAnswer(f.question); source = 'answers';
    if (isEmptyAnswer(ans) && S.cfg.canAsk) { ans = await ask(f.question, { ...info, required: f.required }); source = 'app'; }
  }
  if (!isEmptyAnswer(ans) && info.options && info.options.length) {
    if (info.type === 'checkbox' && !info.single) {
      const list = (Array.isArray(ans) ? ans : String(ans).split(/\s*[;,\n]\s*/)).map((x) => (info.options.includes(x) ? x : bestOption(info.options, x))).filter(Boolean);
      ans = [...new Set(list)];
    } else {
      const s = Array.isArray(ans) ? ans[0] : ans;
      ans = info.options.includes(s) ? s : bestOption(info.options, s);
    }
  }
  if (isEmptyAnswer(ans)) ans = null;
  return { ans, source };
}

async function applyAnswer(f, ans, ctx) {
  const el = byKey(f.key);
  switch (f.kind) {
    case 'text': case 'textarea': {
      const v = Array.isArray(ans) ? ans.join(', ') : String(ans);
      if (f.value && f.value === v) return true;
      return fillText(el, v);
    }
    case 'select': return selectNative(el, ans);
    case 'radio': { const i = f.options.indexOf(ans); return i >= 0 && setChecked(groupOpt(f.key, i), true); }
    case 'buttons': { const i = f.options.indexOf(ans); if (i < 0) return false; if (f.value === ans) return true; return clickPressButton(f.key, i); }
    case 'checkboxGroup': {
      const want = new Set(Array.isArray(ans) ? ans : [ans]);
      let ok = true;
      for (let i = 0; i < f.options.length; i++) if (want.has(f.options[i])) ok = (await setChecked(groupOpt(f.key, i), true)) && ok;
      return ok;
    }
    case 'checkbox': return setChecked(el, /^(yes|true|1|on|checked|agree|i agree)/i.test(String(Array.isArray(ans) ? ans[0] : ans)));
    case 'combobox': {
      const want = Array.isArray(ans) ? ans[0] : ans;
      const chosen = await pickCombo(el, {
        typed: f._typeahead ? want : (String(want).length < 60 ? want : null),
        chooser: (opts) => (opts.includes(want) ? want : bestOption(opts, want)),
        firstIfNoMatch: !!f._typeahead,
      });
      f._chosen = chosen;
      const city = ctx.profile && ctx.profile.city;
      if (!chosen && f._typeahead && city && want !== city) f._chosen = await pickCombo(byKey(f.key), { typed: city, chooser: (o) => o[0], firstIfNoMatch: true });
      return !!f._chosen;
    }
    default: return false;
  }
}

function markUnanswered(f) {
  const el = byKey(f.key) || deepOne(`[data-ap-grp="${f.key}"]`);
  if (el) S.unansweredEls.push(el);
  const box = el && (el.closest('.field, .field-wrapper, li.application-question, .ashby-application-form-field-entry, fieldset, [class*="question"]') || el.parentElement);
  if (box && box.style) { box.style.outline = '2px solid #f59e0b'; box.style.outlineOffset = '4px'; box.style.borderRadius = '6px'; }
}
function pushUnanswered(st, f, extra) {
  const u = { question: f.question || f.name || 'Question', required: !!f.required, type: fieldType(f), options: (f.options || []).slice(0, 50), ...(extra || {}) };
  st.unanswered.push(u);
  if (f.key) markUnanswered(f);
  if (f.question) post('question', u.question, u);
}

async function handleFiles(fields, ctx, st) {
  const files = fields.filter((f) => f.kind === 'file');
  if (!files.length) return 0;
  let uploaded = 0;
  const classify = (f) => {
    const t = `${f.question} ${f.name} ${f.id} ${f.context || ''}`;
    if (COVER_RE.test(t) && !RESUME_RE.test(`${f.question} ${f.name} ${f.id}`)) return 'cover';
    if (RESUME_RE.test(t)) return 'resume';
    return 'other';
  };
  const kinds = files.map(classify);
  for (let i = 0; i < files.length; i++) {
    const f = files[i];
    if (st.processed.has(f.key)) continue;
    st.processed.add(f.key);
    let kind = kinds[i];
    if (files.length === 1 && kind !== 'resume') kind = 'resume';
    const el = byKey(f.key);
    if (kind === 'resume') {
      if (!ctx.resumeFile) { pushUnanswered(st, { ...f, question: f.question || 'Resume' }); continue; }
      if (f.hasFile) continue;
      try {
        if (await uploadFile(el, ctx.resumeFile)) {
          uploaded++; st.filled++;
          post('filled', `Resume → ${ctx.resumeFile.name}`, { question: f.question || 'Resume', answer: ctx.resumeFile.name, source: 'resume' });
        } else pushUnanswered(st, { ...f, question: f.question || 'Resume' });
      } catch { pushUnanswered(st, { ...f, question: f.question || 'Resume' }); }
    } else if (kind === 'cover' && ctx.coverLetter && (!f.accept || /txt|text/i.test(f.accept))) {
      const file = new File([ctx.coverLetter], 'Cover letter.txt', { type: 'text/plain', lastModified: Date.now() });
      if (await uploadFile(el, file).catch(() => false)) { st.filled++; post('filled', 'Cover letter → Cover letter.txt', { question: f.question || 'Cover letter', source: 'cover' }); }
      else if (f.required) pushUnanswered(st, { ...f, question: f.question || 'Cover letter' });
    } else if (f.required) {
      pushUnanswered(st, { ...f, question: f.question || (kind === 'cover' ? 'Cover letter' : 'File upload') });
    }
  }
  return uploaded;
}

async function fillOne(f, ctx, cfg, st) {
  if (cfg.fieldHook) {
    const r = await cfg.fieldHook(f, ctx, st);
    if (r === 'filled') { st.filled++; return; }
    if (r === 'skip') return;
    if (r === 'unanswered') { pushUnanswered(st, f); return; }
  }
  if (!f.question && !f.name && !f.id) return;
  const type = fieldType(f);
  let options = f.options || [];
  if (f.kind === 'combobox') {
    f._typeahead = (cfg.typeaheadKeys || LOCATIONISH).test(f.question || '');
    if (!f._typeahead) {
      options = await peekComboOptions(byKey(f.key));
      if (!options.length) { await sleep(600); options = await peekComboOptions(byKey(f.key)); }
      if (!options.length) f._typeahead = true;
    }
  }
  const info = {
    type, options, required: !!f.required, inputType: f.inputType, name: f.name, id: f.id,
    placeholder: f.placeholder, autocomplete: f.autocomplete, coverLetterText: ctx.coverLetter,
    single: f.kind === 'checkbox', phoneNational: cfg.phoneNational, kind: f.kind,
  };
  let { ans, source } = await getAnswer(f, ctx, info);
  if (ans == null) {
    const hasValue = Array.isArray(f.value) ? f.value.length : !!f.value;
    if (!hasValue && (f.required || f.kind !== 'checkbox')) pushUnanswered(st, { ...f, options });
    return;
  }
  if (f.kind === 'checkbox' && !/^(yes|true)/i.test(String(ans)) && !f.value) return;
  const ok = await applyAnswer(f, ans, ctx);
  if (ok) {
    if (f._chosen) ans = f._chosen;
    st.filled++;
    st.answered.push({ question: f.question, answer: ans, source });
    post('filled', `${(f.question || f.name).slice(0, 80)} → ${String(Array.isArray(ans) ? ans.join(', ') : ans).slice(0, 80)}`, { question: f.question, answer: ans, source });
  } else pushUnanswered(st, { ...f, options });
}

async function fillForm(ctx, cfg) {
  const st = { filled: 0, unanswered: [], processed: new Set(), answered: [] };
  const scanCfg = { root: cfg.root, containerRules: cfg.containerRules || [], exclude: cfg.exclude || [] };
  let fields = __apScan(scanCfg);
  const up = await handleFiles(fields, ctx, st);
  if (up) await sleep(cfg.afterUploadWaitMs != null ? cfg.afterUploadWaitMs : 2500);
  for (let pass = 0; pass < 3; pass++) {
    fields = __apScan(scanCfg);
    await handleFiles(fields, ctx, st);
    const todo = fields.filter((f) => f.kind !== 'file' && !st.processed.has(f.key));
    if (!todo.length) break;
    for (const f of todo) {
      st.processed.add(f.key);
      try { await fillOne(f, ctx, cfg, st); } catch (e) {
        if (e instanceof GuardError) post('step', e.message);
        if (f.question) pushUnanswered(st, f);
      }
    }
    await sleep(300);
  }
  const seen = new Set();
  st.unanswered = st.unanswered.filter((u) => { const k = (u.question || '').toLowerCase(); if (seen.has(k)) return false; seen.add(k); return true; });
  return { filledCount: st.filled, unanswered: st.unanswered, answered: st.answered, fieldCount: fields.length };
}

// ------------------------------------------------------------------ detection (ports of dom.js)
const CAPTCHA_SRC = /recaptcha\/(api2|enterprise)\/(anchor|bframe)|hcaptcha\.com\/captcha|challenges\.cloudflare\.com|turnstile|arkoselabs|funcaptcha|captcha-delivery\.com|datadome|px-captcha|perimeterx/;
const BOT_WALL = /access (is )?(temporarily )?(restricted|denied|blocked)|unusual (activity|traffic) from your|verify (that )?you are (a )?human|are you a robot|checking your browser|press (&|and) hold|just a moment\.\.\./i;
function captchaKind(u) {
  return /hcaptcha/.test(u) ? 'hcaptcha' : /cloudflare|turnstile/.test(u) ? 'turnstile' : /arkose|funcaptcha/.test(u) ? 'arkose'
    : /captcha-delivery|datadome|perimeterx|px-captcha/.test(u) ? 'bot-check' : 'recaptcha';
}
/** Visible, interactive CAPTCHA (invisible reCAPTCHA badges are ignored). wall = full-page bot check. */
function detectCaptcha() {
  for (const f of deepAll('iframe')) {
    const u = f.src || f.getAttribute('src') || '';
    if (!CAPTCHA_SRC.test(u) || /[?&]size=invisible/.test(u)) continue;
    const r = f.getBoundingClientRect();
    if (visible(f) && r.width > 60 && r.height > 50) return { kind: captchaKind(u), url: u.split('?')[0], wall: formish() < 3 };
  }
  for (const w of deepAll('.g-recaptcha,.h-captcha,.cf-turnstile,#px-captcha,[data-captcha]')) {
    if (/invisible/i.test(w.getAttribute('data-size') || '')) continue;
    const r = w.getBoundingClientRect();
    if (visible(w) && r.width > 60 && r.height > 50) return { kind: captchaKind(w.className || w.id || ''), url: location.href.split('?')[0], wall: formish() < 3 };
  }
  const t = document.body ? document.body.innerText.slice(0, 3000) : '';
  if (BOT_WALL.test(t) && formish() < 3) return { kind: 'bot-check', url: location.href.split('?')[0], wall: true };
  return null;
}
function looksLikeLoginWall() {
  if (/\/(login|signin|sign-in|uas\/login|authwall|checkpoint)\b/i.test(location.pathname)) return true;
  const pw = deepAll('input[type=password]').some(visible);
  return pw && formish() < 8;
}
const CONFIRM_TEXT = /thank(s| you) for (applying|your (application|interest|submission))|application (has been |was )?(successfully )?(submitted|received|sent|complete)|we(?:'ve| have) received your application|successfully (submitted|applied)|your application is (in|complete|submitted)|you(?:'ve| have) (successfully )?applied/i;
function genericConfirmation() {
  if (/\/(confirmation|thanks|thank-you|thankyou|application-submitted|success)(\b|\/|\?|$)/i.test(location.pathname + location.search)) return true;
  const t = document.body ? document.body.innerText.slice(0, 20000) : '';
  if (!CONFIRM_TEXT.test(t)) return false;
  const hasForm = deepAll('input[type=email],input[type=file]').some(visible);
  return !hasForm || /successfully|has been (submitted|received)|we(?:'ve| have) received/i.test(t);
}
function isConfirmation(ats) {
  const p = location.pathname + location.search;
  if (ats === 'greenhouse' && /\/confirmation|\/thanks|application_confirmation/.test(p)) return true;
  if (ats === 'lever' && /\/thanks(\b|\/|\?|$)/.test(p)) return true;
  if (ats === 'smartrecruiters' && /\/(success|confirmation|thank)/i.test(p)) return true;
  if (ats === 'ashby' && deepAll('.ashby-application-form-success-container,[class*="successContainer"]').some(visible)) return true;
  if (ats === 'workable' && deepAll('[data-ui="application-success"],[data-ui="success"]').some(visible)) return true;
  return genericConfirmation();
}
function visibleErrors() {
  const sel = '[aria-invalid="true"], .error:not(:empty), .field-error, .error-message, [class*="error"][role="alert"], [role=alert]';
  return deepAll(sel).filter(visible).map((e) => cleanText(e.innerText || e.getAttribute('aria-label') || e.name || '')).filter(Boolean).slice(0, 10);
}
/** Cookie banners: only ever the most privacy-preserving choice. */
async function rejectCookies() {
  const texts = /^(reject all|reject|decline all|decline|deny|deny all|only necessary|necessary only|use necessary cookies only|refuse all|reject non-essential|continue without accepting|only essential|essential only|reject optional cookies)$/i;
  const b = deepAll('button,[role=button],a[role=button],input[type=button]').slice(0, 300).find((x) => visible(x) && texts.test(textOf(x)));
  if (b) { try { safeClick(b); await sleep(300); return true; } catch { /* guarded */ } }
  return false;
}

// ------------------------------------------------------------------ per-ATS adapters (ports of adapters/*.js)
function navigate(url, why) {
  if (!isHttpUrl(url) || url === location.href) return null;
  post('navigating', why || 'Opening the application form', { url });
  setTimeout(() => { location.href = url; }, 50);
  return { navigating: true, url };
}
const KNOWN_FRAME = /greenhouse\.io|lever\.co|ashbyhq\.com|workable\.com|smartrecruiters\.com|recruitee\.com|teamtailor\.com/i;
function embeddedAtsFrame() {
  return deepAll('iframe').find((f) => KNOWN_FRAME.test(f.src || '') && (visible(f) || /grnhse/.test(f.id))) || null;
}

const ADAPTERS = {
  greenhouse: {
    async prepare(ctx) {
      if (!/greenhouse\.io$/.test(location.hostname)) {
        const fr = deepOne('iframe#grnhse_iframe, iframe[src*="greenhouse.io"]');
        if (fr && fr.src) {
          const { token, id } = parseGreenhouse(fr.src, ctx.job);
          return navigate(token && id ? greenhouseFormUrl(token, id, ctx.job) : fr.src, 'Opening the Greenhouse-hosted application form');
        }
      }
      await waitForAny(['#application-form', '#application_form', 'form input#first_name', 'input#first_name'], 20000);
      return null;
    },
    scan: {
      containerRules: [
        { container: '.field-wrapper, .select__container, .text-input-wrapper, .input-wrapper', label: 'label' },
        { container: '#application_form .field, #application-form .field', label: 'label' },
      ],
      exclude: ['.iti__dropdown-content', '[aria-hidden="true"]'],
      phoneNational: false,
    },
    hook(ctx, state) {
      return async (f) => {
        if (f.kind === 'file') return undefined;
        if (/cover letter/i.test(f.question || '') && f.kind === 'textarea' && ctx.coverLetter) {
          await fillText(byKey(f.key), ctx.coverLetter); state.coverDone = true; return 'filled';
        }
        return undefined;
      };
    },
    async after(ctx, res, state) {
      if (!state.coverDone && ctx.coverLetter) {
        try {
          const inp = deepOne('#cover_letter');
          const group = inp && (inp.closest('.file-upload, [class*="file-upload"]') || inp.parentElement);
          let btn = group ? [...group.querySelectorAll('button')].find((b) => /enter manually/i.test(textOf(b))) : null;
          let ta = null;
          if (btn) { safeClick(btn); await sleep(400); ta = deepOne('textarea#cover_letter_text, textarea[id*="cover_letter"], textarea[name*="cover_letter"]'); }
          if (!ta) {
            const legacy = deepOne('#cover_letter_fieldset a[data-source="paste"], [data-field="cover_letter"] a[data-source="paste"]');
            if (legacy) { safeClick(legacy); await sleep(400); ta = deepOne('textarea[name="job_application[cover_letter_text]"], #cover_letter_text'); }
          }
          if (ta && visible(ta) && await fillText(ta, ctx.coverLetter)) { res.filledCount++; post('filled', 'Cover letter → (entered as text)', { question: 'Cover Letter', source: 'cover' }); state.coverDone = true; }
        } catch (e) { post('step', `Cover letter: ${e.message}`); }
      }
      if (ctx.coverLetter) res.unanswered = res.unanswered.filter((u) => !/cover letter/i.test(u.question));
    },
    submitSel: ['#application-form button[type=submit]', '#submit_app', 'input#submit_app'],
    submitText: [['form button[type=submit]', /submit/i], ['button', /submit application/i]],
  },
  lever: {
    async prepare() {
      if (/jobs\.(eu\.)?lever\.co\/[^/]+\/[0-9a-f-]{36}\/?$/i.test(location.origin + location.pathname)) return navigate(`${location.origin}${location.pathname.replace(/\/$/, '')}/apply`);
      await waitForAny(['form#application-form', 'input[name="email"]', '.application-form'], 20000);
      return null;
    },
    scan: { containerRules: [{ container: 'li.application-question', label: '.application-label' }], exclude: ['.posting-header', '.main-footer'], afterUploadWaitMs: 4000 },
    hook(ctx) {
      return async (f) => {
        if (f.name === 'location' || /location-input/.test(f.id || '')) {
          const p = ctx.profile || {};
          const loc = [p.city, p.state, p.country].filter(Boolean).join(', ') || p.city;
          if (!loc) return 'unanswered';
          const el = byKey(f.key);
          const ok = await typeAndPickSuggestion(el, p.city ? `${p.city}${p.country ? `, ${p.country}` : ''}` : loc,
            '.dropdown-location, .location-dropdown .dropdown-item, [class*="dropdown-results"] [class*="location"], .dropdown-results > div');
          if (!ok) await fillText(el, loc);
          post('filled', `Current location → ${loc}`, { question: 'Current location', answer: loc, source: 'profile' });
          return 'filled';
        }
        return undefined;
      };
    },
    submitSel: ['#btn-submit', 'button[data-qa="btn-submit"]', 'button.template-btn-submit'],
  },
  ashby: {
    async prepare() {
      if (!/\/application/.test(location.pathname)) {
        const tab = deepAll('a[href$="/application"]').find(visible) || byText('[role=tab]', /^application$/i)[0];
        if (tab) { try { safeClick(tab); } catch { /* */ } }
      }
      await waitForAny(['.ashby-application-form-container', 'input#_systemfield_name', 'input#_systemfield_email'], 25000);
      return null;
    },
    scan: { containerRules: [{ container: '.ashby-application-form-field-entry', label: '.ashby-application-form-question-title' }], exclude: ['.ashby-application-form-autofill-pane', '.ashby-job-posting-header'], afterUploadWaitMs: 3000 },
    submitSel: ['button.ashby-application-form-submit-button'],
    submitText: [['button', /^submit application$/i]],
  },
  workable: {
    async prepare() {
      const sels = ['form[data-ui="application-form"]', 'input[name="firstname"]', 'input[name="email"]'];
      if (!(await waitForAny(sels, 10000))) {
        const btn = deepOne('a[data-ui="overview-apply-now"]') || byText('a,button', /^apply for this job$/i)[0];
        if (btn) { post('step', 'Opening the application form'); try { safeClick(btn); } catch { /* */ } await waitForAny(sels, 15000); }
      }
      await rejectCookies();
      return null;
    },
    scan: { root: 'form[data-ui="application-form"], main form, form', afterUploadWaitMs: 3000 },
    submitSel: ['button[data-ui="apply-button"]'],
    submitText: [['form button[type=submit]', /submit/i]],
  },
  smartrecruiters: {
    async prepare() {
      if (!/oneclick-ui/.test(location.href)) {
        const a = deepOne('a[href*="oneclick-ui"], a#st-apply') || byText('a', /i'm interested|^apply/i)[0];
        const href = a && a.getAttribute('href');
        if (href && /^https?:|^\//.test(href)) return navigate(new URL(href, location.href).toString(), 'Opening the SmartRecruiters application form');
      }
      await waitForAny(['input#first-name-input', 'input[name="firstName"]', 'oc-oneclick-form', 'input[type=email]'], 25000);
      await rejectCookies();
      return null;
    },
    scan: { exclude: ['header', 'footer', 'oc-footer'], afterUploadWaitMs: 4000 },
    submitSel: ['button[data-test="footer-submit"]'],
    submitText: [['oc-footer button, button', /^submit/i]],
  },
  recruitee: {
    async prepare() {
      const sels = ['form input[name="candidate[email]"]', 'form input[type=email]'];
      if (!(await waitForAny(sels, 10000))) {
        const a = deepOne('a[href$="/c/new"]') || byText('a,button', /^apply for this job$/i)[0];
        if (a && a.tagName === 'A' && a.href) return navigate(a.href);
        if (a) { try { safeClick(a); } catch { /* */ } await waitForAny(sels, 15000); }
      }
      return null;
    },
    scan: { root: 'form[data-testid="application-form"], form.application-form, main form, form', afterUploadWaitMs: 2000 },
    submitLast: 'form button[type=submit]',
  },
  teamtailor: {
    async prepare() {
      const sels = ['form input[name="candidate[email]"]', 'form input[type=email]'];
      if (!(await waitForAny(sels, 8000))) {
        const a = deepOne('a[href*="/applications/new"]') || byText('a[href]', /^(apply for this job|apply now|apply)$/i)[0];
        if (a && a.href) return navigate(a.href);
      }
      return null;
    },
    scan: { root: 'form#new_candidate, form[action*="applications"], main form, form', exclude: ['header', 'footer', 'nav'], afterUploadWaitMs: 2000 },
  },
  generic: {
    async prepare() {
      if (formish() < 3) {
        const fr = embeddedAtsFrame();
        if (fr && fr.src && !/^about:/.test(fr.src)) {
          let target = fr.src;
          if (/greenhouse\.io/.test(target)) { const { token, id } = parseGreenhouse(target, null); if (token && id) target = greenhouseFormUrl(token, id, null); }
          return navigate(target, 'Opening the embedded application form');
        }
      }
      return null;
    },
    scan: { exclude: ['header', 'nav', 'footer', '[role=search]', 'form[role=search]'] },
  },
};

function findSubmit(ad) {
  if (!ad) return null;
  for (const s of ad.submitSel || []) { const b = deepAll(s).find(visible); if (b) return b; }
  for (const [sel, re] of ad.submitText || []) { const b = byText(sel, re)[0]; if (b) return b; }
  if (ad.submitLast) { const all = deepAll(ad.submitLast).filter(visible); if (all.length) return all[all.length - 1]; }
  return null;
}

// ------------------------------------------------------------------ cancel window + submit
function cancelSubmit(by = 'user') {
  if (!S.submitArmed) return false;
  S.submitArmed = false;
  clearInterval(S.submitTimer); S.submitTimer = null;
  post('submit-cancelled', by === 'user' ? 'You cancelled the automatic submit. Review and submit it yourself.' : 'Automatic submit cancelled.', { by });
  bar({ text: 'Auto-submit cancelled. Review and submit yourself.', mode: 'idle' });
  return true;
}
function armSubmit(ats, seconds) {
  S.submitArmed = true;
  let left = Math.max(1, Math.round(seconds));
  post('countdown', `Submitting in ${left}s`, { remaining: left });
  bar({ text: `Submitting in ${left}s`, mode: 'countdown' });
  S.submitTimer = setInterval(async () => {
    if (!S.submitArmed) return;
    left--;
    if (left > 0) { post('countdown', `Submitting in ${left}s`, { remaining: left }); bar({ text: `Submitting in ${left}s`, mode: 'countdown' }); return; }
    clearInterval(S.submitTimer); S.submitTimer = null; S.submitArmed = false;
    await doSubmit(ats);
  }, 1000);
}
async function doSubmit(ats) {
  const cfg = S.cfg;
  // Re-check every guard at the moment of the click.
  if (!cfg || cfg.allowSubmit !== true || cfg.mode !== 'auto' || !canAutoSubmit(ats) || S.submitClicked) return false;
  const cap = detectCaptcha();
  if (cap) { post('captcha', `A ${cap.kind} check appeared. Complete it and submit yourself.`, cap); bar({ text: 'Complete the check, then submit', mode: 'idle' }); return false; }
  const btn = findSubmit(ADAPTERS[ats]);
  if (!btn) { post('needs-user', 'Could not find the submit button. Please submit it yourself.'); return false; }
  S.submitClicked = true;
  post('submit-clicked', 'Submitting application');
  bar({ text: 'Submitting…', mode: 'busy' });
  scrollTo(btn);
  btn.click();
  const end = Date.now() + 45000;
  while (Date.now() < end) {
    await sleep(1000);
    if (isConfirmation(ats)) { S.submitted = true; post('submitted', 'Application submitted', { url: location.href }); bar({ text: 'Application submitted', mode: 'done' }); return true; }
    const c = detectCaptcha();
    if (c) { post('captcha', 'A CAPTCHA appeared after submitting. Complete it in the page.', c); bar({ text: 'Complete the check to finish', mode: 'idle' }); return false; }
  }
  const errs = visibleErrors();
  post('needs-user', errs.length ? `The form reported problems: ${errs.slice(0, 3).join(' | ')}` : 'No confirmation seen. Check the form and submit it.', { errors: errs });
  bar({ text: 'Check the form', mode: 'idle' });
  return false;
}

// ------------------------------------------------------------------ top bar (closed shadow root)
function bar(state) {
  if (!S.cfg || S.cfg.ui === false || !document.body) return;
  if (!S.bar) {
    const host = document.createElement('div');
    host.id = '__applypilot_bar';
    host.style.cssText = 'position:fixed;left:0;right:0;top:0;z-index:2147483647;pointer-events:none;';
    const root = host.attachShadow({ mode: 'closed' });
    root.innerHTML = `<style>
      .b{pointer-events:auto;margin:6px 8px;display:flex;align-items:center;gap:8px;padding:8px 10px;border-radius:12px;
        background:rgba(17,17,20,.94);color:#f4f4f5;font:500 13px/1.25 -apple-system,system-ui,Segoe UI,Roboto,sans-serif;
        box-shadow:0 6px 24px rgba(0,0,0,.35);border:1px solid rgba(129,140,248,.35)}
      .d{width:8px;height:8px;border-radius:50%;background:#818cf8;flex:none}
      .t{flex:1;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
      button{all:unset;cursor:pointer;padding:6px 10px;border-radius:8px;background:#27272a;color:#e4e4e7;font-weight:600;font-size:12px}
      button.p{background:#818cf8;color:#0a0a0a} button.w{background:#f59e0b;color:#0a0a0a}
      .min .t,.min button:not(.m){display:none} [hidden]{display:none!important}
      .countdown .d{background:#f59e0b} .done .d{background:#10b981} .busy .d{animation:p 1s infinite}
      @keyframes p{50%{opacity:.3}}</style>
      <div class="b" part="bar"><span class="d"></span><span class="t">ApplyPilot</span>
      <button class="w" data-a="cancel" hidden>Cancel</button><button data-a="next" hidden>Next</button>
      <button data-a="again">Fill again</button><button data-a="close">Close</button><button class="m" data-a="min">–</button></div>`;
    const el = root.querySelector('.b');
    root.addEventListener('click', (e) => {
      const a = e.target && e.target.getAttribute && e.target.getAttribute('data-a');
      if (!a) return;
      e.preventDefault(); e.stopPropagation();
      if (a === 'cancel') cancelSubmit('user');
      else if (a === 'again') { post('ui', 'fill-again'); run(S.cfg, { manual: true }); }
      else if (a === 'next') { const n = S.unansweredEls.shift(); if (n) { scrollTo(n); try { n.focus({ preventScroll: true }); } catch { /* */ } S.unansweredEls.push(n); } }
      else if (a === 'min') el.classList.toggle('min');
      else if (a === 'close') { cancelSubmit('user'); post('ui', 'close'); try { window.mobileApp && window.mobileApp.close && window.mobileApp.close(); } catch { /* */ } }
    }, true);
    document.documentElement.appendChild(host);
    S.bar = { host, el, t: root.querySelector('.t'), btn: (n) => root.querySelector(`[data-a="${n}"]`) };
  }
  const b = S.bar;
  b.el.className = `b ${state.mode || 'idle'}${b.el.classList.contains('min') ? ' min' : ''}`;
  b.t.textContent = state.text || 'ApplyPilot';
  b.btn('cancel').hidden = state.mode !== 'countdown';
  b.btn('again').hidden = state.mode === 'countdown' || state.mode === 'busy' || state.mode === 'done';
  b.btn('next').hidden = !(S.unansweredEls.length && state.mode !== 'countdown' && state.mode !== 'done');
}

// ------------------------------------------------------------------ main
function normalizeCfg(cfg) {
  const c = { ...(cfg || {}) };
  c.mode = c.mode === 'auto' ? 'auto' : 'review';
  c.allowSubmit = c.allowSubmit === true && c.mode === 'auto';
  c.profile = c.profile || {};
  c.answers = Array.isArray(c.answers) ? c.answers : [];
  c.job = c.job || {};
  c.cancelWindowSec = Number.isFinite(Number(c.cancelWindowSec)) ? Number(c.cancelWindowSec) : 10;
  return c;
}

function run(cfg, opts = {}) {
  if (S.running) return S.running;
  S.running = (async () => {
    try { return await runInner(cfg, opts); } catch (e) {
      post('error', e && e.message ? e.message : String(e));
      return { status: 'error', message: String(e && e.message || e), filledCount: 0, unanswered: [] };
    } finally { S.running = null; }
  })();
  return S.running;
}

async function runInner(cfgIn, opts) {
  const cfg = normalizeCfg(cfgIn);
  // Defence in depth: the app checks the page URL before sending data; refuse here too if the page
  // navigated to a site that is not part of this application.
  if (Array.isArray(cfg.allowedSites) && cfg.allowedSites.length && !cfg.allowedSites.includes(siteOf(location.hostname))) {
    return { status: 'blocked-site', url: location.href, filledCount: 0, unanswered: [] };
  }
  S.cfg = cfg;
  S.unansweredEls = [];
  const detected = cfg.ats || detectAts(cfg.job, location.href);
  const ats = ADAPTERS[detected] ? detected : 'generic';
  const adapter = ADAPTERS[ats] || ADAPTERS.generic;
  const base = { ats: detected, url: location.href, filledCount: 0, unanswered: [], answered: [], captcha: null, loginWall: false };
  const finish = (s) => { S.lastSummary = { ...base, ...s }; post('fill-done', s.message || s.status, S.lastSummary); return S.lastSummary; };

  if (isConfirmation(ats) && (S.submitClicked || cfg.afterSubmit || !formish())) {
    S.submitted = true;
    post('submitted', 'Application submitted', { url: location.href });
    bar({ text: 'Application submitted', mode: 'done' });
    return finish({ status: 'submitted' });
  }
  bar({ text: opts.manual ? 'Filling again…' : 'Filling the form…', mode: 'busy' });
  post('step', opts.manual ? 'Filling the form again' : `Filling ${ats === 'generic' ? 'the application form' : `the ${ats} form`}`, { ats });

  if (looksLikeLoginWall()) {
    post('needs-user', 'This site wants you to sign in. Sign in yourself (ApplyPilot never enters passwords), then tap Fill again.');
    bar({ text: 'Sign in, then tap Fill again', mode: 'idle' });
    return finish({ status: 'needs-user', loginWall: true, message: 'Sign-in required' });
  }
  const wall = detectCaptcha();
  if (wall && wall.wall) {
    post('captcha', `A ${wall.kind} check is shown. Complete it yourself; filling continues after.`, wall);
    bar({ text: 'Complete the check to continue', mode: 'idle' });
    if (cfg.resumeAfterCaptcha !== false && !S.captchaWatch) {
      const end = Date.now() + 5 * 60 * 1000;
      S.captchaWatch = setInterval(() => {
        const c = detectCaptcha();
        if (!c || !c.wall || Date.now() > end) { clearInterval(S.captchaWatch); S.captchaWatch = null; if (!c || !c.wall) { post('step', 'Check cleared, continuing'); run(S.cfg); } }
      }, 2000);
    }
    return finish({ status: 'captcha', captcha: wall, message: 'CAPTCHA shown' });
  }

  await rejectCookies();
  const nav = adapter.prepare ? await adapter.prepare(cfg) : null;
  if (nav && nav.navigating) return finish({ status: 'navigating', url: nav.url, message: 'Opening the form' });

  const ctx = { profile: cfg.profile, job: cfg.job, coverLetter: cfg.coverLetter || null, resumeFile: fileFromCfg(cfg.resume) };
  const state = {};
  const scanCfg = { ...(adapter.scan || {}) };
  if (adapter.hook) scanCfg.fieldHook = adapter.hook(ctx, state);
  const res = await fillForm(ctx, scanCfg);
  if (adapter.after) await adapter.after(ctx, res, state);
  const captcha = detectCaptcha();
  const requiredMissing = res.unanswered.filter((u) => u.required);
  const summary = { status: res.fieldCount ? 'filled' : 'no-form', filledCount: res.filledCount, unanswered: res.unanswered, answered: res.answered, captcha };
  if (captcha) post('captcha', `A ${captcha.kind} check is on the form. Complete it yourself before submitting.`, captcha);

  const autoOk = cfg.allowSubmit && cfg.mode === 'auto' && canAutoSubmit(ats) && !requiredMissing.length && !captcha && res.filledCount > 0 && !S.submitClicked;
  const label = `Filled ${res.filledCount}${res.unanswered.length ? ` · ${res.unanswered.length} need you` : ''}`;
  if (autoOk) {
    summary.status = 'submit-pending';
    finish({ ...summary, message: label });
    armSubmit(ats, cfg.cancelWindowSec);
    return S.lastSummary;
  }
  if (!res.fieldCount) {
    post('needs-user', 'No application form found on this page. Find the Apply button, then tap Fill again.');
    bar({ text: 'No form here yet. Tap Fill again on the form', mode: 'idle' });
  } else if (cfg.mode === 'auto' && canAutoSubmit(ats) && requiredMissing.length) {
    post('needs-user', `${requiredMissing.length} required question(s) need your answer. Complete them and submit.`, { unanswered: requiredMissing });
    bar({ text: `${label}. Answer, then submit`, mode: 'idle' });
  } else if (cfg.mode === 'auto' && !canAutoSubmit(ats)) {
    post('needs-user', 'This site is fill-only: review the form and submit it yourself.', { unanswered: res.unanswered });
    bar({ text: `${label}. Review and submit`, mode: 'idle' });
  } else {
    post('needs-user', 'Form filled. Review it and tap the site\'s submit button.', { unanswered: res.unanswered });
    bar({ text: `${label}. Review and submit`, mode: 'idle' });
  }
  return finish({ ...summary, message: label });
}

Object.defineProperty(window, '__ApplyPilotAutofill', {
  configurable: true,
  enumerable: false,
  value: Object.freeze({
    version: VERSION,
    run,
    /** Posts 'ready' (with the page URL) so the app can decide whether this page may receive data. */
    ping: () => post('ready', 'Auto-fill engine loaded', { version: VERSION, url: location.href, host: location.hostname }),
    cancelSubmit: () => cancelSubmit('app'),
    detectCaptcha,
    isConfirmation: (ats) => isConfirmation(ats || (S.cfg && S.cfg.ats) || 'generic'),
    scan: (cfg) => __apScan(cfg || {}),
    state: () => ({ submitArmed: S.submitArmed, submitClicked: S.submitClicked, submitted: S.submitted, last: S.lastSummary }),
  }),
});
