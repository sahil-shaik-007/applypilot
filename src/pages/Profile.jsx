import React, { useEffect, useMemo, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Plus, Trash2, Check, Loader2, User, MapPin, Link, ShieldCheck, Target, Briefcase, Building2, GraduationCap, Award, FolderGit2, Users, HeartHandshake, FileText, Circle } from 'lucide-react';
import { useApp } from '../lib/store';
import { Button, Field, TagInput, MultiChips, Seg, Switch, ScoreRing } from '../components/ui';

const ICON = { user: User, 'map-pin': MapPin, link: Link, 'shield-check': ShieldCheck, target: Target, briefcase: Briefcase, building: Building2, 'graduation-cap': GraduationCap, award: Award, 'folder-git': FolderGit2, users: Users, 'heart-handshake': HeartHandshake, 'file-text': FileText };

export function withDefaults(schema, values = {}) {
  const out = { ...values };
  for (const s of schema.sections) {
    if (s.repeat) { if (!Array.isArray(out[s.id])) out[s.id] = []; continue; }
    for (const f of s.fields) if (out[f.key] === undefined && f.default !== undefined) out[f.key] = f.default;
  }
  return out;
}

const filled = (v) => v !== undefined && v !== null && v !== '' && !(Array.isArray(v) && !v.length);

export function sectionCompletion(section, values) {
  if (section.repeat) return (values[section.id] || []).length ? 1 : 0;
  const fs = section.fields.filter((f) => f.type !== 'checkbox');
  return fs.length ? fs.filter((f) => filled(values[f.key])).length / fs.length : 1;
}

export function profileCompletion(schema, values) {
  const required = schema.sections.flatMap((s) => (s.repeat ? [] : s.fields.filter((f) => f.required)));
  const req = required.filter((f) => filled(values[f.key])).length / Math.max(1, required.length);
  const all = schema.sections.reduce((a, s) => a + sectionCompletion(s, values), 0) / schema.sections.length;
  return Math.round(100 * (0.6 * req + 0.4 * all));
}

export function FieldInput({ f, value, onChange }) {
  switch (f.type) {
    case 'textarea': return <textarea className="textarea" rows={f.rows || 3} value={value || ''} placeholder={f.placeholder} onChange={(e) => onChange(e.target.value)} />;
    case 'select': return (
      <select className="select" value={value || ''} onChange={(e) => onChange(e.target.value)}>
        <option value="">Select…</option>
        {f.options.map((o) => <option key={o} value={o}>{o}</option>)}
      </select>
    );
    case 'multiselect': return <MultiChips value={value || []} options={f.options} onChange={onChange} />;
    case 'tags': return <TagInput value={value || []} onChange={onChange} placeholder={f.placeholder} />;
    case 'yesno': return <Seg value={value || ''} onChange={(v) => onChange(v === value ? '' : v)} options={['Yes', 'No']} />; // click again to clear
    case 'checkbox': return <div style={{ paddingTop: 6 }}><Switch on={!!value} onChange={onChange} /></div>;
    case 'number': return <input className="input" type="number" value={value ?? ''} placeholder={f.placeholder} onChange={(e) => onChange(e.target.value === '' ? '' : Number(e.target.value))} />;
    default: return <input className="input" type={f.type === 'month' ? 'month' : f.type === 'date' ? 'date' : f.type === 'email' ? 'email' : 'text'} value={value || ''} placeholder={f.placeholder} onChange={(e) => onChange(e.target.value)} />;
  }
}

const wide = (f) => ['textarea', 'tags', 'multiselect'].includes(f.type);

function SectionForm({ section, values, set }) {
  if (section.repeat) {
    const items = values[section.id] || [];
    const update = (i, k, v) => set(section.id, items.map((it, j) => (j === i ? { ...it, [k]: v } : it)));
    return (
      <div className="col" style={{ gap: 14 }}>
        <AnimatePresence>
          {items.map((it, i) => (
            <motion.div key={i} className="card pad" layout initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, scale: 0.97 }}>
              <div className="row between" style={{ marginBottom: 12 }}>
                <span className="label" style={{ margin: 0 }}>{section.itemLabel} {i + 1}</span>
                <Button size="sm" variant="ghost" icon={Trash2} onClick={() => set(section.id, items.filter((_, j) => j !== i))} />
              </div>
              <div className="grid g2">
                {section.fields.map((f) => (
                  <Field key={f.key} label={f.label} className={wide(f) ? 'span2' : ''}>
                    <FieldInput f={f} value={it[f.key]} onChange={(v) => update(i, f.key, v)} />
                  </Field>
                ))}
              </div>
            </motion.div>
          ))}
        </AnimatePresence>
        <Button icon={Plus} onClick={() => set(section.id, [...items, {}])}>Add {section.itemLabel.toLowerCase()}</Button>
      </div>
    );
  }
  return (
    <div className="grid g2" style={{ gap: 18 }}>
      {section.fields.map((f) => (
        <Field key={f.key} label={f.label} required={f.required} help={f.help} className={wide(f) ? 'span2' : ''}>
          <FieldInput f={f} value={values[f.key]} onChange={(v) => set(f.key, v)} />
        </Field>
      ))}
    </div>
  );
}

