import React, { useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Upload, FileText, Star, Trash2, Pencil, Download, Check, X, CircleAlert, Loader2, Eye } from 'lucide-react';
import { newId } from '@shared/vaultCrypto.js';
import { useApp } from '../lib/store.jsx';
import { Button, Empty, TagInput, Sheet, timeAgo, downloadFile } from '../components/ui.jsx';
import { ACCEPT, MAX_BYTES, extOf, extractResume, prettySkills } from '../lib/resumeParse.js';
import { sha256Hex } from '../lib/sync.js';
import { setResumeProfile, resumeGroup } from '../lib/profiles.js';
import { fillProfileFromResume } from '../lib/resumeProfile.js';

const MIME = { '.pdf': 'application/pdf', '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', '.txt': 'text/plain', '.md': 'text/markdown' };
const kb = (n) => (n > 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);
const profileName = (app, id) => { const p = app.profiles.find((x) => x.id === id); return p ? p.label : 'a removed profile'; };

function ResumeCard({ r, onView }) {
  const app = useApp();
  // Profile badges and pickers only appear once there is more than one profile (or the resume has one).
  const showProfiles = app.profiles.length > 1 || !!r.profileId;
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(r.name);
  const save = async (patch, msg) => { try { await app.put('resumes', r.id, { ...r, ...patch }); if (msg) app.toast(msg, 'success'); } catch (e) { app.toast(e.message, 'error'); } };
  // "Default" is per group: the default of one profile, and the default of the shared resumes.
  const makeDefault = async () => {
    try {
      for (const o of app.resumes) if (o.isDefault && o.id !== r.id && resumeGroup(o) === resumeGroup(r)) await app.put('resumes', o.id, { ...o, isDefault: false });
      await save({ isDefault: true }, `"${r.name}" is now the default resume${r.profileId ? ` for ${profileName(app, r.profileId)}` : ''}`);
    } catch (e) { app.toast(e.message, 'error'); }
  };
  const moveTo = async (pid) => {
    try { await setResumeProfile(app, r, pid || null); app.toast(pid ? `"${r.name}" belongs to ${profileName(app, pid)}` : `"${r.name}" is shared with every profile`, 'success'); }
    catch (e) { app.toast(e.message, 'error'); }
  };
  const del = async () => {
    if (!(await app.confirm({ title: 'Delete resume?', message: `"${r.name}" and its encrypted file will be deleted from every device.` }))) return;
    try {
      if (r.blobId) await app.sync.deleteBlob(r.blobId);
      await app.remove('resumes', r.id);
      if (r.isDefault) { const next = app.resumes.find((x) => x.id !== r.id && resumeGroup(x) === resumeGroup(r)); if (next) await app.put('resumes', next.id, { ...next, isDefault: true }); }
      app.toast('Resume deleted', 'success');
    } catch (e) { app.toast(e.message, 'error'); }
  };
  const download = async () => {
    try { const bytes = await app.sync.getBlob(r.blobId); downloadFile(r.fileName || `${r.name}${r.ext}`, bytes, MIME[r.ext] || 'application/octet-stream'); } catch (e) { app.toast(e.message, 'error'); }
  };
  return (
    <motion.div layout initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, x: 30 }} className={`card pad ${r.isDefault ? 'premium premium-shimmer' : ''}`} data-testid="resume-card">
      <div className="col" style={{ gap: 10, position: 'relative', zIndex: 2 }}>
        <div className="row" style={{ gap: 10, alignItems: 'flex-start' }}>
          <span className="feature"><span className="ico"><FileText size={17} /></span></span>
          <div className="grow">
            {editing ? (
              <form className="row" style={{ gap: 6 }} onSubmit={(e) => { e.preventDefault(); if (name.trim()) { save({ name: name.trim() }, 'Renamed'); setEditing(false); } }}>
                <input className="input" value={name} onChange={(e) => setName(e.target.value)} autoFocus aria-label="Resume name" data-testid="rename-input" />
                <Button type="submit" variant="primary" icon={Check} aria-label="Save name" />
                <Button icon={X} aria-label="Cancel rename" onClick={() => { setName(r.name); setEditing(false); }} />
              </form>
            ) : (
              <>
                <div className="row wrap" style={{ gap: 6 }}><span style={{ fontWeight: 700 }} className="ellipsis" data-testid="resume-name">{r.name}</span>{r.isDefault && <span className="badge accent"><Star size={10} />default</span>}{showProfiles && <span className="badge" data-testid="resume-profile">{r.profileId ? profileName(app, r.profileId) : 'Shared'}</span>}</div>
                <div className="tiny dim ellipsis">{r.fileName} · {kb(r.size || 0)} · {timeAgo(r.createdAt)}</div>
              </>
            )}
          </div>
        </div>
        {r.parseError && <div className="small row" style={{ color: 'var(--amber)' }}><CircleAlert size={14} />Couldn't read text: {r.parseError}</div>}
        {(r.skills || []).length > 0 && <div className="chips">{prettySkills(r.skills).slice(0, 14).map((s) => <span key={s} className="badge">{s}</span>)}{r.skills.length > 14 && <span className="badge">+{r.skills.length - 14}</span>}</div>}
        <div>
          <span className="label">Use for roles</span>
          <TagInput value={r.roles || []} onChange={(roles) => save({ roles })} placeholder="e.g. Data Analyst, BI" label="Roles for this resume" />
        </div>
        <div>
          <span className="label">Belongs to</span>
          <select className="select" value={r.profileId || ''} onChange={(e) => moveTo(e.target.value)} aria-label="Resume belongs to" data-testid="resume-profile-select">
            <option value="">Shared with every profile</option>
            {app.profiles.map((p) => <option key={p.id} value={p.id}>{p.label}{p.isDefault ? ' (default)' : ''}</option>)}
            {r.profileId && !app.profiles.some((p) => p.id === r.profileId) && <option value={r.profileId}>Removed profile</option>}
          </select>
        </div>
        <div className="row wrap" style={{ gap: 6 }}>
          {!r.isDefault && <Button size="sm" icon={Star} onClick={makeDefault}>Make default</Button>}
          <Button size="sm" icon={Pencil} onClick={() => setEditing(true)} data-testid="rename">Rename</Button>
          <Button size="sm" icon={Eye} onClick={() => onView(r)}>Text</Button>
          {r.blobId && <Button size="sm" icon={Download} onClick={download}>File</Button>}
          <Button size="sm" variant="danger" icon={Trash2} onClick={del} aria-label={`Delete ${r.name}`} data-testid="delete-resume">Delete</Button>
        </div>
      </div>
    </motion.div>
  );
}

