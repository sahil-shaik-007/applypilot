import React, { useEffect, useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { Globe, ExternalLink, Search, Zap, MapPin } from 'lucide-react';
import { useApp } from '../lib/store.jsx';
import { api } from '../lib/api.js';
import { Logo, Empty, Switch } from '../components/ui.jsx';
import { buildPlatformUrl } from '../lib/apply.js';

const REGIONS = { all: 'All regions', global: 'Global', india: 'India', us: 'USA', uk: 'UK', europe: 'Europe', canada: 'Canada', australia: 'Australia', 'middle-east': 'Middle East', asia: 'Asia', latam: 'LatAm', africa: 'Africa' };
let cache = null;

export default function Platforms() {
  const app = useApp();
  const p = app.profile || {};
  const [list, setList] = useState(cache || []);
  const [err, setErr] = useState('');
  const [q, setQ] = useState((p.desiredTitles || [])[0] || '');
  const [loc, setLoc] = useState((p.preferredLocations || [])[0] || p.city || '');
  const [region, setRegion] = useState(p.country && /india/i.test(p.country) ? 'india' : 'all');
  const [cat, setCat] = useState('all');
  const [remote, setRemote] = useState(false);
  const [text, setText] = useState('');
  const [limit, setLimit] = useState(40);

  useEffect(() => {
    if (cache) return;
    api('/jobs/platforms').then((r) => { const l = Array.isArray(r) ? r : r.platforms || []; cache = l; setList(l); }).catch((e) => setErr(e.message));
  }, []);
  const cats = useMemo(() => ['all', ...new Set(list.map((x) => x.category).filter(Boolean))], [list]);
  const shown = useMemo(() => list
    .filter((x) => (region === 'all' || x.region === region || x.region === 'global') && (cat === 'all' || x.category === cat) && (!text || `${x.name} ${x.notes || ''}`.toLowerCase().includes(text.toLowerCase())))
    .sort((a, b) => (b.popularity || 0) - (a.popularity || 0)), [list, region, cat, text]);
  useEffect(() => setLimit(40), [region, cat, text]);

  return (
    <div className="col" style={{ gap: 14 }}>
      <div className="card pad col" style={{ gap: 8 }}>
        <span className="label" style={{ margin: 0 }}>Your search, opened on every board</span>
        <div className="search-wrap"><Search size={16} /><input className="input" style={{ height: 44 }} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Role" aria-label="Role" /></div>
        <div className="search-wrap"><MapPin size={16} /><input className="input" style={{ height: 44 }} value={loc} onChange={(e) => setLoc(e.target.value)} placeholder="Location" aria-label="Location" /></div>
        <div className="grid g2">
          <select className="select" value={region} onChange={(e) => setRegion(e.target.value)} aria-label="Region">{Object.entries(REGIONS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
          <select className="select" value={cat} onChange={(e) => setCat(e.target.value)} aria-label="Category">{cats.map((c) => <option key={c} value={c}>{c === 'all' ? 'All categories' : c}</option>)}</select>
        </div>
        <div className="row between" style={{ minHeight: 44 }}><span className="small">Remote only</span><Switch on={remote} onChange={setRemote} label="Remote only" /></div>
        <input className="input" value={text} onChange={(e) => setText(e.target.value)} placeholder="Filter boards…" aria-label="Filter boards" />
      </div>
      <div className="small muted">{shown.length} platforms</div>
      {shown.length ? (
        <div className="col" style={{ gap: 8 }}>
          {shown.slice(0, limit).map((x, i) => (
            <motion.a key={x.id} href={buildPlatformUrl(x, q, loc, remote)} target="_blank" rel="noopener noreferrer" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: Math.min(i, 16) * 0.015 }}
              className={`card ${x.category === 'ats-search' ? 'premium' : ''}`} style={{ padding: 14, textDecoration: 'none', display: 'block' }} data-testid="platform">
              <div className="row" style={{ gap: 12 }}>
                <Logo name={x.name} size="sm" />
                <div className="grow">
                  <div className="ellipsis" style={{ fontWeight: 700 }}>{x.name}</div>
                  <div className="row wrap" style={{ gap: 5, marginTop: 3 }}>
                    <span className="badge">{REGIONS[x.region] || x.region}</span>
                    {x.category && <span className="badge">{x.category}</span>}
                    {x.applyStyle === 'easy-apply' && <span className="badge green"><Zap size={9} />easy apply</span>}
                  </div>
                </div>
                <ExternalLink size={15} className="dim" />
              </div>
              {x.notes && <div className="small muted" style={{ marginTop: 8 }}>{x.notes}</div>}
            </motion.a>
          ))}
          {shown.length > limit && <button type="button" className="btn btn-outline btn-block" onClick={() => setLimit(limit + 40)}>Show more ({shown.length - limit})</button>}
        </div>
      ) : <Empty icon={Globe} title={err ? 'Could not load platforms' : list.length ? 'No platforms match' : 'Loading platforms…'}>{err || 'Try another region or category.'}</Empty>}
    </div>
  );
}