// Switcher for the people ApplyPilot applies for: the main profile (the default) plus extra ones, each with
// its own values, resumes, campaigns and answers. Add, rename and delete live here.
function ProfileSwitcher({ list, selected, onSelect, onAdd, onRename, onDelete, busy }) {
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const cur = list.find((p) => p.id === selected) || list[0];
  const create = async () => { const n = name.trim(); if (!n) return; await onAdd(n); setName(''); setAdding(false); };
  return (
    <div className="card pad" style={{ marginBottom: 18 }}>
      <div className="row wrap" style={{ gap: 8, alignItems: 'center' }}>
        <span className="label" style={{ margin: 0 }}>Profile</span>
        {list.map((p) => (
          <span key={p.id} className={`chip ${p.id === selected ? 'on' : ''}`} onClick={() => onSelect(p.id)} title={p.isDefault ? 'The default profile: used by campaigns and jobs unless you pick another' : p.label}>
            <User size={12} />{p.label}{p.isDefault && <span className="badge" style={{ marginLeft: 4 }}>Default</span>}
          </span>
        ))}
        {adding ? (
          <form className="row" style={{ gap: 6 }} onSubmit={(e) => { e.preventDefault(); create(); }}>
            <input className="input" autoFocus style={{ width: 200, height: 32 }} value={name} maxLength={60} onChange={(e) => setName(e.target.value)} placeholder="Name, e.g. Priya" />
            <Button size="sm" variant="primary" type="submit" disabled={!name.trim()} loading={busy}>Create</Button>
            <Button size="sm" variant="ghost" type="button" onClick={() => { setAdding(false); setName(''); }}>Cancel</Button>
          </form>
        ) : <Button size="sm" icon={Plus} onClick={() => setAdding(true)}>Add profile</Button>}
      </div>
      {cur && !cur.isDefault && (
        <div className="row between" style={{ marginTop: 12, gap: 12 }}>
          <div className="row" style={{ gap: 8 }}>
            <span className="small muted">Name</span>
            <input key={cur.id + cur.label} className="input" style={{ width: 240, height: 32 }} defaultValue={cur.label} maxLength={60} onBlur={(e) => { const v = e.target.value.trim(); if (v && v !== cur.label) onRename(cur.id, v); }} />
          </div>
          <div className="row" style={{ gap: 10 }}>
            {cur.counts && <span className="tiny dim">{cur.counts.resumes} resume(s) · {cur.counts.campaigns} campaign(s) · {cur.counts.applications} application(s) · {cur.counts.answers} answer(s)</span>}
            <Button size="sm" variant="ghost" icon={Trash2} onClick={() => onDelete(cur)}>Delete profile</Button>
          </div>
        </div>
      )}
      {list.length > 1 && <div className="tiny dim" style={{ marginTop: 10 }}>You are editing {cur ? cur.label : ''}. Applications for this profile use only these details, its resumes and its answers.</div>}
    </div>
  );
}

