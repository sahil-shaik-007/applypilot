import React, { useEffect, useMemo, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Plus, Trash2, Check, Loader2, User, MapPin, Link, ShieldCheck, Target, Briefcase, Building2, GraduationCap, Award, FolderGit2, Users, HeartHandshake, FileText, Circle, ChevronDown, CircleAlert, Wand2 } from 'lucide-react';
import { displaySkill } from '@shared/match.js';
import { useApp } from '../lib/store.jsx';
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
                  <Field key={f.key} label={f.label} className={wide(f) ? 'span-all' : ''}>
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
        <Field key={f.key} label={f.label} required={f.required} help={f.help} className={wide(f) ? 'span-all' : ''}>
          <FieldInput f={f} value={values[f.key]} onChange={(v) => set(f.key, v)} />
        </Field>
      ))}
    </div>
  );
}

export default function Profile() {
  const app = useApp();
  const [values, setValues] = useState(() => withDefaults(app.profile));
  const [open, setOpen] = useState('personal');
  const [saveState, setSaveState] = useState('saved');
  const timer = useRef(null);
  const latest = useRef(values);
  const stateRef = useRef(saveState);
  stateRef.current = saveState;

  const persist = async () => {
    timer.current = null;
    setSaveState('saving');
    try { await app.saveProfile(latest.current); setSaveState((s) => (s === 'saving' ? 'saved' : s)); } catch (e) { setSaveState('error'); app.toast(`Profile not saved: ${e.message}`, 'error'); }
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
    const remote = withDefaults(app.profile);
    if (JSON.stringify(remote) !== JSON.stringify(latest.current)) { latest.current = remote; setValues(remote); }
  }, [app.profile]);

  const pct = useMemo(() => profileCompletion(values), [values]);
  const resume = app.resumes.find((r) => r.isDefault) || app.resumes[0];
  const importSkills = () => {
    const have = new Set((values.skills || []).map((s) => s.toLowerCase()));
    const add = (resume.skills || []).map(displaySkill).filter((s) => !have.has(s.toLowerCase()));
    if (!add.length) { app.toast('No new skills found in your resume', 'info'); return; }
    set('skills', [...(values.skills || []), ...add]);
    app.toast(`Added ${add.length} skills from "${resume.name}"`, 'success');
  };

  return (
    <div className="col" style={{ gap: 14 }}>
      <div className="card pad row" style={{ gap: 14 }}>
        <ScoreRing score={pct} size={56} stroke={5} />
        <div className="grow">
          <div style={{ fontWeight: 700 }}>Fill this once</div>
          <div className="small muted">Used for quick-fill on your phone and by the desktop app. Encrypted on this device.</div>
        </div>
      </div>
      <div className="row between small" style={{ minHeight: 24 }} data-testid="save-state" data-state={saveState}>
        <span className="muted row" style={{ gap: 6 }}>
          {saveState === 'saving' || saveState === 'dirty' ? <><Loader2 size={13} className="spin" />Saving…</> : saveState === 'error' ? <><CircleAlert size={13} color="var(--red)" />Not saved</> : <><Check size={13} color="var(--green)" />Saved & encrypted</>}
        </span>
        {resume && (resume.skills || []).length > 0 && <Button size="sm" variant="ghost" icon={Wand2} onClick={importSkills}>Skills from resume</Button>}
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
