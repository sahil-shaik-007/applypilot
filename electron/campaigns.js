// Campaign runner: every campaign (one per target role) runs its own independent loop in parallel:
//   search all sources -> filter & score -> queue / apply with the campaign's resume -> sleep -> repeat.
// Browser work is bounded globally by the ApplyEngine's own semaphore.
const crypto = require('crypto');
const { searchAll } = require('./connectors');
const { scoreJob, isExcluded } = require('./match');
const fs = require('fs');
const { pickResume } = require('./resume');
const tailoredResume = require('./tailoredResume');

const today = () => new Date().toISOString().slice(0, 10);
const sleep = (ms, signal) => new Promise((resolve) => {
  const t = setTimeout(resolve, ms);
  signal && signal.addEventListener('abort', () => { clearTimeout(t); resolve(); }, { once: true });
});

function fillTemplate(tpl, job, profile) {
  return (tpl || '').replace(/\{(\w+)\}/g, (m, k) => ({
    company: job.company, title: job.title, firstName: profile.firstName, lastName: profile.lastName,
    skills: (profile.skills || []).slice(0, 5).join(', '), years: profile.totalYearsExperience,
  }[k] ?? m));
}

function tokens(s) { return new Set((s || '').toLowerCase().replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter((w) => w.length > 2)); }
function similarity(a, b) {
  const A = tokens(a); const B = tokens(b);
  if (!A.size || !B.size) return 0;
  let inter = 0; A.forEach((w) => B.has(w) && inter++);
  return inter / (A.size + B.size - inter);
}

class CampaignManager {
  constructor({ store, getEngine, ai, getPlan, emit, notify, companies, tailoredDir }) {
    Object.assign(this, { store, getEngine, ai, getPlan, emit, notify, companies, tailoredDir });
    this.careerPages = () => (this.store.careerPages ? this.store.careerPages.get().items : []);
    this.runners = new Map(); // campaignId -> AbortController
    this.applying = new Map(); // applicationId -> AbortController
    this.pendingSubmits = new Map(); // applicationId -> resolve(boolean) during the cancel window
    this.aiUsage = { day: today(), count: 0 };
  }

  // ---------- helpers ----------
  profile() { return this.store.profile.get().values || {}; }
  settings() { return this.store.settings.get(); }
  campaign(id) { return this.store.campaigns.get().items.find((c) => c.id === id); }
  patchCampaign(id, patch) {
    let out = null;
    this.store.campaigns.update((d) => {
      const c = d.items.find((x) => x.id === id);
      if (c) { Object.assign(c, typeof patch === 'function' ? patch(c) : patch); out = c; }
    });
    if (out) this.emit('campaign:update', out);
    return out;
  }
  log(type, message, data = {}) {
    const entry = { id: crypto.randomUUID(), t: new Date().toISOString(), type, message, ...data };
    this.store.activity.update((d) => { d.items.unshift(entry); d.items.length = Math.min(d.items.length, 800); });
    this.emit('activity', entry);
  }
  patchApp(id, patch, event) {
    let out = null;
    this.store.applications.update((d) => {
      const a = d.items.find((x) => x.id === id);
      if (!a) return;
      Object.assign(a, patch, { updatedAt: new Date().toISOString() });
      if (event) { a.events = a.events || []; a.events.push({ t: new Date().toISOString(), ...event }); if (a.events.length > 60) a.events.shift(); }
      out = a;
    });
    if (out) this.emit('application:update', out);
    return out;
  }
  attemptsToday(campaignId) {
    const d = today();
    return this.store.applications.get().items.filter((a) => a.attemptedAt && a.attemptedAt.startsWith(d) && (!campaignId || a.campaignId === campaignId)).length;
  }
  // Duplicate guard + per-company cap (max 2 applications to one company per 30 days) so parallel
  // campaigns never spam the same recruiter.
  alreadyHandled(job) {
    const co = (job.company || '').toLowerCase().trim();
    const key = `${co}|${(job.title || '').toLowerCase()}`;
    const since = Date.now() - 30 * 86400000;
    let sameCompany = 0;
    for (const a of this.store.applications.get().items) {
      const aco = (a.job.company || '').toLowerCase().trim();
      if (a.jobId === job.id || `${aco}|${(a.job.title || '').toLowerCase()}` === key) return true;
      if (co && aco === co && a.status !== 'skipped' && new Date(a.createdAt).getTime() > since) sameCompany++;
    }
    return sameCompany >= 2;
  }
  canUseAi() {
    const s = this.settings();
    if (!s.keys.anthropic) return false;
    if (this.aiUsage.day !== today()) this.aiUsage = { day: today(), count: 0 };
    return this.aiUsage.count < this.getPlan().aiPerDay;
  }
  aiArgs() { const s = this.settings(); this.aiUsage.count++; return { apiKey: s.keys.anthropic, model: s.aiModel }; }

