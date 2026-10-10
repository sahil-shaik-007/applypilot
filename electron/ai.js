// AI helpers powered by Claude (bring-your-own Anthropic API key, stored locally).
const Anthropic = require('@anthropic-ai/sdk');

const MODELS = [
  { id: 'claude-opus-5-5', label: 'Claude Opus 5.5 (best quality)' },
  { id: 'claude-sonnet-5-5', label: 'Claude Sonnet 5.5 (fast, cheaper)' },
  { id: 'claude-haiku-4-5', label: 'Claude Haiku 4.5 (cheapest)' },
];
// Models that support server-side refusal fallbacks ("default" routing).
const FALLBACK_MODELS = new Set(['claude-opus-5-5', 'claude-sonnet-5-5']);

let client = null;
let clientKey = null;
function getClient(apiKey) {
  if (!apiKey) throw new Error('Add your Anthropic API key in Settings → AI to use AI features.');
  if (!client || clientKey !== apiKey) { client = new Anthropic({ apiKey, maxRetries: 3 }); clientKey = apiKey; }
  return client;
}

// ---- Local models: any OpenAI-compatible server on the PC or LAN (Ollama, LM Studio, llama.cpp, vLLM).
// The candidate's data only goes to the base URL the user typed in Settings.
const LOCAL_DEFAULT_URL = 'http://localhost:11434/v1';
function localBase(url) {
  let u;
  try { u = new URL(String(url || LOCAL_DEFAULT_URL).trim()); } catch { throw new Error('The local AI address must start with http:// or https://, e.g. http://localhost:11434/v1'); }
  if (!/^https?:$/.test(u.protocol)) throw new Error('The local AI address must start with http:// or https://.');
  return u.href.replace(/\/+$/, '');
}
// Models often wrap JSON in prose or code fences; take the outermost object.
function extractJson(text) {
  const t = String(text || '').trim();
  try { return JSON.parse(t); } catch { /* fall through */ }
  const m = t.match(/\{[\s\S]*\}/);
  if (m) { try { return JSON.parse(m[0]); } catch { /* fall through */ } }
  throw new Error('The local model did not return the expected JSON. Try a larger or instruction-tuned model.');
}
async function localChat({ baseUrl, model, system, prompt, maxTokens = 4000, schema }) {
  if (!model) throw new Error('Choose a local model name in Settings → AI first (run `ollama list` to see yours).');
  const url = `${localBase(baseUrl)}/chat/completions`;
  const messages = [
    { role: 'system', content: `${system || SYSTEM}${schema ? `
Respond with only a JSON object matching this JSON Schema, no prose:
${JSON.stringify(schema)}` : ''}` },
    { role: 'user', content: prompt },
  ];
  const post = async (body) => {
    const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(240000) });
    if (!res.ok) { const err = new Error(`Local AI returned HTTP ${res.status}`); err.status = res.status; throw err; }
    return res.json();
  };
  const base = { model, messages, max_tokens: maxTokens, temperature: 0.2, stream: false };
  let data;
  try {
    data = await post(schema ? { ...base, response_format: { type: 'json_object' } } : base);
  } catch (e) {
    if (e.status && e.status !== 400) throw new Error(`${e.message}. Is the local AI server running at ${localBase(baseUrl)}?`);
    if (e.status === 400 && schema) data = await post(base); else if (e.status) throw e; else throw new Error(`Can't reach the local AI at ${localBase(baseUrl)}. Start Ollama or LM Studio and try again.`);
  }
  const text = (data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content) || '';
  if (!text.trim()) throw new Error('The local model returned an empty answer.');
  return schema ? extractJson(text) : text.trim();
}
async function localModels(baseUrl) {
  const res = await fetch(`${localBase(baseUrl)}/models`, { signal: AbortSignal.timeout(8000) }).catch(() => null);
  if (!res || !res.ok) throw new Error(`Can't reach the local AI at ${localBase(baseUrl)}. Start Ollama or LM Studio, then try again.`);
  const data = await res.json();
  return (data.data || []).map((m) => m.id).filter(Boolean);
}

