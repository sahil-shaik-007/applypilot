import React, { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { Settings as Cog, Database, KeyRound, Building2, Crown, HardDrive, Check, ExternalLink, Globe, Trash2, Plus, Bot, Monitor, LogIn } from 'lucide-react';
import { useApp } from '../lib/store';
import { Button, Field, Switch, Seg } from '../components/ui';
import { CONFIG, PRICING } from '../config';

const TABS = [
  { id: 'general', label: 'General', icon: Cog },
  { id: 'sources', label: 'Job sources', icon: Database },
  { id: 'ai', label: 'AI', icon: Bot },
  { id: 'companies', label: 'Company boards', icon: Building2 },
  { id: 'plan', label: 'Plan & license', icon: Crown },
  { id: 'data', label: 'Data & privacy', icon: HardDrive },
];

function Row({ title, desc, children }) {
  return (
    <div className="row between" style={{ padding: '14px 0', borderBottom: '1px solid var(--border)', gap: 24 }}>
      <div><div style={{ fontWeight: 600 }}>{title}</div>{desc && <div className="small muted">{desc}</div>}</div>
      <div style={{ flexShrink: 0 }}>{children}</div>
    </div>
  );
}

function KeyField({ name, label }) {
  const app = useApp();
  const [v, setV] = useState('');
  const masked = app.settings.keys[name];
  const save = async () => {
    const r = await app.run('settings:setKey', [name, v], v ? 'Key saved (encrypted on this PC)' : 'Key removed');
    app.set({ settings: r.settings, connectors: r.connectors });
    setV('');
  };
  return (
    <div className="row" style={{ gap: 8 }}>
      <span className="small" style={{ width: 150 }}>{label || name}</span>
      <input className="input" type="password" value={v} onChange={(e) => setV(e.target.value)} placeholder={masked || 'not set'} style={{ maxWidth: 320 }} />
      <Button size="sm" onClick={save} disabled={!v && !masked}>{v ? 'Save' : masked ? 'Remove' : 'Save'}</Button>
      {masked && <Check size={15} color="var(--green)" />}
    </div>
  );
}

function General() {
  const app = useApp();
  const s = app.settings;
  const [check, setCheck] = useState(null);
  const up = async (patch) => app.set({ settings: await app.run('settings:update', [patch]) });
  return (
    <div>
      <Row title="Browser used for applying" desc="ApplyPilot drives your own Edge or Chrome in a separate profile — your normal browser is untouched.">
        <div className="row"><Seg value={s.browserChannel} onChange={(v) => up({ browserChannel: v })} options={[{ value: 'msedge', label: 'Edge' }, { value: 'chrome', label: 'Chrome' }, { value: 'custom', label: 'Custom' }]} />
          <Button size="sm" icon={Monitor} onClick={async () => setCheck(await app.run('browser:check'))}>Test</Button></div>
      </Row>
      {check && <div className={`small ${check.ok ? '' : ''}`} style={{ color: check.ok ? 'var(--green)' : 'var(--red)', padding: '8px 0' }}>{check.ok ? `✓ Browser ready (${check.channel})` : `✗ ${check.error}`}</div>}
      {s.browserChannel === 'custom' && <Row title="Browser executable path"><input className="input" style={{ width: 360 }} defaultValue={s.browserPath} onBlur={(e) => up({ browserPath: e.target.value })} placeholder="C:\\Program Files\\BraveSoftware\\…\\brave.exe" /></Row>}
      <Row title="Sign in to job sites" desc="Open the ApplyPilot browser once and log in to LinkedIn, Naukri, Indeed… Logins are remembered for assisted applying.">
        <div className="row">
          {[['LinkedIn', 'https://www.linkedin.com/login'], ['Naukri', 'https://www.naukri.com/nlogin/login'], ['Indeed', 'https://secure.indeed.com/auth']].map(([n, u]) => <Button key={n} size="sm" icon={LogIn} onClick={() => app.run('browser:open', [u])}>{n}</Button>)}
        </div>
      </Row>
      <Row title="Human-like typing delays" desc="Recommended: fills forms at a natural pace."><Switch on={s.humanDelays} onChange={(v) => up({ humanDelays: v })} /></Row>
      <Row title={`Parallel browser tabs: ${Math.min(s.maxParallelBrowsers, app.plan.parallelBrowsers)}`} desc={`How many applications fill at the same time across all campaigns (your plan allows ${app.plan.parallelBrowsers}).`}>
        <input type="range" className="range" style={{ width: 200 }} min={1} max={10} value={s.maxParallelBrowsers} onChange={(e) => up({ maxParallelBrowsers: +e.target.value })} />
      </Row>
      <Row title="Default apply mode" desc="Used for one-off applies from the Jobs page.">
        <Seg value={s.defaultApplyMode} onChange={(v) => up({ defaultApplyMode: v })} options={[{ value: 'review', label: 'Fill, I submit' }, { value: 'auto', label: 'Autopilot' }]} />
      </Row>
      <Row title="Global daily application cap" desc="Safety limit across all campaigns. Quality beats volume."><input className="input" type="number" style={{ width: 100 }} defaultValue={s.dailyApplyLimit} onBlur={(e) => up({ dailyApplyLimit: +e.target.value })} /></Row>
      <Row title="Default minimum match score"><input className="input" type="number" style={{ width: 100 }} defaultValue={s.minMatchScore} onBlur={(e) => up({ minMatchScore: +e.target.value })} /></Row>
      <Row title="Desktop notifications"><Switch on={s.notifications} onChange={(v) => up({ notifications: v })} /></Row>
      <Row title="Start with Windows" desc="Keeps campaigns running in the tray after login."><Switch on={!!s.openAtLogin} onChange={async (v) => { await app.run('app:setLoginItem', [v]); up({ openAtLogin: v }); }} /></Row>
    </div>
  );
}

function Sources() {
  const app = useApp();
  const enabled = app.settings.enabledSources;
  const isOn = (id) => !enabled || enabled.includes(id);
  const toggle = async (id, on) => {
    const all = app.connectors.map((c) => c.id);
    const cur = enabled || all;
    const next = on ? [...new Set([...cur, id])] : cur.filter((x) => x !== id);
    app.set({ settings: await app.run('settings:update', [{ enabledSources: next.length === all.length ? null : next }]) });
  };
  const free = app.connectors.filter((c) => !c.requiresKeys.length);
  const keyed = app.connectors.filter((c) => c.requiresKeys.length);
  return (
    <div className="col" style={{ gap: 22 }}>
      <div>
        <div className="section-title">Free sources — no setup</div>
        <div className="grid g2">
          {free.map((c) => (
            <div key={c.id} className="card" style={{ padding: 14 }}>
              <div className="row between"><span style={{ fontWeight: 700 }}>{c.name}</span><Switch on={isOn(c.id)} onChange={(v) => toggle(c.id, v)} /></div>
              <div className="small muted" style={{ marginTop: 4, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{c.description}</div>
            </div>
          ))}
        </div>
      </div>
      <div>
        <div className="section-title">Premium sources — add your free API key</div>
        <p className="small muted" style={{ marginTop: -6 }}>These unlock LinkedIn, Indeed, Glassdoor & Naukri listings (via Google for Jobs), plus Adzuna (India, US, UK & 16 more), Jooble, Reed, USAJOBS and more. Most have generous free tiers.</p>
        <div className="col">
          {keyed.map((c) => (
            <div key={c.id} className="card pad">
              <div className="row between">
                <div className="row"><span style={{ fontWeight: 700 }}>{c.name}</span>{c.ready ? <span className="badge green">connected</span> : <span className="badge">not connected</span>}</div>
                <div className="row">{c.homepage && <Button size="sm" variant="ghost" icon={ExternalLink} onClick={() => app.run('shell:open', [c.homepage])}>Get key</Button>}{c.ready && <Switch on={isOn(c.id)} onChange={(v) => toggle(c.id, v)} />}</div>
              </div>
              <div className="small muted" style={{ margin: '6px 0 12px' }}>{c.description}</div>
              <div className="col" style={{ gap: 8 }}>
                {[...c.requiresKeys, ...(c.optionalKeys || [])].map((k) => <KeyField key={k} name={k} label={`${k}${(c.optionalKeys || []).includes(k) ? ' (optional)' : ''}`} />)}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function AI() {
  const app = useApp();
  const s = app.settings;
  const [testing, setTesting] = useState(false);
  const up = async (patch) => app.set({ settings: await app.run('settings:update', [patch]) });
  return (
    <div>
      <p className="muted" style={{ marginTop: 0 }}>ApplyPilot uses Claude by Anthropic with <b>your own API key</b> — you pay Anthropic directly (usually a few cents per application) and your data never touches our servers. Get a key at <a href="#" onClick={(e) => { e.preventDefault(); app.run('shell:open', ['https://console.anthropic.com/settings/keys']); }}>console.anthropic.com</a>.</p>
      <div className="card pad col" style={{ gap: 12 }}>
        <KeyField name="anthropic" label="Anthropic API key" />
        <div className="row"><Button size="sm" icon={KeyRound} loading={testing} disabled={!s.keys.anthropic} onClick={async () => { setTesting(true); try { await app.run('ai:testKey', [], 'Key works ✓'); } catch {} finally { setTesting(false); } }}>Test key</Button></div>
      </div>
      <Row title="Model" desc="Opus gives the best writing; Sonnet is faster and cheaper; Haiku is cheapest.">
        <select className="select" style={{ width: 280 }} value={s.aiModel} onChange={(e) => up({ aiModel: e.target.value })}>
          {app.aiModels.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
        </select>
      </Row>
      <Row title="Answer unknown screening questions with AI" desc="Only when your profile clearly supports the answer; otherwise the question waits for you in the Answer bank."><Switch on={s.aiAnswerQuestions} onChange={(v) => up({ aiAnswerQuestions: v })} /></Row>
      <Row title="Usage on your plan" desc={`${app.plan.label}: ${app.plan.aiPerDay >= 1000 ? 'unlimited' : `${app.plan.aiPerDay}`} AI actions per day`}><span /></Row>
    </div>
  );
}

function Companies() {
  const app = useApp();
  const [counts, setCounts] = useState(app.companyCounts || {});
  const [ats, setAts] = useState('greenhouse');
  const [slug, setSlug] = useState('');
  const custom = app.settings.customCompanies || {};
  useEffect(() => { app.run('companies:counts').then(setCounts).catch(() => {}); }, [app.settings]); // eslint-disable-line
  const add = async () => {
    const m = slug.trim().match(/(?:greenhouse\.io\/|lever\.co\/|ashbyhq\.com\/|workable\.com\/|smartrecruiters\.com\/|^)([A-Za-z0-9_.-]+)/);
    const s = m ? m[1] : slug.trim();
    if (!s) return;
    const next = { ...custom, [ats]: [...(custom[ats] || []), { slug: s, name: s }] };
    app.set({ settings: await app.run('settings:update', [{ customCompanies: next }]) });
    setSlug('');
    app.toast(`Added ${s} — it's searched in every campaign now`, 'success');
  };
  const remove = async (a, s) => app.set({ settings: await app.run('settings:update', [{ customCompanies: { ...custom, [a]: custom[a].filter((c) => c.slug !== s) } }]) });
  return (
    <div className="col" style={{ gap: 18 }}>
      <p className="muted" style={{ margin: 0 }}>ApplyPilot reads company career pages directly from their applicant tracking system — the freshest jobs, often before they hit LinkedIn, and auto-apply capable.</p>
      <div className="grid g3">{Object.entries(counts).map(([k, v]) => <div key={k} className="card pad metric"><div className="k">{k}</div><div className="v">{v} companies</div></div>)}</div>
      <div className="card pad">
        <div className="section-title">Add a dream company</div>
        <div className="row">
          <select className="select" style={{ width: 180 }} value={ats} onChange={(e) => setAts(e.target.value)}>{['greenhouse', 'lever', 'ashby', 'workable', 'smartrecruiters', 'recruitee'].map((a) => <option key={a}>{a}</option>)}</select>
          <input className="input grow" value={slug} onChange={(e) => setSlug(e.target.value)} placeholder="Careers URL or slug, e.g. https://jobs.lever.co/acme" />
          <Button icon={Plus} onClick={add}>Add</Button>
        </div>
        <div className="small dim" style={{ marginTop: 8 }}>Tip: open the company's careers page, click a job — if the URL contains greenhouse.io, lever.co or ashbyhq.com, paste it here.</div>
        <div className="chips" style={{ marginTop: 12 }}>
          {Object.entries(custom).flatMap(([a, list]) => (list || []).map((c) => <span key={a + c.slug} className="tag">{a}: {c.slug}<button onClick={() => remove(a, c.slug)}><Trash2 size={11} /></button></span>))}
        </div>
      </div>
    </div>
  );
}

function Plan() {
  const app = useApp();
  const [key, setKey] = useState('');
  const [busy, setBusy] = useState(false);
  const p = app.plan;
  const activate = async () => {
    setBusy(true);
    try { app.set({ plan: await app.run('license:activate', [key], 'License activated — welcome to Pro 🎉') }); setKey(''); } catch {} finally { setBusy(false); }
  };
  const buy = (ids) => {
    const url = (ids || []).map((i) => CONFIG.checkout[i]).find(Boolean) || CONFIG.website;
    app.run('shell:open', [url]);
  };
  return (
    <div className="col" style={{ gap: 20 }}>
      <div className="card pad row between">
        <div><div className="label">Current plan</div><div style={{ fontSize: 22, fontWeight: 700 }}>{p.label}{p.trialDaysLeft ? <span className="badge amber" style={{ marginLeft: 10 }}>{p.trialDaysLeft} days left</span> : null}</div>
          {p.email && <div className="small muted">Licensed to {p.email}</div>}{p.keyError && <div className="small" style={{ color: 'var(--red)' }}>{p.keyError}</div>}</div>
        <div className="row">
          {!p.licensed && !p.trialUsed && p.plan === 'free' && <Button variant="gradient" className="btn-gradient" onClick={async () => app.set({ plan: await app.run('license:startTrial', [], '7-day Pro trial started') })}>Start 7-day Pro trial</Button>}
          {p.licensed && <Button variant="ghost" onClick={async () => app.set({ plan: await app.run('license:remove') })}>Remove license</Button>}
          {CONFIG.customerPortal && p.licensed && <Button onClick={() => app.run('shell:open', [CONFIG.customerPortal])}>Manage billing</Button>}
        </div>
      </div>
      <div className="grid g4">
        {PRICING.map((t, i) => (
          <motion.div key={t.id} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.06 }} className={`card pad col ${t.highlight ? 'premium premium-shimmer' : ''}`} style={{ gap: 10, borderColor: p.plan === t.id ? 'rgba(74,222,128,.5)' : undefined }}>
            <div className="row between" style={{ position: 'relative', zIndex: 2 }}><span style={{ fontWeight: 700 }}>{t.name}</span>{t.highlight && <span className="badge accent">most popular</span>}</div>
            <div style={{ position: 'relative', zIndex: 2 }}><span style={{ fontSize: 30, fontWeight: 700 }}>{t.price}</span> <span className="small muted">{t.period}</span><div className="small dim">{t.inr} in India{t.alt ? ` · ${t.alt}` : ''}</div></div>
            <ul className="small" style={{ margin: 0, paddingLeft: 18, flex: 1, position: 'relative', zIndex: 2 }}>{t.features.map((f) => <li key={f} style={{ margin: '3px 0' }}>{f}</li>)}</ul>
            {t.id !== 'free' && <Button variant={t.highlight ? 'gradient' : 'outline'} className={t.highlight ? 'btn-gradient' : ''} style={{ position: 'relative', zIndex: 2 }} onClick={() => buy(t.checkout)} disabled={p.plan === t.id}>{p.plan === t.id ? 'Current plan' : `Get ${t.name}`}</Button>}
          </motion.div>
        ))}
      </div>
      <div className="card pad">
        <div className="section-title"><KeyRound size={14} />Activate a license key</div>
        <div className="row"><input className="input grow" value={key} onChange={(e) => setKey(e.target.value)} placeholder="Paste the key from your purchase email" /><Button variant="primary" loading={busy} disabled={!key.trim()} onClick={activate}>Activate</Button></div>
        <div className="small dim" style={{ marginTop: 8 }}>14-day money-back guarantee · cancel anytime in one click · your data stays yours on every plan.</div>
      </div>
    </div>
  );
}

function Data() {
  const app = useApp();
  return (
    <div>
      <div className="card pad" style={{ marginBottom: 14 }}>
        <div className="row"><Globe size={16} color="var(--green)" /><b>100% local.</b></div>
        <div className="small muted" style={{ marginTop: 4 }}>Your profile, resumes, applications and API keys are stored only on this PC (keys encrypted with Windows DPAPI). ApplyPilot has no servers that receive your data. Job searches go directly from your PC to each job source.</div>
      </div>
      <Row title="Export full backup (JSON)" desc="Profile, campaigns, applications and answers."><Button onClick={() => app.run('data:export', [], 'Backup saved')}>Export</Button></Row>
      <Row title="Export applications (CSV)" desc="Open in Excel or Google Sheets."><Button onClick={() => app.run('data:exportCsv', [], 'CSV saved')}>Export CSV</Button></Row>
      <Row title="Open data folder" desc={app.userDataDir}><Button onClick={() => app.run('shell:openPath', [app.userDataDir])}>Open</Button></Row>
      <Row title="Re-run setup wizard"><Button onClick={async () => { app.set({ settings: await app.run('settings:update', [{ onboarded: false }]) }); }}>Start</Button></Row>
      <Row title="Version"><span className="muted">ApplyPilot {app.version}</span></Row>
    </div>
  );
}

export default function Settings({ params }) {
  const [tab, setTab] = useState(params.tab || 'general');
  useEffect(() => { if (params.tab) setTab(params.tab); }, [params.tab]);
  const Comp = { general: General, sources: Sources, ai: AI, companies: Companies, plan: Plan, data: Data }[tab];
  return (
    <div className="page">
      <div className="page-head"><div><h1>Settings</h1><p>Tune how ApplyPilot searches and applies.</p></div></div>
      <div className="split">
        <div className="sticky side-list">{TABS.map((t) => <button key={t.id} className={tab === t.id ? 'on' : ''} onClick={() => setTab(t.id)}><t.icon size={15} />{t.label}</button>)}</div>
        <motion.div key={tab} initial={{ opacity: 0, x: 10 }} animate={{ opacity: 1, x: 0 }} className="card pad" style={{ padding: 26 }}><Comp /></motion.div>
      </div>
    </div>
  );
}
