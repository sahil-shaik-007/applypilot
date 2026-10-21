// Explainable match scoring between a job and a candidate (resume text + profile + campaign).
// Score 0-100 built from: title fit, skill overlap, experience fit, location/work-mode fit, freshness.

const SKILLS = [
  // languages
  'python', 'java', 'javascript', 'typescript', 'c++', 'c#', 'go', 'golang', 'rust', 'ruby', 'php', 'kotlin', 'swift', 'scala', 'r', 'matlab', 'perl', 'dart', 'elixir', 'haskell', 'lua', 'objective-c', 'sql', 'pl/sql', 'bash', 'powershell', 'solidity',
  // web/frontend
  'react', 'react native', 'next.js', 'nextjs', 'vue', 'nuxt', 'angular', 'svelte', 'redux', 'html', 'css', 'sass', 'tailwind', 'webpack', 'vite', 'jquery', 'graphql', 'rest', 'grpc', 'websockets', 'flutter', 'electron',
  // backend
  'node.js', 'nodejs', 'express', 'nestjs', 'django', 'flask', 'fastapi', 'spring', 'spring boot', 'rails', 'laravel', '.net', 'asp.net', 'microservices', 'kafka', 'rabbitmq', 'redis', 'elasticsearch', 'celery',
  // data
  'postgresql', 'postgres', 'mysql', 'mongodb', 'cassandra', 'dynamodb', 'snowflake', 'bigquery', 'redshift', 'databricks', 'spark', 'pyspark', 'hadoop', 'airflow', 'dbt', 'etl', 'kafka streams', 'flink', 'tableau', 'power bi', 'looker', 'excel', 'pandas', 'numpy', 'data modeling', 'data warehousing', 'statistics', 'a/b testing',
  // ml/ai
  'machine learning', 'deep learning', 'nlp', 'computer vision', 'pytorch', 'tensorflow', 'keras', 'scikit-learn', 'llm', 'llms', 'generative ai', 'rag', 'langchain', 'mlops', 'hugging face', 'transformers', 'reinforcement learning', 'prompt engineering', 'xgboost',
  // cloud/devops
  'aws', 'azure', 'gcp', 'google cloud', 'docker', 'kubernetes', 'terraform', 'ansible', 'jenkins', 'github actions', 'ci/cd', 'linux', 'helm', 'prometheus', 'grafana', 'datadog', 'serverless', 'lambda', 'ec2', 's3', 'cloudformation', 'sre', 'devops', 'networking', 'security', 'iam',
  // mobile
  'android', 'ios', 'swiftui', 'jetpack compose',
  // testing
  'selenium', 'cypress', 'playwright', 'jest', 'pytest', 'junit', 'qa', 'test automation', 'manual testing', 'appium',
  // product/design/biz
  'figma', 'sketch', 'adobe xd', 'photoshop', 'illustrator', 'ux', 'ui', 'user research', 'prototyping', 'product management', 'roadmap', 'agile', 'scrum', 'jira', 'confluence', 'kanban', 'stakeholder management', 'seo', 'sem', 'google analytics', 'salesforce', 'hubspot', 'crm', 'sap', 'erp', 'oracle', 'financial modeling', 'accounting', 'tally', 'gst', 'quickbooks', 'copywriting', 'content marketing', 'social media', 'email marketing', 'b2b', 'saas', 'sales', 'customer success', 'recruiting', 'operations', 'supply chain', 'project management', 'pmp', 'six sigma', 'communication', 'leadership',
  // misc eng
  'system design', 'distributed systems', 'data structures', 'algorithms', 'oop', 'design patterns', 'blockchain', 'web3', 'embedded', 'iot', 'fpga', 'verilog', 'unity', 'unreal', 'opencv', 'cybersecurity', 'penetration testing', 'soc', 'siem',
  // office & analysis (every domain)
  'ms office', 'microsoft office', 'powerpoint', 'ms word', 'google sheets', 'vlookup', 'pivot tables', 'data analysis', 'data visualization', 'data entry', 'reporting', 'mis', 'documentation', 'research',
  // finance & accounting
  'financial analysis', 'financial reporting', 'budgeting', 'forecasting', 'accounts payable', 'accounts receivable', 'bookkeeping', 'auditing', 'internal audit', 'taxation', 'income tax', 'tds', 'ifrs', 'gaap', 'reconciliation', 'bank reconciliation', 'payroll', 'invoicing', 'cost accounting', 'treasury', 'credit analysis', 'risk management', 'compliance', 'kyc', 'aml', 'zoho books', 'sap fico', 'tally erp', 'valuation', 'equity research', 'investment banking',
  // HR
  'recruitment', 'talent acquisition', 'sourcing', 'onboarding', 'employee relations', 'performance management', 'hris', 'compensation', 'benefits', 'labour law', 'training and development', 'hr operations',
  // sales, marketing, support
  'lead generation', 'business development', 'negotiation', 'account management', 'key account management', 'cold calling', 'inside sales', 'b2c', 'channel sales', 'digital marketing', 'google ads', 'facebook ads', 'meta ads', 'performance marketing', 'marketing automation', 'content writing', 'market research', 'brand management', 'public relations', 'event management', 'customer service', 'customer support', 'call center', 'zendesk', 'freshdesk', 'client relationship',
  // operations & supply chain
  'inventory management', 'logistics', 'procurement', 'purchasing', 'vendor management', 'warehouse management', 'process improvement', 'lean', 'kaizen', 'quality control', 'quality assurance', 'iso 9001', 'production planning', 'erp', 'sap mm', 'sap sd', 'demand planning',
  // mechanical / civil / electrical engineering
  'autocad', 'solidworks', 'catia', 'creo', 'ansys', 'revit', 'staad pro', 'etabs', 'primavera', 'ms project', 'plc', 'scada', 'hvac', 'cnc', 'gd&t', 'mechanical design', 'product design', 'manufacturing', 'maintenance', 'site supervision', 'estimation', 'quantity surveying', 'electrical design', 'matlab simulink', 'pcb design', 'labview',
  // healthcare, pharma, education
  'patient care', 'clinical research', 'pharmacovigilance', 'regulatory affairs', 'nursing', 'emr', 'medical coding', 'gmp', 'lab techniques', 'teaching', 'curriculum development', 'lesson planning', 'tutoring',
];

