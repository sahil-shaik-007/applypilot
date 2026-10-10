import React, { useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Search, MapPin, SlidersHorizontal, SearchX, Layers, List, Check, CircleAlert, Plane, Sparkles } from 'lucide-react';
import { scoreJob, isExcluded } from '@shared/match.js';
import { useApp, go } from '../lib/store.jsx';
import { api } from '../lib/api.js';
import { Button, Seg, Empty, Switch, Progress, Sheet } from '../components/ui.jsx';
import { JobCard, JobSheet, SwipeDeck } from '../components/jobs.jsx';
import { AUTO_ATS } from '../lib/apply.js';
import { rememberJobs } from '../lib/insights.js';

// Last search lives in memory only (public job data; cleared on reload/lock).
let lastSearch = null;
export function getLastSearch() { return lastSearch; }

const SORTS = { score: 'Best match', newest: 'Newest first', salary: 'Highest salary' };
const DEFAULT_F = { minScore: 0, autoOnly: false, hasSalary: false, days: 0, hideDone: true, source: 'all', text: '', sponsors: false, canTake: true };
const NO_SPONSOR = "Employer doesn't sponsor visas";
const isPhone = () => window.matchMedia('(max-width: 768px)').matches;

function statsList(stats) {
  if (!stats) return [];
  if (Array.isArray(stats)) return stats;
  if (Array.isArray(stats.sources)) return stats.sources;
  return Object.entries(stats).filter(([, v]) => v && typeof v === 'object').map(([k, v]) => ({ id: k, name: v.name || k, ...v }));
}