  // ---------- lifecycle ----------
  resumeAll() {
    for (const c of this.store.campaigns.get().items) if (c.status === 'running') this.start(c.id);
  }
  start(id) {
    if (this.runners.has(id)) return;
    const plan = this.getPlan();
    const running = [...this.runners.keys()].length;
    if (running >= plan.campaigns) throw new Error(`Your ${plan.label} plan allows ${plan.campaigns} active campaign(s). Upgrade to run more in parallel.`);
    const ac = new AbortController();
    this.runners.set(id, ac);
    this.patchCampaign(id, { status: 'running' });
    this.loop(id, ac.signal).finally(() => {
      this.runners.delete(id);
      const c = this.campaign(id);
      if (c && c.status === 'running') this.patchCampaign(id, { status: 'paused', phase: 'idle' });
    });
  }
  stop(id) {
    const ac = this.runners.get(id);
    this.patchCampaign(id, { status: 'paused', phase: 'idle', nextRunAt: null });
    if (ac) ac.abort();
  }
  stopAll() { [...this.runners.keys()].forEach((id) => this.stop(id)); this.applying.forEach((ac) => ac.abort()); }

  async loop(id, signal) {
    while (!signal.aborted) {
      const c = this.campaign(id);
      if (!c) return;
      try {
        await this.runOnce(c, signal);
      } catch (e) {
        this.log('error', `Campaign "${c.name}" error: ${e.message}`, { campaignId: id });
        this.patchCampaign(id, { lastError: e.message });
      }
      if (signal.aborted) return;
      const mins = Math.max(15, Number(c.intervalMinutes) || 60);
      this.patchCampaign(id, { phase: 'sleeping', nextRunAt: new Date(Date.now() + mins * 60000).toISOString() });
      await sleep(mins * 60000, signal);
    }
  }

  // ---------- one pass ----------
  async search(c, onProgress) {
    const s = this.settings();
    const roles = (c.roles || []).filter(Boolean);
    const locations = (c.locations && c.locations.length ? c.locations : ['']).slice(0, 3);
    const merged = new Map();
    const stats = [];
    for (const role of roles) {
      for (const loc of locations) {
        const { jobs, stats: st } = await searchAll(
          { query: role, location: loc, remote: c.remote || 'any', limit: 80 },
          { sources: c.sources && c.sources.length ? c.sources : s.enabledSources, keys: s.keys, companies: this.companies(), careerPages: this.careerPages(), onProgress },
        );
        jobs.forEach((j) => merged.set(j.id, j));
        stats.push(...st);
      }
    }
    return { jobs: [...merged.values()], stats };
  }

