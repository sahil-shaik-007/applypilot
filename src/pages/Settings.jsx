import React, { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { Smartphone, RefreshCw, Lock, Users, Settings as Cog, Database, KeyRound, Building2, Crown, HardDrive, Check, ExternalLink, Globe, Trash2, Plus, Bot, Monitor, LogIn, Search, Zap, Puzzle, FolderOpen } from 'lucide-react';
import { useApp } from '../lib/store';
import { Button, Field, Switch, Seg } from '../components/ui';
import { CONFIG, PRICING } from '../config';

const TABS = [
  { id: 'general', label: 'General', icon: Cog },
  { id: 'sources', label: 'Job sources', icon: Database },
  { id: 'ai', label: 'AI', icon: Bot },
  { id: 'companies', label: 'Career pages', icon: Building2 },
  { id: 'network', label: 'Network (referrals)', icon: Users },
  { id: 'cloud', label: 'Phone & web', icon: Smartphone },
  { id: 'extension', label: 'Browser extension', icon: Puzzle },
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
      <Row title="Cancel window before auto-submit" desc="Autopilot waits this long (and notifies you) before pressing submit, so you can hold any application. 0 = submit immediately.">
        <select className="select" style={{ width: 140 }} value={s.submitDelaySeconds ?? 30} onChange={(e) => up({ submitDelaySeconds: +e.target.value })}>
          {[0, 15, 30, 60, 120, 300].map((v) => <option key={v} value={v}>{v === 0 ? 'Off' : v < 60 ? `${v} seconds` : `${v / 60} minute${v > 60 ? 's' : ''}`}</option>)}
        </select>
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
  const local = s.aiProvider === 'local';
  const [testing, setTesting] = useState(false);
  const [addr, setAddr] = useState((s.localAi && s.localAi.baseUrl) || 'http://localhost:11434/v1');
  const [models, setModels] = useState([]);
  const [finding, setFinding] = useState(false);
  const up = async (patch) => app.set({ settings: await app.run('settings:update', [patch]) });
  const findModels = async () => {
    setFinding(true);
    try {
      const list = await app.run('ai:localModels', [addr]);
      setModels(list);
      if (!list.length) return app.toast('The server is running but has no models. Pull one first (e.g. "ollama pull llama3.1").', 'error');
      app.toast(`Found ${list.length} model${list.length === 1 ? '' : 's'}`, 'success');
      if (!s.localAi?.model || !list.includes(s.localAi.model)) await up({ localAi: { baseUrl: addr, model: list[0] } });
      else await up({ localAi: { baseUrl: addr, model: s.localAi.model } });
    } catch {} finally { setFinding(false); }
  };
  return (
    <div>
      <div className="row" style={{ marginBottom: 14 }}>
        <Seg value={local ? 'local' : 'anthropic'} onChange={(v) => up({ aiProvider: v })} options={[{ value: 'anthropic', label: 'Claude (cloud, your key)' }, { value: 'local', label: 'Local model (on your PC)' }]} />
      </div>
      {!local ? (
        <>
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
        </>
      ) : (
        <div className="card pad col" style={{ gap: 12 }}>
          <p className="muted" style={{ margin: 0 }}>Run a model on this PC with <b>Ollama</b> (ollama.com) or <b>LM Studio</b> and ApplyPilot uses it for cover letters, tailored resumes, answers and plain-English search. Nothing leaves your machine. Your data only goes to the address below, so only point it at a server you run yourself.</p>
          <div>
            <span className="field-label">Server address</span>
            <div className="row" style={{ gap: 8 }}>
              <input className="input grow" value={addr} onChange={(e) => setAddr(e.target.value)} placeholder="http://localhost:11434/v1" />
              <Button icon={RefreshCw} loading={finding} onClick={findModels}>Find models</Button>
            </div>
            <div className="small dim" style={{ marginTop: 6 }}>Ollama: http://localhost:11434/v1 · LM Studio: http://localhost:1234/v1</div>
          </div>
          <div>
            <span className="field-label">Model</span>
            {models.length ? (
              <select className="select" value={s.localAi?.model || ''} onChange={(e) => up({ localAi: { baseUrl: addr, model: e.target.value } })}>
                {models.map((m) => <option key={m} value={m}>{m}</option>)}
              </select>
            ) : (
              <input className="input" value={s.localAi?.model || ''} onChange={(e) => up({ localAi: { baseUrl: addr, model: e.target.value } })} placeholder="Click Find models, or type a model name" />
            )}
            <div className="small dim" style={{ marginTop: 6 }}>Instruction-tuned models (for example llama3.1, qwen2.5 or mistral) give the best results. Plain-English search needs one that follows JSON instructions well.</div>
          </div>
        </div>
      )}
      <Row title="Answer unknown screening questions with AI" desc="Only when your profile clearly supports the answer; otherwise the question waits for you in the Answer bank."><Switch on={s.aiAnswerQuestions} onChange={(v) => up({ aiAnswerQuestions: v })} /></Row>
      <Row title="Usage on your plan" desc={`${app.plan.label}: ${app.plan.aiPerDay >= 1000 ? 'unlimited' : `${app.plan.aiPerDay}`} AI actions per day${local ? ' (local models count the same way)' : ''}`}><span /></Row>
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
  // Accepts a careers URL (ATS detected from the domain) or a bare slug for the selected ATS.
  const add = async () => {
    const raw = slug.trim();
    if (!raw) return;
    const patterns = [
      ['greenhouse', /greenhouse\.io\/(?:embed\/job_board\?for=)?([A-Za-z0-9_.-]+)/i], ['lever', /lever\.co\/([A-Za-z0-9_.-]+)/i],
      ['ashby', /ashbyhq\.com\/([A-Za-z0-9_.%-]+)/i], ['workable', /workable\.com\/(?:j\/)?([A-Za-z0-9_.-]+)/i],
      ['smartrecruiters', /smartrecruiters\.com\/([A-Za-z0-9_.-]+)/i], ['recruitee', /([A-Za-z0-9-]+)\.recruitee\.com/i],
    ];
    let kind = ats; let s = raw;
    const hit = patterns.find(([, re]) => re.test(raw));
    if (hit) { kind = hit[0]; s = raw.match(hit[1])[1]; }
    else if (/[/:.]/.test(raw)) return app.toast('That URL is not a Greenhouse, Lever, Ashby, Workable, SmartRecruiters or Recruitee careers page.', 'error');
    if ((custom[kind] || []).some((c) => c.slug === s)) return app.toast(`${s} is already in your list`, 'error');
    const next = { ...custom, [kind]: [...(custom[kind] || []), { slug: s, name: s }] };
    app.set({ settings: await app.run('settings:update', [{ customCompanies: next }]) });
    setSlug('');
    setAts(kind);
    app.toast(`Added ${s} (${kind}) — it's searched in every campaign now`, 'success');
  };
  const remove = async (a, s) => app.set({ settings: await app.run('settings:update', [{ customCompanies: { ...custom, [a]: custom[a].filter((c) => c.slug !== s) } }]) });
  return (
    <div className="col" style={{ gap: 18 }}>
      <CareerPages />
      <p className="muted" style={{ margin: 0 }}>ApplyPilot reads company career pages directly from their applicant tracking system — the freshest jobs, often before they hit LinkedIn, and auto-apply capable.</p>
      <div className="grid g3">{Object.entries(counts).map(([k, v]) => <div key={k} className="card pad metric"><div className="k">{k}</div><div className="v">{v} companies</div></div>)}</div>
      <div className="card pad">
        <div className="section-title">Add an ATS board by slug</div>
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

const METHOD_LABEL = { ats: 'ATS board · auto-apply capable', workday: 'Workday', jsonld: 'Structured job data', links: 'Page links' };

// Watch any company's careers page: paste a link -> inspect -> preview jobs -> add & watch.
function CareerPages() {
  const app = useApp();
  const [pages, setPages] = useState([]);
  const [url, setUrl] = useState('');
  const [found, setFound] = useState(null);
  const [busy, setBusy] = useState('');
  useEffect(() => { app.run('careerPages:list').then(setPages).catch(() => {}); }, []); // eslint-disable-line
  const inspect = async () => {
    const u = url.trim();
    if (!u) return;
    setBusy('inspect'); setFound(null);
    try { setFound(await app.run('careerPages:inspect', [/^https?:/i.test(u) ? u : `https://${u}`])); } catch {} finally { setBusy(''); }
  };
  const add = async () => {
    setBusy('add');
    try {
      const next = await app.run('careerPages:add', [found], `Watching ${found.company} — its jobs are included in every search and campaign`);
      setPages(next); setFound(null); setUrl('');
      const added = next[next.length - 1];
      if (added) app.run('careerPages:refresh', [added.id]).then((r) => setPages(r.pages)).catch(() => {});
    } catch {} finally { setBusy(''); }
  };
  const refresh = async (p) => {
    setBusy(p.id);
    try { const r = await app.run('careerPages:refresh', [p.id]); setPages(r.pages); app.toast(`${r.count} jobs from ${p.company} added to Jobs`, 'success'); } catch {} finally { setBusy(''); }
  };
  const toggle = async (p) => setPages(await app.run('careerPages:update', [p.id, { enabled: p.enabled === false }]));
  const remove = async (p) => { if (await app.confirm({ title: 'Stop watching this page?', message: `${p.company} will no longer be searched. Jobs already found stay in your Jobs list.`, confirmLabel: 'Remove' })) setPages(await app.run('careerPages:remove', [p.id])); };
  return (
    <div className="card pad col" style={{ gap: 12 }}>
      <div className="section-title" style={{ margin: 0 }}>Watch any company's careers page</div>
      <div className="small muted">Paste the careers page of any company. ApplyPilot works out how the page lists its jobs (Greenhouse, Lever, Ashby, Workable, SmartRecruiters, Recruitee, Workday or the page itself), then includes them in every search and campaign so you can auto-apply like any other job.</div>
      <div className="row">
        <input className="input grow" value={url} onChange={(e) => setUrl(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && inspect()} placeholder="https://company.com/careers" />
        <Button icon={Search} onClick={inspect} disabled={!url.trim() || busy === 'inspect'}>{busy === 'inspect' ? 'Reading page…' : 'Inspect'}</Button>
      </div>
      {found && (
        <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} className="card pad col" style={{ gap: 8, background: 'var(--bg-2, rgba(255,255,255,.02))' }}>
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <div className="col" style={{ gap: 2 }}>
              <input className="input" style={{ fontWeight: 600, maxWidth: 320 }} value={found.company || ''} onChange={(e) => setFound({ ...found, company: e.target.value })} aria-label="Company name" />
              <span className="small dim">{METHOD_LABEL[found.method] || found.method}{found.ats && found.method === 'ats' ? ` (${found.ats}: ${found.slug})` : ''} · {found.jobCount} open {found.jobCount === 1 ? 'role' : 'roles'}</span>
            </div>
            <div className="row" style={{ gap: 6 }}>
              <Button onClick={() => setFound(null)}>Cancel</Button>
              <Button icon={Plus} onClick={add} disabled={busy === 'add'}>Add &amp; watch</Button>
            </div>
          </div>
          <div className="col" style={{ gap: 4 }}>
            {(found.jobsPreview || []).map((j) => <div key={j.id} className="small row" style={{ justifyContent: 'space-between', gap: 8 }}><span>{j.title}</span><span className="dim">{j.location}</span></div>)}
            {found.jobCount > (found.jobsPreview || []).length && <div className="small dim">…and {found.jobCount - found.jobsPreview.length} more</div>}
          </div>
        </motion.div>
      )}
      {pages.length > 0 && (
        <div className="col" style={{ gap: 6 }}>
          {pages.map((p) => (
            <div key={p.id} className="row" style={{ gap: 10, justifyContent: 'space-between', opacity: p.enabled === false ? 0.55 : 1 }}>
              <div className="col grow" style={{ gap: 2, minWidth: 0 }}>
                <span style={{ fontWeight: 600 }}>{p.company} {p.method === 'ats' && <Zap size={12} style={{ color: 'var(--accent, #818cf8)' }} title="Auto-apply capable" />}</span>
                <span className="small dim" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.url} · {p.jobCount || 0} jobs{p.lastChecked ? ` · checked ${new Date(p.lastChecked).toLocaleString()}` : ''}</span>
              </div>
              <Switch on={p.enabled !== false} onChange={() => toggle(p)} />
              <Button size="sm" icon={RefreshCw} onClick={() => refresh(p)} disabled={busy === p.id} title="Fetch jobs now">{busy === p.id ? 'Fetching…' : 'Refresh'}</Button>
              <Button size="sm" icon={Trash2} onClick={() => remove(p)} title="Stop watching" />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function Cloud() {
  const app = useApp();
  const [st, setSt] = useState(null);
  const [form, setForm] = useState({ serverUrl: CONFIG.cloudUrl, code: '', passphrase: '' });
  const [busy, setBusy] = useState(false);
  const load = () => app.run('cloud:status').then(setSt).catch(() => {});
  useEffect(() => { load(); const off = window.api.on((ch, p) => { if (ch === 'cloud:status') setSt(p); }); return off; }, []); // eslint-disable-line
  const link = async () => {
    setBusy(true);
    try { setSt(await app.run('cloud:link', [form], 'Linked — your phone and this PC now share an encrypted vault')); setForm((f) => ({ ...f, code: '', passphrase: '' })); } catch {} finally { setBusy(false); }
  };
  if (!st) return null;
  return (
    <div className="col" style={{ gap: 16 }}>
      <p className="muted" style={{ margin: 0 }}>Apply from your phone when you're away from this PC: search and swipe through matches on the ApplyPilot website; jobs you send here wait in your Review queue (or apply on autopilot if you chose that) the next time this app is on. Your profile, resumes and applications sync <b>end-to-end encrypted</b> — the server only ever stores ciphertext it cannot read.</p>
      {st.linked ? (
        <div className="card pad col premium" style={{ gap: 10 }}>
          <div className="row between">
            <div><div style={{ fontWeight: 700 }}><Lock size={14} style={{ verticalAlign: -2 }} /> Linked to {st.email}</div><div className="small muted">{st.serverUrl} · {st.deviceName}</div></div>
            <div className="row">
              <Button icon={RefreshCw} loading={st.syncing || busy} onClick={async () => { setBusy(true); try { setSt(await app.run('cloud:sync')); } catch {} finally { setBusy(false); } }}>Sync now</Button>
              <Button variant="ghost" onClick={async () => { if (await app.confirm({ title: 'Unlink this PC?', message: 'This PC stops syncing with your phone. Your local data stays here; revoke the device on the website to remove its access completely.', confirmLabel: 'Unlink' })) setSt(await app.run('cloud:unlink')); }}>Unlink</Button>
            </div>
          </div>
          <div className="small muted">{st.lastSyncAt ? `Last sync ${new Date(st.lastSyncAt).toLocaleTimeString()}${st.stats ? ` · ${st.stats.pushed} sent, ${st.stats.pulled} received, ${st.stats.fromPhone} job(s) from your phone` : ''}` : 'Syncing…'}</div>
          {st.lastError && <div className="small" style={{ color: 'var(--red)' }}>{st.lastError}</div>}
        </div>
      ) : (
        <div className="card pad col" style={{ gap: 12 }}>
          <div className="section-title" style={{ margin: 0 }}>Link this PC</div>
          <ol className="small" style={{ margin: 0, paddingLeft: 18, lineHeight: 1.8 }}>
            <li>On your phone, open the ApplyPilot website and sign in with Google.</li>
            <li>Create your vault passphrase (first time only) → <b>Settings → Devices → Link desktop app</b>.</li>
            <li>Enter the 8-character code and your vault passphrase here.</li>
          </ol>
          <Field label="Server"><input className="input" value={form.serverUrl} onChange={(e) => setForm({ ...form, serverUrl: e.target.value })} /></Field>
          <div className="grid g2">
            <Field label="Link code"><input className="input" value={form.code} maxLength={12} placeholder="e.g. 7KQ2MXRA" onChange={(e) => setForm({ ...form, code: e.target.value.toUpperCase() })} style={{ letterSpacing: 2, fontWeight: 700 }} /></Field>
            <Field label="Vault passphrase" help="Only used here to unlock your encryption key; never sent anywhere."><input className="input" type="password" value={form.passphrase} onChange={(e) => setForm({ ...form, passphrase: e.target.value })} /></Field>
          </div>
          <div><Button variant="primary" icon={Smartphone} loading={busy} disabled={!form.code || !form.passphrase} onClick={link}>Link this PC</Button></div>
        </div>
      )}
    </div>
  );
}

function Network() {
  const app = useApp();
  const [stats, setStats] = useState(null);
  const load = () => app.run('network:stats').then(setStats).catch(() => {});
  useEffect(() => { load(); }, []); // eslint-disable-line
  return (
    <div className="col" style={{ gap: 16 }}>
      <p className="muted" style={{ margin: 0 }}>Referrals get interviews several times more often than cold applications. Import your LinkedIn connections and ApplyPilot shows <b>who you already know</b> at every company you look at — with a one-click AI referral message. The file never leaves this PC.</p>
      <div className="card pad">
        <div className="section-title">How to get the file (2 minutes)</div>
        <ol className="small" style={{ margin: 0, paddingLeft: 18, lineHeight: 1.8 }}>
          <li>LinkedIn → <b>Me</b> → <b>Settings &amp; Privacy</b> → <b>Data privacy</b> → <b>Get a copy of your data</b></li>
          <li>Choose <b>Connections</b> only → <b>Request archive</b> (LinkedIn emails it within ~10 minutes)</li>
          <li>Unzip it and import <b>Connections.csv</b> below</li>
        </ol>
        <Button size="sm" variant="ghost" icon={ExternalLink} style={{ marginTop: 8 }} onClick={() => app.run('shell:open', ['https://www.linkedin.com/mypreferences/d/download-my-data'])}>Open LinkedIn data export</Button>
      </div>
      <div className="card pad row between">
        <div>
          <div style={{ fontWeight: 700 }}>{stats && stats.count ? `${stats.count.toLocaleString()} connections imported` : 'No connections imported yet'}</div>
          {stats && stats.importedAt && <div className="small dim">Imported {new Date(stats.importedAt).toLocaleDateString()}</div>}
        </div>
        <div className="row">
          {stats && stats.count > 0 && <Button variant="ghost" icon={Trash2} onClick={async () => { if (await app.confirm({ title: 'Remove imported connections?', message: 'The referral finder will stop showing who you know at each company. You can import again anytime.', confirmLabel: 'Remove' })) { await app.run('network:clear'); load(); } }}>Remove</Button>}
          <Button variant="primary" icon={Users} onClick={async () => { try { const r = await app.run('network:import'); if (r) { app.toast(`Imported ${r.count} connections across ${r.companies} companies`, 'success'); load(); } } catch {} }}>{stats && stats.count ? 'Re-import' : 'Import Connections.csv'}</Button>
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
      <Row title="Delete all my data" desc="Permanently erases your profile, resumes, applications, answers, API keys, license and the ApplyPilot browser profile from this PC, then restarts the app. Export a backup first if you might need it.">
        <Button variant="danger" icon={Trash2} onClick={async () => {
          if (!(await app.confirm({ title: 'Delete all ApplyPilot data?', message: 'Everything ApplyPilot stored on this PC will be permanently deleted and the app will restart as if newly installed. This cannot be undone.', confirmLabel: 'Delete everything' }))) return;
          app.toast('Deleting your data…');
          try { await app.run('data:reset'); } catch {}
        }}>Delete everything</Button>
      </Row>
      <Row title={`ApplyPilot ${app.version}`} desc="Updates download automatically in the background and install on restart.">
        <Button icon={RefreshCw} onClick={async () => { const r = await app.run('app:checkUpdates'); app.toast(r.message, r.status === 'error' ? 'error' : 'success'); }}>Check for updates</Button>
      </Row>
      <Row title="Export diagnostics" desc="A file for support: versions, settings (no keys), counts and recent errors. Contains no profile, resume or application contents.">
        <Button onClick={async () => { const p = await app.run('app:exportDiagnostics'); if (p) app.toast('Diagnostics saved', 'success'); }}>Export</Button>
      </Row>
    </div>
  );
}

// Pair the ApplyPilot browser extension with this PC. The extension fills application forms in your own
// browser from your profile; nothing is submitted until you press submit.
function Extension() {
  const app = useApp();
  const [st, setSt] = useState(null);
  const load = () => app.run('extension:status').then(setSt).catch(() => {});
  useEffect(() => {
    load();
    const t = setInterval(load, 15000);
    const off = window.api.on((ch) => { if (ch === 'extension:paired') load(); });
    return () => { clearInterval(t); off(); };
  }, []); // eslint-disable-line
  if (!st) return null;
  const revoke = async (p) => {
    if (!(await app.confirm({ title: 'Unpair this browser?', message: `${p.name || p.browser || 'This browser'} will stop filling forms until you pair it again.`, confirmLabel: 'Unpair' }))) return;
    setSt(await app.run('extension:revoke', [p.id]));
  };
  return (
    <div className="col" style={{ gap: 16 }}>
      <p className="muted" style={{ margin: 0 }}>The ApplyPilot extension fills job application forms in your own Chrome or Edge from your profile. It shows what it will fill and what is missing, fills only after you confirm, and never submits for you.</p>
      <div className="card pad col" style={{ gap: 10 }}>
        <div className="row between">
          <div className="section-title" style={{ margin: 0 }}>Connection</div>
          <span className={`badge ${st.running ? 'green' : 'red'}`}>{st.running ? `Running · port ${st.port}` : 'Not running'}</span>
        </div>
        {!st.running && <div className="small dim">The local connection could not start. Restart ApplyPilot; if it keeps failing, another program may be using ports 47823-47833.</div>}
        {st.running && st.code && (
          <div className="col" style={{ gap: 6 }}>
            <span className="field-label">Pairing code (valid for 10 minutes, single use)</span>
            <div className="row" style={{ gap: 10 }}>
              <span style={{ fontSize: 28, fontWeight: 700, letterSpacing: '0.18em' }} data-testid="pair-code">{st.code.code}</span>
              <Button size="sm" onClick={async () => setSt(await app.run('extension:newCode'))}>New code</Button>
            </div>
          </div>
        )}
      </div>
      <div className="card pad col" style={{ gap: 8 }}>
        <div className="section-title" style={{ margin: 0 }}>Install in 4 steps</div>
        <ol className="small muted" style={{ margin: 0, paddingLeft: 18, lineHeight: 1.8 }}>
          <li>Open <b>chrome://extensions</b> (or <b>edge://extensions</b>) and turn on <b>Developer mode</b>.</li>
          <li>Click <b>Load unpacked</b> and choose the ApplyPilot extension folder (button below).</li>
          <li>Pin the ApplyPilot icon, open it, and enter the pairing code above.</li>
          <li>Open a job application page, click the icon, review, and confirm to fill.</li>
        </ol>
        <div className="row"><Button icon={FolderOpen} disabled={!st.folderReady} onClick={() => app.run('extension:openFolder')}>Open extension folder</Button>{!st.folderReady && <span className="small dim">The extension folder was not found next to the app.</span>}</div>
      </div>
      <div className="card pad col" style={{ gap: 8 }}>
        <div className="section-title" style={{ margin: 0 }}>Paired browsers</div>
        {st.pairings.length ? st.pairings.map((p) => (
          <div key={p.id} className="row between">
            <div className="col" style={{ gap: 2 }}>
              <span style={{ fontWeight: 600 }}>{p.name || p.browser || 'Browser'}</span>
              <span className="small dim">Paired {new Date(p.createdAt).toLocaleDateString()}{p.lastSeenAt ? ` · last used ${new Date(p.lastSeenAt).toLocaleString()}` : ''}</span>
            </div>
            <Button size="sm" icon={Trash2} onClick={() => revoke(p)}>Unpair</Button>
          </div>
        )) : <div className="small dim">No browser paired yet.</div>}
      </div>
    </div>
  );
}

export default function Settings({ params }) {
  const [tab, setTab] = useState(params.tab || 'general');
  useEffect(() => { if (params.tab) setTab(params.tab); }, [params.tab]);
  const Comp = { general: General, sources: Sources, ai: AI, companies: Companies, network: Network, cloud: Cloud, extension: Extension, plan: Plan, data: Data }[tab];
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
