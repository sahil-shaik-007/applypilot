import React, { useEffect, useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { Globe, ExternalLink, Search, Check, Zap, Layers } from 'lucide-react';
import { useApp } from '../lib/store';
import { Button, Logo, Empty, timeAgo } from '../components/ui';

const REGIONS = { all: 'All regions', global: 'Global', india: 'India', us: 'USA', uk: 'UK', europe: 'Europe', canada: 'Canada', australia: 'Australia', 'middle-east': 'Middle East', asia: 'Asia', latam: 'LatAm', africa: 'Africa' };

function buildUrl(p, q, loc, remote) {
  const tpl = (remote && p.remoteSearchUrl) || p.searchUrl;
  if (!tpl) return p.url;
  return tpl.replace(/\{q\}/g, encodeURIComponent(q || '')).replace(/\{loc\}/g, encodeURIComponent(loc || ''));
}

export default function Platforms() {
  const app = useApp();
  const profile = app.profile.values || {};
  const [list, setList] = useState([]);
  const [q, setQ] = useState((profile.desiredTitles || [])[0] || '');
  const [loc, setLoc] = useState((profile.preferredLocations || [])[0] || profile.city || '');
  const [region, setRegion] = useState(profile.country && /india/i.test(profile.country) ? 'india' : 'all');
  const [cat, setCat] = useState('all');
  const [remote, setRemote] = useState(false);
  const [used, setUsed] = useState(app.platformUsage || {});
  const [text, setText] = useState('');

  useEffect(() => { app.run('platforms:list').then(setList).catch(() => {}); }, []); // eslint-disable-line
  const cats = useMemo(() => ['all', ...new Set(list.map((p) => p.category))], [list]);
  const shown = useMemo(() => list
    .filter((p) => (region === 'all' || p.region === region || p.region === 'global') && (cat === 'all' || p.category === cat) && (!text || `${p.name} ${p.notes}`.toLowerCase().includes(text.toLowerCase())))
    .sort((a, b) => (b.popularity || 0) - (a.popularity || 0)), [list, region, cat, text]);

  const open = async (p) => {
    await app.run('shell:open', [buildUrl(p, q, loc, remote)]);
    setUsed(await app.run('platforms:markUsed', [p.id]));
  };
  const openTop = async () => {
    const top = shown.filter((p) => p.searchUrl).slice(0, 8);
    for (const p of top) { await open(p); await new Promise((r) => setTimeout(r, 350)); }
  };

  return (
    <div className="page">
      <div className="hero" style={{ paddingTop: 8 }}>
        <h1 style={{ fontSize: 38 }}>{list.length || 250} job platforms.<br />One click each.</h1>
        <p>Big boards, niche boards, India, remote, government, freelance and hidden-job tricks — opened straight on your search. ApplyPilot remembers which you've covered today.</p>
      </div>
      <div className="card pad" style={{ marginBottom: 20 }}>
        <div className="row wrap" style={{ gap: 10 }}>
          <div className="search-wrap grow" style={{ minWidth: 240 }}><Search size={16} /><input className="input" style={{ height: 38 }} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Role to search for" /></div>
          <input className="input" style={{ width: 200 }} value={loc} onChange={(e) => setLoc(e.target.value)} placeholder="Location" />
          <select className="select" style={{ width: 160 }} value={region} onChange={(e) => setRegion(e.target.value)}>{Object.entries(REGIONS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
          <select className="select" style={{ width: 170 }} value={cat} onChange={(e) => setCat(e.target.value)}>{cats.map((c) => <option key={c} value={c}>{c === 'all' ? 'All categories' : c}</option>)}</select>
          <label className="row small"><input type="checkbox" checked={remote} onChange={(e) => setRemote(e.target.checked)} style={{ accentColor: 'var(--accent)' }} />Remote</label>
          <input className="input" style={{ width: 160 }} value={text} onChange={(e) => setText(e.target.value)} placeholder="Filter boards…" />
          <Button variant="primary" icon={Layers} onClick={openTop}>Open top 8</Button>
        </div>
      </div>
      {shown.length ? (
        <div className="grid g3">
          {shown.map((p, i) => {
            const u = used[p.id];
            const today = u && u.slice(0, 10) === new Date().toISOString().slice(0, 10);
            return (
              <motion.div key={p.id} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: Math.min(i, 24) * 0.015 }} className={`card clickable ${p.category === 'ats-search' ? 'premium' : ''}`} style={{ padding: 16 }} onClick={() => open(p)}>
                <div className="row" style={{ gap: 12 }}>
                  <Logo name={p.name} size="sm" />
                  <div className="grow" style={{ minWidth: 0 }}>
                    <div className="row" style={{ gap: 6 }}><span className="ellipsis" style={{ fontWeight: 700 }}>{p.name}</span>{today && <Check size={14} color="var(--green)" />}</div>
                    <div className="row" style={{ gap: 5, marginTop: 3 }}>
                      <span className="badge">{REGIONS[p.region] || p.region}</span>
                      <span className="badge">{p.category}</span>
                      {p.applyStyle === 'easy-apply' && <span className="badge green"><Zap size={9} />easy apply</span>}
                    </div>
                  </div>
                  <ExternalLink size={14} className="dim" />
                </div>
                {p.notes && <div className="small muted" style={{ marginTop: 10, minHeight: 38 }}>{p.notes}</div>}
                <div className="row between tiny dim" style={{ marginTop: 8 }}>
                  <span>{'★'.repeat(p.popularity || 0)}<span style={{ opacity: 0.3 }}>{'★'.repeat(5 - (p.popularity || 0))}</span></span>
                  <span>{u ? `searched ${timeAgo(u)}` : p.searchUrl ? 'deep link' : 'homepage'}</span>
                </div>
              </motion.div>
            );
          })}
        </div>
      ) : (
        <Empty icon={Globe} title={list.length ? 'No platforms match' : 'Loading platforms…'}>Try another region or category.</Empty>
      )}
    </div>
  );
}
