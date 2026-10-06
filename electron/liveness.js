// "Is this job still open?" — checked right before applying, using each ATS's public API.
// Returns true (open), false (closed), or null (couldn't tell — treated as open).
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) ApplyPilot/1.1';

async function status(url, opts = {}) {
  try {
    const res = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/json' }, signal: AbortSignal.timeout(opts.timeout || 8000), redirect: 'follow' });
    return { code: res.status, json: opts.json ? await res.json().catch(() => null) : null };
  } catch { return { code: 0 }; }
}

async function isStillOpen(job) {
  const m = job.atsMeta || {};
  const url = job.applyUrl || job.url || '';
  try {
    if (job.ats === 'greenhouse') {
      const token = m.boardToken || (url.match(/greenhouse\.io\/(?:embed\/job_app\?for=)?([^/?&]+)/) || [])[1];
      const id = m.jobId || (url.match(/(?:jobs\/|token=|gh_jid=)(\d+)/) || [])[1];
      if (!token || !id) return null;
      const host = m.region === 'eu' ? 'boards-api.eu.greenhouse.io' : 'boards-api.greenhouse.io';
      const r = await status(`https://${host}/v1/boards/${token}/jobs/${id}`);
      return r.code === 200 ? true : r.code === 404 ? false : null;
    }
    if (job.ats === 'lever') {
      const company = m.company || (url.match(/lever\.co\/([^/]+)/) || [])[1];
      const id = m.postingId || (url.match(/lever\.co\/[^/]+\/([0-9a-f-]{36})/) || [])[1];
      if (!company || !id) return null;
      const r = await status(`https://${m.region === 'eu' ? 'api.eu.lever.co' : 'api.lever.co'}/v0/postings/${company}/${id}`);
      return r.code === 200 ? true : r.code === 404 ? false : null;
    }
    if (job.ats === 'ashby') {
      const org = m.org || (url.match(/ashbyhq\.com\/([^/]+)/) || [])[1];
      const id = m.jobId || (url.match(/ashbyhq\.com\/[^/]+\/([0-9a-f-]{36})/) || [])[1];
      if (!org || !id) return null;
      const r = await status(`https://api.ashbyhq.com/posting-api/job-board/${org}`, { json: true });
      if (r.code !== 200 || !r.json || !Array.isArray(r.json.jobs)) return null;
      return r.json.jobs.some((j) => j.id === id);
    }
    if (job.ats === 'smartrecruiters') {
      const company = m.company || (url.match(/smartrecruiters\.com\/([^/]+)/) || [])[1];
      const id = m.postingId || m.jobId || (url.match(/smartrecruiters\.com\/[^/]+\/(\d+)/) || [])[1];
      if (!company || !id) return null;
      const r = await status(`https://api.smartrecruiters.com/v1/companies/${company}/postings/${id}`);
      return r.code === 200 ? true : r.code === 404 ? false : null;
    }
  } catch { /* unknown */ }
  return null;
}

module.exports = { isStillOpen };