  async runOnce(c, signal) {
    const profile = this.profile();
    this.patchCampaign(c.id, { phase: 'searching', lastRunAt: new Date().toISOString(), lastError: null, progress: { sources: 0, found: 0 } });
    let srcDone = 0; let foundSoFar = 0;
    const { jobs } = await this.search(c, (p) => {
      srcDone++; foundSoFar += p.count;
      this.patchCampaign(c.id, { progress: { sources: srcDone, found: foundSoFar } });
    });
    if (signal.aborted) return;

    this.patchCampaign(c.id, { phase: 'scoring' });
    const fresh = [];
    let skipped = 0;
    const include = (c.includeKeywords || []).map((k) => k.toLowerCase());
    for (const job of jobs) {
      if (this.alreadyHandled(job)) continue;
      const excluded = isExcluded(job, { profile, campaign: c });
      if (excluded) { skipped++; continue; }
      if (include.length && !include.some((k) => `${job.title} ${job.description}`.toLowerCase().includes(k))) { skipped++; continue; }
      const resume = pickResume(this.store, { resumeId: c.resumeId, job });
      const match = scoreJob(job, { resumeText: resume ? resume.text : '', profile, campaign: c });
      fresh.push({ job, match, resume });
    }
    // Only jobs this campaign has never seen before count toward its "found" stat.
    const known = this.store.jobs.get().items;
    const brandNew = fresh.filter(({ job }) => !(known[job.id] && (known[job.id].campaignIds || []).includes(c.id)));
    // Persist discovered jobs so they show up in the Jobs tab.
    this.store.jobs.update((d) => {
      for (const { job, match } of fresh) {
        const prev = d.items[job.id];
        d.items[job.id] = { ...job, match, firstSeen: prev ? prev.firstSeen : new Date().toISOString(), campaignIds: [...new Set([...(prev?.campaignIds || []), c.id])] };
      }
      // keep the cache bounded
      const ids = Object.keys(d.items);
      if (ids.length > 6000) ids.sort((a, b) => (d.items[a].firstSeen < d.items[b].firstSeen ? -1 : 1)).slice(0, ids.length - 6000).forEach((id) => delete d.items[id]);
    });

    const minScore = Number(c.minScore ?? this.settings().minMatchScore ?? 55);
    const good = fresh.filter((x) => x.match.score >= minScore && !x.match.flags.some((f) => /scam/i.test(f)))
      .sort((a, b) => b.match.score - a.match.score);
    this.patchCampaign(c.id, (cur) => ({ stats: { ...(cur.stats || {}), found: (cur.stats?.found || 0) + brandNew.length, skipped: (cur.stats?.skipped || 0) + brandNew.filter((x) => x.match.score < minScore).length } }));
    this.log('search', `"${c.name}": ${jobs.length} jobs found, ${good.length} new matches ≥ ${minScore}%`, { campaignId: c.id });

    if (!good.length) return;
    const plan = this.getPlan();
    const globalLeft = Math.min(plan.dailyApplies, Number(this.settings().dailyApplyLimit) || plan.dailyApplies) - this.attemptsToday();
    const campLeft = (Number(c.dailyLimit) || 25) - this.attemptsToday(c.id);
    const budget = Math.max(0, Math.min(globalLeft, campLeft));

    // Queue mode keeps at most 50 jobs waiting per campaign so the review queue stays manageable.
    const waiting = this.store.applications.get().items.filter((a) => a.campaignId === c.id && a.status === 'queued').length;
    const toQueue = c.mode === 'queue' ? good.slice(0, Math.max(0, 50 - waiting)) : good.slice(0, budget);
    const created = toQueue.map(({ job, match, resume }) => this.createApplication({ job, match, resume, campaign: c, status: 'queued' }));
    if (c.mode === 'queue') {
      if (created.length) {
        this.log('queue', `"${c.name}": ${created.length} new jobs waiting in your Review queue`, { campaignId: c.id });
        this.notify('Jobs ready for review', `${created.length} new matches for ${c.name}`);
      }
      return;
    }
    if (!budget) { this.log('limit', `Daily application limit reached — "${c.name}" will continue tomorrow.`, { campaignId: c.id }); return; }
    this.patchCampaign(c.id, { phase: 'applying' });
    // Two applications per campaign at a time; the engine caps total browser tabs across campaigns.
    let i = 0;
    const worker = async () => {
      while (i < created.length && !signal.aborted) {
        const app = created[i++];
        await this.applyApplication(app.id, { mode: c.mode, signal });
      }
    };
    await Promise.all([worker(), worker()]);
  }

