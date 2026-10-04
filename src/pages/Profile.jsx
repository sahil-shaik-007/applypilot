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
    case 'yesno': return <Seg value={value || ''} onChange={onChange} options={['Yes', 'No']} />;
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

export default function Profile() {
  const app = useApp();
  const schema = app.profileSchema;
  const [values, setValues] = useState(() => withDefaults(schema, app.profile.values));
  const [active, setActive] = useState(schema.sections[0].id);
  const [saveState, setSaveState] = useState('saved');
  const timer = useRef(null);
  const latest = useRef(values);

  const persist = async () => {
    setSaveState('saving');
    try { const saved = await app.run('profile:save', [latest.current]); app.set({ profile: saved }); setSaveState('saved'); } catch { setSaveState('error'); }
  };
  const set = (k, v) => {
    setValues((cur) => { const next = { ...cur, [k]: v }; latest.current = next; return next; });
    setSaveState('dirty');
    clearTimeout(timer.current);
    timer.current = setTimeout(persist, 700);
  };
  useEffect(() => () => { if (timer.current) { clearTimeout(timer.current); persist(); } }, []); // eslint-disable-line

  const section = schema.sections.find((s) => s.id === active);
  const pct = useMemo(() => profileCompletion(schema, values), [schema, values]);

  return (
    <div className="page">
      <div className="page-head">
        <div><h1>Your profile</h1><p>Fill this once — ApplyPilot uses it to answer every application form and screening question. Stored only on this PC.</p></div>
        <div className="row" style={{ gap: 14 }}>
          <span className="small muted row" style={{ gap: 6 }}>{saveState === 'saving' || saveState === 'dirty' ? <><Loader2 size={13} className="spin" />Saving…</> : saveState === 'error' ? 'Save failed' : <><Check size={13} color="var(--green)" />Saved</>}</span>
          <ScoreRing score={pct} size={54} stroke={5} />
        </div>
      </div>
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
