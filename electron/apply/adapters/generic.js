// Generic heuristic adapter + the shared form-filling orchestrator used by every ATS adapter.
//
// fillForm(frame, ctx, cfg) scans the form, uploads the resume, answers each field via
// answerFromProfile → ctx.answerQuestion (app memory / AI), and fills it. Conditional
// follow-up questions are picked up by re-scanning (up to 3 passes).
//
// cfg = {
//   root, containerRules: [{container, label}], exclude: [selectors],
//   fieldHook: async (frame, field, ctx, helpers) => undefined | 'filled' | 'skip' | 'unanswered',
//   afterUploadWaitMs, phoneNational, typeaheadKeys: RegExp (questions whose combobox needs typing)
// }

'use strict';

const dom = require('../dom');
const { answerFromProfile, bestOption } = require('../answers');

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

function isEmptyAnswer(a) {
  return a == null || (typeof a === 'string' && !a.trim()) || (Array.isArray(a) && !a.length);
}

async function withTimeout(p, ms, fallback = null) {
  let t;
  try {
    return await Promise.race([p, new Promise((r) => { t = setTimeout(() => r(fallback), ms); })]);
  } finally { clearTimeout(t); }
}

function checkAbort(ctx) {
  if (ctx.signal && ctx.signal.aborted) {
    const e = new Error('Aborted'); e.code = 'ABORTED'; throw e;
  }
}