  createApplication({ job, match, resume, campaign, status = 'queued' }) {
    const app = {
      id: crypto.randomUUID(),
      jobId: job.id,
      job: { title: job.title, company: job.company, companyLogo: job.companyLogo, location: job.location, remote: job.remote, url: job.url, applyUrl: job.applyUrl, source: job.source, ats: job.ats, atsMeta: job.atsMeta, salaryText: job.salaryText, salaryMin: job.salaryMin, salaryMax: job.salaryMax, salaryCurrency: job.salaryCurrency, description: (job.description || '').slice(0, 6000), postedAt: job.postedAt },
      campaignId: campaign ? campaign.id : null,
      campaignName: campaign ? campaign.name : 'Manual',
      resumeId: resume ? resume.id : null,
      resumeName: resume ? resume.name : null,
      score: match ? match.score : null,
      match,
      status,
      notes: '',
      events: [{ t: new Date().toISOString(), type: 'created', message: status === 'saved' ? 'Saved' : 'Queued' }],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    this.store.applications.update((d) => { d.items.unshift(app); });
    this.emit('application:update', app);
    return app;
  }

  async buildCoverLetter(app, job, resume, profile, style) {
    if (style === 'none') return '';
    if (style !== 'template' && this.canUseAi()) {
      try {
        return await this.ai.coverLetter({ ...this.aiArgs(), job, profile, resumeText: resume ? resume.text : '' });
      } catch (e) {
        this.patchApp(app.id, {}, { type: 'warn', message: `AI cover letter failed (${this.ai.errMessage(e)}), using template` });
      }
    }
    const tpl = profile.coverLetterTemplate || `Dear {company} team,\n\nI'm excited to apply for the {title} role. With {years} years of experience in {skills}, I'm confident I can contribute from day one.\n\nThank you for your consideration.\n\n{firstName} {lastName}`;
    return fillTemplate(tpl, job, profile);
  }

  // Q&A memory first, then AI, otherwise remember the question so the user can answer it once for next time.
  async answerQuestion(question, info, ctx) {
    const items = this.store.qa.get().items;
    let best = null; let bestSim = 0;
    for (const q of items) {
      if (!q.answer) continue;
      const sim = similarity(q.question, question);
      if (sim > bestSim) { best = q; bestSim = sim; }
    }
    if (best && bestSim >= 0.72) {
      this.store.qa.update((d) => { const q = d.items.find((x) => x.id === best.id); if (q) q.uses = (q.uses || 0) + 1; });
      return best.answer;
    }
    const s = this.settings();
    if (s.aiAnswerQuestions && this.canUseAi()) {
      try {
        const ans = await this.ai.answerQuestion({ ...this.aiArgs(), question, options: info.options, type: info.type, job: ctx.job, profile: ctx.profile, resumeText: ctx.resume ? ctx.resume.text : '' });
        if (ans) {
          if (!info.options || !info.options.length) {
            this.store.qa.update((d) => { d.items.unshift({ id: crypto.randomUUID(), question, answer: Array.isArray(ans) ? ans.join(', ') : ans, source: 'ai', uses: 1, updatedAt: new Date().toISOString() }); });
          }
          return ans;
        }
      } catch { /* fall through */ }
    }
    // Remember real screening questions for the user to answer once — but not empty optional
    // one-word fields like "Twitter" or "Other website".
    const worthAsking = info.required || question.trim().split(/\s+/).length >= 4;
    if (worthAsking && !items.some((q) => similarity(q.question, question) >= 0.85)) {
      this.store.qa.update((d) => { d.items.unshift({ id: crypto.randomUUID(), question, answer: '', options: info.options || [], source: 'pending', uses: 0, updatedAt: new Date().toISOString() }); });
      this.emit('qa:pending', { question });
    }
    return null;
  }

  async applyApplication(appId, { mode, signal, force = false } = {}) {
    const app = this.store.applications.get().items.find((a) => a.id === appId);
    if (!app) throw new Error('Application not found');
    const engine = this.getEngine();
    if (!engine) { this.patchApp(appId, { status: 'failed' }, { type: 'error', message: 'Auto-apply engine unavailable' }); return; }
    const plan = this.getPlan();
    if (this.attemptsToday() >= plan.dailyApplies) {
      this.patchApp(appId, {}, { type: 'limit', message: `Daily limit of ${plan.dailyApplies} reached on the ${plan.label} plan` });
      return;
    }
    const profile = this.profile();
    const campaign = app.campaignId ? this.campaign(app.campaignId) : null;
    const job = { ...(this.store.jobs.get().items[app.jobId] || {}), ...app.job, id: app.jobId };
    const resume = pickResume(this.store, { resumeId: app.resumeId || (campaign && campaign.resumeId), job });
    if (!resume) { this.patchApp(appId, { status: 'failed' }, { type: 'error', message: 'Upload a resume first' }); return; }
    // Don't waste an application on a posting that has already closed.
    const open = await require('./liveness').isStillOpen(job).catch(() => null);
    if (open === false) {
      this.patchApp(appId, { status: 'skipped' }, { type: 'closed', message: 'This job is no longer accepting applications — skipped' });
      return;
    }
    const { scamSignals } = require('./eligibility');
    const scam = scamSignals(job);
    if (scam.length && !force) {
      this.patchApp(appId, { status: 'skipped' }, { type: 'blocked', message: `Blocked before sending any data — looks like a scam (${scam.join(', ')}). Open the posting yourself if you trust it.` });
      this.log('error', `Blocked likely scam: ${job.title} at ${job.company}`, { applicationId: appId });
      return;
    }
    const ac = new AbortController();
    const onCampaignAbort = () => ac.abort();
    if (signal) signal.addEventListener('abort', onCampaignAbort, { once: true });
    this.applying.set(appId, ac);
    this.patchApp(appId, { status: 'in-progress', attemptedAt: new Date().toISOString(), resumeId: resume.id, resumeName: resume.name }, { type: 'step', message: 'Preparing application' });

    const finalize = (result) => {
      const cur = this.store.applications.get().items.find((a) => a.id === appId);
      if (!cur || ['skipped', 'applied', 'interview', 'offer', 'rejected'].includes(cur.status) && result.status !== 'submitted') return; // user already decided
      const status = { submitted: 'applied', 'filled-awaiting-user': 'awaiting-you', 'needs-attention': 'awaiting-you', failed: 'failed' }[result.status] || 'awaiting-you';
      const wasAwaiting = cur.status === 'awaiting-you';
      this.patchApp(appId, {
        status,
        appliedAt: status === 'applied' ? new Date().toISOString() : cur.appliedAt || null,
        followUpAt: status === 'applied' ? new Date(Date.now() + 7 * 86400000).toISOString() : null,
        unanswered: result.unanswered || cur.unanswered || [],
        screenshotPath: result.screenshotPath || cur.screenshotPath || null,
      }, { type: result.status, message: result.message || result.status });
      if (status === 'applied') {
        this.bumpStats(campaign, resume, 'applied');
        this.log('applied', `Applied: ${job.title} at ${job.company}`, { applicationId: appId, campaignId: app.campaignId });
        this.notify('Application submitted', `${job.title} at ${job.company}`);
      } else if (status === 'awaiting-you') {
        if (!wasAwaiting) {
          this.log('review', `Needs you: ${job.title} at ${job.company} — ${result.message || 'review & submit'}`, { applicationId: appId });
          this.notify('Application needs your review', `${job.title} at ${job.company}`);
        }
      } else {
        this.bumpStats(campaign, null, 'failed');
        this.log('error', `Failed: ${job.title} at ${job.company} — ${result.message}`, { applicationId: appId });
      }
    };

    try {
      const coverLetterText = app.coverLetter || await this.buildCoverLetter(app, job, resume, profile, campaign ? campaign.coverLetter : 'ai');
      if (coverLetterText) this.patchApp(appId, { coverLetter: coverLetterText });
      let effectiveMode = mode || (campaign && campaign.mode !== 'queue' ? campaign.mode : this.settings().defaultApplyMode) || 'review';
      if (effectiveMode === 'auto' && !plan.autoSubmit) effectiveMode = 'review'; // Free plan: you click submit.

      // Once the form is handed to the user, stop blocking the campaign: the engine keeps watching the tab
      // for a confirmation in the background and finalize() records the outcome whenever it arrives.
      let handOff;
      const handedOff = new Promise((resolve) => { handOff = resolve; });
      // Use (or create) an AI-tailored, verified resume for this job when available.
      let upload = { path: resume.path, fileName: resume.fileName, text: resume.text };
      const cur = this.store.applications.get().items.find((x) => x.id === appId) || app;
      if (cur.tailored && cur.tailored.path && fs.existsSync(cur.tailored.path)) {
        upload = { path: cur.tailored.path, fileName: cur.tailored.fileName, text: cur.tailored.text };
      } else if (campaign && campaign.tailorResume && this.canUseAi() && this.tailoredDir) {
        try {
          this.patchApp(appId, {}, { type: 'step', message: 'Tailoring your resume for this job' });
          const t = await tailoredResume.generate({ ai: this.ai, aiArgs: this.aiArgs(), job, profile, resume, outDir: this.tailoredDir });
          this.patchApp(appId, { tailored: { ...t, baseResumeId: resume.id } }, { type: 'step', message: `Tailored resume ready${t.removed.length ? ` (${t.removed.length} unsupported claim(s) removed)` : ''}` });
          upload = { path: t.path, fileName: t.fileName, text: t.text };
        } catch (e) {
          this.patchApp(appId, {}, { type: 'warn', message: `Couldn't tailor the resume (${this.ai.errMessage(e)}); using "${resume.name}"` });
        }
      }
      const done = engine.applyToJob({
        job,
        profile,
        resume: upload,
        coverLetterText,
        mode: effectiveMode,
        signal: ac.signal,
        answerQuestion: (q, info) => this.answerQuestion(q, info || {}, { job, profile, resume }),
        beforeSubmit: () => this.cancelWindow(appId, job),
        onEvent: (ev) => {
          if (ev.type === 'needs-user') {
            if (signal) signal.removeEventListener('abort', onCampaignAbort); // pausing a campaign never closes your tab
            const cur = this.store.applications.get().items.find((a) => a.id === appId);
            this.patchApp(appId, { status: 'awaiting-you', unanswered: (ev.data && ev.data.unanswered) || (cur && cur.unanswered) || [] }, { type: ev.type, message: ev.message });
            this.log('review', `Needs you: ${job.title} at ${job.company} — ${ev.message}`, { applicationId: appId });
            this.notify('Application ready for your review', `${job.title} at ${job.company}`);
            handOff();
          } else {
            this.patchApp(appId, {}, { type: ev.type, message: ev.message });
          }
        },
      }).then(finalize, (e) => finalize({ status: 'failed', message: e.message }))
        .finally(() => this.applying.delete(appId));
      await Promise.race([done, handedOff]);
    } catch (e) {
      this.patchApp(appId, { status: 'failed' }, { type: 'error', message: e.message });
      this.bumpStats(campaign, null, 'failed');
      this.applying.delete(appId);
    }
  }

  // Cancel window before every auto-submit: the user can hold (turn into a review) or submit now.
  cancelWindow(appId, job) {
    const secs = Math.max(0, Number(this.settings().submitDelaySeconds ?? 30));
    if (!secs) return Promise.resolve(true);
    const until = new Date(Date.now() + secs * 1000).toISOString();
    this.patchApp(appId, { pendingSubmitUntil: until }, { type: 'step', message: `Submitting in ${secs}s — you can hold it` });
    this.notify('About to submit an application', `${job.title} at ${job.company} in ${secs}s — open ApplyPilot to hold it`);
    return new Promise((resolve) => {
      const done = (ok) => { clearTimeout(t); this.pendingSubmits.delete(appId); this.patchApp(appId, { pendingSubmitUntil: null }); resolve(ok); };
      const t = setTimeout(() => done(true), secs * 1000);
      this.pendingSubmits.set(appId, done);
    });
  }

  resolvePendingSubmit(appId, ok) {
    const done = this.pendingSubmits.get(appId);
    if (done) { done(ok); this.patchApp(appId, {}, { type: 'step', message: ok ? 'Submitting now' : 'Held — you will review it' }); }
    return !!done;
  }

  bumpStats(campaign, resume, key) {
    if (campaign) this.patchCampaign(campaign.id, (c) => ({ stats: { ...(c.stats || {}), [key]: (c.stats?.[key] || 0) + 1 } }));
    if (resume && key === 'applied') this.store.resumes.update((d) => { const r = d.items.find((x) => x.id === resume.id); if (r) r.stats = { ...(r.stats || {}), applied: (r.stats?.applied || 0) + 1 }; });
  }

  cancelApplication(appId) {
    const ac = this.applying.get(appId);
    if (ac) ac.abort();
    this.patchApp(appId, { status: 'skipped' }, { type: 'cancelled', message: 'Cancelled by you' });
  }
}

module.exports = { CampaignManager };
