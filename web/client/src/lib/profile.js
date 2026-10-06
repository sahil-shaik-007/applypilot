// Profile schema helpers (schema shared with the desktop app: electron/data/profile-schema.json).
import schema from '@schema';

export const profileSchema = schema;

export function withDefaults(values = {}) {
  const out = { ...values };
  for (const s of schema.sections) {
    if (s.repeat) { if (!Array.isArray(out[s.id])) out[s.id] = []; continue; }
    for (const f of s.fields) if (out[f.key] === undefined && f.default !== undefined) out[f.key] = f.default;
  }
  return out;
}

export const filled = (v) => v !== undefined && v !== null && v !== '' && !(Array.isArray(v) && !v.length);

export function sectionCompletion(section, values) {
  if (section.repeat) return (values[section.id] || []).length ? 1 : 0;
  const fs = section.fields.filter((f) => f.type !== 'checkbox');
  return fs.length ? fs.filter((f) => filled(values[f.key])).length / fs.length : 1;
}

export function profileCompletion(values = {}) {
  const required = schema.sections.flatMap((s) => (s.repeat ? [] : s.fields.filter((f) => f.required)));
  const req = required.filter((f) => filled(values[f.key])).length / Math.max(1, required.length);
  const all = schema.sections.reduce((a, s) => a + sectionCompletion(s, values), 0) / schema.sections.length;
  return Math.round(100 * (0.6 * req + 0.4 * all));
}
