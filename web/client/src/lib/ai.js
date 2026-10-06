// AI helpers (Claude, bring-your-own Anthropic key). Calls go DIRECTLY from this device to
// api.anthropic.com; the key lives inside the encrypted `settings` record and never reaches our server.
import Anthropic from '@anthropic-ai/sdk';

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

async function call({ apiKey, model = DEFAULT_MODEL, system, prompt, maxTokens = 4000, effort = 'low', schema, signal }) {
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
    system: SYSTEM,
    effort: 'medium',
    maxTokens: 6000,
    schema: TAILOR_SCHEMA,
    prompt: `${candidateBrief(o.profile, o.resumeText)}\n\n${jobBrief(o.job)}\n\nAct as an ATS + senior recruiter. Score how well this resume matches the job (0-100), list important job keywords missing from the resume, write a tailored 3-sentence professional summary, rewrite up to 5 existing resume bullets to better target this job (keep them truthful, quantify where the resume already has numbers), and give 3-5 concrete tips.`,
  });
}

export async function testKey({ apiKey, model }) {
  await call({ apiKey, model: model || 'claude-haiku-4-5', prompt: 'Reply with OK.', maxTokens: 16, effort: 'low' });
  return true;
}
