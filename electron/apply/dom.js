// DOM helpers shared by all adapters: form scanning (with shadow-DOM support), robust
// filling of React-controlled inputs, native selects, custom comboboxes / react-select,
// radio / checkbox / button groups, file uploads, safe clicking, captcha & confirmation detection.
//
// Every control discovered by scanFields() is tagged with data-ap-id="<n>" (and group options
// with data-ap-opt="<i>") so that it can be addressed later with a plain CSS selector — Playwright
// CSS selectors pierce open shadow roots, so this works for web-component forms too.

'use strict';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const rand = (a, b) => a + Math.floor(Math.random() * Math.max(1, b - a));

class SubmitGuardError extends Error {}

// ---------------------------------------------------------------------------
// In-page scanner (serialised into the page by frame.evaluate)
// ---------------------------------------------------------------------------
/* eslint-disable no-undef */
function __apScan(cfg) {
  cfg = cfg || {};
  const rules = cfg.containerRules || [];
  const excludeSel = (cfg.exclude || []).join(',');
  window.__apSeq = window.__apSeq || 0;

  const deepAll = (root, sel) => {
    const out = [];
    const walk = (r) => {
      try { r.querySelectorAll(sel).forEach((e) => out.push(e)); } catch { /* bad selector */ }
      const all = r.querySelectorAll('*');
      for (const el of all) if (el.shadowRoot) walk(el.shadowRoot);
    };
    walk(root);
    return out;
  };
  let root = document;
  if (cfg.root) {
    const r = deepAll(document, cfg.root)[0];
    if (r) root = r;
  }
  const clean = (t) => String(t || '').replace(/ /g, ' ').replace(/\s+/g, ' ').replace(/\s*[*✱]+\s*/g, ' ').replace(/\(\s*(required|optional)\s*\)/ig, '').trim();
  const rawText = (el) => (el ? String(el.innerText != null && el.innerText !== '' ? el.innerText : el.textContent || '') : '');
  const isVisible = (el) => {
    if (!el || !el.getBoundingClientRect) return false;
    const s = getComputedStyle(el);
    if (s.display === 'none' || s.visibility === 'hidden') return false;
    const r = el.getBoundingClientRect();
    return r.width > 1 && r.height > 1;
  };
  const nearVisible = (el, depth = 4) => {
    for (let e = el, i = 0; e && i <= depth; e = e.parentElement, i++) if (isVisible(e)) return true;
    return false;
  };
  const hiddenByAncestor = (el) => {
    for (let e = el; e; e = e.parentElement || (e.getRootNode && e.getRootNode().host)) {
      if (e.nodeType !== 1) break;
      if (e.getAttribute('aria-hidden') === 'true' && !e.querySelector('input[type=file]')) return true;
      const s = getComputedStyle(e);
      if (s.display === 'none') return true;
      if (e === document.body) break;
    }
    return false;
  };
  const byId = (el, id) => {
    if (!id) return null;
    const rn = el.getRootNode ? el.getRootNode() : document;
    return (rn.getElementById ? rn.getElementById(id) : null) || document.getElementById(id);
  };
  const textMinusControls = (container, skipLabelsOf) => {
    const c = container.cloneNode(true);
    c.querySelectorAll('input,select,textarea,button,option,script,style,svg,[role=listbox],[role=option],[aria-live],.visually-hidden,.sr-only').forEach((n) => n.remove());
    if (skipLabelsOf) c.querySelectorAll('label').forEach((l) => { if (!l.textContent.trim() || skipLabelsOf.has(clean(l.textContent))) l.remove(); });
    return c.textContent || '';
  };
  const tag = (el) => {
    if (!el.getAttribute('data-ap-id')) el.setAttribute('data-ap-id', String(++window.__apSeq));
    return el.getAttribute('data-ap-id');
  };
  const isRequiredText = (t) => /[*✱]|\brequired\b/i.test(t || '');

  // Label for a single control
  const labelOf = (el, opts = {}) => {
    const out = { text: '', raw: '' };
    const set = (t) => { if (!out.text && clean(t)) { out.raw = String(t); out.text = clean(t); } };
    for (const r of rules) {
      const c = el.closest(r.container);
      if (!c) continue;
      const l = r.label ? c.querySelector(r.label) : null;
      if (l) {
        // If the label belongs to a different control (label[for] mismatch) skip it for groups
        const f = l.getAttribute && l.getAttribute('for');
        if (opts.group && f && byId(l, f) && !opts.group.includes(byId(l, f))) continue;
        set(rawText(l));
      }
      if (out.text) return out;
    }
    if (!opts.group) {
      if (el.id) {
        const rn = el.getRootNode ? el.getRootNode() : document;
        let l = null;
        try { l = (rn.querySelector ? rn.querySelector(`label[for="${CSS.escape(el.id)}"]`) : null) || document.querySelector(`label[for="${CSS.escape(el.id)}"]`); } catch { /* */ }
        if (l) set(textMinusControls(l));
      }
      if (out.text) return out;
    }
    const lb = el.getAttribute('aria-labelledby');
    if (lb) set(lb.split(/\s+/).map((id) => byId(el, id)).filter(Boolean).map((n) => rawText(n)).join(' '));
    if (out.text) return out;
    const al = el.getAttribute('aria-label');
    if (al && !/^(search|toggle flyout|select|open|clear|close)$/i.test(al.trim())) set(al);
    if (out.text) return out;
    if (!opts.group) {
      const pl = el.closest('label');
      if (pl) set(textMinusControls(pl));
      if (out.text) return out;
    }
    const fs = el.closest('fieldset');
    if (fs) { const lg = fs.querySelector('legend'); if (lg) set(rawText(lg)); }
    if (out.text) return out;
    const grp = el.closest('[role=radiogroup],[role=group]');
    if (grp) {
      const gl = grp.getAttribute('aria-labelledby');
      if (gl) set(gl.split(/\s+/).map((id) => byId(grp, id)).filter(Boolean).map((n) => rawText(n)).join(' '));
      if (!out.text && grp.getAttribute('aria-label')) set(grp.getAttribute('aria-label'));
    }
    if (out.text) return out;
    // Ancestor walk: nearest ancestor that has some text besides our control(s)
    const mine = new Set(opts.group || [el]);
    const optionLabels = new Set(opts.optionLabels || []);
    for (let a = (opts.group ? commonAncestor(opts.group) : el).parentElement, d = 0; a && d < 5; a = a.parentElement, d++) {
      const ctrls = [...a.querySelectorAll('input:not([type=hidden]),select,textarea')].filter((x) => !mine.has(x) && x.type !== 'hidden' && isVisible(x));
      const t = clean(textMinusControls(a, optionLabels));
      if (ctrls.length) {
        // another control lives here: only accept text if it precedes ours and is short
        break;
      }
      if (t && t.length <= 400) { set(textMinusControls(a, optionLabels)); break; }
      if (t.length > 400) break;
    }
    if (out.text) return out;
    if (el.placeholder && !/^(type here|select|start typing|search)/i.test(el.placeholder)) set(el.placeholder);
    if (!out.text && el.name) set(el.name.replace(/.*\[(.+?)\]$/, '$1').replace(/[_\-\[\]]+/g, ' '));
    return out;
  };
  function commonAncestor(els) {
    if (!els.length) return null;
    let a = els[0].parentElement;
    while (a && !els.every((e) => a.contains(e))) a = a.parentElement;
    return a || els[0];
  }
  const optLabelOf = (el) => {
    let t = '';
    if (el.id) {
      try {
        const rn = el.getRootNode ? el.getRootNode() : document;
        const l = (rn.querySelector ? rn.querySelector(`label[for="${CSS.escape(el.id)}"]`) : null) || document.querySelector(`label[for="${CSS.escape(el.id)}"]`);
        if (l) t = clean(textMinusControls(l));
      } catch { /* */ }
    }
    if (!t) { const pl = el.closest('label'); if (pl) t = clean(textMinusControls(pl)); }
    if (!t && el.getAttribute('aria-label')) t = clean(el.getAttribute('aria-label'));
    if (!t && el.nextElementSibling) t = clean(rawText(el.nextElementSibling));
    if (!t && el.parentElement) t = clean(textMinusControls(el.parentElement));
    if (!t) t = clean(el.value);
    return t;
  };
  const reqOf = (els, lab) => els.some((e) => e.required || e.getAttribute('aria-required') === 'true') || isRequiredText(lab.raw);

  const all = deepAll(root, 'input,select,textarea,[role=combobox],[aria-pressed]');
  const fields = [];
  const seenGroups = new Set();
  const excluded = (el) => (excludeSel && el.closest(excludeSel)) ||
    /recaptcha|hcaptcha|h-captcha|cf-turnstile/i.test(`${el.name || ''} ${el.id || ''} ${el.className || ''}`) ||
    (el.closest && el.closest('.iti__dropdown-content,.iti__country-container,[role=dialog][aria-modal=true] .iti'));

  // button groups (Ashby Yes/No etc.) first, so we can suppress their hidden checkbox
  const pressGroups = new Map();
  for (const b of all) {
    if (!b.hasAttribute || !b.hasAttribute('aria-pressed') || excluded(b) || !isVisible(b)) continue;
    const p = b.parentElement; if (!p) continue;
    if (!pressGroups.has(p)) pressGroups.set(p, []);
    pressGroups.get(p).push(b);
  }
  const groupedParents = new Set();
  for (const [p, btns] of pressGroups) {
    if (btns.length < 2) continue;
    groupedParents.add(p);
    const key = tag(p);
    const opts = btns.map((b, i) => { b.setAttribute('data-ap-id', key); b.setAttribute('data-ap-opt', String(i)); return clean(rawText(b)); });
    const lab = labelOf(p.querySelector('input') || btns[0], { group: [...btns, ...p.querySelectorAll('input')], optionLabels: opts });
    const pressed = btns.find((b) => b.getAttribute('aria-pressed') === 'true');
    fields.push({ key, kind: 'buttons', question: lab.text, required: isRequiredText(lab.raw) || !!p.querySelector('input[required]'), options: opts, value: pressed ? clean(rawText(pressed)) : '' });
  }

  for (const el of all) {
    if (el.hasAttribute('aria-pressed') && el.tagName !== 'INPUT') continue;
    const tg = el.tagName;
    const type = (el.getAttribute('type') || (tg === 'INPUT' ? 'text' : tg.toLowerCase())).toLowerCase();
    if (tg === 'INPUT' && type === 'password') continue; // never touch credentials
    if (tg === 'INPUT' && /^(hidden|submit|button|reset|image|search)$/.test(type) && el.getAttribute('role') !== 'combobox') continue;
    if (type === 'search' && /iti__/.test(el.className)) continue;
    if (excluded(el)) continue;
    if (el.disabled || el.readOnly && el.getAttribute('role') !== 'combobox' && tg !== 'SELECT') { if (type !== 'file') continue; }
    if (el.parentElement && groupedParents.has(el.parentElement)) continue;
    if (type === 'file') {
      if (hiddenByAncestor(el) && !nearVisible(el, 6)) continue;
      const key = tag(el);
      const lab = labelOf(el);
      // include surrounding text (e.g. "Resume/CV", "Attach") to classify the upload
      let ctx = '';
      for (let a = el.parentElement, d = 0; a && d < 4 && ctx.length < 40; a = a.parentElement, d++) ctx = clean(textMinusControls(a)).slice(0, 200);
      fields.push({ key, kind: 'file', question: lab.text, context: ctx, required: el.required || isRequiredText(lab.raw), name: el.name || '', id: el.id || '', accept: el.accept || '', hasFile: !!(el.files && el.files.length) });
      continue;
    }
    if (type === 'radio' || type === 'checkbox') {
      if (!nearVisible(el, 3) || hiddenByAncestor(el)) continue;
      const gname = el.name || '';
      let members;
      if (gname) {
        const scope = el.closest('form') || el.getRootNode() || document;
        members = [...(scope.querySelectorAll ? scope.querySelectorAll(`input[type=${type}]`) : [])].filter((x) => x.name === gname && !excluded(x));
      } else {
        const g = el.closest('[role=radiogroup],[role=group],fieldset');
        members = g ? [...g.querySelectorAll(`input[type=${type}]`)] : [el];
      }
      const gk = `${type}|${gname || ''}|${members.indexOf(el) === 0 ? '' : ''}`;
      if (members.length > 1 || type === 'radio') {
        if (members.some((m) => seenGroups.has(m))) continue;
        members.forEach((m) => seenGroups.add(m));
        const key = tag(members[0]);
        const opts = members.map((m, i) => { m.setAttribute('data-ap-grp', key); m.setAttribute('data-ap-opt', String(i)); return optLabelOf(m); });
        const lab = labelOf(members[0], { group: members, optionLabels: opts });
        const checked = members.filter((m) => m.checked).map((m) => optLabelOf(m));
        fields.push({ key, kind: type === 'radio' ? 'radio' : 'checkboxGroup', question: lab.text, required: reqOf(members, lab), options: opts, value: type === 'radio' ? (checked[0] || '') : checked, name: gname });
        void gk;
      } else {
        const key = tag(el);
        const ol = optLabelOf(el);
        let lab = labelOf(el, { group: [el], optionLabels: [] });
        let q = lab.text;
        // single checkbox: question is usually its own label
        if (ol && (!q || q.length < ol.length)) q = ol;
        fields.push({ key, kind: 'checkbox', question: q, required: el.required || el.getAttribute('aria-required') === 'true' || isRequiredText(lab.raw), options: [], value: el.checked ? 'Yes' : '', name: el.name || '' });
      }
      continue;
    }
    if (!isVisible(el)) continue;
    const key = tag(el);
    const lab = labelOf(el);
    const base = { key, question: lab.text, required: el.required || el.getAttribute('aria-required') === 'true' || isRequiredText(lab.raw), name: el.name || '', id: el.id || '', placeholder: el.placeholder || '', autocomplete: el.getAttribute('autocomplete') || '', inputType: type };
    if (tg === 'SELECT') {
      const opts = [...el.options].filter((o) => !o.disabled || o.value).map((o) => clean(o.textContent)).filter((t, i) => !(i === 0 && /^(select|choose|please|--|—|click here)/i.test(t)) && t);
      const sel = el.selectedIndex >= 0 ? el.options[el.selectedIndex] : null;
      const val = sel && sel.value !== '' && !/^(select|choose|please|--|—)/i.test(clean(sel.textContent)) ? clean(sel.textContent) : '';
      fields.push({ ...base, kind: 'select', options: opts, value: val, multiple: el.multiple });
      continue;
    }
    if (el.getAttribute('role') === 'combobox' || el.getAttribute('aria-autocomplete') === 'list') {
      // react-select shows the chosen value in a sibling ".select__single-value"
      let shown = '';
      for (let a = el.parentElement, d = 0; a && d < 4 && !shown; a = a.parentElement, d++) {
        const sv = a.querySelector('[class*="single-value"],[class*="singleValue"],[class*="multi-value__label"]');
        if (sv) shown = clean(rawText(sv));
      }
      fields.push({ ...base, kind: 'combobox', options: [], value: shown || el.value || '' });
      continue;
    }
    fields.push({ ...base, kind: tg === 'TEXTAREA' ? 'textarea' : 'text', value: el.value || '' });
  }
  return fields;
}

