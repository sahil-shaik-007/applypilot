import React, { useEffect, useMemo, useState } from 'react';
import { motion, AnimatePresence, useMotionValue, useTransform, animate } from 'framer-motion';
import {
  MapPin, Clock, ExternalLink, Bookmark, BookmarkCheck, Send, Zap, Sparkles, FileText, ShieldCheck, CircleAlert,
  Laptop, Smartphone, X, Info, Undo2, Search, Check, Download, Plane, Copy, Users, Banknote, GraduationCap, MessageSquareText, Building2, Newspaper, Star as StarIcon, MessagesSquare,
} from 'lucide-react';
import { useApp, go } from '../lib/store.jsx';
import { Button, Sheet, Logo, ScoreRing, StatusBadge, Seg, timeAgo, salary, stagger, CopyRow, copyText, downloadFile, Markdown } from './ui.jsx';
import { AUTO_ATS, saveJob, unsaveJob, sendToLaptop, skipJob, upsertApplication, openExternal, findApplication } from '../lib/apply.js';
import { allProfiles, getProfile, pickResumeFor, resumePool, profileIdForJob } from '../lib/profiles.js';
import { safeId } from '../lib/sync.js';
import { coverLetter, tailorResume, outreach, interviewPrep, aiError, DEFAULT_MODEL } from '../lib/ai.js';
import { canApplyInApp, openUrl } from '../lib/bridge.js';
import { ApplyCheck } from './applyCheck.jsx';
import { allConnections, peopleAt, researchLinks } from '../lib/network.js';
import { marketPay } from '../lib/insights.js';
import { startInAppApply, TailoredCard } from './apply.jsx';

export function SponsorBadge({ s }) {
  if (s === 'offered') return <span className="badge green" data-testid="sponsor-badge"><Plane size={10} />Sponsors visa</span>;
  if (s === 'not-offered') return <span className="badge red" data-testid="sponsor-badge"><Plane size={10} />No sponsorship</span>;
  return null;
}

