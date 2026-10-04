import React, { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Upload, FileText, Star, Trash2, ExternalLink, Eye, Wand2, TrendingUp } from 'lucide-react';
import { useApp, api } from '../lib/store';
import { Button, Modal, TagInput, Empty, stagger } from '../components/ui';

// Merge extracted resume data into the profile without overwriting what the user already typed.
export function mergeProfile(current = {}, found = {}, overwrite = false) {
  const out = { ...current };
  for (const [k, v] of Object.entries(found || {})) {
    if (v === '' || v == null || (Array.isArray(v) && !v.length)) continue;
    const cur = out[k];
    const empty = cur == null || cur === '' || (Array.isArray(cur) && !cur.length);
    if (overwrite || empty) out[k] = v;
    else if (Array.isArray(cur) && Array.isArray(v) && typeof v[0] === 'string') out[k] = [...new Set([...cur, ...v])];
  }
  return out;
}

export function useResumeUpload() {
  const app = useApp();
  const [busy, setBusy] = useState(false);
  const after = (results) => {
    if (!results || !results.length) return results;
    app.set((s) => ({ resumes: [...s.resumes.filter((r) => !results.some((x) => x.resume.id === r.id)), ...results.map((x) => x.resume)] }));
    app.toast(`${results.length} resume${results.length > 1 ? 's' : ''} uploaded`, 'success');
    return results;
  };
  const pick = async () => { setBusy(true); try { return after(await app.run('resumes:pick')); } catch { return null; } finally { setBusy(false); } };
  const dropFiles = async (files) => {
    const paths = [...files].map((f) => api.pathForFile(f)).filter(Boolean);
    if (!paths.length) return null;
    setBusy(true);
    try { return after(await app.run('resumes:importPaths', [paths])); } catch { return null; } finally { setBusy(false); }
  };
  return { busy, pick, dropFiles };
}

export function Dropzone({ onDone, compact }) {
  const { busy, pick, dropFiles } = useResumeUpload();
  const [over, setOver] = useState(false);
  return (
    <div className={`dropzone ${over ? 'over' : ''}`} style={compact ? { padding: 22 } : null}
      onClick={async () => { const r = await pick(); r && onDone && onDone(r); }}
      onDragOver={(e) => { e.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)}
      onDrop={async (e) => { e.preventDefault(); setOver(false); const r = await dropFiles(e.dataTransfer.files); r && onDone && onDone(r); }}>
      <motion.div animate={busy ? { rotate: [0, 8, -8, 0] } : { y: [0, -4, 0] }} transition={{ repeat: Infinity, duration: busy ? 0.6 : 2.4 }} style={{ display: 'inline-block' }}>
        <Upload size={30} color="var(--accent-2)" />
      </motion.div>
      <div style={{ fontWeight: 700, marginTop: 10 }}>{busy ? 'Reading your resume…' : 'Drop resumes here or click to upload'}</div>
      <div className="small muted">PDF, DOCX or TXT · upload a different version for each kind of role</div>
    </div>
  );
}

export function FillProfileModal({ open, onClose, resumeId }) {
  const app = useApp();
  const [busy, setBusy] = useState(false);
  const fill = async (overwrite) => {
    setBusy(true);
    try {
      const found = await app.run('ai:parseResume', [resumeId]);
      const values = mergeProfile(app.profile.values, found, overwrite);
      const saved = await app.run('profile:save', [values], 'Profile filled from your resume — please double-check it');
      app.set({ profile: saved });
      onClose(true);
    } catch {} finally { setBusy(false); }
  };
  return (
    <Modal open={open} onClose={() => onClose(false)} title="Fill your profile from this resume?" footer={<>
      <Button variant="ghost" onClick={() => onClose(false)}>Not now</Button>
      <Button onClick={() => fill(true)} loading={busy}>Overwrite everything</Button>
      <Button variant="primary" icon={Wand2} onClick={() => fill(false)} loading={busy}>Fill empty fields</Button>
    </>}>
      <p className="muted" style={{ marginTop: 0 }}>ApplyPilot reads your resume and fills in your name, contact details, links, skills, experience{app.settings.keys.anthropic ? ', work history, education and more (using AI)' : ''}. You can review and edit everything in the Profile tab.</p>
      {!app.settings.keys.anthropic && <p className="small dim">Tip: add an Anthropic API key in Settings for a much more complete import (work history, education, projects).</p>}
    </Modal>
  );
}

