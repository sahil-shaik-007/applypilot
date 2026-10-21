import React, { useEffect, useMemo, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Plus, Trash2, Check, Loader2, User, MapPin, Link, ShieldCheck, Target, Briefcase, Building2, GraduationCap, Award, FolderGit2, Users, HeartHandshake, FileText, Circle, ChevronDown, CircleAlert, Wand2, Pencil, X } from 'lucide-react';
import { resumeFill } from '../lib/resumeProfile.js';
import { useApp } from '../lib/store.jsx';
import { createProfile, renameProfile, deleteProfile, DEFAULT_PROFILE_ID } from '../lib/profiles.js';
import { Button, Field, TagInput, MultiChips, Seg, Switch, ScoreRing } from '../components/ui.jsx';
import { profileSchema as schema, withDefaults, sectionCompletion, profileCompletion } from '../lib/profile.js';

const ICON = { user: User, 'map-pin': MapPin, link: Link, 'shield-check': ShieldCheck, target: Target, briefcase: Briefcase, building: Building2, 'graduation-cap': GraduationCap, award: Award, 'folder-git': FolderGit2, users: Users, 'heart-handshake': HeartHandshake, 'file-text': FileText };
const INPUT_MODE = { email: 'email', tel: 'tel', url: 'url', number: 'decimal' };
const AUTOCOMPLETE = { firstName: 'given-name', middleName: 'additional-name', lastName: 'family-name', email: 'email', phone: 'tel-national', phoneCountryCode: 'tel-country-code', addressLine1: 'address-line1', addressLine2: 'address-line2', city: 'address-level2', state: 'address-level1', postalCode: 'postal-code', country: 'country-name', dateOfBirth: 'bday' };

export function FieldInput({ f, value, onChange }) {
  switch (f.type) {
    case 'textarea': return <textarea className="textarea" rows={f.rows || 4} value={value || ''} placeholder={f.placeholder} onChange={(e) => onChange(e.target.value)} />;
    case 'select': return (
      <select className="select" value={value || ''} onChange={(e) => onChange(e.target.value)}>
        <option value="">Select…</option>
        {f.options.map((o) => <option key={o} value={o}>{o}</option>)}
      </select>
    );
    case 'multiselect': return <MultiChips value={value || []} options={f.options} onChange={onChange} />;
    case 'tags': return <TagInput value={value || []} onChange={onChange} placeholder={f.placeholder} label={f.label} />;
    case 'yesno': return <Seg value={value || ''} onChange={(v) => onChange(v === value ? '' : v)} options={['Yes', 'No']} />;
    case 'checkbox': return <div style={{ paddingTop: 4 }}><Switch on={!!value} onChange={onChange} label={f.label} /></div>;
    case 'number': return <input className="input" type="number" inputMode="decimal" value={value ?? ''} placeholder={f.placeholder} onChange={(e) => onChange(e.target.value === '' ? '' : Number(e.target.value))} />;
    default: return (
      <input className="input" type={f.type === 'month' ? 'month' : f.type === 'date' ? 'date' : f.type === 'email' ? 'email' : f.type === 'url' ? 'url' : f.type === 'tel' ? 'tel' : 'text'}
        inputMode={INPUT_MODE[f.type]} autoComplete={AUTOCOMPLETE[f.key] || 'off'} autoCapitalize={['email', 'url'].includes(f.type) ? 'off' : undefined}
        value={value || ''} placeholder={f.placeholder} onChange={(e) => onChange(e.target.value)} data-field={f.key} />
    );
  }
}

const wide = (f) => ['textarea', 'tags', 'multiselect'].includes(f.type);

function SectionForm({ section, values, set, app }) {
  if (section.repeat) {
    const items = values[section.id] || [];
    const update = (i, k, v) => set(section.id, items.map((it, j) => (j === i ? { ...it, [k]: v } : it)));
    return (
      <div className="col" style={{ gap: 12 }}>
        <AnimatePresence initial={false}>
          {items.map((it, i) => (
            <motion.div key={i} className="card pad" layout initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, scale: 0.97 }}>
              <div className="row between" style={{ marginBottom: 10 }}>
                <span className="label" style={{ margin: 0 }}>{section.itemLabel} {i + 1}</span>
                <Button size="sm" variant="ghost" icon={Trash2} aria-label={`Remove ${section.itemLabel} ${i + 1}`} onClick={async () => {
                  const label = it.company || it.school || it.name || `${section.itemLabel} ${i + 1}`;
                  if (await app.confirm({ title: `Remove ${section.itemLabel.toLowerCase()}?`, message: `"${label}" will be removed from your profile.`, confirmLabel: 'Remove' })) set(section.id, items.filter((_, j) => j !== i));
                }} />
              </div>
              <div className="grid g2-md" style={{ gap: 14 }}>
                {section.fields.map((f) => (
                  <Field key={f.key} label={f.label} className={wide(f) ? 'span-all' : ''} group={['yesno', 'multiselect'].includes(f.type)}>
                    <FieldInput f={f} value={it[f.key]} onChange={(v) => update(i, f.key, v)} />
                  </Field>
                ))}
              </div>
            </motion.div>
          ))}
        </AnimatePresence>
        <Button icon={Plus} block onClick={() => set(section.id, [...items, {}])}>Add {section.itemLabel.toLowerCase()}</Button>
      </div>
    );
  }
  return (
    <div className="grid g2-md" style={{ gap: 16 }}>
      {section.fields.map((f) => (
        <Field key={f.key} label={f.label} required={f.required} help={f.help} className={wide(f) ? 'span-all' : ''} group={['yesno', 'multiselect'].includes(f.type)}>
          <FieldInput f={f} value={values[f.key]} onChange={(v) => set(f.key, v)} />
        </Field>
      ))}
    </div>
  );
}