async function call({ apiKey, model, system, prompt, maxTokens = 4000, effort = 'low', schema, provider, localBaseUrl, localModel }) {
  if (provider === 'local') return localChat({ baseUrl: localBaseUrl, model: localModel, system: system || SYSTEM, prompt, maxTokens, schema });
  const c = getClient(apiKey);
  const params = {
    model,
    max_tokens: maxTokens,
    system,
    messages: [{ role: 'user', content: prompt }],
  };
  const outputConfig = {};
  if (model !== 'claude-haiku-4-5') outputConfig.effort = effort;
  if (schema) outputConfig.format = { type: 'json_schema', schema };
  if (Object.keys(outputConfig).length) params.output_config = outputConfig;

  let res;
  if (FALLBACK_MODELS.has(model)) {
    res = await c.beta.messages.create({ ...params, betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' });
  } else {
    res = await c.messages.create(params);
  }
  if (res.stop_reason === 'refusal') throw new Error('The AI declined this request.');
  const text = res.content.filter((b) => b.type === 'text').map((b) => b.text).join('').trim();
  if (schema) {
    try { return JSON.parse(text); } catch { throw new Error('AI returned malformed JSON.'); }
  }
  return text;
}

function errMessage(e) {
  if (e instanceof Anthropic.AuthenticationError) return 'Invalid Anthropic API key.';
  if (e instanceof Anthropic.RateLimitError) return 'AI rate limit reached — try again in a minute.';
  if (e instanceof Anthropic.APIError) return `AI error ${e.status || ''}: ${e.message}`;
  return e.message || String(e);
}

function candidateBrief(profile = {}, resumeText = '') {
  const p = profile;
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

const SYSTEM = 'You help a job seeker apply to jobs. Write in the candidate\'s voice: specific, honest, concise, no clichés, no invented facts. Never claim skills or experience that are not in the candidate information.';

async function coverLetter(o) {
  return call({
    ...o,
    system: SYSTEM,
    effort: 'medium',
    prompt: `${candidateBrief(o.profile, o.resumeText)}\n\n${jobBrief(o.job)}\n\nWrite a ${o.tone || 'confident, warm'} cover letter (180-260 words) for this job. Open with a specific hook about the company or role, connect 2-3 concrete achievements from the resume to the job's needs, and close with a short call to action. Plain text only, no placeholders, no address block. Sign with the candidate's name.`,
  });
}

async function answerQuestion(o) {
  const opts = o.options && o.options.length ? `\nAllowed options (answer with exactly one of these strings${o.type === 'checkbox' ? ', or several separated by " || "' : ''}):\n${o.options.map((x) => `- ${x}`).join('\n')}` : '';
  const out = await call({
    ...o,
    system: `${SYSTEM} You fill in job application form questions. If the candidate information does not contain enough to answer truthfully, set confident=false.`,
    schema: {
      type: 'object',
      properties: { answer: { type: 'string' }, confident: { type: 'boolean' } },
      required: ['answer', 'confident'],
      additionalProperties: false,
    },
    maxTokens: 1500,
    prompt: `${candidateBrief(o.profile, o.resumeText)}\n\n${jobBrief(o.job)}\n\nApplication form question (${o.type || 'text'}): "${o.question}"${opts}\n\nAnswer as the candidate. For free-text questions keep it under ${o.type === 'textarea' ? '120' : '25'} words. For numeric questions answer with a number only.`,
  });
  if (!out.confident || !out.answer) return null;
  if (o.type === 'checkbox') return out.answer.split('||').map((s) => s.trim()).filter(Boolean);
  return out.answer;
}

// A complete, truthful resume rewritten for one job. Returned as structured data; the app renders
// it to an ATS-friendly PDF and verifies that no new skills were introduced.
const RESUME_DOC_SCHEMA = {
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

async function tailoredResumeDoc(o) {
  return call({
    ...o,
    effort: 'medium',
    maxTokens: 12000,
    schema: RESUME_DOC_SCHEMA,
    system: `${SYSTEM} You are an expert resume writer. HARD RULES: use ONLY facts present in the candidate's resume and profile. Never add employers, titles, dates, degrees, certifications, tools, skills, numbers or achievements that are not already there. You MAY reorder sections and bullets, rephrase for clarity and impact, mirror the job's terminology where it truthfully describes existing experience, and drop irrelevant details. Keep dates exactly as written.`,
    prompt: `${candidateBrief(o.profile, o.resumeText)}\n\n${jobBrief(o.job)}\n\nProduce a one-to-two page resume tailored to this job. Put the most relevant skills first (only skills the candidate already has), lead each role with the bullets most relevant to the job, keep 3-6 bullets per recent role, and write a 2-3 sentence summary aimed at this role. In "changes", list 3-6 short notes describing what you emphasised or reordered (not invented).`,
  });
}

async function tailorResume(o) {
  return call({
    ...o,
    system: SYSTEM,
    effort: 'medium',
    maxTokens: 6000,
    schema: {
      type: 'object',
      properties: {
        atsScore: { type: 'integer' },
        verdict: { type: 'string' },
        missingKeywords: { type: 'array', items: { type: 'string' } },
        tailoredSummary: { type: 'string' },
        bulletRewrites: {
          type: 'array',
          items: {
            type: 'object',
            properties: { original: { type: 'string' }, improved: { type: 'string' } },
            required: ['original', 'improved'],
            additionalProperties: false,
          },
        },
        tips: { type: 'array', items: { type: 'string' } },
      },
      required: ['atsScore', 'verdict', 'missingKeywords', 'tailoredSummary', 'bulletRewrites', 'tips'],
      additionalProperties: false,
    },
    prompt: `${candidateBrief(o.profile, o.resumeText)}\n\n${jobBrief(o.job)}\n\nAct as an ATS + senior recruiter. Score how well this resume matches the job (0-100), list important job keywords missing from the resume, write a tailored 3-sentence professional summary, rewrite up to 5 existing resume bullets to better target this job (keep them truthful, quantify where the resume already has numbers), and give 3-5 concrete tips.`,
  });
}

async function parseResume(o) {
  return call({
    ...o,
    effort: 'low',
    maxTokens: 8000,
    system: 'You extract structured data from resumes. Use empty strings/arrays when unknown. Dates as YYYY-MM.',
    schema: {
      type: 'object',
      properties: {
        firstName: { type: 'string' }, lastName: { type: 'string' }, email: { type: 'string' }, phone: { type: 'string' },
        city: { type: 'string' }, country: { type: 'string' }, linkedin: { type: 'string' }, github: { type: 'string' }, portfolio: { type: 'string' },
        headline: { type: 'string' }, currentTitle: { type: 'string' }, currentCompany: { type: 'string' },
        totalYearsExperience: { type: 'number' }, summary: { type: 'string' },
        skills: { type: 'array', items: { type: 'string' } },
        workHistory: { type: 'array', items: { type: 'object', properties: { company: { type: 'string' }, title: { type: 'string' }, location: { type: 'string' }, startDate: { type: 'string' }, endDate: { type: 'string' }, current: { type: 'boolean' }, description: { type: 'string' } }, required: ['company', 'title', 'location', 'startDate', 'endDate', 'current', 'description'], additionalProperties: false } },
        education: { type: 'array', items: { type: 'object', properties: { school: { type: 'string' }, degree: { type: 'string' }, field: { type: 'string' }, startDate: { type: 'string' }, endDate: { type: 'string' }, gpa: { type: 'string' } }, required: ['school', 'degree', 'field', 'startDate', 'endDate', 'gpa'], additionalProperties: false } },
        certifications: { type: 'array', items: { type: 'object', properties: { name: { type: 'string' }, issuer: { type: 'string' }, date: { type: 'string' }, url: { type: 'string' } }, required: ['name', 'issuer', 'date', 'url'], additionalProperties: false } },
        projects: { type: 'array', items: { type: 'object', properties: { name: { type: 'string' }, url: { type: 'string' }, description: { type: 'string' } }, required: ['name', 'url', 'description'], additionalProperties: false } },
        languages: { type: 'array', items: { type: 'string' } },
      },
      required: ['firstName', 'lastName', 'email', 'phone', 'city', 'country', 'linkedin', 'github', 'portfolio', 'headline', 'currentTitle', 'currentCompany', 'totalYearsExperience', 'summary', 'skills', 'workHistory', 'education', 'certifications', 'projects', 'languages'],
      additionalProperties: false,
    },
    prompt: `Extract the candidate profile from this resume. For education.degree use one of: High School, Diploma, Associate, Bachelor's, Master's, MBA, PhD, Other.\n\n<resume>\n${(o.resumeText || '').slice(0, 30000)}\n</resume>`,
  });
}

async function interviewPrep(o) {
  return call({
    ...o,
    system: SYSTEM,
    effort: 'medium',
    maxTokens: 6000,
    prompt: `${candidateBrief(o.profile, o.resumeText)}\n\n${jobBrief(o.job)}\n\nPrepare the candidate for interviews for this job. Output Markdown with: 1) What this company/team likely cares about (3 bullets), 2) 8 likely interview questions (mix of technical and behavioural) each with a 2-3 sentence suggested answer grounded in the candidate's real experience, 3) 3 smart questions to ask the interviewer, 4) Red flags or gaps to prepare for.`,
  });
}

async function outreach(o) {
  return call({
    ...o,
    system: SYSTEM,
    effort: 'low',
    maxTokens: 1500,
    prompt: o.kind === 'followup'
      ? `${candidateBrief(o.profile, o.resumeText)}\n\n${jobBrief(o.job)}\n\nThe candidate applied ${o.days || 7} days ago and has not heard back. Write a short, polite follow-up email to the recruiter/hiring team (subject line + max 110 words): restate interest, one specific reason they fit, and a clear ask for next steps. Plain text, starting with 'Subject:'.`
      : `${candidateBrief(o.profile, o.resumeText)}\n\n${jobBrief(o.job)}\n\nWrite a short ${o.kind === 'referral' ? 'LinkedIn message asking an employee for a referral' : 'LinkedIn message / email to the hiring manager or recruiter'} for this role (max 90 words, friendly, specific, one clear ask). Plain text.`,
  });
}

async function testKey({ apiKey, model }) {
  await call({ apiKey, model: model || 'claude-haiku-4-5', prompt: 'Reply with OK.', maxTokens: 20 });
  return true;
}

// Plain-English request -> a plan the app can check against real job boards. The model only proposes
// company names, role words and filters; every job it leads to must come from a live source.
const PLAN_SCHEMA = {
  type: 'object',
  properties: {
    companies: { type: 'array', items: { type: 'object', properties: { name: { type: 'string' }, careersUrl: { type: 'string' } }, required: ['name', 'careersUrl'], additionalProperties: false } },
    roles: { type: 'array', items: { type: 'string' } },
    requireVisaSponsorship: { type: 'boolean' },
    countries: { type: 'array', items: { type: 'string' } },
    note: { type: 'string' },
  },
  required: ['companies', 'roles', 'requireVisaSponsorship', 'countries', 'note'],
  additionalProperties: false,
};
async function planDiscovery(o) {
  return call({
    ...o,
    system: "You turn a job seeker's request into a search plan. You never invent job openings. Company careers URLs are only suggestions; leave careersUrl empty when you are not sure of the exact page.",
    schema: PLAN_SCHEMA,
    effort: 'low',
    maxTokens: 1500,
    prompt: `Request: "${String(o.prompt || '').slice(0, 1000)}"

Extract: the companies named (or implied), the job titles or role words, whether visa sponsorship is required, and any countries. Use short role words (e.g. "data analyst"). Put each company's public careers page URL only if you are confident of it.`,
  });
}

module.exports = { MODELS, coverLetter, answerQuestion, tailorResume, tailoredResumeDoc, parseResume, interviewPrep, outreach, testKey, errMessage, localModels, planDiscovery, LOCAL_DEFAULT_URL };