export default function Resumes() {
  const app = useApp();
  const input = useRef(null);
  const [busy, setBusy] = useState('');
  const [over, setOver] = useState(false);
  const [view, setView] = useState(null);
  const [forProfile, setForProfile] = useState(''); // profile for new uploads; '' = shared

  const upload = async (files) => {
    for (const file of [...files]) {
      const ext = extOf(file.name);
      if (!['.pdf', '.docx', '.txt', '.md'].includes(ext)) { app.toast(`"${file.name}" isn't a supported resume. Use PDF, DOCX or TXT.`, 'error'); continue; }
      if (file.size > MAX_BYTES) { app.toast(`"${file.name}" is larger than 5 MB.`, 'error'); continue; }
      try {
        setBusy(`Reading ${file.name}…`);
        const bytes = new Uint8Array(await file.arrayBuffer());
        const hash = await sha256Hex(bytes);
        const dup = app.resumes.find((r) => r.hash === hash);
        if (dup) { app.toast(`"${file.name}" is already uploaded as "${dup.name}".`, 'error'); continue; }
        const { text, skills, parseError } = await extractResume(file.name, bytes);
        setBusy('Encrypting & uploading…');
        const blobId = newId();
        await app.sync.putBlob(blobId, bytes);
        const id = newId();
        const rec = {
          id, name: file.name.replace(/\.[^.]+$/, ''), fileName: file.name, ext, size: bytes.length, hash,
          text, skills, roles: [], isDefault: !app.resumes.some((x) => resumeGroup(x) === (forProfile || 'shared')), profileId: forProfile || null, blobId, parseError, createdAt: new Date().toISOString(),
        };
        try { await app.put('resumes', id, rec); } catch (e) { await app.sync.deleteBlob(blobId).catch(() => {}); throw e; }
        app.toast(parseError ? `Uploaded "${rec.name}", but its text couldn't be read.` : `Uploaded "${rec.name}" · ${skills.length} skills found`, parseError ? 'error' : 'success');
        // Empty profile fields are filled from what the resume states (nothing already typed is overwritten).
        if (!parseError) {
          try { const added = await fillProfileFromResume(app, forProfile || 'main', rec); if (added.length) app.toast(`Filled ${added.length} empty profile field${added.length > 1 ? 's' : ''} from the resume: ${added.slice(0, 5).join(', ')}${added.length > 5 ? '…' : ''}`, 'success'); } catch { /* the profile can be filled later from the Profile page */ }
        }
      } catch (e) { app.toast(e.message, 'error'); } finally { setBusy(''); }
    }
    if (input.current) input.current.value = '';
  };

  return (
    <div className="col" style={{ gap: 14 }}>
      {app.profiles.length > 1 && (
        <div className="col" style={{ gap: 6 }}>
          <span className="label">New uploads belong to</span>
          <select className="select" value={forProfile} onChange={(e) => setForProfile(e.target.value)} aria-label="Profile for new resumes" data-testid="upload-profile">
            <option value="">Shared with every profile</option>
            {app.profiles.map((p) => <option key={p.id} value={p.id}>{p.label}{p.isDefault ? ' (default)' : ''}</option>)}
          </select>
        </div>
      )}
      <div className={`dropzone card pad ${over ? 'over' : ''}`} style={{ borderStyle: 'dashed', textAlign: 'center', cursor: 'pointer', padding: 24 }}
        onClick={() => !busy && input.current.click()} onDragOver={(e) => { e.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)}
        onDrop={(e) => { e.preventDefault(); setOver(false); upload(e.dataTransfer.files); }} role="button" tabIndex={0} onKeyDown={(e) => e.key === 'Enter' && input.current.click()}>
        {busy ? <Loader2 size={28} className="spin" color="var(--accent-2)" /> : <Upload size={28} color="var(--accent-2)" />}
        <div style={{ fontWeight: 700, marginTop: 8 }}>{busy || 'Upload a resume'}</div>
        <div className="small muted">PDF, DOCX or TXT · read on this device, encrypted before upload</div>
        <input ref={input} type="file" accept={ACCEPT} multiple hidden onChange={(e) => upload(e.target.files)} data-testid="resume-file" />
      </div>
      <AnimatePresence>
        {app.resumes.map((r) => <ResumeCard key={r.id} r={r} onView={setView} />)}
      </AnimatePresence>
      {!app.resumes.length && !busy && <Empty icon={FileText} title="No resumes yet">Your resume powers match scores, quick-fill and AI cover letters. Upload several and tag them by role.</Empty>}
      <Sheet open={!!view} onClose={() => setView(null)} tall title={view ? view.name : ''}>
        {view && <div className="prewrap small" style={{ lineHeight: 1.7 }} data-testid="resume-text">{view.text || 'No text could be extracted from this file.'}</div>}
      </Sheet>
    </div>
  );
}