/** Profile page: the list of profiles (the default one plus any others) and the form of the selected one. */
export default function Profile() {
  const app = useApp();
  const [selId, setSelId] = useState(DEFAULT_PROFILE_ID);
  const [adding, setAdding] = useState(false);
  const [label, setLabel] = useState('');
  const [busy, setBusy] = useState(false);
  const profiles = app.profiles;
  const sel = profiles.find((p) => p.id === selId) || profiles[0];
  const add = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      const id = await createProfile(app, label);
      setSelId(id); setLabel(''); setAdding(false);
      app.toast('Profile added. Fill in its details below.', 'success');
    } catch (err) { app.toast(err.message, 'error'); } finally { setBusy(false); }
  };
  return (
    <div className="col" style={{ gap: 14 }}>
      <div className="col" style={{ gap: 8 }} data-testid="profile-switcher">
        <div className="row between small" style={{ minHeight: 24 }}>
          <span className="muted">Profiles</span>
          <span className="tiny dim">Each one has its own details and resumes</span>
        </div>
        <div className="card list">
          {profiles.map((p) => {
            const own = app.resumes.filter((r) => r.profileId === p.id).length;
            return (
              <button key={p.id} type="button" className="list-row" onClick={() => setSelId(p.id)} aria-current={p.id === sel.id ? 'true' : undefined} data-profile={p.id}>
                <span className="ico"><User size={16} /></span>
                <span className="grow"><span style={{ display: 'block', fontWeight: 600 }}>{p.label}</span><span className="tiny dim">{p.isDefault ? 'Default profile' : `${own} resume${own === 1 ? '' : 's'} of its own`}</span></span>
                {p.isDefault && <span className="badge accent">Default</span>}
                {p.id === sel.id && <Check size={15} color="var(--green)" />}
              </button>
            );
          })}
        </div>
        {adding ? (
          <form className="card pad row" style={{ gap: 6 }} onSubmit={add} data-testid="profile-add">
            <input className="input" value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Name, e.g. Brother" aria-label="New profile name" autoFocus data-testid="profile-name" />
            <Button type="submit" variant="primary" icon={Check} loading={busy} disabled={!label.trim()} aria-label="Add profile" />
            <Button icon={X} aria-label="Cancel" onClick={() => { setAdding(false); setLabel(''); }} />
          </form>
        ) : (
          <Button icon={Plus} block onClick={() => setAdding(true)} data-testid="profile-new">New profile</Button>
        )}
      </div>
      <ProfileEditor key={sel.id} profile={sel} onDeleted={() => setSelId(DEFAULT_PROFILE_ID)} />
    </div>
  );
}

