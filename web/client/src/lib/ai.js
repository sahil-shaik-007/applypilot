// AI helpers (Claude, bring-your-own Anthropic key). Calls go DIRECTLY from this device to
// api.anthropic.com; the key lives inside the encrypted `settings` record and never reaches our server.
import Anthropic from '@anthropic-ai/sdk';
import { isTestMode } from './bridge.js';

export const MODELS = [
  { id: 'claude-opus-5-5', label: 'Claude Opus 5.5 (best quality)' },
  { id: 'claude-sonnet-5-5', label: 'Claude Sonnet 5.5 (fast, cheaper)' },
  { id: 'claude-haiku-4-5', label: 'Claude Haiku 4.5 (cheapest)' },
];
export const DEFAULT_MODEL = 'claude-opus-5-5';
// Models that support server-side refusal fallbacks ("default" routing), same as the desktop app.
const FALLBACK_MODELS = new Set(['claude-opus-5-5', 'claude-sonnet-5-5']);

let cached = { key: null, client: null };
function getClient(apiKey) {
  if (!apiKey) throw new Error('Add your Anthropic API key in AI studio to use AI features.');
  if (cached.key !== apiKey) cached = { key: apiKey, client: new Anthropic({ apiKey, dangerouslyAllowBrowser: true, maxRetries: 2 }) };
  return cached.client;
}
export function forgetClient() { cached = { key: null, client: null }; }

// e2e only: with the server in dev-login mode a test can install window.__AP_AI_STUB__(kind, args)
// to return fixture responses, so the suite never needs a real Anthropic key. Ignored otherwise.
function stubFor(kind, o) {
  const fn = isTestMode() && typeof window !== 'undefined' ? window.__AP_AI_STUB__ : null;
  return typeof fn === 'function' ? Promise.resolve(fn(kind, o)) : null;
}