function __apReadListOptions(input) {
  const clean = (t) => String(t || '').replace(/\s+/g, ' ').trim();
  const isVisible = (el) => { const r = el.getBoundingClientRect(); const s = getComputedStyle(el); return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none'; };
  document.querySelectorAll('[data-ap-listopt]').forEach((n) => n.removeAttribute('data-ap-listopt'));
  let opts = [];
  const ids = [input.getAttribute('aria-controls'), input.getAttribute('aria-owns')].filter(Boolean);
  for (const id of ids) {
    const lb = document.getElementById(id) || (input.getRootNode().getElementById && input.getRootNode().getElementById(id));
    if (lb) { opts = [...lb.querySelectorAll('[role=option]')]; if (!opts.length && lb.getAttribute('role') !== 'listbox') opts = [...lb.querySelectorAll('li')]; }
    if (opts.length) break;
  }
  if (!opts.length) {
    // nearest visible listbox
    for (let a = input.parentElement, d = 0; a && d < 6 && !opts.length; a = a.parentElement, d++) {
      opts = [...a.querySelectorAll('[role=option]')].filter(isVisible);
    }
  }
  if (!opts.length) opts = [...document.querySelectorAll('[role=listbox] [role=option], [role=option]')].filter(isVisible).filter((o) => !o.closest('.iti__country-list'));
  opts = opts.filter(isVisible).slice(0, 400);
  return opts.map((o, i) => { o.setAttribute('data-ap-listopt', String(i)); return clean(o.innerText || o.textContent); });
}
/* eslint-enable no-undef */

async function scanFields(frame, cfg = {}) {
  try {
    return await frame.evaluate(__apScan, cfg);
  } catch (e) {
    return [];
  }
}

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------
const SUBMIT_TEXT = /\b(submit|send application|send my application|complete application|finish application|confirm application|apply now|submit application)\b/i;

// Refuse clicks that could submit an application unless ctx.allowSubmit is set.
async function assertSafe(locator, ctx) {
  if (ctx && ctx.allowSubmit) return;
  const info = await locator.evaluate((el) => {
    const t = (el.innerText || el.value || el.getAttribute('aria-label') || '').trim();
    const isBtn = el.tagName === 'BUTTON' || (el.tagName === 'INPUT' && /submit|button|image/.test(el.type));
    const submitsForm = isBtn && (el.type === 'submit' || el.tagName === 'BUTTON' && !el.getAttribute('type')) && !!el.form;
    return { t, submitsForm };
  }).catch(() => ({ t: '', submitsForm: false }));
  if (info.submitsForm || SUBMIT_TEXT.test(info.t)) throw new SubmitGuardError(`Blocked a click on a submit control ("${info.t.slice(0, 40)}")`);
}

async function safeClick(locator, ctx, opts = {}) {
  await assertSafe(locator, ctx);
  try {
    await locator.scrollIntoViewIfNeeded({ timeout: 3000 }).catch(() => {});
    await locator.click({ timeout: opts.timeout || 5000, ...opts });
  } catch (e) {
    if (e instanceof SubmitGuardError) throw e;
    // fallback: DOM click (works for visually-hidden radios / overlays)
    await locator.evaluate((el) => el.click());
  }
}

async function humanPause(ctx, a = 120, b = 450) {
  if (ctx && ctx.human) await sleep(rand(a, b));
}

async function fillText(frame, selector, value, ctx) {
  const loc = frame.locator(selector).first();
  const v = String(value);
  await loc.scrollIntoViewIfNeeded({ timeout: 3000 }).catch(() => {});
  try {
    await loc.fill(v, { timeout: 5000 });
  } catch {
    await loc.click({ timeout: 3000 }).catch(() => {});
    await frame.page().keyboard.press('Control+A').catch(() => {});
    await loc.pressSequentially(v, { delay: 5 }).catch(() => {});
  }
  let cur = await loc.inputValue().catch(() => null);
  if (cur !== v) {
    // React-controlled fallback: use the native setter and dispatch input/change
    await loc.evaluate((el, val) => {
      const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      const setter = Object.getOwnPropertyDescriptor(proto, 'value').set;
      setter.call(el, val);
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    }, v).catch(() => {});
    cur = await loc.inputValue().catch(() => null);
  }
  await loc.evaluate((el) => { el.dispatchEvent(new Event('change', { bubbles: true })); el.blur(); }).catch(() => {});
  await humanPause(ctx);
  // inputs with masks may reformat (phone etc.) — accept any non-empty value
  return cur != null && cur !== '';
}

async function selectNative(frame, selector, optionText, ctx) {
  const loc = frame.locator(selector).first();
  await loc.scrollIntoViewIfNeeded({ timeout: 3000 }).catch(() => {});
  const ok = await loc.evaluate((el, want) => {
    const clean = (t) => String(t || '').replace(/\s+/g, ' ').trim();
    const opt = [...el.options].find((o) => clean(o.textContent) === want) || [...el.options].find((o) => clean(o.textContent).toLowerCase() === String(want).toLowerCase());
    return opt ? opt.value : null;
  }, optionText).catch(() => null);
  if (ok == null) return false;
  try { await loc.selectOption(ok, { timeout: 5000 }); } catch {
    await loc.evaluate((el, val) => { el.value = val; el.dispatchEvent(new Event('change', { bubbles: true })); }, ok).catch(() => {});
  }
  await humanPause(ctx);
  return true;
}

async function setChecked(frame, selector, checked, ctx) {
  const loc = frame.locator(selector).first();
  const cur = await loc.isChecked().catch(() => null);
  if (cur === checked) return true;
  try {
    if (await loc.isVisible()) await (checked ? loc.check({ timeout: 4000 }) : loc.uncheck({ timeout: 4000 }));
    else throw new Error('hidden');
  } catch {
    // click the associated label or the element itself via DOM
    await loc.evaluate((el) => {
      const lab = (el.id && document.querySelector(`label[for="${CSS.escape(el.id)}"]`)) || el.closest('label');
      (lab || el).click();
    }).catch(() => {});
  }
  await humanPause(ctx, 80, 250);
  return (await loc.isChecked().catch(() => !checked)) === checked;
}

// Choose an option in a radio / checkbox group by its option index.
async function chooseGroupOption(frame, groupKey, index, ctx, checked = true) {
  return setChecked(frame, `[data-ap-grp="${groupKey}"][data-ap-opt="${index}"]`, checked, ctx);
}

async function clickPressButton(frame, groupKey, index, ctx) {
  const loc = frame.locator(`[data-ap-id="${groupKey}"][data-ap-opt="${index}"]`).first();
  await safeClick(loc, ctx);
  await humanPause(ctx);
  return (await loc.getAttribute('aria-pressed').catch(() => 'true')) === 'true';
}

async function readComboOptions(frame, selector) {
  const loc = frame.locator(selector).first();
  return loc.evaluate(__apReadListOptions).catch(() => []);
}

const NO_OPTS = /^(no options|no results|no matches|type to search|loading|searching|start typing|no location found)/i;

// Open a combobox (react-select / Ashby / ARIA) and return its option texts without choosing.
async function peekComboOptions(frame, selector, ctx) {
  const loc = frame.locator(selector).first();
  await loc.scrollIntoViewIfNeeded({ timeout: 3000 }).catch(() => {});
  await loc.click({ timeout: 4000 }).catch(() => loc.focus().catch(() => {}));
  await sleep(450);
  let opts = await readComboOptions(frame, selector);
  if (!opts.length) {
    await frame.page().keyboard.press('ArrowDown').catch(() => {});
    await sleep(350);
    opts = await readComboOptions(frame, selector);
  }
  await frame.page().keyboard.press('Escape').catch(() => {});
  await sleep(120);
  void ctx;
  return opts.filter((o) => o && !NO_OPTS.test(o));
}

// Pick a value in a combobox. `chooser(options) -> optionText|null` decides; `typed` is the
// text to type for async/typeahead lists (location etc.). Returns the chosen text or null.
async function pickCombo(frame, selector, { typed, chooser, firstIfNoMatch = false }, ctx) {
  const page = frame.page();
  const loc = frame.locator(selector).first();
  await loc.scrollIntoViewIfNeeded({ timeout: 3000 }).catch(() => {});
  await loc.click({ timeout: 4000 }).catch(() => loc.focus().catch(() => {}));
  await sleep(300);
  let opts = (await readComboOptions(frame, selector)).filter((o) => !NO_OPTS.test(o));
  let choice = opts.length ? chooser(opts) : null;
  if ((!choice || opts.length > 30) && typed) {
    // type to filter / to trigger async search
    await loc.fill('').catch(() => {});
    await loc.pressSequentially(String(typed).slice(0, 60), { delay: ctx && ctx.human ? 45 : 15 }).catch(() => {});
    for (let i = 0; i < 12; i++) {
      await sleep(400);
      opts = (await readComboOptions(frame, selector)).filter((o) => !NO_OPTS.test(o));
      if (opts.length) break;
    }
    await sleep(250);
    opts = (await readComboOptions(frame, selector)).filter((o) => !NO_OPTS.test(o));
    choice = opts.length ? (chooser(opts) || (firstIfNoMatch ? opts[0] : null)) : null;
  }
  if (!choice) { await page.keyboard.press('Escape').catch(() => {}); return null; }
  const idx = opts.indexOf(choice);
  const optLoc = frame.locator(`[data-ap-listopt="${idx}"]`).first();
  try {
    await optLoc.scrollIntoViewIfNeeded({ timeout: 2000 }).catch(() => {});
    await optLoc.click({ timeout: 4000 });
  } catch {
    await optLoc.evaluate((el) => { el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })); el.click(); }).catch(() => {});
  }
  await sleep(250);
  await humanPause(ctx);
  return choice;
}