const ALIASES = { golang: 'go', nodejs: 'node.js', nextjs: 'next.js', postgres: 'postgresql', 'google cloud': 'gcp', llms: 'llm', 'microsoft office': 'ms office', 'tally erp': 'tally', purchasing: 'procurement', 'customer support': 'customer service', 'talent acquisition': 'recruitment', 'meta ads': 'facebook ads' };
const canon = (s) => ALIASES[s] || s;

const DISPLAY = {
  'node.js': 'Node.js', 'next.js': 'Next.js', typescript: 'TypeScript', javascript: 'JavaScript', postgresql: 'PostgreSQL', mongodb: 'MongoDB', mysql: 'MySQL',
  graphql: 'GraphQL', 'github actions': 'GitHub Actions', 'ci/cd': 'CI/CD', pytorch: 'PyTorch', tensorflow: 'TensorFlow', 'scikit-learn': 'scikit-learn', fastapi: 'FastAPI',
  nestjs: 'NestJS', dynamodb: 'DynamoDB', bigquery: 'BigQuery', 'power bi': 'Power BI', ios: 'iOS', swiftui: 'SwiftUI', 'a/b testing': 'A/B testing', 'c++': 'C++', 'c#': 'C#',
  '.net': '.NET', 'asp.net': 'ASP.NET', 'objective-c': 'Objective-C', 'pl/sql': 'PL/SQL', pyspark: 'PySpark', 'hugging face': 'Hugging Face', langchain: 'LangChain', xgboost: 'XGBoost',
  opencv: 'OpenCV', 'ms office': 'MS Office', 'ms word': 'MS Word', 'powerpoint': 'PowerPoint', vlookup: 'VLOOKUP', 'autocad': 'AutoCAD', solidworks: 'SolidWorks', catia: 'CATIA', ansys: 'ANSYS', 'staad pro': 'STAAD Pro', etabs: 'ETABS', 'ms project': 'MS Project', 'gd&t': 'GD&T', 'iso 9001': 'ISO 9001', 'sap fico': 'SAP FICO', 'sap mm': 'SAP MM', 'sap sd': 'SAP SD', labview: 'LabVIEW', 'pcb design': 'PCB design', 'matlab simulink': 'MATLAB Simulink', 'zoho books': 'Zoho Books', 'google ads': 'Google Ads', 'facebook ads': 'Facebook Ads', jquery: 'jQuery', 'spring boot': 'Spring Boot', 'react native': 'React Native', 'jetpack compose': 'Jetpack Compose', 'adobe xd': 'Adobe XD', hubspot: 'HubSpot',
  quickbooks: 'QuickBooks', 'google analytics': 'Google Analytics', 'generative ai': 'Generative AI', mlops: 'MLOps', devops: 'DevOps', saas: 'SaaS', b2b: 'B2B', rabbitmq: 'RabbitMQ',
  elasticsearch: 'Elasticsearch', github: 'GitHub', 'web3': 'Web3', iam: 'IAM', ec2: 'EC2', s3: 'S3', llm: 'LLM', 'power bi ': 'Power BI',
};
const UPPER = new Set(['mis', 'tds', 'ifrs', 'gaap', 'kyc', 'aml', 'hris', 'b2c', 'erp', 'plc', 'scada', 'hvac', 'cnc', 'emr', 'gmp', 'aws', 'gcp', 'sql', 'css', 'html', 'php', 'rest', 'grpc', 'etl', 'nlp', 'rag', 'llm', 'ux', 'ui', 'seo', 'sem', 'crm', 'sap', 'erp', 'gst', 'iot', 'sre', 'siem', 'soc', 'qa', 'pmp', 'oop', 'dbt', 'r', 'fpga']);
function displaySkill(s) {
  if (DISPLAY[s]) return DISPLAY[s];
  if (UPPER.has(s)) return s.toUpperCase();
  return s.replace(/\b[a-z]/g, (c) => c.toUpperCase());
}

