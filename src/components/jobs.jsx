import React, { useEffect, useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { ShieldAlert, Plane, Users, Building2, Newspaper, MessagesSquare, Star as StarIcon, Banknote, MapPin, Clock, ExternalLink, Bookmark, BookmarkX, Send, Wand2, Zap, Sparkles, Copy, FileText, MessageSquareText, GraduationCap, ShieldCheck, CircleAlert } from 'lucide-react';
import { useApp } from '../lib/store';
import { Button, Drawer, Logo, ScoreRing, StatusBadge, Markdown, Seg, timeAgo, salary, stagger } from './ui';
import { useDetailsCheck } from './DetailsCheck';

export const AUTO_ATS = ['greenhouse', 'lever', 'ashby', 'workable', 'smartrecruiters', 'recruitee'];
export const SOURCE_LABEL = (id, connectors = []) => (connectors.find((c) => c.id === id) || {}).name || id;

export function JobCard({ job, onOpen, index = 0 }) {
  const { connectors } = useApp();
  const score = job.match ? job.match.score : null;
  const top = score >= 88;
  return (
    <motion.div {...stagger(index)} className={`card clickable ${top ? 'premium premium-shimmer' : ''}`} onClick={() => onOpen(job)} style={{ overflow: 'hidden' }}>
      <div style={{ position: 'absolute', top: 0, right: 0, display: 'flex', gap: 6, padding: '6px 8px', zIndex: 2 }}>
        {AUTO_ATS.includes(job.ats) && <span className="badge green" title="ApplyPilot can fill this form automatically"><Zap size={10} />auto-apply</span>}
        {job.match && job.match.sponsorship === 'offered' && <span className="badge blue" title="The posting says visa sponsorship is available"><Plane size={10} />visa</span>}
        {job.appStatus && <StatusBadge status={job.appStatus} />}
      </div>
      <div style={{ padding: 18, position: 'relative', zIndex: 2 }}>
        <div className="row" style={{ alignItems: 'flex-start', gap: 14 }}>
          <Logo name={job.company} src={job.companyLogo} />
          <div className="grow">
            <div className="card-title" title={job.title} style={{ paddingRight: AUTO_ATS.includes(job.ats) || job.appStatus ? 92 : 0, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden', lineHeight: 1.3 }}>{job.title}</div>
            <div className="row wrap" style={{ gap: 6, marginTop: 6 }}>
              <span className="badge accent">{job.company || 'Unknown company'}</span>
              {job.remote && <span className="badge">Remote</span>}
              {job.employmentType && <span className="badge">{job.employmentType}</span>}
            </div>
          </div>
        </div>
        <p className="small muted" style={{ margin: '12px 0 0', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden', minHeight: 40 }}>
          {(job.description || '').replace(/\s+/g, ' ').slice(0, 220)}
        </p>
      </div>
      <div style={{ borderTop: '1px solid var(--border)', padding: '12px 18px', display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1.2fr', gap: 10, position: 'relative', zIndex: 2 }}>
        <div className="metric"><div className="k">Match</div><div className="v" style={{ color: score >= 80 ? 'var(--green)' : score >= 60 ? 'var(--fg)' : 'var(--muted)' }}>{score ?? '—'}{score != null && '%'}</div></div>
        <div className="metric"><div className="k">Salary</div><div className="v ellipsis">{salary(job)}</div></div>
        <div className="metric"><div className="k">Posted</div><div className="v">{job.postedAt ? timeAgo(job.postedAt).replace(' ago', '') : '—'}</div></div>
        <div className="metric"><div className="k">Where</div><div className="v ellipsis small" style={{ fontSize: 14 }}>{job.location || (job.remote ? 'Remote' : '—')}</div></div>
      </div>
      <div style={{ padding: '0 18px 12px', position: 'relative', zIndex: 2 }} className="tiny dim">
        via {SOURCE_LABEL(job.source, connectors)}{job.alsoOn && job.alsoOn.length ? ` · also on ${job.alsoOn.length} more` : ''}
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

export function JobDrawer({ job, onClose }) {
  const app = useApp();
  const { ensure: ensureDetails, dialog: detailsDialog } = useDetailsCheck();
  const [tab, setTab] = useState('details');
  const [resumeId, setResumeId] = useState('auto');
  const [profileId, setProfileId] = useState(null); // null = this job's current application profile, else main
  const [mode, setMode] = useState(app.settings.defaultApplyMode || 'review');
  const [busy, setBusy] = useState(null);
  const [aiOut, setAiOut] = useState({});
  const profiles = app.profiles || [];
  const multi = profiles.length > 1;
  const forJob = useMemo(() => (job ? app.applications.filter((a) => a.jobId === job.id) : []), [job, app.applications]);
  // The profile applying: the one picked here, else the profile of this job's latest application, else main.
  const activeProfile = profileId || (forJob[0] ? forJob[0].profileId || 'main' : 'main');
  const application = useMemo(() => forJob.find((a) => (a.profileId || 'main') === activeProfile) || (!multi ? forJob[0] : null) || null, [forJob, activeProfile, multi]);
  const [market, setMarket] = useState(null);
  const [people, setPeople] = useState(null);
  useEffect(() => { setProfileId(null); }, [job && job.id]); // eslint-disable-line
  useEffect(() => { setMarket(null); setPeople(null); if (job) { app.run('insights:salary', [job.id]).then(setMarket).catch(() => {}); app.run('network:forCompany', [job.company]).then(setPeople).catch(() => {}); } }, [job && job.id]); // eslint-disable-line
  if (!job) return <Drawer open={false} onClose={onClose} />;
  const m = job.match;
  const canAuto = AUTO_ATS.includes(job.ats);

  const apply = async () => {
    if (!(await ensureDetails(activeProfile))) return; // missing name/email/phone/location are asked for first
    setBusy('apply');
    try {
      await app.run('jobs:apply', [job.id, { resumeId, mode, ...(multi ? { profileId: activeProfile } : {}) }], mode === 'auto' ? 'Applying in the background…' : 'Opening the application and filling it in…');
    } finally { setBusy(null); }
  };
  const save = async () => { setBusy('save'); try { await app.run('jobs:save', [job.id], 'Saved to Applications'); } finally { setBusy(null); } };
  const ai = async (kind, channel, args) => {
    setBusy(kind);
    try { const r = await app.run(channel, args); setAiOut((o) => ({ ...o, [kind]: r })); } catch {} finally { setBusy(null); }
  };

  return (
    <>
    <Drawer open={!!job} onClose={onClose} header={(
      <div className="row" style={{ alignItems: 'flex-start', gap: 14, paddingRight: 40 }}>
        <Logo name={job.company} src={job.companyLogo} />
        <div className="grow">
          <h2 style={{ margin: 0, fontSize: 22, lineHeight: 1.25 }}>{job.title}</h2>
          <div className="row wrap small muted" style={{ marginTop: 6, gap: 12 }}>
            <span style={{ color: 'var(--fg)', fontWeight: 600 }}>{job.company}</span>
            {job.location && <span className="row" style={{ gap: 4 }}><MapPin size={13} />{job.location}</span>}
            {job.postedAt && <span className="row" style={{ gap: 4 }}><Clock size={13} />{timeAgo(job.postedAt)}</span>}
            <span>{salary(job)}</span>
          </div>
          <div className="row wrap" style={{ marginTop: 14, gap: 8 }}>
            {application ? <StatusBadge status={application.status} /> : null}
            <Seg value={tab} onChange={setTab} options={[{ value: 'details', label: 'Details' }, { value: 'apply', label: 'Apply' }, { value: 'ai', label: 'AI tools' }]} />
            <Button size="sm" icon={ExternalLink} onClick={() => app.run('shell:open', [job.url || job.applyUrl])}>Open posting</Button>
            {!application && <Button size="sm" icon={Bookmark} loading={busy === 'save'} onClick={save}>Save</Button>}
            {application && ['saved', 'skipped'].includes(application.status) && <Button size="sm" variant="ghost" icon={BookmarkX} onClick={async () => {
              await app.run('applications:delete', [application.id], 'Removed from your tracker');
              app.set((s) => ({ applications: s.applications.filter((x) => x.id !== application.id) }));
            }}>{application.status === 'saved' ? 'Unsave' : 'Un-skip'}</Button>}
          </div>
        </div>
      </div>
    )}>
      {tab === 'details' && (
        <div className="col" style={{ gap: 18 }}>
          {m && (
            <div className="card pad">
              <div className="row" style={{ gap: 18, alignItems: 'flex-start' }}>
                <ScoreRing score={m.score} size={72} stroke={6} />
                <div className="grow col" style={{ gap: 8 }}>
                  <div className="grid g2" style={{ gap: 10 }}>
                    <Bar label="Title fit" value={m.breakdown.title} />
                    <Bar label="Skills" value={m.breakdown.skills} />
                    <Bar label="Experience" value={m.breakdown.experience} />
                    <Bar label="Location" value={m.breakdown.location} />
                  </div>
                  <div className="small muted">{m.reasons.join(' · ')}</div>
                </div>
              </div>
              {(m.matchedSkills.length > 0 || m.missingSkills.length > 0) && <hr className="hr" />}
              {m.matchedSkills.length > 0 && <div className="chips" style={{ marginBottom: 8 }}>{m.matchedSkills.map((s) => <span key={s} className="badge green">✓ {s}</span>)}</div>}
              {m.missingSkills.length > 0 && <div className="chips">{m.missingSkills.map((s) => <span key={s} className="badge amber">+ {s}</span>)}</div>}
              {m.eligibility && !m.eligibility.ok && <div className="row small" style={{ marginTop: 12, color: 'var(--red)', alignItems: 'flex-start' }}><ShieldAlert size={14} style={{ flexShrink: 0, marginTop: 2 }} /><span><b>Not a fit:</b> {m.eligibility.blockers.join(' · ')}{m.eligibility.scam.length ? ' — ApplyPilot will not send your details to this posting.' : ''}</span></div>}
              {m.flags && m.flags.filter((x) => !(m.eligibility && m.eligibility.blockers.includes(x))).length > 0 && <div className="row small" style={{ marginTop: 12, color: 'var(--amber)' }}><CircleAlert size={14} />{m.flags.filter((x) => !(m.eligibility && m.eligibility.blockers.includes(x))).join(' · ')}</div>}
            </div>
          )}
          {market && market.median && (
            <div className="card pad row" style={{ gap: 14 }}>
              <Banknote size={18} color="var(--green)" />
              <div className="grow">
                <div className="label" style={{ margin: 0 }}>Market pay for similar roles</div>
                <div style={{ fontWeight: 700 }}>{salary({ salaryMin: market.p25, salaryMax: market.p75, salaryCurrency: market.currency })} <span className="small muted">· median {salary({ salaryMin: market.median, salaryCurrency: market.currency })}</span></div>
                <div className="tiny dim">From {market.count} similar jobs ApplyPilot has seen (25th–75th percentile). Use it to set your expected salary.</div>
              </div>
            </div>
          )}
          <div className="card pad">
            <div className="section-title"><Users size={14} />Research & referrals</div>
            {people && people.length > 0 && (
              <div style={{ marginBottom: 12 }}>
                <div className="small" style={{ fontWeight: 700, color: 'var(--green)', marginBottom: 6 }}>You know {people.length} {people.length === 1 ? 'person' : 'people'} at {job.company}</div>
                <div className="col" style={{ gap: 4 }}>
                  {people.slice(0, 6).map((p) => (
                    <div key={p.url || p.name} className="row small" style={{ gap: 8 }}>
                      <span style={{ fontWeight: 600 }}>{p.name}</span><span className="muted ellipsis grow">{p.position}</span>
                      {p.url && <a href="#" onClick={(e) => { e.preventDefault(); app.run('shell:open', [p.url]); }}>Profile ↗</a>}
                    </div>
                  ))}
                </div>
              </div>
            )}
            <div className="chips">
              {[
                ['People at ' + job.company, `https://www.linkedin.com/search/results/people/?keywords=${encodeURIComponent(`${job.company} ${(job.title || '').split(/[,(-]/)[0]}`)}`, Users],
                ['Company page', `https://www.linkedin.com/search/results/companies/?keywords=${encodeURIComponent(job.company)}`, Building2],
                ['Reviews (Glassdoor)', `https://www.google.com/search?q=${encodeURIComponent(`${job.company} reviews site:glassdoor.com`)}`, StarIcon],
                ['Reviews (AmbitionBox)', `https://www.google.com/search?q=${encodeURIComponent(`${job.company} reviews site:ambitionbox.com`)}`, StarIcon],
                ['Interview questions', `https://www.google.com/search?q=${encodeURIComponent(`${job.company} ${job.title} interview questions`)}`, MessagesSquare],
                ['Latest news', `https://news.google.com/search?q=${encodeURIComponent(job.company)}`, Newspaper],
              ].map(([label, url, Icon]) => <span key={label} className="chip" onClick={() => app.run('shell:open', [url])}><Icon size={12} />{label}</span>)}
            </div>
            <div className="tiny dim" style={{ marginTop: 8 }}>{people && people.length ? 'Ask one of them for a referral — AI tools → "Ask for a referral" writes the message.' : <>A referral makes you several times more likely to get an interview. <a href="#" onClick={(e) => { e.preventDefault(); onClose(); app.go('settings', { tab: 'network' }); }}>Import your LinkedIn connections</a> to see who you already know here.</>}</div>
          </div>
          <div className="row wrap" style={{ gap: 6 }}>
            {canAuto ? <span className="badge green"><Zap size={11} />ApplyPilot fills this {job.ats} form automatically</span>
              : <span className="badge amber"><ShieldCheck size={11} />Assisted apply: we fill, you click submit</span>}
            {(job.tags || []).slice(0, 8).map((t) => <span key={t} className="badge">{t}</span>)}
          </div>
          <div className="prewrap small" style={{ color: '#d4d4d4', lineHeight: 1.7 }}>{job.description || 'No description provided. Open the posting for details.'}</div>
        </div>
      )}

      {tab === 'apply' && (
        <div className="col" style={{ gap: 18 }}>
          <div className="card pad col" style={{ gap: 16 }}>
            {multi && (
              <div>
                <span className="label">Apply as</span>
                <select className="select" value={activeProfile} onChange={(e) => { setProfileId(e.target.value); setResumeId('auto'); }}>
                  {profiles.map((p) => <option key={p.id} value={p.id}>{p.label}{p.isDefault ? ' (default)' : ''}</option>)}
                </select>
                <div className="tiny dim" style={{ marginTop: 4 }}>Uses this profile's details and resumes. Each profile keeps its own application for a job.</div>
              </div>
            )}
            <div>
              <span className="label">Resume for this application</span>
              <select className="select" value={resumeId} onChange={(e) => setResumeId(e.target.value)}>
                <option value="auto">✨ Auto-pick best match</option>
                {app.resumes.filter((r) => !r.profileId || r.profileId === activeProfile).map((r) => <option key={r.id} value={r.id}>{r.name}{r.isDefault ? ' (default)' : ''}</option>)}
              </select>
              {!app.resumes.length && <div className="small" style={{ color: 'var(--amber)', marginTop: 6 }}>Upload a resume first in the Resumes tab.</div>}
            </div>
            <div>
              <span className="label">How should ApplyPilot apply?</span>
              <Seg value={mode} onChange={setMode} options={[{ value: 'review', label: 'Fill & let me submit' }, { value: 'auto', label: canAuto ? 'Fully automatic' : 'Fully automatic (n/a)' }]} />
              <div className="small muted" style={{ marginTop: 8 }}>
                {mode === 'auto' ? (canAuto ? (app.plan.autoSubmit ? 'Fills every field and submits when all required answers are known. Anything uncertain lands in your Review queue.' : 'Auto-submit is a Pro feature — on Free we fill everything and you click submit.') : 'This site does not allow automated submission. ApplyPilot fills the form and you click submit.')
                  : 'A browser tab opens with everything filled in. Review it and press submit — we detect the confirmation and log it.'}
              </div>
            </div>
            <Button variant="primary" size="lg" icon={Send} loading={busy === 'apply'} disabled={!app.resumes.length} onClick={apply}>{application ? 'Apply again' : 'Apply now'}</Button>
          </div>
          {application && (
            <div className="card pad">
              <div className="section-title">Application log</div>
              <div className="col" style={{ gap: 6 }}>
                {(application.events || []).slice().reverse().map((e, i) => (
                  <div key={i} className="row small" style={{ alignItems: 'flex-start' }}><span className="dim mono-num" style={{ width: 70, flexShrink: 0 }}>{new Date(e.t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span><span>{e.message}</span></div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {tab === 'ai' && (
        <div className="col" style={{ gap: 14 }}>
          {!app.settings.keys.anthropic && <div className="card pad small" style={{ borderColor: 'rgba(251,191,36,.3)' }}>Add your Anthropic API key in <a href="#" onClick={(e) => { e.preventDefault(); onClose(); app.go('settings', { tab: 'ai' }); }}>Settings → AI</a> to unlock these tools.</div>}
          <div className="grid g2">
            <Button icon={Sparkles} loading={busy === 'tailor'} onClick={() => ai('tailor', 'ai:tailor', [job.id, resumeId])}>ATS check & tailor resume</Button>
            <Button variant="primary" icon={FileText} loading={busy === 'pdf'} onClick={() => ai('pdf', 'resume:tailor', [job.id, resumeId])}>Tailored resume PDF</Button>
            <Button icon={FileText} loading={busy === 'cover'} onClick={() => ai('cover', 'ai:coverLetter', [job.id, resumeId])}>Write cover letter</Button>
            <Button icon={GraduationCap} loading={busy === 'prep'} onClick={() => ai('prep', 'ai:interviewPrep', [job.id, resumeId])}>Interview prep pack</Button>
            <Button icon={MessageSquareText} loading={busy === 'outreach'} onClick={() => ai('outreach', 'ai:outreach', [job.id, 'recruiter'])}>Message the recruiter</Button>
            <Button icon={Users} loading={busy === 'referral'} onClick={() => ai('referral', 'ai:outreach', [job.id, 'referral'])}>Ask for a referral</Button>
          </div>
          {aiOut.pdf && <TailoredPdfResult r={aiOut.pdf} />}
          {aiOut.tailor && <TailorResult r={aiOut.tailor} />}
          {aiOut.cover && <TextResult title="Cover letter" text={aiOut.cover} />}
          {aiOut.outreach && <TextResult title="Recruiter message" text={aiOut.outreach} />}
          {aiOut.referral && <TextResult title="Referral request" text={aiOut.referral} />}
          {aiOut.prep && <div className="card pad"><div className="section-title">Interview prep</div><Markdown text={aiOut.prep} /></div>}
        </div>
      )}
    </Drawer>
    {detailsDialog}
    </>
  );
}

export function TailoredPdfResult({ r }) {
  const app = useApp();
  return (
    <motion.div className="card pad col premium" style={{ gap: 10 }} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
      <div className="row between"><div className="section-title" style={{ margin: 0 }}><FileText size={14} />Tailored resume ready</div>
        <Button size="sm" icon={ExternalLink} onClick={() => app.run('shell:openPath', [r.path])}>Open PDF</Button></div>
      <div className="small muted">{r.fileName} · {r.attachedTo ? 'will be uploaded for this application' : 'save or apply to this job to use it automatically'}</div>
      {r.changes && r.changes.length > 0 && <div><span className="label">What was tailored</span><ul className="small" style={{ margin: 0, paddingLeft: 18 }}>{r.changes.map((c, i) => <li key={i}>{c}</li>)}</ul></div>}
      {r.removed && r.removed.length > 0 && <div className="small" style={{ color: 'var(--amber)' }}>Truth check removed {r.removed.length} item(s) the AI tried to add: {r.removed.join('; ')}</div>}
    </motion.div>
  );
}

export function TextResult({ title, text }) {
  const app = useApp();
  return (
    <motion.div className="card pad" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
      <div className="row between"><div className="section-title" style={{ margin: 0 }}>{title}</div><Button size="sm" variant="ghost" icon={Copy} onClick={() => { navigator.clipboard.writeText(text); app.toast('Copied', 'success'); }}>Copy</Button></div>
      <div className="prewrap small" style={{ marginTop: 10, lineHeight: 1.7 }}>{text}</div>
    </motion.div>
  );
}

export function TailorResult({ r }) {
  return (
    <motion.div className="card pad col" style={{ gap: 14 }} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
      <div className="row" style={{ gap: 16 }}>
        <ScoreRing score={r.atsScore} size={64} stroke={6} />
        <div><div className="section-title" style={{ margin: 0 }}>ATS match</div><div className="small">{r.verdict}</div></div>
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