// Plain text input with an autocomplete dropdown (e.g. Lever location): type, then pick the first suggestion.
async function typeAndPickSuggestion(frame, selector, text, suggestionSelector, ctx) {
  const loc = frame.locator(selector).first();
  await loc.scrollIntoViewIfNeeded({ timeout: 3000 }).catch(() => {});
  await loc.fill('').catch(() => {});
  await loc.click({ timeout: 3000 }).catch(() => {});
  await loc.pressSequentially(String(text).slice(0, 80), { delay: ctx && ctx.human ? 50 : 20 }).catch(() => {});
  const sug = frame.locator(suggestionSelector).first();
  try {
    await sug.waitFor({ state: 'visible', timeout: 6000 });
    await sleep(200);
    await sug.click({ timeout: 3000 });
    await humanPause(ctx);
    return true;
  } catch {
    return false;
  }
}

async function uploadFile(frame, selector, filePath, ctx) {
  const loc = frame.locator(selector).first();
  await loc.setInputFiles(filePath, { timeout: 10000 });
  await humanPause(ctx, 300, 800);
  return true;
}

// ---------------------------------------------------------------------------
// Detection helpers
// ---------------------------------------------------------------------------
// Visible, interactive CAPTCHA challenge (invisible reCAPTCHA / hCaptcha badges are ignored).
async function detectCaptcha(page) {
  try {
    for (const f of page.frames()) {
      const u = f.url();
      if (!/recaptcha\/(api2|enterprise)\/(anchor|bframe)|hcaptcha\.com\/captcha|challenges\.cloudflare\.com|turnstile|arkoselabs|funcaptcha|captcha-delivery\.com|datadome|px-captcha|perimeterx/.test(u)) continue;
      if (/[?&]size=invisible/.test(u)) continue;
      const el = await f.frameElement().catch(() => null);
      if (!el) continue;
      const box = await el.boundingBox().catch(() => null);
      const vis = await el.isVisible().catch(() => false);
      if (vis && box && box.width > 60 && box.height > 50) {
        const kind = /hcaptcha/.test(u) ? 'hcaptcha' : /cloudflare|turnstile/.test(u) ? 'turnstile' : /arkose|funcaptcha/.test(u) ? 'arkose'
          : /captcha-delivery|datadome|perimeterx|px-captcha/.test(u) ? 'bot-check' : 'recaptcha';
        return { kind, url: u.split('?')[0] };
      }
    }
    // Full-page bot walls ("Access is temporarily restricted", "Verify you are human", Cloudflare interstitials)
    const t = await page.evaluate(() => (document.body ? document.body.innerText.slice(0, 3000) : '')).catch(() => '');
    if (/access (is )?(temporarily )?(restricted|denied|blocked)|unusual (activity|traffic) from your|verify (that )?you are (a )?human|are you a robot|checking your browser|press (&|and) hold|just a moment\.\.\./i.test(t)) {
      const formish = await page.evaluate(() => document.querySelectorAll('input:not([type=hidden]),textarea,select').length).catch(() => 0);
      if (formish < 3) return { kind: 'bot-check', url: page.url().split('?')[0] };
    }
  } catch { /* ignore */ }
  return null;
}