function ResumeCard({ r, index }) {
  const app = useApp();
  const [text, setText] = useState(null);
  const [fill, setFill] = useState(false);
  const update = async (patch) => app.set({ resumes: await app.run('resumes:update', [r.id, patch]) });
  const del = async () => { if (confirm(`Delete "${r.name}"?`)) app.set({ resumes: await app.run('resumes:delete', [r.id]) }); };
  const st = r.stats || {};
  const rate = st.applied ? Math.round(((st.interviews || 0) / st.applied) * 100) : null;
  return (
    <motion.div {...stagger(index)} layout className={`card ${r.isDefault ? 'premium' : ''}`}>
      <div style={{ padding: 18 }}>
        <div className="row" style={{ alignItems: 'flex-start', gap: 14 }}>
          <div className="logo-tile" style={{ background: 'linear-gradient(135deg,#4f46e5,#0891b2)' }}><FileText size={22} /></div>
          <div className="grow">
            <input className="input" style={{ background: 'transparent', border: 0, padding: 0, height: 26, fontWeight: 700, fontSize: 16 }} defaultValue={r.name} onBlur={(e) => e.target.value !== r.name && update({ name: e.target.value })} />
            <div className="small dim">{r.fileName} · {Math.round(r.size / 1024)} KB · {r.textLength ? `${r.textLength.toLocaleString()} chars read` : <span style={{ color: 'var(--red)' }}>couldn't read text{r.parseError ? ` (${r.parseError})` : ''}</span>}</div>
          </div>
          <Button size="sm" variant={r.isDefault ? 'outline' : 'ghost'} icon={Star} onClick={() => update({ isDefault: true })}>{r.isDefault ? 'Default' : 'Make default'}</Button>
        </div>
        <div style={{ marginTop: 14 }}>
          <span className="label">Use for roles like</span>
          <TagInput value={r.roles || []} onChange={(roles) => update({ roles })} placeholder="e.g. Data Analyst, BI Developer" />
        </div>
        {r.skills && r.skills.length > 0 && <div className="chips" style={{ marginTop: 12 }}>{r.skills.slice(0, 16).map((s) => <span className="badge" key={s}>{s}</span>)}{r.skills.length > 16 && <span className="badge">+{r.skills.length - 16}</span>}</div>}
      </div>
      <div style={{ borderTop: '1px solid var(--border)', padding: '12px 18px', display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 8 }}>
        <div className="metric"><div className="k">Applied</div><div className="v">{st.applied || 0}</div></div>
        <div className="metric"><div className="k">Interviews</div><div className="v">{st.interviews || 0}</div></div>
        <div className="metric"><div className="k">Offers</div><div className="v">{st.offers || 0}</div></div>
        <div className="metric"><div className="k">Interview rate</div><div className="v" style={{ color: rate ? 'var(--green)' : undefined }}>{rate == null ? '—' : `${rate}%`}</div></div>
      </div>
      <div className="row" style={{ padding: '0 18px 14px', gap: 6 }}>
        <Button size="sm" icon={ExternalLink} onClick={() => app.run('resumes:open', [r.id])}>Open</Button>
        <Button size="sm" icon={Eye} onClick={async () => setText(await app.run('resumes:text', [r.id]))}>Parsed text</Button>
        <Button size="sm" icon={Wand2} onClick={() => setFill(true)}>Fill profile</Button>
        <div className="grow" />
        <Button size="sm" variant="ghost" icon={Trash2} onClick={del} />
      </div>
      <Modal open={text != null} onClose={() => setText(null)} title={`What employers' ATS sees: ${r.name}`} wide>
        <p className="small muted" style={{ marginTop: 0 }}>This is the plain text applicant tracking systems extract. If something important is missing or jumbled here, simplify your resume layout (single column, no text in images).</p>
        <pre className="prewrap small card pad" style={{ fontFamily: 'var(--font)', maxHeight: 520, overflow: 'auto' }}>{text}</pre>
      </Modal>
      <FillProfileModal open={fill} resumeId={r.id} onClose={() => setFill(false)} />
    </motion.div>
  );
}

export default function Resumes() {
  const app = useApp();
  const [fillFor, setFillFor] = useState(null);
  useEffect(() => { app.run('resumes:list').then((resumes) => app.set({ resumes })).catch(() => {}); }, []); // eslint-disable-line
  const profileEmpty = !(app.profile.values || {}).firstName;
  return (
    <div className="page">
      <div className="page-head">
        <div><h1>Resumes</h1><p>Keep a tailored resume per role. Tag each with roles — ApplyPilot sends the best one to every job, then shows which converts best.</p></div>
        <span className="badge">{app.resumes.length}/{app.plan.resumes} on {app.plan.label}</span>
      </div>
      <Dropzone onDone={(r) => { if (profileEmpty && r[0]) setFillFor(r[0].resume.id); }} />
      <div style={{ height: 24 }} />
      {app.resumes.length ? (
        <>
          <div className="section-title"><TrendingUp size={14} />Your resumes — A/B tested automatically</div>
          <div className="grid g2"><AnimatePresence>{app.resumes.map((r, i) => <ResumeCard key={r.id} r={r} index={i} />)}</AnimatePresence></div>
        </>
      ) : (
        <Empty icon={FileText} title="No resumes yet">Upload at least one resume to start applying.</Empty>
      )}
      <FillProfileModal open={!!fillFor} resumeId={fillFor} onClose={() => setFillFor(null)} />
    </div>
  );
}
