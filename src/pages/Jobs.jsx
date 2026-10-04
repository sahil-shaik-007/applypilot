import React, { useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Search, MapPin, Loader2, Check, CircleAlert, SearchX, Rocket } from 'lucide-react';
import { useApp } from '../lib/store';
import { Button, Seg, Empty, Switch, Progress } from '../components/ui';
import { JobCard, JobDrawer, AUTO_ATS } from '../components/jobs';

const SORTS = { score: 'Best match (default)', newest: 'Newest first', salary: 'Highest salary' };

export default function Jobs({ params }) {
  const app = useApp();
  const profile = app.profile.values || {};
  const [query, setQuery] = useState(params.query || (profile.desiredTitles || [])[0] || '');
  const [location, setLocation] = useState(params.location || (profile.preferredLocations || [])[0] || '');
  const [remote, setRemote] = useState('any');
  const [jobs, setJobs] = useState([]);
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState([]);
  const [stats, setStats] = useState(null);
  const [open, setOpen] = useState(null);
  const [f, setF] = useState({ minScore: 0, autoOnly: false, hasSalary: false, days: 0, hideApplied: true, source: 'all', text: '' });
  const [sort, setSort] = useState('score');
  const searchId = useRef(null);
  const free = app.connectors.filter((c) => c.ready);

  useEffect(() => { app.run('jobs:list', [{ limit: 600 }]).then(setJobs).catch(() => {}); }, []); // eslint-disable-line
  useEffect(() => app.onSearchProgress((p) => { if (p.searchId === searchId.current) setProgress((x) => [...x, p]); }), [app]);

  const search = async (e) => {
    e && e.preventDefault();
    if (!query.trim()) return app.toast('Type a job title to search', 'error');
    searchId.current = Math.random().toString(36).slice(2);
    setLoading(true); setProgress([]); setStats(null);
    try {
      const r = await app.run('jobs:search', [{ query, location, remote, searchId: searchId.current }]);
      setJobs(r.jobs);
      setStats(r.stats);
      document.getElementById('main-scroll')?.scrollTo({ top: 330, behavior: 'smooth' });
    } catch {} finally { setLoading(false); }
  };

  const sources = useMemo(() => [...new Set(jobs.map((j) => j.source))], [jobs]);
  const shown = useMemo(() => {
    const t = f.text.toLowerCase();
    let l = jobs.filter((j) => (j.match?.score || 0) >= f.minScore
      && (!f.autoOnly || AUTO_ATS.includes(j.ats))
      && (!f.hasSalary || j.salaryMin || j.salaryMax || j.salaryText)
      && (!f.days || (j.postedAt && Date.now() - new Date(j.postedAt) < f.days * 86400000))
      && (!f.hideApplied || !j.appStatus || j.appStatus === 'saved')
      && (f.source === 'all' || j.source === f.source)
      && (!t || `${j.title} ${j.company} ${j.location}`.toLowerCase().includes(t)));
    if (sort === 'newest') l = l.slice().sort((a, b) => new Date(b.postedAt || 0) - new Date(a.postedAt || 0));
    else if (sort === 'salary') l = l.slice().sort((a, b) => (b.salaryMax || b.salaryMin || 0) - (a.salaryMax || a.salaryMin || 0));
    else l = l.slice().sort((a, b) => (b.match?.score || 0) - (a.match?.score || 0));
    return l;
  }, [jobs, f, sort]);

  const [limit, setLimit] = useState(60);
  useEffect(() => setLimit(60), [f, sort, jobs]);

  return (
    <div className="page" style={{ position: 'relative' }}>
      <div className="glow" style={{ top: -300, left: '50%', transform: 'translateX(-50%)' }} />
      <div className="hero" style={{ position: 'relative' }}>
        <h1>Every job board.<br />One search.</h1>
        <p>Search {app.connectors.length}+ live sources at once — remote boards, job APIs and {Object.values(app.companyCounts || {}).reduce((a, b) => a + b, 0) || 'hundreds of'} company career pages on Greenhouse, Lever, Ashby & more. Ranked by how well each job fits <em>you</em>.</p>
        <form onSubmit={search} className="row" style={{ maxWidth: 780, margin: '24px auto 0', gap: 8 }}>
          <div className="search-wrap grow"><Search size={17} /><input className="input" value={query} onChange={(e) => setQuery(e.target.value)} placeholder='"Data analyst", "React developer"…' autoFocus /></div>
          <div className="search-wrap" style={{ width: 220 }}><MapPin size={16} /><input className="input" value={location} onChange={(e) => setLocation(e.target.value)} placeholder="Anywhere" /></div>
          <Button variant="primary" size="lg" icon={loading ? undefined : Search} loading={loading} type="submit">Search</Button>
        </form>
        <div className="row" style={{ justifyContent: 'center', marginTop: 12 }}>
          <Seg value={remote} onChange={setRemote} options={[{ value: 'any', label: 'Any' }, { value: 'remote', label: 'Remote only' }, { value: 'onsite', label: 'On-site / hybrid' }]} />
        </div>
      </div>

      <AnimatePresence>
        {(loading || stats) && (
          <motion.div className="card pad" style={{ marginBottom: 20 }} initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }}>
            <div className="row between small" style={{ marginBottom: 10 }}>
              <span>{loading ? <><Loader2 size={14} className="spin" style={{ verticalAlign: -2 }} /> Searching {free.length} sources in parallel…</> : `Searched ${stats.length} sources · ${jobs.length} unique jobs after removing duplicates`}</span>
              <span className="dim">{progress.length}/{free.length}</span>
            </div>
            <Progress value={(progress.length / Math.max(1, free.length)) * 100} indeterminate={loading && !progress.length} />
            <div className="chips" style={{ marginTop: 12 }}>
              {(stats || progress).map((p) => (
                <span key={p.id || p.source} className={`badge ${p.error ? 'red' : p.count ? 'green' : ''}`} title={p.error || ''}>
                  {p.error ? <CircleAlert size={10} /> : <Check size={10} />}{p.name} · {p.count}
                </span>
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <div style={{ display: 'grid', gridTemplateColumns: '240px 1fr', gap: 24, alignItems: 'start' }}>
        <div className="sticky">
          <div className="label" style={{ marginBottom: 12 }}>Filters</div>
          <div className="card pad col" style={{ gap: 18 }}>
            <div><span className="field-label">Keyword</span><input className="input" value={f.text} onChange={(e) => setF({ ...f, text: e.target.value })} placeholder="Company, title…" /></div>
            <div>
              <div className="row between"><span className="field-label">Min. match</span><span className="small">{f.minScore}%</span></div>
              <input type="range" className="range" min={0} max={95} step={5} value={f.minScore} onChange={(e) => setF({ ...f, minScore: +e.target.value })} />
            </div>
            <div>
              <span className="field-label">Posted within</span>
              <select className="select" value={f.days} onChange={(e) => setF({ ...f, days: +e.target.value })}>
                <option value={0}>Any time</option><option value={1}>24 hours</option><option value={3}>3 days</option><option value={7}>7 days</option><option value={30}>30 days</option>
              </select>
            </div>
            <div>
              <span className="field-label">Source</span>
              <select className="select" value={f.source} onChange={(e) => setF({ ...f, source: e.target.value })}>
                <option value="all">All sources</option>
                {sources.map((s) => <option key={s} value={s}>{(app.connectors.find((c) => c.id === s) || {}).name || s}</option>)}
              </select>
            </div>
            <label className="row between small"><span>Auto-apply capable</span><Switch on={f.autoOnly} onChange={(v) => setF({ ...f, autoOnly: v })} /></label>
            <label className="row between small"><span>Shows salary</span><Switch on={f.hasSalary} onChange={(v) => setF({ ...f, hasSalary: v })} /></label>
            <label className="row between small"><span>Hide applied</span><Switch on={f.hideApplied} onChange={(v) => setF({ ...f, hideApplied: v })} /></label>
          </div>
          <div className="card pad" style={{ marginTop: 14 }}>
            <div className="small" style={{ fontWeight: 700 }}>Tired of searching?</div>
            <div className="small muted" style={{ marginTop: 4 }}>Turn this search into a campaign that runs every hour and applies for you.</div>
            <Button size="sm" variant="primary" icon={Rocket} style={{ marginTop: 10, width: '100%' }} onClick={() => app.go('campaigns', { draft: { name: query, roles: query ? [query] : [], locations: location ? [location] : [], remote } })}>Create campaign</Button>
          </div>
        </div>

        <div>
          <div className="row between" style={{ marginBottom: 14 }}>
            <span className="small muted">{shown.length.toLocaleString()} jobs found</span>
            <select className="select" style={{ width: 210 }} value={sort} onChange={(e) => setSort(e.target.value)}>
              {Object.entries(SORTS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </div>
          {loading && !jobs.length ? (
            <div className="grid g2">{Array.from({ length: 6 }).map((_, i) => <div key={i} className="skeleton" style={{ height: 210 }} />)}</div>
          ) : shown.length ? (
            <>
              <div className="grid g2">{shown.slice(0, limit).map((j, i) => <JobCard key={j.id} job={j} index={i} onOpen={setOpen} />)}</div>
              {shown.length > limit && <div style={{ textAlign: 'center', marginTop: 20 }}><Button onClick={() => setLimit(limit + 60)}>Show more ({shown.length - limit} left)</Button></div>}
            </>
          ) : (
            <Empty icon={SearchX} title={jobs.length ? 'No jobs match these filters' : 'Search to get started'}>
              {jobs.length ? 'Try lowering the minimum match or clearing filters.' : 'Type a role above — we\'ll search every connected source at once.'}
            </Empty>
          )}
        </div>
      </div>
      <JobDrawer job={open && (jobs.find((j) => j.id === open.id) || open)} onClose={() => setOpen(null)} />
    </div>
  );
}
