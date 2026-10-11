// ApplyPilot autofill (content script, injected on demand with activeTab, after content/shared.js).
//
// Two entry points, used in this order by the popup:
//   * __apPlan(data)     read only: what a fill would do (fill / differs / needs you). Changes nothing on the page.
//   * __apAutofill(data) fills the page. Only fields the user confirmed in the check panel are replaced
//                        (data.overwriteKeys) and typed values for required fields come in as data.manual.
//
// Uses the desktop app's own field scanner (__apScan) and answerer (__apAnswers.answerFromProfile +
// bestOption), then the Answer bank, to fill the visible application form.
//
// Hard rules (also see docs/EXTENSION.md):
//   * never submits — a capturing submit blocker is active while filling and no submit control is ever clicked
//   * never touches password / OTP / payment / CAPTCHA fields
//   * never overwrites a value that is already there unless the user ticked it in the check panel
//   * never solves CAPTCHAs — it only tells you one is present
//   * never sends anything anywhere: the only network traffic is the popup/background talking to 127.0.0.1
/* eslint-disable no-undef */
(function () {
  'use strict';
  if (globalThis.__apAutofill && globalThis.__apPlan) return;

  const A = () => globalThis.__apAnswers;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const SUBMIT_TEXT = /\b(submit|send application|send my application|complete application|finish application|confirm application|apply now|submit application)\b/i;
  const SENSITIVE = /pass(word|wd|code)?\b|\bpwd\b|\botp\b|one[- ]?time (code|pass)|verification code|security code|captcha|\bcvv\b|\bcvc\b|card ?number|credit ?card|debit ?card|\bcc-|expir(y|ation) date|\biban\b|routing number|bank account|account number|\bssn\b|social security|aadhaar|\bpan\b(?! ?india)/i;
  const RESUME_RE = /resume|résumé|\bcv\b|curriculum/i;
  const COVER_RE = /cover\s*letter|motivation/i;
  const LOCATIONISH = /location|city|where .* (located|based|live|work from)|address|residence/i;
  const NO_OPTS = /^(no options|no results|no matches|type to search|loading|searching|start typing|no location found)/i;
  const EXCLUDE = ['header', 'nav', 'footer', '[role=search]', 'form[role=search]', '#__applypilot_toast'];

  const state = { fields: [], unanswered: new Map(), learnHooked: false, learnEnabled: true, sent: new Set() };

  // ------------------------------------------------------------------ helpers
  const byKey = (key) => document.querySelector(`[data-ap-id="${CSS.escape(key)}"]`) || deepFind(`[data-ap-id="${CSS.escape(key)}"]`);
  function deepFind(sel) {
    const walk = (root) => {
      const hit = root.querySelector(sel);
      if (hit) return hit;
      for (const el of root.querySelectorAll('*')) if (el.shadowRoot) { const h = walk(el.shadowRoot); if (h) return h; }
      return null;
    };
    return walk(document);
  }
  const deepAll = (sel) => {
    const out = [];
    const walk = (root) => { root.querySelectorAll(sel).forEach((e) => out.push(e)); root.querySelectorAll('*').forEach((el) => el.shadowRoot && walk(el.shadowRoot)); };
    walk(document);
    return out;
  };
  const isEmpty = (a) => a == null || (typeof a === 'string' && !a.trim()) || (Array.isArray(a) && !a.length);
  const hasValue = (f) => (Array.isArray(f.value) ? f.value.length > 0 : !!(f.value && String(f.value).trim()));
  const present = (v) => v != null && String(v).trim() !== '';
  const showVal = (v) => (Array.isArray(v) ? v.join(', ') : String(v == null ? '' : v)).replace(/\s+/g, ' ').trim();
  const sameVal = (a, b) => showVal(a).toLowerCase() === showVal(b).toLowerCase();

  // ------------------------------------------------------------------ identity fields
  // Decided here, before the desktop answerer: "Address" / "Location" get "City, Country", and a phone field gets
  // the national number, but only when the same form has a separate country-code field to hold the code.
  // Otherwise the full number is used, so a single phone box still gets a usable value.
  const PHONE_Q = /phone|mobile|telephone|\btel\b/i;
  const PHONE_NOT_NATIONAL = /country code|dial|international|with (the )?code|whatsapp|fax|extension|\bext\b/i;
  const ADDRESS_Q = /^\s*(your |current |home |full |mailing |residential |present )?(address|location|current location|city and country|city, country|where are you (currently )?(located|based))\s*[?:*]?\s*$/i;
  const CODE_FIELD_Q = /country code|dial(ing)? code|phone code|calling code/i;
  const codeFieldPresent = (fields) => fields.some((f) => f.kind !== 'file' && CODE_FIELD_Q.test(f.question || ''));
  function nationalPhone(p) {
    const ph = String(p.phone || '').trim();
    if (!ph) return null;
    if (!ph.startsWith('+')) return ph;
    const cc = String(p.phoneCountryCode || '').replace(/\D/g, '');
    const digits = ph.replace(/\D/g, '');
    return cc && digits.startsWith(cc) ? digits.slice(cc.length) : ph;
  }
  function identityOverride(f, p, hasCodeField) {
    const q = String(f.question || '').trim();
    if ((f.kind === 'text' || f.kind === 'combobox') && ADDRESS_Q.test(q)) {
      return [p.city, p.country].filter(present).join(', ') || null;
    }
    const hint = q || `${f.name || ''} ${f.id || ''} ${f.autocomplete || ''}`;
    if (f.kind === 'text' && PHONE_Q.test(hint) && !PHONE_NOT_NATIONAL.test(hint)) {
      if (hasCodeField) return nationalPhone(p);
      return present(p.phone) ? String(p.phone).trim() : null;
    }
    return null;
  }
  // "File" fields: the resume upload is the one whose label, name or surrounding text says resume/CV.
  function fileFieldsOf(fields) {
    const files = fields.filter((f) => f.kind === 'file');
    return files.map((f) => ({ key: f.key, kind: classifyFile(f, files.length), question: f.question, required: !!f.required, hasFile: !!f.hasFile }));
  }

  function fieldType(f) {
    switch (f.kind) {
      case 'textarea': return 'textarea';
      case 'select': case 'combobox': return 'select';
      case 'radio': case 'buttons': return 'radio';
      case 'checkboxGroup': case 'checkbox': return 'checkbox';
      default: return f.inputType === 'number' ? 'number' : 'text';
    }
  }

  // Same token-Jaccard similarity the desktop uses for the Answer bank (campaigns.js).
  const toks = (s) => new Set(String(s || '').toLowerCase().replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter((w) => w.length > 2));
  function similarity(a, b) {
    const X = toks(a); const Y = toks(b);
    if (!X.size || !Y.size) return 0;
    let inter = 0; X.forEach((w) => Y.has(w) && inter++);
    return inter / (X.size + Y.size - inter);
  }
  function fromBank(question, bank) {
    let best = null; let bs = 0;
    for (const q of bank || []) {
      if (!q.answer) continue;
      const s = similarity(q.question, question);
      if (s > bs) { bs = s; best = q; }
    }
    return best && bs >= 0.72 ? best.answer : null;
  }

  function nativeSet(el, value) {
    const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : el.tagName === 'SELECT' ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
    const desc = Object.getOwnPropertyDescriptor(proto, 'value');
    if (desc && desc.set) desc.set.call(el, value); else el.value = value;
  }
  function fire(el, ...types) { for (const t of types) el.dispatchEvent(new Event(t, { bubbles: true, composed: true })); }
  function mouse(el) {
    const o = { bubbles: true, cancelable: true, composed: true, view: window };
    try { el.dispatchEvent(new PointerEvent('pointerdown', o)); } catch { /* old engines */ }
    el.dispatchEvent(new MouseEvent('mousedown', o));
    try { el.dispatchEvent(new PointerEvent('pointerup', o)); } catch { /* */ }
    el.dispatchEvent(new MouseEvent('mouseup', o));
    el.click();
  }
  function isSubmitControl(el) {
    if (!el) return false;
    const t = (el.innerText || el.value || el.getAttribute('aria-label') || '').trim();
    const isBtn = el.tagName === 'BUTTON' || (el.tagName === 'INPUT' && /submit|image/.test(el.type));
    if (isBtn && (el.type === 'submit' || el.type === 'image') && !el.hasAttribute('aria-pressed')) return true;
    return SUBMIT_TEXT.test(t);
  }

  // Blocks every form submission (and clicks on submit controls) while ApplyPilot is filling.
  function withSubmitGuard(fn) {
    const onSubmit = (e) => { e.preventDefault(); e.stopImmediatePropagation(); };
    const onClick = (e) => { const t = e.target && e.target.closest && e.target.closest('button,input[type=submit],input[type=image],[role=button]'); if (t && isSubmitControl(t) && !t.hasAttribute('aria-pressed')) { e.preventDefault(); e.stopImmediatePropagation(); } };
    const onKey = (e) => { if (e.key === 'Enter' && e.isTrusted === false) { e.preventDefault(); e.stopImmediatePropagation(); } };
    window.addEventListener('submit', onSubmit, true);
    window.addEventListener('click', onClick, true);
    window.addEventListener('keydown', onKey, true);
    const release = () => { window.removeEventListener('submit', onSubmit, true); window.removeEventListener('click', onClick, true); window.removeEventListener('keydown', onKey, true); };
    return Promise.resolve().then(fn).finally(() => setTimeout(release, 400)); // late async submits from our events are blocked too
  }

  function mark(el, kind) {
    if (!el || !state.highlight) return;
    const target = el.type === 'radio' || el.type === 'checkbox' || el.type === 'file' ? (el.closest('fieldset,[role=radiogroup],[role=group],label') || el) : el;
    target.style.setProperty('outline', kind === 'filled' ? '2px solid #6366f1' : '2px dashed #fbbf24', 'important');
    target.style.setProperty('outline-offset', '2px', 'important');
    target.setAttribute('data-ap-mark', kind);
  }

  // ------------------------------------------------------------------ combobox
  async function openCombo(el) {
    el.scrollIntoView({ block: 'center' });
    el.focus();
    mouse(el);
    await sleep(250);
    let opts = globalThis.__apReadListOptions(el).filter((o) => o && !NO_OPTS.test(o));
    if (!opts.length) {
      el.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', code: 'ArrowDown', keyCode: 40, bubbles: true }));
      await sleep(250);
      opts = globalThis.__apReadListOptions(el).filter((o) => o && !NO_OPTS.test(o));
    }
    return opts;
  }
  function closeCombo(el) {
    el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', keyCode: 27, bubbles: true }));
  }
  async function pickCombo(el, want, typeahead) {
    const { bestOption } = A();
    let opts = await openCombo(el);
    let choice = opts.length ? (opts.includes(want) ? want : bestOption(opts, want)) : null;
    if ((!choice || opts.length > 30) && want && String(want).length < 80) {
      nativeSet(el, String(want).slice(0, 60));
      fire(el, 'input');
      for (let i = 0; i < 12; i++) {
        await sleep(300);
        opts = globalThis.__apReadListOptions(el).filter((o) => o && !NO_OPTS.test(o));
        if (opts.length) break;
      }
      choice = opts.length ? (opts.includes(want) ? want : bestOption(opts, want) || (typeahead ? opts[0] : null)) : null;
    }
    if (!choice) { closeCombo(el); return null; }
    const idx = opts.indexOf(choice);
    const optEl = document.querySelector(`[data-ap-listopt="${idx}"]`);
    if (!optEl) { closeCombo(el); return null; }
    optEl.scrollIntoView({ block: 'nearest' });
    mouse(optEl);
    await sleep(200);
    return choice;
  }

  // ------------------------------------------------------------------ apply one answer
  async function applyAnswer(f, ans) {
    switch (f.kind) {
      case 'text': case 'textarea': {
        const el = byKey(f.key); if (!el) return false;
        const v = Array.isArray(ans) ? ans.join(', ') : String(ans);
        el.focus();
        nativeSet(el, v);
        fire(el, 'input', 'change');
        el.blur(); fire(el, 'blur');
        mark(el, 'filled');
        return !!el.value;
      }
      case 'select': {
        const el = byKey(f.key); if (!el) return false;
        const clean = (t) => String(t || '').replace(/\s+/g, ' ').trim();
        const opt = [...el.options].find((o) => clean(o.textContent) === ans) || [...el.options].find((o) => clean(o.textContent).toLowerCase() === String(ans).toLowerCase());
        if (!opt) return false;
        nativeSet(el, opt.value);
        opt.selected = true;
        fire(el, 'input', 'change');
        mark(el, 'filled');
        return true;
      }
      case 'radio': case 'checkboxGroup': {
        const want = new Set(Array.isArray(ans) ? ans : [ans]);
        let ok = false;
        f.options.forEach((o, i) => {
          if (!want.has(o)) return;
          const el = deepAll(`[data-ap-grp="${CSS.escape(f.key)}"][data-ap-opt="${i}"]`)[0];
          if (!el) return;
          if (!el.checked) { el.click(); if (!el.checked) { const lab = (el.id && document.querySelector(`label[for="${CSS.escape(el.id)}"]`)) || el.closest('label'); if (lab) lab.click(); } }
          if (el.checked) { ok = true; mark(el, 'filled'); }
        });
        return ok;
      }
      case 'buttons': {
        const i = f.options.indexOf(ans);
        if (i < 0) return false;
        if (f.value === ans) return true;
        const el = deepAll(`[data-ap-id="${CSS.escape(f.key)}"][data-ap-opt="${i}"]`)[0];
        if (!el || SUBMIT_TEXT.test(el.innerText || '')) return false;
        el.click();
        await sleep(50);
        mark(el, 'filled');
        return el.getAttribute('aria-pressed') !== 'false';
      }
      case 'checkbox': {
        const el = byKey(f.key); if (!el) return false;
        const yes = /^(yes|true|1|on|checked|agree|i agree)/i.test(String(Array.isArray(ans) ? ans[0] : ans));
        if (el.checked !== yes) { el.click(); if (el.checked !== yes) { const lab = (el.id && document.querySelector(`label[for="${CSS.escape(el.id)}"]`)) || el.closest('label'); if (lab) lab.click(); } }
        if (el.checked === yes) mark(el, 'filled');
        return el.checked === yes;
      }
      case 'combobox': {
        const el = byKey(f.key); if (!el) return false;
        const chosen = await pickCombo(el, Array.isArray(ans) ? ans[0] : ans, f._typeahead);
        if (chosen) { f._chosen = chosen; mark(el, 'filled'); }
        return !!chosen;
      }
      default: return false;
    }
  }

  function sensitive(f) {
    const hay = `${f.name || ''} ${f.id || ''} ${f.autocomplete || ''} ${f.inputType || ''} ${f.question || ''}`;
    return /password/i.test(f.inputType || '') || /(current|new)-password|one-time-code|cc-/i.test(f.autocomplete || '') || SENSITIVE.test(hay);
  }

  function visibleCaptcha() {
    for (const fr of document.querySelectorAll('iframe[src]')) {
      const u = fr.getAttribute('src') || '';
      if (!/recaptcha\/(api2|enterprise)\/(anchor|bframe)|hcaptcha\.com|challenges\.cloudflare\.com|turnstile|arkoselabs|funcaptcha/.test(u) || /[?&]size=invisible/.test(u)) continue;
      const r = fr.getBoundingClientRect();
      if (r.width > 60 && r.height > 50) return /hcaptcha/.test(u) ? 'hCaptcha' : /cloudflare|turnstile/.test(u) ? 'Cloudflare Turnstile' : /arkose|funcaptcha/.test(u) ? 'Arkose' : 'reCAPTCHA';
    }
    return null;
  }

  function classifyFile(f, total) {
    const t = `${f.question} ${f.name} ${f.id} ${f.context || ''}`;
    if (COVER_RE.test(t) && !RESUME_RE.test(`${f.question} ${f.name} ${f.id}`)) return 'cover';
    if (RESUME_RE.test(t) || total === 1) return 'resume';
    return 'other';
  }

  // ------------------------------------------------------------------ main fill
  async function autofill(data) {
    if (!A() || !globalThis.__apScan) throw new Error('ApplyPilot helpers are not loaded');
    const o = { highlight: true, learn: true, ...(data.options || {}) };
    state.highlight = o.highlight;
    state.learnEnabled = o.learn;
    const profile = data.profile || {};
    const job = data.job || {};
    const bank = data.answers || [];
    // Only the fields the user ticked in the check panel may replace a value that is already on the page.
    const overwriteKeys = new Set(Array.isArray(data.overwriteKeys) ? data.overwriteKeys : []);
    const manual = data.manual && typeof data.manual === 'object' ? data.manual : {};
    const out = { filled: 0, answered: [], unanswered: [], prefilled: 0, skippedSensitive: 0, fileFields: [], captcha: visibleCaptcha(), total: 0 };

    await withSubmitGuard(async () => {
      const processed = new Set();
      for (let pass = 0; pass < 3; pass++) {
        const fields = globalThis.__apScan({ exclude: EXCLUDE });
        state.fields = fields;
        out.fileFields = fileFieldsOf(fields);
        const ctx = { profile, job, bank, coverLetterText: data.coverLetterText, manual, hasCodeField: codeFieldPresent(fields) };
        const todo = fields.filter((f) => f.kind !== 'file' && !processed.has(f.key));
        if (!todo.length) break;
        for (const f of todo) {
          processed.add(f.key);
          out.total++;
          if (sensitive(f)) { out.skippedSensitive++; continue; }
          if (!f.question && !f.name && !f.id) continue;
          if (hasValue(f) && !overwriteKeys.has(f.key)) { out.prefilled++; continue; }
          try {
            await fillOne(f, ctx, out);
          } catch (e) {
            if (f.question) out.unanswered.push({ key: f.key, question: f.question, required: !!f.required, error: String(e && e.message || e).slice(0, 100) });
          }
        }
        await sleep(300); // conditional follow-up questions appear after answers
      }
    });

    // remember what still needs the user, for "save my answers" / learn-on-submit
    state.unanswered.clear();
    for (const u of out.unanswered) {
      const f = state.fields.find((x) => x.key === u.key);
      if (f) { state.unanswered.set(f.key, { key: f.key, kind: f.kind, question: f.question, options: f.options || [] }); mark(firstEl(f), 'needs'); }
    }
    if (o.learn) hookLearning();
    out.unanswered = out.unanswered.map(({ key, ...r }) => r);
    const seen = new Set();
    out.unanswered = out.unanswered.filter((u) => { const k = (u.question || '').toLowerCase(); if (seen.has(k)) return false; seen.add(k); return true; });
    toast(out);
    return out;
  }

  function firstEl(f) {
    if (f.kind === 'radio' || f.kind === 'checkboxGroup') return deepAll(`[data-ap-grp="${CSS.escape(f.key)}"]`)[0];
    return byKey(f.key);
  }

  // The answer for one field. A typed value from the check panel wins; otherwise identity rules, the profile
  // answerer, then the Answer bank. Dropdown options are only read when openCombos is set (the fill does that,
  // the read-only plan does not), so planning never opens a dropdown.
  async function resolveAnswer(f, ctx, openCombos) {
    const { answerFromProfile, bestOption } = A();
    const type = fieldType(f);
    let options = f.options || [];
    if (f.kind === 'combobox') {
      f._typeahead = LOCATIONISH.test(f.question || '');
      if (openCombos && !f._typeahead) {
        const el = byKey(f.key);
        options = el ? await openCombo(el) : [];
        if (el) closeCombo(el);
        await sleep(80);
        if (!options.length) f._typeahead = true;
      }
    }
    const info = {
      type, options, required: !!f.required, inputType: f.inputType, name: f.name, id: f.id,
      placeholder: f.placeholder, autocomplete: f.autocomplete, coverLetterText: ctx.coverLetterText || null,
      single: f.kind === 'checkbox', kind: f.kind,
    };
    let ans = null;
    let source = 'profile';
    if (ctx.manual && ctx.manual[f.key] != null && ctx.manual[f.key] !== '') {
      ans = ctx.manual[f.key];
      source = 'typed';
    } else {
      ans = identityOverride(f, ctx.profile, ctx.hasCodeField);
      if (isEmpty(ans)) ans = answerFromProfile(f.question, info, ctx.profile, ctx.job);
      if (isEmpty(ans) && f.question && f.question.length > 1) {
        ans = fromBank(f.question, ctx.bank);
        source = 'answer bank';
      }
    }
    if (!isEmpty(ans) && options.length) {
      if (type === 'checkbox' && !info.single) {
        const list = (Array.isArray(ans) ? ans : String(ans).split(/\s*[;,\n]\s*/)).map((x) => (options.includes(x) ? x : bestOption(options, x))).filter(Boolean);
        ans = [...new Set(list)];
      } else {
        const s = Array.isArray(ans) ? ans[0] : ans;
        ans = options.includes(s) ? s : bestOption(options, s);
      }
    }
    return { ans, source, options };
  }

  async function fillOne(f, ctx, out) {
    const { ans, source } = await resolveAnswer(f, ctx, true);
    if (isEmpty(ans)) {
      if (!hasValue(f) && (f.required || f.kind !== 'checkbox')) out.unanswered.push({ key: f.key, question: f.question || f.name, required: !!f.required });
      return;
    }
    if (f.kind === 'checkbox' && !/^(yes|true)/i.test(String(Array.isArray(ans) ? ans[0] : ans)) && !f.value) return; // optional "No" checkboxes: nothing to do
    const ok = await applyAnswer(f, ans);
    if (ok) {
      out.filled++;
      out.answered.push({ question: (f.question || f.name || '').slice(0, 160), answer: String(Array.isArray(f._chosen || ans) ? (f._chosen || ans).join(', ') : (f._chosen || ans)).slice(0, 160), source });
    } else {
      out.unanswered.push({ key: f.key, question: f.question || f.name, required: !!f.required });
    }
  }

  // ------------------------------------------------------------------ check before filling (read only)
  // What a fill would do, for the popup's check panel. Nothing on the page changes: dropdowns are not opened,
  // so a dropdown's planned value is the closest text and the exact option is matched when the fill runs.
  async function plan(data) {
    if (!A() || !globalThis.__apScan) throw new Error('ApplyPilot helpers are not loaded');
    const fields = globalThis.__apScan({ exclude: EXCLUDE });
    const ctx = {
      profile: data.profile || {}, job: data.job || {}, bank: data.answers || [], coverLetterText: data.coverLetterText || null,
      manual: null, hasCodeField: codeFieldPresent(fields),
    };
    const items = [];
    const counts = { fill: 0, differs: 0, same: 0, kept: 0, needs: 0, empty: 0, sensitive: 0 };
    for (const f of fields) {
      if (f.kind === 'file') continue;
      if (sensitive(f)) { counts.sensitive++; continue; }
      if (!f.question && !f.name && !f.id) continue;
      const { ans, source, options } = await resolveAnswer(f, ctx, false);
      const label = String(f.question || f.name || f.id || '').replace(/\s+/g, ' ').trim().slice(0, 160);
      const page = hasValue(f) ? showVal(f.value) : '';
      const want = isEmpty(ans) ? '' : showVal(ans);
      let status;
      if (f.kind === 'checkbox') {
        const yes = !isEmpty(ans) && /^(yes|true)/i.test(String(Array.isArray(ans) ? ans[0] : ans));
        if (isEmpty(ans)) status = hasValue(f) ? 'kept' : (f.required ? 'needs' : 'empty');
        else if (!hasValue(f)) status = yes ? 'fill' : 'same';
        else status = yes ? 'same' : 'differs';
      } else if (isEmpty(ans)) {
        status = hasValue(f) ? 'kept' : (f.required ? 'needs' : 'empty');
      } else if (!hasValue(f)) {
        status = 'fill';
      } else {
        status = sameVal(page, want) ? 'same' : 'differs';
      }
      counts[status]++;
      if (status === 'fill' || status === 'differs' || status === 'needs') {
        items.push({
          key: f.key, label, kind: f.kind, status, value: want, page, required: !!f.required, source,
          options: (options.length ? options : f.options || []).slice(0, 80),
        });
      }
    }
    return {
      items, counts, total: fields.filter((f) => f.kind !== 'file').length,
      fileFields: fileFieldsOf(fields), captcha: visibleCaptcha(),
    };
  }

  // ------------------------------------------------------------------ resume upload
  function attachFile(file) {
    const bytes = Uint8Array.from(atob(file.base64), (c) => c.charCodeAt(0));
    const blob = new File([bytes], file.fileName || 'resume.pdf', { type: file.mime || 'application/octet-stream' });
    const fileFields = (state.fields || []).filter((f) => f.kind === 'file');
    const targets = fileFields.filter((f) => classifyFile(f, fileFields.length) === 'resume' && !f.hasFile);
    let attached = 0;
    for (const f of targets) {
      const el = byKey(f.key);
      if (!el || el.type !== 'file' || (el.files && el.files.length)) continue;
      const accept = (el.getAttribute('accept') || '').toLowerCase();
      const ext = (file.fileName || '').toLowerCase().replace(/^.*(\.[a-z0-9]+)$/, '$1');
      if (accept && !accept.split(',').map((s) => s.trim()).some((a) => a === ext || a === file.mime || (a.endsWith('/*') && file.mime.startsWith(a.slice(0, -1))) || a === '*/*')) continue;
      const dt = new DataTransfer();
      dt.items.add(blob);
      el.files = dt.files;
      fire(el, 'input', 'change');
      mark(el, 'filled');
      attached++;
      if (!f.multiple) break; // one resume per form
    }
    return { attached, fileName: file.fileName };
  }

  // ------------------------------------------------------------------ learning answers you type
  function readValue(u) {
    if (u.kind === 'radio' || u.kind === 'checkboxGroup') {
      const els = deepAll(`[data-ap-grp="${CSS.escape(u.key)}"]`);
      const picked = els.filter((e) => e.checked).map((e) => u.options[Number(e.getAttribute('data-ap-opt'))]).filter(Boolean);
      return u.kind === 'radio' ? picked[0] || '' : picked;
    }
    if (u.kind === 'buttons') {
      const el = deepAll(`[data-ap-id="${CSS.escape(u.key)}"][aria-pressed="true"]`)[0];
      return el ? u.options[Number(el.getAttribute('data-ap-opt'))] || (el.innerText || '').trim() : '';
    }
    const el = byKey(u.key);
    if (!el) return '';
    if (el.tagName === 'SELECT') { const o = el.options[el.selectedIndex]; return o && o.value !== '' ? (o.textContent || '').replace(/\s+/g, ' ').trim() : ''; }
    if (el.type === 'checkbox') return el.checked ? 'Yes' : '';
    if (u.kind === 'combobox') {
      for (let a = el.parentElement, d = 0; a && d < 4; a = a.parentElement, d++) {
        const sv = a.querySelector('[class*="single-value"],[class*="singleValue"]');
        if (sv) return (sv.innerText || '').trim();
      }
    }
    return (el.value || '').trim();
  }
  function collectAnswers() {
    const items = [];
    for (const u of state.unanswered.values()) {
      if (!u.question || u.question.trim().split(/\s+/).length < 2) continue; // skip one-word labels like "Twitter"
      const v = readValue(u);
      const answer = Array.isArray(v) ? v.join(', ') : v;
      if (!answer || SENSITIVE.test(u.question)) continue;
      items.push({ question: u.question.slice(0, 500), answer: answer.slice(0, 5000), options: (u.options || []).slice(0, 50), url: location.href });
    }
    return items;
  }
  function hookLearning() {
    if (state.learnHooked) return;
    state.learnHooked = true;
    const send = () => {
      if (!state.learnEnabled) return;
      const items = collectAnswers().filter((i) => !state.sent.has(`${i.question}|${i.answer}`));
      if (!items.length) return;
      items.forEach((i) => state.sent.add(`${i.question}|${i.answer}`));
      try { chrome.runtime.sendMessage({ type: 'learnAnswers', items }); } catch { /* extension reloaded */ }
    };
    // Passive listeners: they never block or alter your submission.
    window.addEventListener('submit', () => send(), true);
    window.addEventListener('click', (e) => { const t = e.isTrusted && e.target && e.target.closest && e.target.closest('button,input[type=submit],[role=button]'); if (t && isSubmitControl(t)) send(); }, true);
  }

  // ------------------------------------------------------------------ in-page toast (shadow DOM, no page CSS leaks)
  function toast(out) {
    try {
      let host = document.getElementById('__applypilot_toast');
      if (host) host.remove();
      host = document.createElement('div');
      host.id = '__applypilot_toast';
      host.style.cssText = 'position:fixed;z-index:2147483647;right:16px;bottom:16px;';
      const root = host.attachShadow({ mode: 'closed' });
      const need = out.unanswered.length;
      const style = document.createElement('style');
      style.textContent = ':host{all:initial}.t{font:13px/1.45 Inconsolata,ui-monospace,Consolas,monospace;background:#0a0a0a;color:#fafafa;border:1px solid rgba(255,255,255,.16);border-left:3px solid #6366f1;border-radius:10px;padding:10px 14px;max-width:340px;box-shadow:0 10px 30px rgba(0,0,0,.45)}b{color:#818cf8}.m{color:#a1a1a1;font-size:12px;margin-top:4px}.w{color:#fbbf24}';
      const box = document.createElement('div');
      box.className = 't';
      const h = document.createElement('div');
      h.innerHTML = '<b>ApplyPilot</b> ';
      h.appendChild(document.createTextNode(`filled ${out.filled} field${out.filled === 1 ? '' : 's'}${need ? ` · ${need} need${need === 1 ? 's' : ''} you` : ''}.`));
      const m = document.createElement('div');
      m.className = 'm';
      m.textContent = 'Review everything, then click Submit yourself. ApplyPilot never submits.';
      box.append(h, m);
      if (out.captcha) { const c = document.createElement('div'); c.className = 'm w'; c.textContent = `${out.captcha} on this page — complete it yourself.`; box.appendChild(c); }
      root.append(style, box);
      (document.body || document.documentElement).appendChild(host);
      setTimeout(() => host.remove(), 9000);
    } catch { /* page CSP / odd documents */ }
  }

  globalThis.__apPlan = plan;
  globalThis.__apAutofill = autofill;
  globalThis.__apAttachResume = attachFile;
  globalThis.__apCollectAnswers = collectAnswers;
})();