export function JobCard({ job, onOpen, index = 0 }) {
  const score = job.match ? job.match.score : null;
  const top = score >= 88;
  const auto = AUTO_ATS.includes(job.ats);
  return (
    <motion.div {...stagger(index)} className={`card clickable ${top ? 'premium premium-shimmer' : ''}`} onClick={() => onOpen(job)} style={{ overflow: 'hidden' }} data-testid="job-card" role="button" tabIndex={0} onKeyDown={(e) => e.key === 'Enter' && onOpen(job)}>
      <div style={{ position: 'absolute', top: 0, right: 0, display: 'flex', gap: 6, padding: '6px 8px', zIndex: 2 }}>
        {auto && <span className="badge green" title="The desktop app can fill this form automatically"><Zap size={10} />auto</span>}
        {job.appStatus && <StatusBadge status={job.appStatus} />}
      </div>
      <div style={{ padding: 16, position: 'relative', zIndex: 2 }}>
        <div className="row" style={{ alignItems: 'flex-start', gap: 12 }}>
          <Logo name={job.company} />
          <div className="grow">
            <div className="card-title" style={{ paddingRight: auto || job.appStatus ? 70 : 0, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden', lineHeight: 1.3, overflowWrap: 'anywhere' }}>{job.title}</div>
            <div className="row wrap" style={{ gap: 6, marginTop: 6 }}>
              <span className="badge accent">{job.company || 'Unknown company'}</span>
              {job.remote && <span className="badge">Remote</span>}
              <SponsorBadge s={job.match && job.match.sponsorship} />
              {(job.blockers || []).length > 0 && <span className="badge red" title={job.blockers.join(' · ')}><CircleAlert size={10} />{job.scam ? 'Likely scam' : "Can't take"}</span>}
            </div>
          </div>
        </div>
        <p className="small muted" style={{ margin: '10px 0 0', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden', overflowWrap: 'anywhere' }}>
          {(job.description || '').replace(/\s+/g, ' ').slice(0, 220)}
        </p>
      </div>
      <div style={{ borderTop: '1px solid var(--border)', padding: '10px 16px', display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 10, position: 'relative', zIndex: 2 }}>
        <div className="metric"><div className="k">Match</div><div className="v" style={{ color: score >= 80 ? 'var(--green)' : score >= 60 ? 'var(--fg)' : 'var(--muted)' }}>{score ?? '—'}{score != null && '%'}</div></div>
        <div className="metric"><div className="k">Salary</div><div className="v ellipsis">{salary(job)}</div></div>
        <div className="metric"><div className="k">Posted</div><div className="v">{job.postedAt ? timeAgo(job.postedAt).replace(' ago', '') : '—'}</div></div>
      </div>
      <div style={{ padding: '0 16px 10px', position: 'relative', zIndex: 2 }} className="tiny dim ellipsis">
        <MapPin size={10} style={{ verticalAlign: -1 }} /> {job.location || (job.remote ? 'Remote' : '—')} · via {job.sourceName || job.source}
      </div>
    </motion.div>
  );
}

function Bar({ label, value }) {
  return (
    <div>
      <div className="row between tiny"><span className="muted" style={{ textTransform: 'uppercase', letterSpacing: '.08em' }}>{label}</span><span>{Math.round(value * 100)}%</span></div>
      <div className="progress" style={{ marginTop: 4 }}><div style={{ width: `${value * 100}%` }} /></div>
    </div>
  );
}

export function MatchBreakdown({ m }) {
  if (!m) return null;
  return (
    <div className="card pad" data-testid="match-breakdown">
      <div className="row" style={{ gap: 16, alignItems: 'flex-start' }}>
        <ScoreRing score={m.score} size={64} stroke={6} />
        <div className="grow col" style={{ gap: 8 }}>
          <div className="grid g2" style={{ gap: 10 }}>
            <Bar label="Title" value={m.breakdown.title} />
            <Bar label="Skills" value={m.breakdown.skills} />
            <Bar label="Exp." value={m.breakdown.experience} />
            <Bar label="Location" value={m.breakdown.location} />
          </div>
        </div>
      </div>
      {m.reasons.length > 0 && <div className="small muted" style={{ marginTop: 12 }}>{m.reasons.join(' · ')}</div>}
      {(m.matchedSkills.length > 0 || m.missingSkills.length > 0) && <hr className="hr" />}
      {m.matchedSkills.length > 0 && <div className="chips" style={{ marginBottom: 8 }}>{m.matchedSkills.map((s) => <span key={s} className="badge green">✓ {s}</span>)}</div>}
      {m.missingSkills.length > 0 && <div className="chips">{m.missingSkills.map((s) => <span key={s} className="badge amber">+ {s}</span>)}</div>}
      {m.flags && m.flags.length > 0 && <div className="row small" style={{ marginTop: 12, color: 'var(--amber)', alignItems: 'flex-start' }}><CircleAlert size={14} style={{ flexShrink: 0, marginTop: 3 }} />{m.flags.join(' · ')}</div>}
    </div>
  );
}

export function Blockers({ job }) {
  const list = job.blockers || (job.match && job.match.eligibility ? job.match.eligibility.blockers : []) || [];
  if (!list.length) return null;
  return (
    <div className="card pad col" style={{ gap: 6, borderColor: 'rgba(248,113,113,.45)', background: 'rgba(248,113,113,.06)' }} data-testid="blockers">
      <div className="section-title" style={{ margin: 0, color: 'var(--red)' }}><CircleAlert size={14} />You may not be able to take this job</div>
      {list.map((b) => <div key={b} className="small" style={{ color: 'var(--red)' }}>• {b}</div>)}
    </div>
  );
}
const isScam = (job) => !!(job && (job.scam || (job.match && job.match.eligibility && (job.match.eligibility.scam || []).length)));

function useSaved(job) {
  const app = useApp();
  const [saved, setSaved] = useState(false);
  useEffect(() => { let on = true; if (job && app.sync) safeId(job.id).then((id) => on && setSaved(!!app.sync.get('savedJobs', id))); return () => { on = false; }; }, [job, app.rev]); // eslint-disable-line
  return saved;
}

const LINK_ICON = { people: Users, company: Building2, glassdoor: StarIcon, ambitionbox: StarIcon, interview: MessagesSquare, news: Newspaper };

/** Market pay for similar roles (25th-75th percentile of jobs seen on this device + tracker). */
export function MarketPay({ job }) {
  const app = useApp();
  const m = useMemo(() => (job ? marketPay(job, app.applications, app.savedJobs) : null), [job && job.id, app.applications, app.savedJobs]); // eslint-disable-line
  if (!m || !m.median) return null;
  return (
    <div className="card pad row" style={{ gap: 12, alignItems: 'flex-start' }} data-testid="market-pay">
      <Banknote size={18} color="var(--green)" style={{ flexShrink: 0, marginTop: 2 }} />
      <div className="grow">
        <div className="label" style={{ margin: 0 }}>Market pay for similar roles</div>
        <div style={{ fontWeight: 700 }}>{salary({ salaryMin: m.p25, salaryMax: m.p75, salaryCurrency: m.currency })} <span className="small muted">· median {salary({ salaryMin: m.median, salaryCurrency: m.currency })}</span></div>
        <div className="tiny dim">From {m.count} similar jobs you've seen (25th–75th percentile). Use it to set your expected salary.</div>
      </div>
    </div>
  );
}

/** People you know at the company (imported LinkedIn connections) + research links. */
export function ResearchCard({ job, onClose }) {
  const app = useApp();
  const people = useMemo(() => peopleAt(allConnections(app.sync), job.company), [job.company, app.rev]); // eslint-disable-line
  return (
    <div className="card pad col" style={{ gap: 10 }} data-testid="research-card">
      <div className="section-title" style={{ margin: 0 }}><Users size={14} />Research & referrals</div>
      {people.length > 0 && (
        <div>
          <div className="small" style={{ fontWeight: 700, color: 'var(--green)', marginBottom: 4 }} data-testid="people-count">You know {people.length} {people.length === 1 ? 'person' : 'people'} at {job.company}</div>
          {people.slice(0, 6).map((p) => (
            <div key={p.id} className="person-row">
              <div className="grow"><div className="small ellipsis" style={{ fontWeight: 600 }}>{p.name}</div><div className="tiny dim ellipsis">{p.position}</div></div>
              {p.url && <Button size="sm" variant="ghost" icon={ExternalLink} aria-label={`Open ${p.name}'s profile`} onClick={() => openUrl(p.url)} />}
            </div>
          ))}
        </div>
      )}
      <div className="chips">
        {researchLinks(job).map((l) => { const I = LINK_ICON[l.id] || ExternalLink; return <button type="button" key={l.id} className="chip" onClick={() => openUrl(l.url)}><I size={12} />{l.label}</button>; })}
      </div>
      <div className="tiny dim">{people.length ? 'Ask one of them for a referral: AI tools → "Ask for referral" writes the message.' : <>A referral makes an interview several times more likely. <a href="#/network" onClick={(e) => { e.preventDefault(); if (onClose) onClose(); go('network'); }}>Import your LinkedIn connections</a> to see who you know here.</>}</div>
    </div>
  );
}

/** Resume picker. With `profileId` it lists that profile's resumes and the shared ones. */
export function ResumeSelect({ value, onChange, profileId }) {
  const app = useApp();
  const list = profileId ? resumePool(app, profileId).all : app.resumes;
  return (
    <select className="select" value={value} onChange={(e) => onChange(e.target.value)} aria-label="Resume">
      <option value="auto">✨ Auto-pick best match</option>
      {list.map((r) => <option key={r.id} value={r.id}>{r.name}{r.isDefault ? ' (default)' : ''}</option>)}
    </select>
  );
}

/** Job detail sheet: match breakdown, apply on phone / send to laptop / save, AI tools. */
export function JobSheet({ job, onClose }) {
  const app = useApp();
  const [tab, setTab] = useState('details');
  const [resumeId, setResumeId] = useState('auto');
  const [pick, setPick] = useState(null); // profile picked in the Apply tab; null = the job's profile
  const [mode, setMode] = useState('review');
  const [busy, setBusy] = useState(null);
  const [quick, setQuick] = useState(false);
  const [checking, setChecking] = useState(false);
  const [more, setMore] = useState(false);
  const saved = useSaved(job);
  useEffect(() => { setTab('details'); setMore(false); setPick(null); }, [job && job.id]);
  const application = job ? findApplication(app, job) : null;
  const queued = job ? app.outbox.some((o) => o.jobId === job.id) : false;
  const canAuto = job && AUTO_ATS.includes(job.ats);
  const scam = isScam(job);

  const run = async (k, fn, ok) => { setBusy(k); try { await fn(); if (ok) app.toast(ok, 'success'); } catch (e) { app.toast(e.message, 'error'); } finally { setBusy(null); } };
  // Apply in app exists only in the phone app; a normal browser sends to the PC or opens the job page.
  const native = canApplyInApp();
  // The person this application is for: picked in the Apply tab, else the job's campaign or the default profile.
  const activePid = pick || (job ? profileIdForJob(app, job) : 'main');
  const applyHere = async () => {
    setBusy('inapp');
    try { await startInAppApply(app, { job, resumeId, mode, profileId: activePid }); } finally { setBusy(null); }
  };

  const desc = (job && job.description) || '';
  return (
    <>
      <Sheet open={!!job} onClose={onClose} tall label="Job details"
        header={job && (
          <div className="row" style={{ alignItems: 'flex-start', gap: 12 }}>
            <Logo name={job.company} />
            <div className="grow">
              <h2 style={{ margin: '2px 0 0' }} data-testid="job-title">{job.title}</h2>
              <div className="row wrap small muted" style={{ marginTop: 4, gap: 10 }}>
                <span style={{ color: 'var(--fg)', fontWeight: 600 }} data-testid="job-company">{job.company}</span>
                {job.location && <span className="row" style={{ gap: 4 }}><MapPin size={12} />{job.location}</span>}
                {job.postedAt && <span className="row" style={{ gap: 4 }}><Clock size={12} />{timeAgo(job.postedAt)}</span>}
                <span>{salary(job)}</span>
              </div>
            </div>
          </div>
        )}
        footer={job && (
          <div className="col" style={{ gap: 8, width: '100%' }}>
            {scam && <div className="tiny" style={{ color: 'var(--red)', textAlign: 'center' }}>Applying is disabled: this posting looks like a scam. Never pay a fee or share ID documents.</div>}
            {native ? (
              <Button variant="gradient" className={scam ? '' : 'btn-gradient'} size="lg" icon={Zap} loading={busy === 'inapp'} onClick={applyHere} disabled={scam} data-testid="apply-here" block>Apply in app</Button>
            ) : (
              <Button variant="gradient" className={scam ? '' : 'btn-gradient'} size="lg" icon={queued ? Check : Laptop} disabled={queued || scam} data-testid="send-laptop" onClick={() => setChecking(true)} block>{queued ? 'Queued for your PC' : 'Send to my PC'}</Button>
            )}
            <div className="grid g2" style={{ gap: 8 }}>
              {native ? (
                <Button icon={queued ? Check : Laptop} disabled={queued || scam} data-testid="send-laptop" onClick={() => setChecking(true)}>{queued ? 'Queued' : 'Send to my PC'}</Button>
              ) : (
                <Button icon={ExternalLink} onClick={() => openExternal(job.applyUrl || job.url)} data-testid="open-job-page">Open job page</Button>
              )}
              <Button icon={saved ? BookmarkCheck : Bookmark} loading={busy === 'save'} data-testid="save-job" onClick={() => run('save', () => (saved ? unsaveJob(app, job) : saveJob(app, job)), saved ? 'Removed from saved' : 'Saved to Applications')}>{saved ? 'Saved' : 'Save'}</Button>
            </div>
          </div>
        )}>
        {job && (
          <div className="col" style={{ gap: 14 }}>
            <div className="row wrap" style={{ gap: 8 }}>
              {application && <StatusBadge status={application.status} />}
              {queued && <span className="badge blue"><Laptop size={10} />Queued for laptop</span>}
              <SponsorBadge s={job.match && job.match.sponsorship} />
              {canAuto ? <span className="badge green"><Zap size={10} />Desktop auto-fills {job.ats}</span> : <span className="badge amber"><ShieldCheck size={10} />Assisted apply</span>}
            </div>
            <Seg full value={tab} onChange={setTab} options={[{ value: 'details', label: 'Details' }, { value: 'apply', label: 'Apply' }, { value: 'ai', label: 'AI tools' }]} />
            {tab === 'details' && (
              <div className="col" style={{ gap: 14 }}>
                <Blockers job={job} />
                <MatchBreakdown m={job.match} />
                <MarketPay job={job} />
                <ResearchCard job={job} onClose={onClose} />
                {(job.tags || []).length > 0 && <div className="chips">{job.tags.slice(0, 10).map((t) => <span key={t} className="badge">{t}</span>)}</div>}
                <div className="prewrap small" style={{ color: '#d4d4d4', lineHeight: 1.7 }}>
                  {desc ? (more || desc.length < 1400 ? desc : `${desc.slice(0, 1400)}…`) : 'No description provided. Open the posting for details.'}
                </div>
                {desc.length >= 1400 && <Button size="sm" variant="ghost" onClick={() => setMore(!more)}>{more ? 'Show less' : 'Show full description'}</Button>}
                <Button icon={ExternalLink} onClick={() => openExternal(job.url || job.applyUrl)}>Open original posting</Button>
              </div>
            )}
            {tab === 'apply' && (
              <div className="col" style={{ gap: 14 }}>
                <div className="card pad col" style={{ gap: 14 }}>
                  <div><span className="label">Profile</span>
                    <select className="select" value={activePid} onChange={(e) => { setPick(e.target.value); setResumeId('auto'); }} aria-label="Profile" data-testid="apply-profile">
                      {allProfiles(app).map((p) => <option key={p.id} value={p.id}>{p.label}{p.isDefault ? ' (default)' : ''}</option>)}
                    </select>
                    <div className="tiny dim" style={{ marginTop: 4 }}>The person this application is for. Each profile has its own details and resumes.</div></div>
                  <div><span className="label">Resume</span><ResumeSelect value={resumeId} onChange={setResumeId} profileId={activePid} />
                    {!app.resumes.length && <div className="small" style={{ color: 'var(--amber)', marginTop: 6 }}>Upload a resume first (More → Resumes).</div>}</div>
                  <div>
                    <span className="label">{native ? 'How to apply' : 'Apply mode'}</span>
                    <Seg full value={mode} onChange={setMode} options={[{ value: 'review', label: 'Fill, I submit' }, { value: 'auto', label: 'Autopilot' }]} />
                    <div className="small muted" style={{ marginTop: 8 }}>{mode === 'auto' ? (canAuto ? `Fills every field and submits after a ${app.settings.submitDelaySeconds ?? 30}s cancel window when every required answer is known; anything uncertain waits for you. Applies to "Apply in app" and "Send to laptop".` : 'This site doesn\'t allow automated submission, so ApplyPilot fills it and you press submit.') : 'The form opens filled in. You review it and press submit.'}</div>
                  </div>
                </div>
                <TailoredCard job={job} resumeId={resumeId} profileId={activePid} />
                <div className="card pad col" style={{ gap: 10 }}>
                  <div className="section-title" style={{ margin: 0 }}><Smartphone size={14} />Applying on your phone</div>
                  <div className="small muted">{native ? 'Apply in app opens the form inside ApplyPilot and fills it from your profile, answers and resume. Quick-fill gives one-tap copy for every field.' : 'We open the application in a new tab and give you one-tap copy for every field.'}</div>
                  {native && <Button variant="primary" icon={Zap} loading={busy === 'inapp'} disabled={scam} onClick={applyHere} data-testid="apply-inapp">Apply in app</Button>}
                  <Button icon={Copy} disabled={scam} onClick={() => setQuick(true)} data-testid="open-quickfill">Open Quick-fill</Button>
                  <Button icon={Check} loading={busy === 'applied'} disabled={application && application.status === 'applied'} onClick={() => run('applied', () => upsertApplication(app, job, 'applied', { resumeId, profileId: activePid }), 'Marked as applied')}>Mark as applied</Button>
                </div>
                {application && (
                  <div className="card pad">
                    <div className="section-title">Activity</div>
                    <div className="col" style={{ gap: 6 }}>
                      {(application.events || []).slice().reverse().map((e, i) => (
                        <div key={i} className="row small" style={{ alignItems: 'flex-start' }}><span className="dim mono-num" style={{ width: 64, flexShrink: 0 }}>{timeAgo(e.t)}</span><span className="grow">{e.message}</span></div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
            {tab === 'ai' && <AiTools job={job} resumeId={resumeId} profileId={activePid} />}
          </div>
        )}
      </Sheet>
      <QuickFillSheet open={quick} job={job} resumeId={resumeId} profileId={activePid} onClose={() => setQuick(false)} />
      <ApplyCheck open={checking && !!job} job={job} resumeId={resumeId} mode={mode} profileId={activePid} onClose={() => setChecking(false)} />
    </>
  );
}

export function useAiArgs(resumeId, job, profileId) {
  const app = useApp();
  const who = getProfile(app, profileId);
  const resume = pickResumeFor(app, job, resumeId, who.id);
  return { apiKey: app.settings.anthropicKey, model: app.settings.aiModel || DEFAULT_MODEL, profile: who.values, resumeText: resume ? resume.text : '' };
}

export function AiTools({ job, resumeId, profileId }) {
  const app = useApp();
  const args = useAiArgs(resumeId, job, profileId);
  const [busy, setBusy] = useState(null);
  const [out, setOut] = useState({});
  useEffect(() => setOut({}), [job && job.id]);
  const people = useMemo(() => peopleAt(allConnections(app.sync), job.company), [job.company, app.rev]); // eslint-disable-line
  const runAi = async (k, fn, extra = {}) => {
    setBusy(k);
    try { const r = await fn({ ...args, job, ...extra }); setOut((o) => ({ ...o, [k]: r })); } catch (e) { app.toast(aiError(e), 'error'); } finally { setBusy(null); }
  };
  return (
    <div className="col" style={{ gap: 12 }}>
      {!args.apiKey && <div className="card pad small" style={{ borderColor: 'rgba(251,191,36,.35)' }}>Add your Anthropic API key in <a href="#/ai" onClick={(e) => { e.preventDefault(); go('ai'); }}>AI studio</a> to unlock these tools. Calls go straight from your phone to Anthropic.</div>}
      <div className="grid g2">
        <Button icon={Sparkles} loading={busy === 'tailor'} disabled={!args.apiKey} onClick={() => runAi('tailor', tailorResume)}>ATS check</Button>
        <Button icon={FileText} loading={busy === 'cover'} disabled={!args.apiKey} onClick={() => runAi('cover', coverLetter)}>Cover letter</Button>
        <Button icon={GraduationCap} loading={busy === 'prep'} disabled={!args.apiKey} onClick={() => runAi('prep', interviewPrep)}>Interview prep</Button>
        <Button icon={MessageSquareText} loading={busy === 'recruiter'} disabled={!args.apiKey} onClick={() => runAi('recruiter', outreach, { kind: 'recruiter' })}>Recruiter note</Button>
        <Button icon={Users} loading={busy === 'referral'} disabled={!args.apiKey} onClick={() => runAi('referral', outreach, { kind: 'referral', contactName: people[0] ? people[0].name.split(' ')[0] : '' })} data-testid="ai-referral">Ask for referral</Button>
      </div>
      <TailoredCard job={job} resumeId={resumeId} />
      {out.tailor && <TailorResult r={out.tailor} />}
      {out.cover && <TextResult title="Cover letter" text={out.cover} />}
      {out.referral && <TextResult title={people[0] ? `Referral request to ${people[0].name}` : 'Referral request'} text={out.referral} />}
      {out.recruiter && <TextResult title="Recruiter message" text={out.recruiter} />}
      {out.prep && <div className="card pad"><div className="section-title">Interview prep</div><Markdown text={out.prep} /></div>}
    </div>
  );
}

export function TextResult({ title, text }) {
  const app = useApp();
  return (
    <motion.div className="card pad" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} data-testid="ai-text-result">
      <div className="row between"><div className="section-title" style={{ margin: 0 }}>{title}</div><Button size="sm" variant="ghost" icon={Copy} onClick={async () => { await copyText(text); app.toast('Copied', 'success'); }}>Copy</Button></div>
      <div className="prewrap small" style={{ marginTop: 10, lineHeight: 1.7 }}>{text}</div>
    </motion.div>
  );
}

export function TailorResult({ r }) {
  return (
    <motion.div className="card pad col" style={{ gap: 14 }} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
      <div className="row" style={{ gap: 14 }}>
        <ScoreRing score={r.atsScore} size={60} stroke={6} />
        <div className="grow"><div className="section-title" style={{ margin: 0 }}>ATS match</div><div className="small">{r.verdict}</div></div>
      </div>
      {r.missingKeywords.length > 0 && <div><span className="label">Missing keywords</span><div className="chips">{r.missingKeywords.map((k) => <span key={k} className="badge amber">{k}</span>)}</div></div>}
      <div><span className="label">Tailored summary</span><div className="small prewrap">{r.tailoredSummary}</div></div>
      {r.bulletRewrites.length > 0 && (
        <div><span className="label">Bullet rewrites</span>
          <div className="col">{r.bulletRewrites.map((b, i) => (
            <div key={i} className="small" style={{ borderLeft: '2px solid var(--accent)', paddingLeft: 10 }}>
              <div className="dim" style={{ textDecoration: 'line-through' }}>{b.original}</div>
              <div style={{ marginTop: 4 }}>{b.improved}</div>
            </div>
          ))}</div>
        </div>
      )}
      {r.tips.length > 0 && <div><span className="label">Tips</span><ul className="small" style={{ margin: 0, paddingLeft: 18 }}>{r.tips.map((t, i) => <li key={i}>{t}</li>)}</ul></div>}
    </motion.div>
  );
}

function fillTemplate(tpl, job, p) {
  return tpl.replace(/\{(\w+)\}/g, (m, k) => ({
    company: job.company, title: job.title, firstName: p.firstName, lastName: p.lastName,
    years: p.totalYearsExperience, skills: (p.skills || []).slice(0, 3).join(', '),
  }[k] ?? m));
}

/** Quick-fill: one-tap copy for every profile field, saved answers, resume file and cover letter. */
export function QuickFillSheet({ open, job, resumeId, profileId, onClose }) {
  const app = useApp();
  const p = getProfile(app, profileId).values || {};
  const [filter, setFilter] = useState('');
  const [letter, setLetter] = useState('');
  const [busy, setBusy] = useState(false);
  const args = useAiArgs(resumeId, job, profileId);
  const resume = job ? pickResumeFor(app, job, resumeId, getProfile(app, profileId).id) : null;
  useEffect(() => { if (open) { setFilter(''); setLetter(''); } }, [open, job && job.id]);
  const onCopied = (ok, k) => app.toast(ok ? `${k} copied` : 'Copy failed. Long-press to copy instead.', ok ? 'success' : 'error');
  const name = [p.firstName, p.middleName, p.lastName].filter(Boolean).join(' ');
  const exp = p.expectedSalaryMin || p.expectedSalaryMax ? [p.expectedSalaryMin, p.expectedSalaryMax].filter(Boolean).join('–') : '';
  const edu = (p.education || [])[0] || {};
  const groups = useMemo(() => [
    ['Contact', [['Full name', name], ['First name', p.firstName], ['Last name', p.lastName], ['Preferred name', p.preferredName], ['Email', p.email], ['Phone', [p.phoneCountryCode, p.phone].filter(Boolean).join(' ')], ['Phone (digits only)', p.phone]]],
    ['Location', [['City', p.city], ['State / Province', p.state], ['Country', p.country], ['City, Country', [p.city, p.country].filter(Boolean).join(', ')], ['Street address', [p.addressLine1, p.addressLine2].filter(Boolean).join(', ')], ['Postal code', p.postalCode], ['Time zone', p.timezone]]],
    ['Links', [['LinkedIn', p.linkedin], ['GitHub', p.github], ['Portfolio', p.portfolio], ['Website', p.website], ['X / Twitter', p.twitter], ['LeetCode / HackerRank', p.leetcode], ['Dribbble / Behance', p.dribbble], ['Other link', p.otherLink]]],
    ['Work authorization', [['Authorized to work in', p.authorizedCountries], ['Needs visa sponsorship', p.needsSponsorship], ['US work status', p.workAuthUS], ['UK work status', p.workAuthUK], ['EU work status', p.workAuthEU], ['Canada work status', p.workAuthCanada], ['Visa details', p.visaDetails], ['Willing to relocate', p.willingToRelocate], ['Security clearance', p.securityClearance], ['18 or older', p.over18]]],
    ['Compensation & availability', [['Current salary', p.currentSalary != null && p.currentSalary !== '' ? `${p.currentSalary}${p.salaryCurrency ? ` ${p.salaryCurrency}` : ''}` : ''], ['Expected salary', exp ? `${exp}${p.salaryCurrency ? ` ${p.salaryCurrency}` : ''}${p.salaryPeriod ? ` (${p.salaryPeriod.toLowerCase()})` : ''}` : ''], ['Expected salary (number)', p.expectedSalaryMin], ['Notice period', p.noticePeriodDays !== undefined && p.noticePeriodDays !== '' ? `${p.noticePeriodDays} days` : ''], ['Earliest start date', p.availableFrom], ['Willing to travel', p.travelPercent ? `${p.travelPercent}%` : '']]],
    ['Experience', [['Current title', p.currentTitle], ['Current company', p.currentCompany], ['Years of experience', p.totalYearsExperience], ['Headline', p.headline], ['Skills', p.skills], ['Languages', p.languages], ['Summary', p.summary, true]]],
    ['Education', [['School', edu.school], ['Degree', edu.degree], ['Field of study', edu.field], ['Graduation', edu.endDate], ['GPA', edu.gpa]]],
    ['Application', [['How did you hear about us', p.howDidYouHear], ['Why are you interested', p.whyInterested, true], ['Additional information', p.additionalInfo, true]]],
  ], [p, name, exp, edu]);
  const f = filter.trim().toLowerCase();
  const match = (k, v) => !f || k.toLowerCase().includes(f) || String(Array.isArray(v) ? v.join(' ') : v ?? '').toLowerCase().includes(f);
  const answers = app.qa.filter((q) => q.answer && match(q.question, q.answer));
  const empty = !Object.keys(p).length;

  const downloadResume = async () => {
    if (!resume || !resume.blobId) return;
    try { const bytes = await app.sync.getBlob(resume.blobId); downloadFile(resume.fileName || `${resume.name}${resume.ext || ''}`, bytes, resume.ext === '.pdf' ? 'application/pdf' : 'application/octet-stream'); } catch (e) { app.toast(e.message, 'error'); }
  };
  const genLetter = async () => {
    setBusy(true);
    try { setLetter(await coverLetter({ ...args, job })); } catch (e) { app.toast(aiError(e), 'error'); } finally { setBusy(false); }
  };

  return (
    <Sheet open={open && !!job} onClose={onClose} tall label="Quick-fill" header={job && (
      <div><h2 style={{ marginTop: 2 }}>Quick-fill</h2><div className="small muted ellipsis">{job.title} · {job.company}</div></div>
    )} footer={job && (
      <>
        <Button icon={ExternalLink} onClick={() => openExternal(job.applyUrl || job.url)}>Reopen form</Button>
        <Button variant="primary" icon={Check} onClick={async () => { try { await upsertApplication(app, job, 'applied', { resumeId }); app.toast('Marked as applied', 'success'); onClose(); } catch (e) { app.toast(e.message, 'error'); } }} data-testid="mark-applied">I applied</Button>
      </>
    )}>
      <div className="col" style={{ gap: 16 }} data-testid="quickfill">
        <div className="search-wrap"><Search size={16} /><input className="input" value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Find a field…" aria-label="Find a field" /></div>
        {empty && <div className="card pad small" style={{ borderColor: 'rgba(251,191,36,.35)' }}>Your profile is empty. <a href="#/profile" onClick={(e) => { e.preventDefault(); onClose(); go('profile'); }}>Fill it once</a> and every field shows up here.</div>}
        {!f && job && (job.ats === 'workable' || /workable\.com/i.test(job.applyUrl || job.url || '')) && (
          <div className="card pad small col" style={{ gap: 4, borderColor: 'rgba(251,191,36,.35)' }} data-testid="identity-check">
            <b>Check the form shows your details</b>
            <span className="muted">Workable can restore a saved draft from an earlier person in this browser. Your name and email on the form should read {name || 'your name'}{p.email ? ` · ${p.email}` : ''}. Change anything that differs, or open the form in a private window.</span>
          </div>
        )}
        {resume && !f && (
          <div className="card pad row" style={{ gap: 10 }}>
            <FileText size={18} className="dim" />
            <div className="grow"><div className="small" style={{ fontWeight: 600 }}>{resume.name}</div><div className="tiny dim">Resume picked for this job</div></div>
            {resume.blobId && <Button size="sm" icon={Download} onClick={downloadResume}>File</Button>}
          </div>
        )}
        {groups.map(([title, rows]) => {
          const visible = rows.filter(([k, v]) => v !== undefined && v !== null && v !== '' && !(Array.isArray(v) && !v.length) && match(k, v));
          if (!visible.length) return null;
          return (
            <div key={title}>
              <div className="label">{title}</div>
              <div className="col" style={{ gap: 6 }}>{visible.map(([k, v, ml]) => <CopyRow key={k} k={k} v={v} multiline={ml} onCopied={onCopied} />)}</div>
            </div>
          );
        })}
        {answers.length > 0 && (
          <div>
            <div className="label">Answer bank</div>
            <div className="col" style={{ gap: 6 }}>{answers.map((q) => <CopyRow key={q.id} k={q.question} v={q.answer} multiline onCopied={onCopied} />)}</div>
          </div>
        )}
        {!f && (
          <div>
            <div className="label">Cover letter</div>
            <div className="card pad col" style={{ gap: 10 }}>
              {letter ? <CopyRow k="AI cover letter" v={letter} multiline onCopied={onCopied} />
                : p.coverLetterTemplate ? <CopyRow k="From your template" v={fillTemplate(p.coverLetterTemplate, job || {}, p)} multiline onCopied={onCopied} /> : null}
              <Button icon={Sparkles} loading={busy} disabled={!args.apiKey} onClick={genLetter}>{letter ? 'Write another' : 'Write with AI'}</Button>
              {!args.apiKey && <div className="tiny dim">Add an Anthropic key in AI studio to generate one.</div>}
            </div>
          </div>
        )}
      </div>
    </Sheet>
  );
}

// ---------------------------------------------------------------- swipe triage
function SwipeCard({ job, onSwipe, onOpen, rightLabel }) {
  const x = useMotionValue(0);
  const rotate = useTransform(x, [-220, 220], [-12, 12]);
  const likeOpacity = useTransform(x, [30, 120], [0, 1]);
  const nopeOpacity = useTransform(x, [-120, -30], [1, 0]);
  const m = job.match || {};
  return (
    <motion.div className={`card ${m.score >= 88 ? 'premium premium-shimmer' : ''}`} data-testid="swipe-card"
      style={{ x, rotate, position: 'absolute', inset: 0, overflow: 'hidden', touchAction: 'pan-y', cursor: 'grab', display: 'flex', flexDirection: 'column' }}
      drag="x" dragSnapToOrigin dragElastic={0.9}
      onDragEnd={(_, info) => {
        if (info.offset.x > 110 || info.velocity.x > 700) onSwipe('right', x);
        else if (info.offset.x < -110 || info.velocity.x < -700) onSwipe('left', x);
      }}
      onTap={() => onOpen(job)}
      initial={{ scale: 0.96, opacity: 0, y: 10 }} animate={{ scale: 1, opacity: 1, y: 0 }} exit={{ opacity: 0, transition: { duration: 0.15 } }}>
      <motion.div style={{ opacity: likeOpacity, position: 'absolute', top: 16, left: 16, zIndex: 3, rotate: -10 }} className="badge green"><span style={{ fontSize: 14, padding: '2px 6px' }}>{rightLabel.toUpperCase()}</span></motion.div>
      <motion.div style={{ opacity: nopeOpacity, position: 'absolute', top: 16, right: 16, zIndex: 3, rotate: 10 }} className="badge red"><span style={{ fontSize: 14, padding: '2px 6px' }}>SKIP</span></motion.div>
      <div style={{ padding: 18, position: 'relative', zIndex: 2, flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div className="row" style={{ gap: 14, alignItems: 'flex-start', marginTop: 22 }}>
          <Logo name={job.company} />
          <div className="grow">
            <div className="card-title" style={{ fontSize: 19, lineHeight: 1.25, overflowWrap: 'anywhere' }}>{job.title}</div>
            <div className="small muted" style={{ marginTop: 4 }}>{job.company}{job.location ? ` · ${job.location}` : ''}</div>
          </div>
          {m.score != null && <ScoreRing score={m.score} size={54} stroke={5} />}
        </div>
        <div className="chips">
          {job.remote && <span className="badge">Remote</span>}
          <SponsorBadge s={m.sponsorship} />
          {(job.blockers || []).length > 0 && <span className="badge red"><CircleAlert size={10} />{job.blockers[0]}</span>}
          {AUTO_ATS.includes(job.ats) && <span className="badge green"><Zap size={10} />auto</span>}
          <span className="badge">{salary(job)}</span>
          {job.postedAt && <span className="badge"><Clock size={10} />{timeAgo(job.postedAt)}</span>}
        </div>
        {m.matchedSkills && m.matchedSkills.length > 0 && <div className="chips">{m.matchedSkills.slice(0, 6).map((s) => <span key={s} className="badge green">✓ {s}</span>)}</div>}
        <p className="small muted" style={{ margin: 0, overflow: 'hidden', flex: 1, minHeight: 0, overflowWrap: 'anywhere', maskImage: 'linear-gradient(#000 70%, transparent)', WebkitMaskImage: 'linear-gradient(#000 70%, transparent)' }}>{(job.description || '').replace(/\s+/g, ' ').slice(0, 700)}</p>
        <div className="tiny dim row" style={{ gap: 6 }}><Info size={12} />Tap for details · swipe right to {rightLabel.toLowerCase()}, left to skip</div>
      </div>
    </motion.div>
  );
}

export function SwipeDeck({ jobs, onOpen, onDone }) {
  const app = useApp();
  const [rightAction, setRightAction] = useState('send'); // send | save
  const [checkJob, setCheckJob] = useState(null); // job waiting for the confirmation sheet
  const [gone, setGone] = useState(() => new Set());
  const [last, setLast] = useState(null);
  const [busy, setBusy] = useState(false);
  const deck = jobs.filter((j) => !gone.has(j.id));
  const top = deck[0];
  const rightLabel = rightAction === 'send' ? 'Send to laptop' : 'Save';

  const act = async (dir, x) => {
    if (!top || busy) return;
    const job = top;
    if (dir === 'right' && isScam(job)) {
      app.toast("This posting looks like a scam, so it can't be saved or sent. Swipe left to skip it.", 'error');
      if (x) animate(x, 0, { type: 'spring', stiffness: 400, damping: 30 });
      return;
    }
    // Sending to the laptop always goes through the check sheet; the card waits until it is confirmed.
    if (dir === 'right' && rightAction === 'send') {
      if (x) animate(x, 0, { type: 'spring', stiffness: 400, damping: 30 });
      setCheckJob(job);
      return;
    }
    setBusy(true);
    if (x) await animate(x, dir === 'right' ? 520 : -520, { duration: 0.22 });
    setGone((g) => new Set(g).add(job.id));
    try {
      if (dir === 'left') { const rec = await skipJob(app, job); setLast({ type: 'skip', job, rec }); }
      else if (rightAction === 'send') { const item = await sendToLaptop(app, job); setLast({ type: 'send', job, item }); app.toast('Sent to your laptop', 'success'); }
      else { await saveJob(app, job); setLast({ type: 'save', job }); app.toast('Saved', 'success'); }
    } catch (e) {
      app.toast(e.message, 'error');
      setGone((g) => { const n = new Set(g); n.delete(job.id); return n; });
    } finally { setBusy(false); }
  };
  const undo = async () => {
    if (!last) return;
    try {
      if (last.type === 'skip' && last.rec) await app.remove('applications', last.rec.id);
      if (last.type === 'send' && last.item) await app.remove('outbox', last.item.id);
      if (last.type === 'save') await unsaveJob(app, last.job);
      setGone((g) => { const n = new Set(g); n.delete(last.job.id); return n; });
      setLast(null);
    } catch (e) { app.toast(e.message, 'error'); }
  };

  return (
    <div className="col" style={{ gap: 12 }} data-testid="swipe-deck">
      <div className="row between wrap" style={{ gap: 8 }}>
        <span className="small muted"><b style={{ color: 'var(--fg)' }} data-testid="swipe-left-count">{deck.length}</b> to review</span>
        <div className="row" style={{ gap: 6 }}><span className="tiny dim">Swipe right =</span><Seg value={rightAction} onChange={setRightAction} options={[{ value: 'send', label: 'Laptop' }, { value: 'save', label: 'Save' }]} /></div>
      </div>
      <div style={{ position: 'relative', height: 'min(480px, calc(100dvh - 380px - var(--safe-bottom)))', minHeight: 320 }}>
        <AnimatePresence>
          {deck[1] && <motion.div key={`${deck[1].id}-under`} className="card" style={{ position: 'absolute', inset: 0, transform: 'scale(.95) translateY(12px)', opacity: 0.5 }} initial={{ opacity: 0 }} animate={{ opacity: 0.5 }} exit={{ opacity: 0 }} />}
          {top ? <SwipeCard key={top.id} job={top} onSwipe={act} onOpen={onOpen} rightLabel={rightLabel} />
            : (
              <motion.div key="done" className="empty" style={{ position: 'absolute', inset: 0, display: 'grid', placeContent: 'center' }} initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
                <Check size={30} color="var(--green)" />
                <h3>All caught up</h3>
                <div className="small">Search again or switch to the list view.</div>
                {onDone && <div style={{ marginTop: 14 }}><Button onClick={onDone}>Show list</Button></div>}
              </motion.div>
            )}
        </AnimatePresence>
      </div>
      <ApplyCheck open={!!checkJob} job={checkJob} mode="review" onClose={() => setCheckJob(null)} onSent={() => { const id = checkJob && checkJob.id; if (id) setGone((g) => new Set(g).add(id)); }} />
      <div className="row" style={{ justifyContent: 'center', gap: 14 }}>
        <Button variant="outline" icon={Undo2} aria-label="Undo" disabled={!last || busy} onClick={undo} />
        <Button variant="danger" icon={X} aria-label="Skip" disabled={!top || busy} onClick={() => act('left')} data-testid="swipe-skip" style={{ width: 60, height: 60, borderRadius: 999 }} />
        <Button variant="outline" icon={Info} aria-label="Details" disabled={!top} onClick={() => top && onOpen(top)} />
        <Button variant="primary" icon={rightAction === 'send' ? Laptop : Bookmark} aria-label={rightLabel} disabled={!top || busy} onClick={() => act('right')} data-testid="swipe-right" style={{ width: 60, height: 60, borderRadius: 999 }} />
      </div>
    </div>
  );
}