async function getAnswer(f, ctx, info) {
  let ans = answerFromProfile(f.question, info, ctx.profile, ctx.job);
  let source = 'profile';
  if (isEmptyAnswer(ans) && ctx.answerQuestion && f.question && f.question.length > 1) {
    const hasValue = Array.isArray(f.value) ? f.value.length : !!f.value;
    if (hasValue) return { ans: null, source: 'prefilled' };
    ctx.emit('question', `Asking: ${f.question.slice(0, 120)}`, { question: f.question, type: info.type, options: info.options, required: !!f.required });
    try {
      ans = await withTimeout(Promise.resolve(ctx.answerQuestion(f.question, { type: info.type, options: info.options, required: !!f.required })), 120000, null);
    } catch (e) {
      ctx.log(`answerQuestion failed: ${e.message}`);
      ans = null;
    }
    source = 'app';
    checkAbort(ctx);
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

async function applyAnswer(frame, f, ans, ctx, cfg) {
  const sel = `[data-ap-id="${f.key}"]`;
  switch (f.kind) {
    case 'text': case 'textarea': {
      const v = Array.isArray(ans) ? ans.join(', ') : String(ans);
      if (f.value && f.value === v) return true;
      return dom.fillText(frame, sel, v, ctx);
    }
    case 'select':
      return dom.selectNative(frame, sel, ans, ctx);
    case 'radio': {
      const i = f.options.indexOf(ans);
      if (i < 0) return false;
      return dom.chooseGroupOption(frame, f.key, i, ctx, true);
    }
    case 'buttons': {
      const i = f.options.indexOf(ans);
      if (i < 0) return false;
      if (f.value === ans) return true;
      return dom.clickPressButton(frame, f.key, i, ctx);
    }
    case 'checkboxGroup': {
      const want = new Set(Array.isArray(ans) ? ans : [ans]);
      let ok = true;
      for (let i = 0; i < f.options.length; i++) {
        if (want.has(f.options[i])) ok = (await dom.chooseGroupOption(frame, f.key, i, ctx, true)) && ok;
      }
      return ok;
    }
    case 'checkbox': {
      const yes = /^(yes|true|1|on|checked|agree|i agree)/i.test(String(Array.isArray(ans) ? ans[0] : ans));
      return dom.setChecked(frame, sel, yes, ctx);
    }
    case 'combobox': {
      const want = Array.isArray(ans) ? ans[0] : ans;
      const chosen = await dom.pickCombo(frame, sel, {
        typed: f._typeahead ? want : (String(want).length < 60 ? want : null),
        chooser: (opts) => (opts.includes(want) ? want : bestOption(opts, want)),
        firstIfNoMatch: !!f._typeahead,
      }, ctx);
      f._chosen = chosen;
      const city = ctx.profile && ctx.profile.city;
      if (!chosen && f._typeahead && city && want !== city) {
        f._chosen = await dom.pickCombo(frame, sel, { typed: city, chooser: (o) => o[0], firstIfNoMatch: true }, ctx);
      }
      return !!f._chosen;
    }
    default: return false;
  }
}

async function handleFiles(frame, fields, ctx, state) {
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
    if (state.processed.has(f.key)) continue;
    state.processed.add(f.key);
    let kind = kinds[i];
    if (files.length === 1 && kind !== 'resume') kind = 'resume';
    if (kind === 'resume') {
      if (!ctx.resume || !ctx.resume.path) { state.unanswered.push({ question: f.question || 'Resume', required: !!f.required }); continue; }
      if (f.hasFile) continue;
      try {
        await dom.uploadFile(frame, `[data-ap-id="${f.key}"]`, ctx.resume.path, ctx);
        uploaded++; state.filled++;
        ctx.emit('step', `Uploaded resume (${ctx.resume.fileName || 'resume'})`, { field: f.question || 'Resume' });
      } catch (e) {
        ctx.log(`resume upload failed: ${e.message}`);
        state.unanswered.push({ question: f.question || 'Resume', required: !!f.required });
      }
    } else if (f.required) {
      // cover letter / transcript etc. that we cannot provide as a file
      if (kind === 'cover' && ctx.coverLetterFile) {
        try { await dom.uploadFile(frame, `[data-ap-id="${f.key}"]`, ctx.coverLetterFile, ctx); state.filled++; continue; } catch { /* fallthrough */ }
      }
      state.unanswered.push({ question: f.question || (kind === 'cover' ? 'Cover letter' : 'File upload'), required: true });
    }
  }
  return uploaded;
}

async function fillForm(frame, ctx, cfg = {}) {
  const state = { filled: 0, unanswered: [], processed: new Set(), answered: [] };
  const scanCfg = { root: cfg.root, containerRules: cfg.containerRules || [], exclude: cfg.exclude || [] };

  let fields = await dom.scanFields(frame, scanCfg);
  ctx.log(`scan: ${fields.length} fields`);
  const up = await handleFiles(frame, fields, ctx, state);
  if (up) await dom.sleep(cfg.afterUploadWaitMs != null ? cfg.afterUploadWaitMs : 2500);

  for (let pass = 0; pass < 3; pass++) {
    checkAbort(ctx);
    fields = await dom.scanFields(frame, scanCfg);
    await handleFiles(frame, fields, ctx, state);
    const todo = fields.filter((f) => f.kind !== 'file' && !state.processed.has(f.key));
    if (!todo.length) break;
    for (const f of todo) {
      checkAbort(ctx);
      state.processed.add(f.key);
      try {
        await fillOne(frame, f, ctx, cfg, state);
      } catch (e) {
        if (e.code === 'ABORTED' || e instanceof dom.SubmitGuardError) throw e;
        ctx.log(`field "${(f.question || f.key).slice(0, 60)}" failed: ${e.message}`);
        if (f.question) state.unanswered.push({ question: f.question, required: !!f.required });
      }
    }
    await dom.sleep(400);
  }
  // de-duplicate unanswered by question
  const seen = new Set();
  state.unanswered = state.unanswered.filter((u) => { const k = (u.question || '').toLowerCase(); if (seen.has(k)) return false; seen.add(k); return true; });
  return { filledCount: state.filled, unanswered: state.unanswered, answered: state.answered };
}

async function fillOne(frame, f, ctx, cfg, state) {
  if (cfg.fieldHook) {
    const r = await cfg.fieldHook(frame, f, ctx, { state });
    if (r === 'filled') { state.filled++; return; }
    if (r === 'skip') return;
    if (r === 'unanswered') { state.unanswered.push({ question: f.question, required: !!f.required }); return; }
  }
  if (!f.question && !f.name && !f.id) return; // nothing to go on
  const type = fieldType(f);
  let options = f.options || [];
  if (f.kind === 'combobox') {
    f._typeahead = (cfg.typeaheadKeys || LOCATIONISH).test(f.question || '');
    if (!f._typeahead) {
      options = await dom.peekComboOptions(frame, `[data-ap-id="${f.key}"]`, ctx);
      if (!options.length) { await dom.sleep(600); options = await dom.peekComboOptions(frame, `[data-ap-id="${f.key}"]`, ctx); }
      if (!options.length) f._typeahead = true;
    }
  }
  const info = {
    type, options, required: !!f.required, inputType: f.inputType, name: f.name, id: f.id,
    placeholder: f.placeholder, autocomplete: f.autocomplete, coverLetterText: ctx.coverLetterText,
    single: f.kind === 'checkbox', phoneNational: cfg.phoneNational, kind: f.kind,
  };
  let { ans, source } = await getAnswer(f, ctx, info);
  if (ans == null) {
    const hasValue = Array.isArray(f.value) ? f.value.length : !!f.value;
    if (!hasValue && (f.required || f.kind !== 'checkbox')) state.unanswered.push({ question: f.question || f.name, required: !!f.required });
    return;
  }
  // Optional single checkboxes answered "No" need no action
  if (f.kind === 'checkbox' && !/^(yes|true)/i.test(String(ans)) && !f.value) return;
  const ok = await applyAnswer(frame, f, ans, ctx, cfg);
  if (ok) {
    if (f._chosen) ans = f._chosen;
    state.filled++;
    state.answered.push({ question: f.question, answer: ans, source });
    ctx.emit('filled', `${(f.question || f.name).slice(0, 80)} → ${String(Array.isArray(ans) ? ans.join(', ') : ans).slice(0, 80)}`, { question: f.question, answer: ans, source });
  } else {
    state.unanswered.push({ question: f.question || f.name, required: !!f.required });
  }
}

// ---------------------------------------------------------------------------
// The generic adapter itself (any site). Never submits.
// ---------------------------------------------------------------------------
module.exports = {
  id: 'generic',
  autoSubmit: false,
  match() { return true; },
  resolveUrl(job) { return job.applyUrl || job.url; },
  async fill(page, ctx) {
    await dom.rejectCookies(page);
    const frame = await dom.bestFormFrame(page);
    return fillForm(frame, ctx, {
      exclude: ['header', 'nav', 'footer', '[role=search]', 'form[role=search]'],
    });
  },
  async submit() { return false; },
  async isConfirmation(page) { return dom.genericConfirmation(page); },
  fillForm,
  getAnswer,
  applyAnswer,
  fieldType,
};
