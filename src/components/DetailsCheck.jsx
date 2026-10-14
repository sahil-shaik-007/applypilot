import React, { useCallback, useState } from 'react';
import { Check } from 'lucide-react';
import { useApp } from '../lib/store';
import { Button, Field, Modal } from './ui';

// The identity details nearly every application form asks for. Same list as the phone/web "Check before applying".
const REQUIRED = [
  { key: 'firstName', label: 'First name' },
  { key: 'lastName', label: 'Last name' },
  { key: 'email', label: 'Email', type: 'email' },
  { key: 'phone', label: 'Phone number', type: 'tel' },
  { key: 'city', label: 'City' },
  { key: 'country', label: 'Country' },
];
const has = (v) => String(v == null ? '' : v).trim().length > 0;

/**
 * Before an application starts, make sure the profile it will use has the details forms ask for.
 *   const { ensure, dialog } = useDetailsCheck();
 *   if (!(await ensure(profileId))) return;   // user cancelled
 *   ...render {dialog} once in the page
 * Missing details are asked for in a dialog and saved to that profile, so the engine fills them instead of leaving
 * the form blank (or showing whatever the browser remembered).
 */
export function useDetailsCheck() {
  const app = useApp();
  const [state, setState] = useState(null); // { entry, missing, draft, resolve }

  const ensure = useCallback(async (profileId = 'main') => {
    let list;
    try { list = await app.run('profiles:list'); } catch { return true; } // never block applying on a lookup error
    const entry = (list || []).find((p) => p.id === (profileId || 'main')) || (list || []).find((p) => p.isDefault);
    if (!entry) return true;
    const missing = REQUIRED.filter((f) => !has((entry.values || {})[f.key]));
    if (!missing.length) return true;
    return new Promise((resolve) => setState({ entry, missing, draft: {}, resolve }));
  }, [app]);

  const close = (ok) => { if (state) state.resolve(ok); setState(null); };
  const save = async () => {
    const values = { ...(state.entry.values || {}), ...state.draft };
    await app.run('profiles:save', [{ id: state.entry.id, values }], 'Details saved to the profile');
    close(true);
  };

  let dialog = null;
  if (state) {
    const stillMissing = state.missing.filter((f) => !has(state.draft[f.key]));
    dialog = (
      <Modal open onClose={() => close(false)} title={`Complete ${state.entry.label || 'your'} details`}
        footer={<><Button onClick={() => close(false)}>Cancel</Button><Button variant="primary" icon={Check} disabled={stillMissing.length > 0} onClick={save}>Save and continue</Button></>}>
        <div className="col" style={{ gap: 14 }}>
          <p className="muted" style={{ margin: 0 }}>Application forms ask for these. They are saved to this profile and used on every application, so you only enter them once.</p>
          {state.missing.map((f) => (
            <Field key={f.key} label={f.label} required>
              <input className="input" type={f.type || 'text'} value={state.draft[f.key] || ''} aria-label={f.label}
                onChange={(e) => setState((s) => ({ ...s, draft: { ...s.draft, [f.key]: e.target.value } }))} />
            </Field>
          ))}
        </div>
      </Modal>
    );
  }
  return { ensure, dialog };
}
