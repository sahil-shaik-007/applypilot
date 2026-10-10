// Jobs seen on this device (searches + campaign runs), kept in memory only (public job data,
// cleared on reload/lock), plus market-pay insight built from them and from tracked applications.
import { salaryInsight } from '@shared/campaignRules.js';

const MAX = 4000;
const seen = new Map(); // job id -> compact job (title, company, salary)

/** Remembers jobs for market-pay percentiles. */
export function rememberJobs(jobs = []) {
  for (const j of jobs) {
    if (!j || !j.id) continue;
    seen.delete(j.id);
    seen.set(j.id, { id: j.id, title: j.title, company: j.company, salaryMin: j.salaryMin, salaryMax: j.salaryMax, salaryCurrency: j.salaryCurrency });
  }
  while (seen.size > MAX) seen.delete(seen.keys().next().value);
}
export function forgetJobs() { seen.clear(); }
export const seenCount = () => seen.size;

/** 25th–75th percentile pay for similar titles among jobs seen on this device + your tracker. */
export function marketPay(job, applications = [], savedJobs = []) {
  const pool = [...seen.values()];
  for (const a of applications) if (a.job) pool.push({ id: a.jobId, ...a.job });
  for (const s of savedJobs) pool.push(s);
  return salaryInsight(job, pool);
}