/** The details form of one profile (autosaves). `profile` = { id, label, values, isDefault }. */
function ProfileEditor({ profile, onDeleted }) {
  const app = useApp();
  const [values, setValues] = useState(() => withDefaults(profile.values));
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState(profile.label);
  const [renameBusy, setRenameBusy] = useState(false);
  const rename = async (e) => {
    e.preventDefault();
    setRenameBusy(true);
    try { await renameProfile(app, profile.id, name); setRenaming(false); app.toast('Renamed', 'success'); }
    catch (err) { app.toast(err.message, 'error'); } finally { setRenameBusy(false); }
  };
  const del = async () => {
    if (!(await app.confirm({ title: 'Delete profile?', message: `"${profile.label}" and its details are removed from every device. Its resumes and applications stay, and campaigns that used it move to your default profile.`, confirmLabel: 'Delete profile' }))) return;
    try { await deleteProfile(app, profile.id); app.toast('Profile deleted', 'success'); onDeleted(); }
    catch (err) { app.toast(err.message, 'error'); }
  };
  const [open, setOpen] = useState('personal');
  const [saveState, setSaveState] = useState('saved');
  const timer = useRef(null);
  const latest = useRef(values);
  const stateRef = useRef(saveState);
  stateRef.current = saveState;

  const persist = async () => {
    timer.current = null;
    setSaveState('saving');
    try { await app.saveProfileTo(profile.id, latest.current); setSaveState((s) => (s === 'saving' ? 'saved' : s)); } catch (e) { setSaveState('error'); app.toast(`Profile not saved: ${e.message}`, 'error'); }
  };
  const set = (k, v) => {
    setValues((cur) => { const next = { ...cur, [k]: v }; latest.current = next; return next; });
    setSaveState('dirty');
    clearTimeout(timer.current);
    timer.current = setTimeout(persist, 700);
  };
  // Flush pending edits when leaving the page.
  useEffect(() => () => { if (timer.current) { clearTimeout(timer.current); persist(); } }, []); // eslint-disable-line
  // Pick up changes synced from another device while we're idle.
  useEffect(() => {
    if (stateRef.current !== 'saved') return;
    const remote = withDefaults(profile.values);
    if (JSON.stringify(remote) !== JSON.stringify(latest.current)) { latest.current = remote; setValues(remote); }
  }, [profile.values]);

  const pct = useMemo(() => profileCompletion(values), [values]);
  const resume = app.resumes.find((r) => r.isDefault) || app.resumes[0];
  // Fills only the empty fields (name, email, phone, birth date, languages, state, education, skills) from the resume.
  const importFromResume = () => {
    const { patch, labels } = resumeFill(values, resume.text);
    if (!labels.length) { app.toast('Nothing new to add: your profile already has what the resume states.', 'info'); return; }
    for (const [k, v] of Object.entries(patch)) set(k, v);
    app.toast(`Added ${labels.join(', ')} from "${resume.name}"`, 'success');
  };

  return (
    <div className="col" style={{ gap: 14 }}>
      <div className="card pad row" style={{ gap: 14 }} data-testid="profile-header">
        <ScoreRing score={pct} size={56} stroke={5} />
        <div className="grow">
          {renaming ? (
            <form className="row" style={{ gap: 6 }} onSubmit={rename}>
              <input className="input" value={name} onChange={(e) => setName(e.target.value)} autoFocus aria-label="Profile name" data-testid="profile-rename-input" />
              <Button type="submit" variant="primary" icon={Check} loading={renameBusy} disabled={!name.trim()} aria-label="Save name" />
              <Button icon={X} aria-label="Cancel rename" onClick={() => { setName(profile.label); setRenaming(false); }} />
            </form>
          ) : (
            <>
              <div style={{ fontWeight: 700 }} data-testid="profile-label">{profile.label}{profile.isDefault && <span className="badge accent" style={{ marginLeft: 8 }}>Default</span>}</div>
              <div className="small muted">Used for quick-fill on your phone and by the desktop app. Encrypted on this device.</div>
            </>
          )}
        </div>
        {!renaming && <Button size="sm" variant="ghost" icon={Pencil} aria-label="Rename profile" onClick={() => { setName(profile.label); setRenaming(true); }} data-testid="profile-rename" />}
        {!profile.isDefault && !renaming && <Button size="sm" variant="ghost" icon={Trash2} aria-label="Delete profile" onClick={del} data-testid="profile-delete" />}
      </div>
      <div className="row between small" style={{ minHeight: 24 }} data-testid="save-state" data-state={saveState}>
        <span className="muted row" style={{ gap: 6 }}>
          {saveState === 'saving' || saveState === 'dirty' ? <><Loader2 size={13} className="spin" />Saving…</> : saveState === 'error' ? <><CircleAlert size={13} color="var(--red)" />Not saved</> : <><Check size={13} color="var(--green)" />Saved & encrypted</>}
        </span>
        {resume && (resume.text || (resume.skills || []).length > 0) && <Button size="sm" variant="ghost" icon={Wand2} onClick={importFromResume} data-testid="fill-from-resume">Fill from resume</Button>}
      </div>
      <div className="col" style={{ gap: 8 }}>
        {schema.sections.map((s) => {
          const Icon = ICON[s.icon] || Circle;
          const c = sectionCompletion(s, values);
          const isOpen = open === s.id;
          return (
            <div key={s.id} className="card" style={{ overflow: 'hidden' }} data-section={s.id}>
              <button type="button" className="list-row" style={{ borderBottom: isOpen ? '1px solid var(--border)' : 0 }} onClick={() => setOpen(isOpen ? null : s.id)} aria-expanded={isOpen}>
                <span className="ico"><Icon size={16} /></span>
                <span className="grow" style={{ fontWeight: 600 }}>{s.title}</span>
                {c >= 0.99 ? <Check size={15} color="var(--green)" /> : c > 0 ? <span className="tiny dim">{Math.round(c * 100)}%</span> : null}
                <ChevronDown size={16} style={{ transform: isOpen ? 'rotate(180deg)' : 'none', transition: 'transform .2s', flexShrink: 0 }} />
              </button>
              <AnimatePresence initial={false}>
                {isOpen && (
                  <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.2 }} style={{ overflow: 'hidden' }}>
                    <div style={{ padding: 16 }}>
                      {s.description && <p className="small muted" style={{ marginTop: 0 }}>{s.description}</p>}
                      <SectionForm section={s} values={values} set={set} app={app} />
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          );
        })}
      </div>
    </div>
  );
}