export default function Jobs({ params }) {
  const app = useApp();
  const profile = app.profile || {};
  const [query, setQuery] = useState(params.q || (lastSearch && lastSearch.q) || (profile.desiredTitles || [])[0] || '');
  const [location, setLocation] = useState(params.loc ?? (lastSearch ? lastSearch.location : (profile.preferredLocations || [])[0] || ''));
  const [remote, setRemote] = useState((lastSearch && lastSearch.remote) || 'any');
  const [raw, setRaw] = useState(lastSearch ? lastSearch.jobs : []);
  const [stats, setStats] = useState(lastSearch ? lastSearch.stats : null);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(null);
  const [f, setF] = useState(DEFAULT_F);
  const [sort, setSort] = useState('score');
  const [filters, setFilters] = useState(false);
  const [view, setView] = useState(isPhone() ? 'swipe' : 'list');
  const [limit, setLimit] = useState(30);
  const [showStats, setShowStats] = useState(false);
  const resultsRef = useRef(null);

  const search = async (e) => {
    if (e) e.preventDefault();
    if (!query.trim()) { app.toast('Type a job title to search', 'error'); return; }
    setLoading(true); setStats(null);
    try {
      const qs = new URLSearchParams({ q: query.trim(), location: location.trim(), remote });
      const r = await api(`/jobs/search?${qs}`);
      const jobs = Array.isArray(r.jobs) ? r.jobs : [];
      rememberJobs(jobs);
      lastSearch = { q: query.trim(), location: location.trim(), remote, jobs, stats: r.stats || null, at: Date.now() };
      setRaw(jobs); setStats(r.stats || null);
      setView(isPhone() ? 'swipe' : 'list');
      if (!jobs.length) app.toast('No jobs found. Try a broader title or location.', 'info');
      else setTimeout(() => resultsRef.current && resultsRef.current.scrollIntoView({ behavior: 'smooth', block: 'start' }), 80);
    } catch (err) { app.toast(err.message, 'error'); } finally { setLoading(false); }
  };
  useEffect(() => { if (params.q && (!lastSearch || lastSearch.q !== params.q)) search(); }, [params.q]); // eslint-disable-line

  // Score on the device (resume text + profile never leave the phone).
  const defaultResume = app.resumes.find((r) => r.isDefault) || app.resumes[0];
  const resumeText = defaultResume ? defaultResume.text || '' : '';
  const statusByJob = useMemo(() => new Map(app.applications.map((a) => [a.jobId, a.status])), [app.applications]);
  const queuedIds = useMemo(() => new Set(app.outbox.map((o) => o.jobId)), [app.outbox]);
  const { jobs, excluded } = useMemo(() => {
    let ex = 0;
    const out = [];
    for (const j of raw) {
      const match = scoreJob(j, { resumeText, profile });
      const reason = isExcluded(j, { profile });
      const el = match.eligibility || { ok: true, blockers: [], scam: [] };
      // Your own exclude lists hide a job outright; eligibility problems are shown (red) and filterable.
      if (reason && el.ok && reason !== NO_SPONSOR) { ex++; continue; }
      const blockers = [...(el.blockers || []), ...(reason === NO_SPONSOR ? [reason] : [])];
      out.push({ ...j, match, blockers, scam: (el.scam || []).length > 0, canTake: !blockers.length, appStatus: statusByJob.get(j.id) || (queuedIds.has(j.id) ? 'queued' : undefined) });
    }
    return { jobs: out, excluded: ex };
  }, [raw, resumeText, profile, statusByJob, queuedIds]);

  const sources = useMemo(() => [...new Set(jobs.map((j) => j.source).filter(Boolean))], [jobs]);
  const shown = useMemo(() => {
    const t = f.text.toLowerCase();
    let l = jobs.filter((j) => (j.match.score || 0) >= f.minScore
      && (!f.autoOnly || AUTO_ATS.includes(j.ats))
      && (!f.hasSalary || j.salaryMin || j.salaryMax || j.salaryText)
      && (!f.days || (j.postedAt && Date.now() - new Date(j.postedAt) < f.days * 86400000))
      && (!f.hideDone || !j.appStatus || j.appStatus === 'saved')
      && (!f.sponsors || j.match.sponsorship === 'offered')
      && (!f.canTake || j.canTake)
      && (f.source === 'all' || j.source === f.source)
      && (!t || `${j.title} ${j.company} ${j.location}`.toLowerCase().includes(t)));
    if (sort === 'newest') l = l.slice().sort((a, b) => new Date(b.postedAt || 0) - new Date(a.postedAt || 0));
    else if (sort === 'salary') l = l.slice().sort((a, b) => (b.salaryMax || b.salaryMin || 0) - (a.salaryMax || a.salaryMin || 0));
    else l = l.slice().sort((a, b) => (b.match.score || 0) - (a.match.score || 0));
    return l;
  }, [jobs, f, sort]);
  useEffect(() => setLimit(30), [f, sort, raw]);
  // Swipe triage only shows jobs you haven't acted on yet.
  const triage = useMemo(() => shown.filter((j) => !j.appStatus), [shown]);
  const activeFilters = Object.keys(DEFAULT_F).filter((k) => f[k] !== DEFAULT_F[k]).length;
  const sponsorCount = jobs.filter((j) => j.match.sponsorship === 'offered').length;
  const cantTake = jobs.filter((j) => !j.canTake).length;
  const sl = statsList(stats);

  return (
    <div className="col" style={{ gap: 14 }}>
      <form onSubmit={search} className="col" style={{ gap: 8 }} role="search" data-testid="job-search">
        <div className="search-wrap"><Search size={17} /><input className="input" value={query} onChange={(e) => setQuery(e.target.value)} placeholder='"Data analyst", "React developer"…' aria-label="Job title" enterKeyHint="search" /></div>
        <div className="row" style={{ gap: 8 }}>
          <div className="search-wrap grow"><MapPin size={16} /><input className="input" value={location} onChange={(e) => setLocation(e.target.value)} placeholder="Anywhere" aria-label="Location" enterKeyHint="search" /></div>
          <Button type="submit" variant="primary" size="lg" icon={Search} loading={loading} aria-label="Search">Search</Button>
        </div>
        <Seg full value={remote} onChange={setRemote} options={[{ value: 'any', label: 'Any' }, { value: 'remote', label: 'Remote' }, { value: 'onsite', label: 'On-site' }]} />
      </form>

      <AnimatePresence>
        {(loading || sl.length > 0) && (
          <motion.div className="card pad" initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} style={{ overflow: 'hidden' }}>
            <button type="button" className="row between small" style={{ width: '100%', background: 'none', border: 0, color: 'inherit', padding: 0, minHeight: 28, cursor: 'pointer' }} onClick={() => setShowStats(!showStats)} aria-expanded={showStats} disabled={loading}>
              <span>{loading ? 'Searching every source in parallel…' : `Searched ${sl.length} sources · ${raw.length} unique jobs`}</span>
              {!loading && <span className="tiny dim">{showStats ? 'hide' : 'details'}</span>}
            </button>
            {loading ? <div style={{ marginTop: 8 }}><Progress indeterminate /></div> : showStats && (
              <div className="chips" style={{ marginTop: 8 }}>{sl.slice(0, 40).map((p, i) => (
                <span key={p.id || p.source || i} className={`badge ${p.error ? 'red' : p.count ? 'green' : ''}`} title={p.error || ''}>{p.error ? <CircleAlert size={10} /> : <Check size={10} />}{p.name || p.id || p.source} · {p.count ?? 0}</span>
              ))}</div>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      {loading && !raw.length ? (
        <div className="col">{Array.from({ length: 4 }).map((_, i) => <div key={i} className="skeleton" style={{ height: 170 }} />)}</div>
      ) : jobs.length ? (
        <>
          <div ref={resultsRef} className="row between wrap" style={{ gap: 8, scrollMarginTop: 'calc(64px + var(--safe-top))' }}>
            <Seg value={view} onChange={setView} options={[{ value: 'swipe', label: <span className="row" style={{ gap: 6 }}><Layers size={14} />Review</span> }, { value: 'list', label: <span className="row" style={{ gap: 6 }} data-testid="view-list"><List size={14} />List</span> }]} />
            <div className="row" style={{ gap: 6 }}>
              <Button size="sm" icon={Plane} variant={f.sponsors ? 'primary' : 'outline'} onClick={() => setF({ ...f, sponsors: !f.sponsors })} aria-pressed={f.sponsors} title={`Sponsors visa (${sponsorCount})`} data-testid="filter-sponsors">Visa</Button>
              <button type="button" className="btn btn-outline btn-icon" style={{ position: 'relative', minHeight: 40, width: 44 }} onClick={() => setFilters(true)} aria-label={`Filters${activeFilters ? ` (${activeFilters} active)` : ''}`} data-testid="open-filters">
                <SlidersHorizontal size={16} />
                {activeFilters > 0 && <span className="badge accent" style={{ position: 'absolute', top: -6, right: -6, padding: '0 5px', fontSize: 10 }}>{activeFilters}</span>}
              </button>
            </div>
          </div>
          {view === 'swipe' ? (
            <SwipeDeck jobs={triage} onOpen={setOpen} onDone={() => setView('list')} />
          ) : (
            <>
              {triage.length > 0 && (
                <motion.button type="button" className="card pad premium premium-shimmer row" style={{ width: '100%', color: 'inherit', textAlign: 'left', cursor: 'pointer', gap: 12 }} onClick={() => setView('swipe')} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} data-testid="review-cta">
                  <Sparkles size={18} style={{ position: 'relative', zIndex: 2 }} color="var(--accent-2)" />
                  <div className="grow" style={{ position: 'relative', zIndex: 2 }}><div style={{ fontWeight: 700 }}>Review {triage.length} matches</div><div className="small muted">Swipe right to send to your laptop, left to skip.</div></div>
                </motion.button>
              )}
              <div className="row between">
                <span className="small muted">{shown.length.toLocaleString()} jobs{excluded ? ` · ${excluded} excluded` : ''}{f.canTake && cantTake ? ` · ${cantTake} you can't take hidden` : ''}</span>
                <select className="select" style={{ width: 170, height: 38 }} value={sort} onChange={(e) => setSort(e.target.value)} aria-label="Sort">
                  {Object.entries(SORTS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </select>
              </div>
              {shown.length ? (
                <div className="col" style={{ gap: 12 }}>
                  {shown.slice(0, limit).map((j, i) => <JobCard key={j.id} job={j} index={i} onOpen={setOpen} />)}
                  {shown.length > limit && <Button block onClick={() => setLimit(limit + 30)}>Show more ({shown.length - limit} left)</Button>}
                </div>
              ) : <Empty icon={SearchX} title="No jobs match these filters">Lower the minimum match or clear filters.</Empty>}
            </>
          )}
        </>
      ) : (
        <Empty icon={SearchX} title={raw.length ? 'Everything was excluded' : 'Search to get started'}>
          {raw.length ? 'Your exclude lists in Profile → Job preferences hid every result.' : 'Type a role above. We search every connected source at once and rank results against your resume, on this phone.'}
          {!app.resumes.length && <div style={{ marginTop: 10 }}><a href="#/resumes" onClick={(e) => { e.preventDefault(); go('resumes'); }}>Upload a resume</a> for better ranking.</div>}
        </Empty>
      )}

      <Sheet open={filters} onClose={() => setFilters(false)} title="Filters" footer={<><Button size="lg" variant="ghost" onClick={() => setF(DEFAULT_F)}>Reset</Button><Button size="lg" variant="primary" onClick={() => setFilters(false)}>Show {shown.length} jobs</Button></>}>
        <div className="col" style={{ gap: 18 }}>
          <div><span className="field-label">Keyword</span><input className="input" value={f.text} onChange={(e) => setF({ ...f, text: e.target.value })} placeholder="Company, title…" /></div>
          <div>
            <div className="row between"><span className="field-label">Minimum match</span><span className="small">{f.minScore}%</span></div>
            <input type="range" className="range" min={0} max={95} step={5} value={f.minScore} onChange={(e) => setF({ ...f, minScore: +e.target.value })} aria-label="Minimum match" />
          </div>
          <div className="grid g2">
            <label className="field"><span className="field-label">Posted within</span>
              <select className="select" value={f.days} onChange={(e) => setF({ ...f, days: +e.target.value })}>
                <option value={0}>Any time</option><option value={1}>24 hours</option><option value={3}>3 days</option><option value={7}>7 days</option><option value={30}>30 days</option>
              </select></label>
            <label className="field"><span className="field-label">Source</span>
              <select className="select" value={f.source} onChange={(e) => setF({ ...f, source: e.target.value })}>
                <option value="all">All sources</option>
                {sources.map((s) => <option key={s} value={s}>{s}</option>)}
              </select></label>
          </div>
          {[
            ['canTake', 'Only jobs I can take', "Hides likely scams, region-locked remote roles, languages you don't speak, and no-sponsorship jobs if you need a visa"],
            ['sponsors', 'Sponsors visa', 'Only jobs that mention visa sponsorship'],
            ['autoOnly', 'Auto-apply capable', 'Forms the desktop app can fill end-to-end'],
            ['hasSalary', 'Shows salary', ''],
            ['hideDone', 'Hide applied & skipped', ''],
          ].map(([k, label, help]) => (
            <div key={k} className="row between" style={{ minHeight: 44 }}>
              <div><div className="small">{label}</div>{help && <div className="tiny dim">{help}</div>}</div>
              <Switch on={f[k]} onChange={(v) => setF({ ...f, [k]: v })} label={label} />
            </div>
          ))}
        </div>
      </Sheet>
      <JobSheet job={open && (jobs.find((j) => j.id === open.id) || open)} onClose={() => setOpen(null)} />
    </div>
  );
}