function escapeRe(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
const skillRegex = new Map(SKILLS.map((s) => [s, new RegExp(`(^|[^a-z0-9+#])${escapeRe(s)}($|[^a-z0-9+#])`, 'i')]));

function extractSkills(text) {
  if (!text) return [];
  const found = new Set();
  for (const [s, re] of skillRegex) if (re.test(text)) found.add(canon(s));
  // 'r' and 'go' are noisy as single tokens; require stronger context.
  if (found.has('r') && !/\b(r programming|rstudio|in r\b|r,|, r\b|tidyverse|ggplot)/i.test(text)) found.delete('r');
  if (found.has('go') && !/\b(golang|go \(|go,|, go\b|go developer|go engineer|in go\b)/i.test(text)) found.delete('go');
  return [...found];
}

const STOP = new Set('a an the and or of to in for with on at by from as is are be will you we our your this that it its their they have has who what which role team work job using use experience years strong ability skills plus including etc about across into within new'.split(' '));
function words(s) { return (s || '').toLowerCase().split(/[^a-z0-9+#.]+/).filter((w) => w.length > 1 && !STOP.has(w)); }

function titleFit(jobTitle, targets) {
  const jt = new Set(words(jobTitle));
  let best = 0;
  for (const t of targets || []) {
    const tw = words(t);
    if (!tw.length) continue;
    const hit = tw.filter((w) => jt.has(w)).length / tw.length;
    best = Math.max(best, hit);
  }
  return best; // 0..1
}

function yearsRequired(desc) {
  const m = (desc || '').match(/(\d{1,2})\s*\+?\s*(?:-|to|–)?\s*(\d{1,2})?\s*\+?\s*years?/i);
  if (!m) return null;
  const n = parseInt(m[1], 10);
  return n > 0 && n < 30 ? n : null;
}

const SENIOR = /\b(senior|sr\.?|staff|principal|lead|head|director|vp|architect)\b/i;
const JUNIOR = /\b(intern|internship|junior|jr\.?|graduate|fresher|entry[- ]level|trainee|associate)\b/i;

const { eligibility } = require('./eligibility');

const SOFT = new Set(['communication', 'leadership', 'stakeholder management', 'operations', 'research', 'documentation', 'reporting']);

function ghostSignals(job) {
  const flags = [];
  if (job.postedAt) {
    const days = (Date.now() - new Date(job.postedAt).getTime()) / 86400000;
    if (days > 60) flags.push(`Posted ${Math.round(days)} days ago — may be stale`);
  }
  if ((job.description || '').length < 300) flags.push('Very short description');
  if (/commission only|unpaid|pay to|registration fee|training fee|deposit/i.test(job.description || '')) flags.push('Possible scam / unpaid wording');
  return flags;
}

/**
 * @returns {score, breakdown: {...}, matchedSkills, missingSkills, reasons, flags}
 */

// Visa sponsorship signal from the job text: 'offered' | 'not-offered' | null (unknown).
const SPONSOR_NO = /\b(no|not|unable to|cannot|can't|can ?not|will not|won't|do not|does not|don't|doesn't|are not able to)\s+(currently\s+)?(be\s+)?(able to\s+)?(provide|offer|support|sponsor)(ing)?\s+(any\s+)?(visa|h-?1b|work (permit|authori[sz]ation)|sponsorship|immigration)|\bsponsorship\s+(is\s+)?(not|unavailable)|\bwithout\s+(the\s+need\s+for\s+)?(current\s+or\s+future\s+)?(visa\s+)?sponsorship|\bno\s+(visa\s+)?sponsorship\b|\bnot\s+eligible\s+for\s+(visa\s+)?sponsorship/i;
const SPONSOR_YES = /\b(visa|h-?1b|work permit|immigration|relocation and visa)\s+(sponsorship|support|assistance)\s+(is\s+)?(available|provided|offered|possible|included)|\bwe\s+(can|will|do|are able to)\s+sponsor\b|\bsponsorship\s+(is\s+)?(available|provided|offered|possible)|\bopen to sponsor(ing)?\b|\b(offer|offers|provide|provides|include|includes)\s+(full\s+)?(relocation\s+(and|&)\s+)?(visa|immigration)\s+(support|sponsorship|assistance)|\bvisa sponsorship\b(?![^.]{0,40}\b(not|no|unable|cannot)\b)/i;
function sponsorshipSignal(job) {
  const t = `${job.title || ''}\n${job.description || ''}`;
  if (SPONSOR_NO.test(t)) return 'not-offered';
  if (SPONSOR_YES.test(t)) return 'offered';
  return null;
}
const needsVisa = (profile) => String(profile.needsSponsorship || '').toLowerCase() === 'yes';

function scoreJob(job, { resumeText = '', profile = {}, campaign = {} } = {}) {
  const targets = [...(campaign.roles || []), ...(profile.desiredTitles || [])];
  const jobText = `${job.title}\n${job.description || ''}\n${(job.tags || []).join(' ')}`;
  const jobSkills = extractSkills(jobText);
  const candSkills = new Set([...extractSkills(resumeText), ...(profile.skills || []).map((s) => canon(s.toLowerCase()))]);
  const matched = jobSkills.filter((s) => candSkills.has(s));
  const missing = jobSkills.filter((s) => !candSkills.has(s));

  const tFit = targets.length ? titleFit(job.title, targets) : 0.6;
  // Long postings list many nice-to-haves; don't expect a candidate to hit all of them.
  const sFit = jobSkills.length ? matched.length / Math.min(jobSkills.length, 6 + 0.4 * jobSkills.length) : 0.5;

  const yrs = Number(profile.totalYearsExperience);
  const req = yearsRequired(job.description);
  let eFit = 0.7;
  if (!Number.isNaN(yrs) && profile.totalYearsExperience !== undefined && profile.totalYearsExperience !== '') {
    if (req != null) eFit = yrs >= req ? 1 : yrs >= req - 1 ? 0.7 : yrs >= req - 3 ? 0.35 : 0.1;
    if (SENIOR.test(job.title) && yrs < 4) eFit = Math.min(eFit, 0.3);
    if (JUNIOR.test(job.title) && yrs > 6) eFit = Math.min(eFit, 0.5);
  }

  let lFit = 0.7;
  const modes = (campaign.workModes && campaign.workModes.length ? campaign.workModes : profile.workModes) || [];
  if (job.remote && modes.includes('Remote')) lFit = 1;
  else if (!job.remote && modes.length === 1 && modes[0] === 'Remote') lFit = 0.1;
  const locs = [...(campaign.locations || []), ...(profile.preferredLocations || [])].map((l) => l.toLowerCase());
  if (locs.length && job.location && locs.some((l) => job.location.toLowerCase().includes(l))) lFit = 1;

  let fresh = 0.6;
  if (job.postedAt) {
    const d = (Date.now() - new Date(job.postedAt).getTime()) / 86400000;
    fresh = d <= 3 ? 1 : d <= 7 ? 0.85 : d <= 14 ? 0.7 : d <= 30 ? 0.5 : 0.25;
  }

  let score = Math.round(100 * (0.32 * tFit + 0.33 * Math.min(1, sFit) + 0.15 * eFit + 0.12 * lFit + 0.08 * fresh));
  const sponsorship = sponsorshipSignal(job);
  const elig = eligibility(job, profile);
  if (needsVisa(profile) && sponsorship === 'not-offered') score = Math.max(0, score - 30);
  const reasons = [];
  if (tFit >= 0.99) reasons.push('Title matches your target role');
  else if (tFit >= 0.5) reasons.push('Title partially matches your target role');
  if (matched.length) reasons.push(`${matched.length} of ${jobSkills.length} detected skills match`);
  if (req != null) reasons.push(`Asks for ~${req}+ yrs (you: ${Number.isNaN(yrs) ? '?' : yrs})`);
  if (job.remote) reasons.push('Remote-friendly');
  if (sponsorship === 'offered') reasons.push('Visa sponsorship offered');
  if (sponsorship === 'not-offered') reasons.push(needsVisa(profile) ? "Doesn't sponsor visas (you need sponsorship)" : 'No visa sponsorship');
  return {
    score: Math.max(0, Math.min(100, score)),
    breakdown: { title: tFit, skills: Math.min(1, sFit), experience: eFit, location: lFit, freshness: fresh },
    matchedSkills: matched.map(displaySkill),
    missingSkills: missing.filter((m) => !SOFT.has(m)).slice(0, 15).map(displaySkill),
    reasons,
    flags: [...ghostSignals(job), ...elig.blockers],
    sponsorship,
    eligibility: elig,
  };
}

function isExcluded(job, { profile = {}, campaign = {} } = {}) {
  const el = eligibility(job, profile);
  if (!el.ok) return el.blockers[0];
  // A beginner is not queued for roles that ask for several more years than they have (a fresher was being shown
  // 5-10 year roles as top matches). Switch off per campaign with skipExperienceGap: false.
  const have = Number(profile.totalYearsExperience);
  if (campaign.skipExperienceGap !== false && profile.totalYearsExperience !== undefined && profile.totalYearsExperience !== '' && !Number.isNaN(have)) {
    const need = yearsRequired(job.description);
    if (need != null && need - have >= 3) return `Asks for ~${need}+ years of experience (you have ${have})`;
  }
  if (needsVisa(profile) && sponsorshipSignal(job) === 'not-offered' && campaign.skipNoSponsorship !== false) return "Employer doesn't sponsor visas";
  const companies = [...(profile.excludeCompanies || []), ...(campaign.excludeCompanies || [])].map((s) => s.toLowerCase().trim()).filter(Boolean);
  if (companies.some((c) => (job.company || '').toLowerCase().includes(c))) return 'Company is on your exclude list';
  const kws = [...(profile.excludeKeywords || []), ...(campaign.excludeKeywords || [])].map((s) => s.toLowerCase().trim()).filter(Boolean);
  const hay = `${job.title} ${job.description}`.toLowerCase();
  const kw = kws.find((k) => hay.includes(k));
  if (kw) return `Contains excluded keyword "${kw}"`;
  return null;
}

module.exports = { scoreJob, extractSkills, isExcluded, displaySkill, sponsorshipSignal, SKILLS };