const CONFIRM_TEXT = /thank(s| you) for (applying|your (application|interest|submission))|application (has been |was )?(successfully )?(submitted|received|sent|complete)|we(?:'ve| have) received your application|successfully (submitted|applied)|your application is (in|complete|submitted)|you(?:'ve| have) (successfully )?applied/i;

async function genericConfirmation(page) {
  try {
    const u = page.url();
    if (/\/(confirmation|thanks|thank-you|thankyou|application-submitted|success)(\b|\/|\?|$)/i.test(u)) return true;
    const t = await page.evaluate(() => (document.body ? document.body.innerText.slice(0, 20000) : '')).catch(() => '');
    if (!CONFIRM_TEXT.test(t)) return false;
    // make sure the form is gone (some pages say "thank you for your interest" up front)
    const hasForm = await page.evaluate(() => [...document.querySelectorAll('input[type=email],input[type=file]')].some((e) => {
      const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0;
    })).catch(() => false);
    return !hasForm || /successfully|has been (submitted|received)|we(?:'ve| have) received/i.test(t);
  } catch { return false; }
}

async function visibleErrors(frame) {
  return frame.evaluate(() => {
    const sel = '[aria-invalid="true"], .error:not(:empty), .field-error, .error-message, [class*="error"][role="alert"], [role=alert]';
    return [...document.querySelectorAll(sel)].filter((e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0; })
      .map((e) => (e.innerText || e.getAttribute('aria-label') || e.name || '').trim()).filter(Boolean).slice(0, 10);
  }).catch(() => []);
}

// Dismiss cookie banners choosing the most privacy-preserving option only.
async function rejectCookies(page) {
  const texts = /^(reject all|reject|decline all|decline|deny|deny all|only necessary|necessary only|use necessary cookies only|refuse all|reject non-essential|continue without accepting|only essential|essential only|reject optional cookies)$/i;
  try {
    for (const f of page.frames()) {
      const btns = f.locator('button, [role=button], a[role=button], input[type=button]');
      const n = Math.min(await btns.count().catch(() => 0), 60);
      for (let i = 0; i < n; i++) {
        const b = btns.nth(i);
        const t = ((await b.innerText({ timeout: 300 }).catch(() => '')) || (await b.getAttribute('value').catch(() => '')) || '').trim();
        if (t && texts.test(t) && await b.isVisible().catch(() => false)) { await b.click({ timeout: 2000 }).catch(() => {}); await sleep(300); return true; }
      }
    }
  } catch { /* ignore */ }
  return false;
}

// Pick the frame that contains the biggest form (handles embedded ATS iframes).
async function bestFormFrame(page) {
  let best = page.mainFrame(); let bestN = -1;
  for (const f of page.frames()) {
    const n = await f.evaluate(() => document.querySelectorAll('input:not([type=hidden]),textarea,select').length).catch(() => -1);
    if (n > bestN) { bestN = n; best = f; }
  }
  return best;
}

async function waitForAny(frame, selectors, timeout = 15000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    for (const s of selectors) {
      if (await frame.locator(s).first().isVisible().catch(() => false)) return s;
    }
    await sleep(300);
  }
  return null;
}

module.exports = {
  sleep, rand, SubmitGuardError,
  scanFields, assertSafe, safeClick, humanPause,
  fillText, selectNative, setChecked, chooseGroupOption, clickPressButton,
  readComboOptions, peekComboOptions, pickCombo, typeAndPickSuggestion, uploadFile,
  detectCaptcha, genericConfirmation, visibleErrors, rejectCookies, bestFormFrame, waitForAny,
  CONFIRM_TEXT,
};