export default function Profile() {
  const app = useApp();
  const schema = app.profileSchema;
  const [list, setList] = useState(() => (app.profiles || [{ id: 'main', label: 'Main profile', isDefault: true }]).map((p) => ({ ...p, values: p.id === 'main' ? app.profile.values : undefined })));
  const [selected, setSelected] = useState('main');
  const selRef = useRef('main');
  const [values, setValues] = useState(() => withDefaults(schema, app.profile.values));
  const [active, setActive] = useState(schema.sections[0].id);
  const [saveState, setSaveState] = useState('saved');
  const [busy, setBusy] = useState(false);
  const timer = useRef(null);
  const latest = useRef(values);
  const dirty = useRef(false);

  const shareList = (profiles) => app.set({ profiles: profiles.map(({ id, label, isDefault }) => ({ id, label, isDefault })), profileLabels: Object.fromEntries(profiles.map((p) => [p.id, p.label])) });

  const persist = async () => {
    const id = selRef.current;
    clearTimeout(timer.current); timer.current = null;
    dirty.current = false;
    setSaveState('saving');
    try {
      if (id === 'main') {
        const saved = await app.run('profile:save', [latest.current]);
        app.set({ profile: saved });
      } else {
        const r = await app.run('profiles:save', [{ id, values: latest.current }]);
        setList(r.profiles);
        shareList(r.profiles);
      }
      setSaveState('saved');
    } catch { setSaveState('error'); }
  };
  const set = (k, v) => {
    setValues((cur) => { const next = { ...cur, [k]: v }; latest.current = next; return next; });
    setSaveState('dirty');
    dirty.current = true;
    clearTimeout(timer.current);
    timer.current = setTimeout(persist, 700);
  };
  useEffect(() => () => { if (dirty.current) persist(); }, []); // eslint-disable-line

  // Load the full list (with values) once; the bootstrap only carries labels.
  useEffect(() => { app.run('profiles:list').then((l) => { setList(l); shareList(l); }).catch(() => {}); }, []); // eslint-disable-line

  const select = async (id) => {
    if (id === selRef.current) return;
    if (dirty.current) await persist(); // never lose edits when switching
    const rec = list.find((p) => p.id === id);
    selRef.current = id;
    setSelected(id);
    const next = withDefaults(schema, id === 'main' ? app.profile.values : (rec && rec.values) || {});
    latest.current = next;
    setValues(next);
    setActive(schema.sections[0].id);
    setSaveState('saved');
  };
  const addProfile = async (label) => {
    setBusy(true);
    try {
      if (dirty.current) await persist();
      const r = await app.run('profiles:save', [{ label }], `Profile "${label}" created`);
      setList(r.profiles); shareList(r.profiles);
      selRef.current = r.saved.id; setSelected(r.saved.id);
      const next = withDefaults(schema, r.saved.values || {});
      latest.current = next; setValues(next); setActive(schema.sections[0].id); setSaveState('saved');
    } catch { /* the toast explains */ } finally { setBusy(false); }
  };
  const renameProfile = async (id, label) => {
    try { const r = await app.run('profiles:save', [{ id, label }], 'Profile renamed'); setList(r.profiles); shareList(r.profiles); } catch { /* toast */ }
  };
  const deleteProfile = async (p) => {
    const ok = await app.confirm({
      title: `Delete the profile "${p.label}"?`,
      message: 'Its details are removed from this PC. Its resumes and applications are kept, its campaigns switch to your main profile, and its answers stay in the Answer bank (you can share or delete them there).',
      confirmLabel: 'Delete profile',
    });
    if (!ok) return;
    try {
      clearTimeout(timer.current); dirty.current = false;
      const r = await app.run('profiles:delete', [p.id], 'Profile deleted');
      setList(r.profiles); shareList(r.profiles);
      app.set({ campaigns: r.campaigns, applications: r.applications });
      app.reload();
      selRef.current = 'main'; setSelected('main');
      const next = withDefaults(schema, app.profile.values); latest.current = next; setValues(next); setSaveState('saved');
    } catch { /* toast */ }
  };

  const section = schema.sections.find((s) => s.id === active);
  const pct = useMemo(() => profileCompletion(schema, values), [schema, values]);

  return (
    <div className="page">
      <div className="page-head">
        <div><h1>{selected === 'main' ? 'Your profile' : (list.find((p) => p.id === selected) || {}).label || 'Profile'}</h1><p>Fill this once — ApplyPilot uses it to answer every application form and screening question. Stored only on this PC.</p></div>
        <div className="row" style={{ gap: 14 }}>
          <span className="small muted row" style={{ gap: 6 }}>{saveState === 'saving' || saveState === 'dirty' ? <><Loader2 size={13} className="spin" />Saving…</> : saveState === 'error' ? 'Save failed' : <><Check size={13} color="var(--green)" />Saved</>}</span>
          <ScoreRing score={pct} size={54} stroke={5} />
        </div>
      </div>
      <ProfileSwitcher list={list} selected={selected} onSelect={select} onAdd={addProfile} onRename={renameProfile} onDelete={deleteProfile} busy={busy} />
      <div className="split">
        <div className="sticky side-list">
          {schema.sections.map((s) => {
            const Icon = ICON[s.icon] || Circle;
            const c = sectionCompletion(s, values);
            return (
              <button key={s.id} className={active === s.id ? 'on' : ''} onClick={() => { setActive(s.id); document.getElementById('main-scroll')?.scrollTo({ top: 0, behavior: 'smooth' }); }}>
                <Icon size={15} /><span className="grow">{s.title}</span>
                {c >= 0.99 ? <Check size={14} color="var(--green)" /> : c > 0 ? <span className="tiny dim">{Math.round(c * 100)}%</span> : null}
              </button>
            );
          })}
        </div>
        <AnimatePresence mode="wait">
          <motion.div key={active} initial={{ opacity: 0, x: 12 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -12 }} transition={{ duration: 0.18 }} className="card pad" style={{ padding: 26 }}>
            <h2 style={{ margin: '0 0 4px', fontSize: 20 }}>{section.title}</h2>
            {section.description && <p className="small muted" style={{ marginTop: 0 }}>{section.description}</p>}
            <div style={{ height: 14 }} />
            <SectionForm section={section} values={values} set={set} />
            <div className="row between" style={{ marginTop: 26 }}>
              {(() => {
                const i = schema.sections.findIndex((s) => s.id === active);
                return <>
                  <Button variant="ghost" disabled={i === 0} onClick={() => setActive(schema.sections[i - 1].id)}>← {i > 0 ? schema.sections[i - 1].title : ''}</Button>
                  {i < schema.sections.length - 1 && <Button variant="primary" onClick={() => setActive(schema.sections[i + 1].id)}>{schema.sections[i + 1].title} →</Button>}
                </>;
              })()}
            </div>
          </motion.div>
        </AnimatePresence>
      </div>
    </div>
  );
}