async function call({ apiKey, model = DEFAULT_MODEL, system, prompt, maxTokens = 4000, effort = 'low', schema, signal, kind = 'text' }) {
  if (!apiKey) throw new Error('Add your Anthropic API key in AI studio to use AI features.');
  const stubbed = stubFor(kind, { prompt, schema });
  if (stubbed) return stubbed;
  const c = getClient(apiKey);
  const params = { model, max_tokens: maxTokens, messages: [{ role: 'user', content: prompt }] };
  if (system) params.system = system;
  const outputConfig = {};
  if (model !== 'claude-haiku-4-5') outputConfig.effort = effort;
  if (schema) outputConfig.format = { type: 'json_schema', schema };
  if (Object.keys(outputConfig).length) params.output_config = outputConfig;
  const res = FALLBACK_MODELS.has(model)
    ? await c.beta.messages.create({ ...params, betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' }, { signal })
    : await c.messages.create(params, { signal });
  if (res.stop_reason === 'refusal') throw new Error('The AI declined this request.');
  if (res.stop_reason === 'max_tokens' && schema) throw new Error('The AI response was cut off. Try again.');
  const text = res.content.filter((b) => b.type === 'text').map((b) => b.text).join('').trim();
  if (schema) { try { return JSON.parse(text); } catch { throw new Error('AI returned malformed JSON. Try again.'); } }
  return text;
}

export function aiError(e) {
  if (e instanceof Anthropic.AuthenticationError) return 'Invalid Anthropic API key. Check it in AI studio.';
  if (e instanceof Anthropic.PermissionDeniedError) return 'This API key is not allowed to use that model.';
  if (e instanceof Anthropic.NotFoundError) return 'That model is not available for this API key. Pick another model in AI studio.';
  if (e instanceof Anthropic.RateLimitError) return 'AI rate limit reached. Try again in a minute.';
  if (e instanceof Anthropic.BadRequestError) return `AI request rejected: ${e.message}`;
  if (e instanceof Anthropic.APIConnectionError) return 'Could not reach Anthropic. Check your connection.';
  if (e instanceof Anthropic.APIError) return `AI error ${e.status || ''}: ${e.message}`;
  return (e && e.message) || String(e);
}

export function candidateBrief(p = {}, resumeText = '') {
  const name = [p.firstName, p.lastName].filter(Boolean).join(' ');
  return [
    `Name: ${name || 'n/a'}`,
    p.headline && `Headline: ${p.headline}`,
    p.currentTitle && `Current: ${p.currentTitle}${p.currentCompany ? ` at ${p.currentCompany}` : ''}`,
    p.totalYearsExperience && `Total experience: ${p.totalYearsExperience} years`,
    p.skills && p.skills.length && `Skills: ${p.skills.join(', ')}`,
    p.city && `Location: ${[p.city, p.country].filter(Boolean).join(', ')}`,
    p.summary && `Summary: ${p.summary}`,
    resumeText && `\n<resume>\n${resumeText.slice(0, 15000)}\n</resume>`,
  ].filter(Boolean).join('\n');
}
function jobBrief(job = {}) {
  return `<job>\nTitle: ${job.title}\nCompany: ${job.company}\nLocation: ${job.location || ''}${job.remote ? ' (remote)' : ''}\n\n${(job.description || '').slice(0, 12000)}\n</job>`;
}
const SYSTEM = "You help a job seeker apply to jobs. Write in the candidate's voice: specific, honest, concise, no clichés, no invented facts. Never claim skills or experience that are not in the candidate information.";

export function coverLetter(o) {
  return call({
    ...o,
    kind: 'coverLetter',
    system: SYSTEM,
    effort: 'medium',
    prompt: `${candidateBrief(o.profile, o.resumeText)}\n\n${jobBrief(o.job)}\n\nWrite a ${o.tone || 'confident, warm'} cover letter (180-260 words) for this job. Open with a specific hook about the company or role, connect 2-3 concrete achievements from the resume to the job's needs, and close with a short call to action. Plain text only, no placeholders, no address block. Sign with the candidate's name.`,
  });
}

export const TAILOR_SCHEMA = {
  type: 'object',
  properties: {
    atsScore: { type: 'integer' },
    verdict: { type: 'string' },
    missingKeywords: { type: 'array', items: { type: 'string' } },
    tailoredSummary: { type: 'string' },
    bulletRewrites: { type: 'array', items: { type: 'object', properties: { original: { type: 'string' }, improved: { type: 'string' } }, required: ['original', 'improved'], additionalProperties: false } },
    tips: { type: 'array', items: { type: 'string' } },
  },
  required: ['atsScore', 'verdict', 'missingKeywords', 'tailoredSummary', 'bulletRewrites', 'tips'],
  additionalProperties: false,
};

export function tailorResume(o) {
  return call({
    ...o,
    kind: 'tailorResume',
    system: SYSTEM,
    effort: 'medium',
    maxTokens: 6000,
    schema: TAILOR_SCHEMA,
    prompt: `${candidateBrief(o.profile, o.resumeText)}\n\n${jobBrief(o.job)}\n\nAct as an ATS + senior recruiter. Score how well this resume matches the job (0-100), list important job keywords missing from the resume, write a tailored 3-sentence professional summary, rewrite up to 5 existing resume bullets to better target this job (keep them truthful, quantify where the resume already has numbers), and give 3-5 concrete tips.`,
  });
}

export async function testKey({ apiKey, model }) {
  await call({ apiKey, model: model || 'claude-haiku-4-5', prompt: 'Reply with OK.', maxTokens: 16, effort: 'low', kind: 'testKey' });
  return true;
}

// A complete, truthful resume rewritten for one job (same schema/prompt as electron/ai.js
// tailoredResumeDoc). The app verifies it with web/shared/tailoredResume.js and renders a PDF.
export const RESUME_DOC_SCHEMA = {
  type: 'object',
  properties: {
    name: { type: 'string' },
    headline: { type: 'string' },
    contact: { type: 'array', items: { type: 'string' } },
    summary: { type: 'string' },
    skills: { type: 'array', items: { type: 'string' } },
    experience: {
      type: 'array',
      items: {
        type: 'object',
        properties: { title: { type: 'string' }, company: { type: 'string' }, location: { type: 'string' }, dates: { type: 'string' }, bullets: { type: 'array', items: { type: 'string' } } },
        required: ['title', 'company', 'location', 'dates', 'bullets'],
        additionalProperties: false,
      },
    },
    projects: {
      type: 'array',
      items: { type: 'object', properties: { name: { type: 'string' }, details: { type: 'string' } }, required: ['name', 'details'], additionalProperties: false },
    },
    education: {
      type: 'array',
      items: { type: 'object', properties: { school: { type: 'string' }, degree: { type: 'string' }, dates: { type: 'string' }, details: { type: 'string' } }, required: ['school', 'degree', 'dates', 'details'], additionalProperties: false },
    },
    certifications: { type: 'array', items: { type: 'string' } },
    changes: { type: 'array', items: { type: 'string' } },
  },
  required: ['name', 'headline', 'contact', 'summary', 'skills', 'experience', 'projects', 'education', 'certifications', 'changes'],
  additionalProperties: false,
};

export function tailoredResumeDoc(o) {
  return call({
    ...o,
    kind: 'tailoredResumeDoc',
    effort: 'medium',
    maxTokens: 12000,
    schema: RESUME_DOC_SCHEMA,
    system: `${SYSTEM} You are an expert resume writer. HARD RULES: use ONLY facts present in the candidate's resume and profile. Never add employers, titles, dates, degrees, certifications, tools, skills, numbers or achievements that are not already there. You MAY reorder sections and bullets, rephrase for clarity and impact, mirror the job's terminology where it truthfully describes existing experience, and drop irrelevant details. Keep dates exactly as written.`,
    prompt: `${candidateBrief(o.profile, o.resumeText)}\n\n${jobBrief(o.job)}\n\nProduce a one-to-two page resume tailored to this job. Put the most relevant skills first (only skills the candidate already has), lead each role with the bullets most relevant to the job, keep 3-6 bullets per recent role, and write a 2-3 sentence summary aimed at this role. In "changes", list 3-6 short notes describing what you emphasised or reordered (not invented).`,
  });
}

/** Follow-up email, referral request or recruiter message (electron/ai.js outreach). */
export function outreach(o) {
  return call({
    ...o,
    kind: `outreach:${o.kind || 'recruiter'}`,
    system: SYSTEM,
    effort: 'low',
    maxTokens: 1500,
    prompt: o.kind === 'followup'
      ? `${candidateBrief(o.profile, o.resumeText)}\n\n${jobBrief(o.job)}\n\nThe candidate applied ${o.days || 7} days ago and has not heard back. Write a short, polite follow-up email to the recruiter/hiring team (subject line + max 110 words): restate interest, one specific reason they fit, and a clear ask for next steps. Plain text, starting with 'Subject:'.`
      : `${candidateBrief(o.profile, o.resumeText)}\n\n${jobBrief(o.job)}\n\nWrite a short ${o.kind === 'referral' ? `LinkedIn message asking ${o.contactName ? `${o.contactName} (an employee)` : 'an employee'} for a referral` : 'LinkedIn message / email to the hiring manager or recruiter'} for this role (max 90 words, friendly, specific, one clear ask). Plain text.`,
  });
}

export function interviewPrep(o) {
  return call({
    ...o,
    kind: 'interviewPrep',
    system: SYSTEM,
    effort: 'medium',
    maxTokens: 6000,
    prompt: `${candidateBrief(o.profile, o.resumeText)}\n\n${jobBrief(o.job)}\n\nPrepare the candidate for interviews for this job. Output Markdown with: 1) What this company/team likely cares about (3 bullets), 2) 8 likely interview questions (mix of technical and behavioural) each with a 2-3 sentence suggested answer grounded in the candidate's real experience, 3) 3 smart questions to ask the interviewer, 4) Red flags or gaps to prepare for.`,
  });
}

/** Answers one application-form question truthfully, or returns null when unsure (electron/ai.js). */
export async function answerQuestion(o) {
  const opts = o.options && o.options.length ? `\nAllowed options (answer with exactly one of these strings${o.type === 'checkbox' ? ', or several separated by " || "' : ''}):\n${o.options.map((x) => `- ${x}`).join('\n')}` : '';
  const out = await call({
    ...o,
    kind: 'answerQuestion',
    system: `${SYSTEM} You fill in job application form questions. If the candidate information does not contain enough to answer truthfully, set confident=false.`,
    schema: { type: 'object', properties: { answer: { type: 'string' }, confident: { type: 'boolean' } }, required: ['answer', 'confident'], additionalProperties: false },
    maxTokens: 1500,
    prompt: `${candidateBrief(o.profile, o.resumeText)}\n\n${jobBrief(o.job)}\n\nApplication form question (${o.type || 'text'}): "${o.question}"${opts}\n\nAnswer as the candidate. For free-text questions keep it under ${o.type === 'textarea' ? '120' : '25'} words. For numeric questions answer with a number only.`,
  });
  if (!out || !out.confident || !out.answer) return null;
  if (o.type === 'checkbox') return out.answer.split('||').map((s) => s.trim()).filter(Boolean);
  return out.answer;
}
