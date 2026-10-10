import React, { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion, useDragControls } from 'framer-motion';
import { X, Loader2, CircleAlert, Check, Info, Copy } from 'lucide-react';
import './features.css';

export const fade = { initial: { opacity: 0, y: 8 }, animate: { opacity: 1, y: 0 }, exit: { opacity: 0, y: -6 }, transition: { duration: 0.22, ease: [0.4, 0, 0.2, 1] } };
export const stagger = (i) => ({ initial: { opacity: 0, y: 12 }, animate: { opacity: 1, y: 0 }, transition: { duration: 0.28, delay: Math.min(i, 12) * 0.035, ease: [0.4, 0, 0.2, 1] } });

export function Button({ variant = 'outline', size, icon: Icon, loading, children, className = '', block, ...rest }) {
  return (
    <button type="button" className={`btn btn-${variant} ${size ? `btn-${size}` : ''} ${!children ? 'btn-icon' : ''} ${block ? 'btn-block' : ''} ${className}`} disabled={loading || rest.disabled} {...rest}>
      {loading ? <Loader2 size={16} className="spin" /> : Icon ? <Icon size={16} /> : null}
      {children != null && children !== false && <span>{children}</span>}
    </button>
  );
}

// Open sheets, topmost last: Escape closes only the top one; body scroll stays locked while any is open.
const sheetStack = [];
const closeHandlers = new Map();
if (typeof window !== 'undefined') {
  window.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape' || !sheetStack.length) return;
    const fn = closeHandlers.get(sheetStack[sheetStack.length - 1]);
    if (fn) { e.stopPropagation(); fn(); }
  });
}

/** Bottom sheet (centered dialog on wide screens). Drag the handle down to dismiss. */
export function Sheet({ open, onClose, title, header, children, footer, tall, label }) {
  const controls = useDragControls();
  const idRef = useRef(Symbol('sheet'));
  useEffect(() => { closeHandlers.set(idRef.current, onClose); }, [onClose]);
  useEffect(() => {
    if (!open) return undefined;
    const id = idRef.current;
    sheetStack.push(id);
    closeHandlers.set(id, onClose);
    document.body.style.overflow = 'hidden';
    return () => {
      const i = sheetStack.indexOf(id);
      if (i >= 0) sheetStack.splice(i, 1);
      closeHandlers.delete(id);
      if (!sheetStack.length) document.body.style.overflow = '';
    };
  }, [open]); // eslint-disable-line
  return (
    <AnimatePresence>
      {open && (
        <div className="sheet-wrap" role="dialog" aria-modal="true" aria-label={label || (typeof title === 'string' ? title : 'Dialog')}>
          <motion.div className="sheet-bg" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose} />
          <motion.div
            className={`sheet ${tall ? 'tall' : ''}`}
            initial={{ y: '100%' }} animate={{ y: 0 }} exit={{ y: '100%' }}
            transition={{ type: 'spring', stiffness: 380, damping: 38 }}
            drag="y" dragControls={controls} dragListener={false} dragConstraints={{ top: 0, bottom: 0 }} dragElastic={{ top: 0, bottom: 0.6 }}
            onDragEnd={(_, info) => { if (info.offset.y > 120 || info.velocity.y > 600) onClose && onClose(); }}
          >
            <div className="sheet-handle" onPointerDown={(e) => controls.start(e)} />
            <div className="sheet-head" onPointerDown={(e) => { if (e.target.closest('button, a, input, select, textarea')) return; controls.start(e); }}>
              <div className="grow">{header || <h2>{title}</h2>}</div>
              <Button variant="ghost" icon={X} onClick={onClose} aria-label="Close" />
            </div>
            <div className="sheet-body">{children}</div>
            {footer && <div className="sheet-foot">{footer}</div>}
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}

/** In-app confirm for destructive actions. `typed` requires typing an exact word to enable. */
export function ConfirmSheet({ state, onClose }) {
  const [text, setText] = useState('');
  useEffect(() => setText(''), [state]);
  const ok = !state || !state.typed || text.trim() === state.typed;
  return (
    <Sheet open={!!state} onClose={() => onClose(false)} title={state ? state.title || 'Are you sure?' : ''}
      footer={state && <>
        <Button variant="ghost" size="lg" onClick={() => onClose(false)}>Cancel</Button>
        <Button variant={state.danger === false ? 'primary' : 'danger'} size="lg" disabled={!ok} onClick={() => onClose(true)} data-testid="confirm-ok">{state.confirmLabel || 'Delete'}</Button>
      </>}>
      {state && (
        <div className="col" style={{ gap: 14 }}>
          <p className="muted" style={{ margin: 0, lineHeight: 1.6 }}>{state.message}</p>
          {state.typed && (
            <label className="field">
              <span className="field-label">Type <b style={{ color: 'var(--red)' }}>{state.typed}</b> to confirm</span>
              <input className="input" value={text} onChange={(e) => setText(e.target.value)} autoCapitalize="characters" autoComplete="off" spellCheck={false} data-testid="confirm-typed" />
            </label>
          )}
        </div>
      )}
    </Sheet>
  );
}

export function Toasts({ toasts }) {
  return (
    <div className="toasts" aria-live="polite">
      <AnimatePresence>
        {toasts.map((t) => (
          <motion.div key={t.id} className={`toast ${t.kind}`} initial={{ opacity: 0, y: 20, scale: 0.97 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 10 }} layout>
            {t.kind === 'error' ? <CircleAlert size={17} color="var(--red)" /> : t.kind === 'success' ? <Check size={17} color="var(--green)" /> : <Info size={17} color="var(--accent-2)" />}
            <div style={{ flex: 1, minWidth: 0 }}>{t.message}</div>
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}

export function Switch({ on, onChange, disabled, label }) {
  return <button type="button" role="switch" aria-checked={!!on} aria-label={label} className={`switch ${on ? 'on' : ''}`} disabled={disabled} onClick={() => onChange(!on)} />;
}

export function Seg({ value, options, onChange, full }) {
  return (
    <div className={`seg ${full ? 'full' : ''}`} role="tablist">
      {options.map((o) => {
        const v = typeof o === 'string' ? o : o.value;
        const l = typeof o === 'string' ? o : o.label;
        return <button type="button" role="tab" aria-selected={value === v} key={v} className={value === v ? 'on' : ''} onClick={() => onChange(v)}>{l}</button>;
      })}
    </div>
  );
}

export function Field({ label, required, help, children, className = '' }) {
  return (
    <label className={`field ${className}`}>
      {label && <span className="field-label">{label}{required && <span className="req">*</span>}</span>}
      {children}
      {help && <span className="help">{help}</span>}
    </label>
  );
}

export function TagInput({ value = [], onChange, placeholder, label }) {
  const [text, setText] = useState('');
  const ref = useRef(null);
  const add = (raw) => {
    const parts = raw.split(/[,\n]/).map((s) => s.trim()).filter(Boolean);
    if (!parts.length) { setText(''); return; }
    const next = [...value];
    parts.forEach((p) => { if (!next.some((x) => x.toLowerCase() === p.toLowerCase())) next.push(p); });
    onChange(next);
    setText('');
  };
  return (
    <div className="tag-input" onClick={() => ref.current && ref.current.focus()}>
      {value.map((t) => (
        <span className="tag" key={t}><span>{t}</span><button type="button" aria-label={`Remove ${t}`} onClick={(e) => { e.stopPropagation(); onChange(value.filter((x) => x !== t)); }}><X size={13} /></button></span>
      ))}
      <input
        ref={ref}
        value={text}
        aria-label={label || placeholder || 'Add tag'}
        enterKeyHint="done"
        placeholder={value.length ? 'Add…' : placeholder || 'Type and press Enter'}
        onChange={(e) => { if (e.target.value.includes(',')) add(e.target.value); else setText(e.target.value); }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') { e.preventDefault(); add(text); }
          if (e.key === 'Backspace' && !text && value.length) onChange(value.slice(0, -1));
        }}
        onBlur={() => text && add(text)}
      />
    </div>
  );
}

export function MultiChips({ value = [], options, onChange }) {
  return (
    <div className="chips">
      {options.map((o) => {
        const on = value.includes(o);
        return <button type="button" key={o} aria-pressed={on} className={`chip ${on ? 'on' : ''}`} onClick={() => onChange(on ? value.filter((x) => x !== o) : [...value, o])}>{on && <Check size={12} />}{o}</button>;
      })}
    </div>
  );
}

export function ScoreRing({ score = 0, size = 46, stroke = 4 }) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const color = score >= 80 ? 'var(--green)' : score >= 60 ? 'var(--accent-2)' : score >= 40 ? 'var(--amber)' : 'var(--red)';
  return (
    <div className="score-ring" style={{ width: size, height: size }}>
      <svg width={size} height={size} style={{ transform: 'rotate(-90deg)' }}>
        <circle cx={size / 2} cy={size / 2} r={r} stroke="rgba(255,255,255,.08)" strokeWidth={stroke} fill="none" />
        <motion.circle cx={size / 2} cy={size / 2} r={r} stroke={color} strokeWidth={stroke} fill="none" strokeLinecap="round"
          strokeDasharray={c} initial={{ strokeDashoffset: c }} animate={{ strokeDashoffset: c * (1 - score / 100) }} transition={{ duration: 0.9, ease: [0.4, 0, 0.2, 1] }} />
      </svg>
      <span style={{ fontSize: size * 0.3, color }}>{score}</span>
    </div>
  );
}

const PALETTE = ['#2563eb', '#7c3aed', '#db2777', '#ea580c', '#059669', '#0891b2', '#4f46e5', '#ca8a04', '#dc2626', '#0d9488'];
// Company logos are deliberately NOT loaded from third-party hosts (strict CSP, no tracking pixels):
// we render a deterministic gradient monogram instead.
export function Logo({ name = '?', size }) {
  const h = [...String(name)].reduce((a, ch) => a + ch.charCodeAt(0), 0);
  const bg = `linear-gradient(135deg, ${PALETTE[h % PALETTE.length]}, ${PALETTE[(h + 3) % PALETTE.length]})`;
  return <div className={`logo-tile ${size === 'sm' ? 'sm' : ''}`} style={{ background: bg }} aria-hidden="true">{(String(name).trim()[0] || '?').toUpperCase()}</div>;
}

export function Empty({ icon: Icon, title, children, action }) {
  return (
    <motion.div className="empty" {...fade}>
      {Icon && <Icon size={32} />}
      <h3>{title}</h3>
      <div className="small">{children}</div>
      {action && <div style={{ marginTop: 16 }}>{action}</div>}
    </motion.div>
  );
}

export const STATUS = {
  saved: { label: 'Saved', cls: '' },
  queued: { label: 'In review queue', cls: 'blue' },
  'in-progress': { label: 'Applying…', cls: 'accent' },
  'awaiting-you': { label: 'Needs you', cls: 'amber' },
  applied: { label: 'Applied', cls: 'green' },
  interview: { label: 'Interview', cls: 'accent' },
  offer: { label: 'Offer 🎉', cls: 'green' },
  rejected: { label: 'Rejected', cls: 'red' },
  failed: { label: 'Failed', cls: 'red' },
  skipped: { label: 'Skipped', cls: '' },
};
export function StatusBadge({ status }) {
  const s = STATUS[status] || { label: status, cls: '' };
  return <span className={`badge ${s.cls}`}>{status === 'in-progress' && <Loader2 size={11} className="spin" />}{s.label}</span>;
}

export function timeAgo(iso) {
  if (!iso) return '—';
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 0) { const m = -s / 60; return m < 60 ? `in ${Math.max(1, Math.round(m))}m` : `in ${Math.round(m / 60)}h`; }
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  if (s < 86400 * 120) return `${Math.floor(s / 86400)}d ago`;
  return new Date(iso).toLocaleDateString();
}

const SYM = { USD: '$', INR: '₹', EUR: '€', GBP: '£', CAD: 'C$', AUD: 'A$', SGD: 'S$' };
function compact(n, cur) {
  const trim = (x) => x.toFixed(1).replace(/\.0$/, '');
  if (cur === 'INR' && n >= 1e5) return n >= 1e7 ? `${trim(n / 1e7)}Cr` : `${trim(n / 1e5)}L`;
  if (n >= 1e6) return `${trim(n / 1e6)}M`;
  if (n >= 1000) return `${Math.round(n / 1000)}k`;
  return String(Math.round(n));
}
export function salary(job) {
  if (!job) return '—';
  if (job.salaryMin || job.salaryMax) {
    const s = SYM[job.salaryCurrency] || (job.salaryCurrency ? `${job.salaryCurrency} ` : '$');
    if (job.salaryMin && job.salaryMax && job.salaryMin !== job.salaryMax) return `${s}${compact(job.salaryMin, job.salaryCurrency)}–${compact(job.salaryMax, job.salaryCurrency)}`;
    return `${s}${compact(job.salaryMin || job.salaryMax, job.salaryCurrency)}`;
  }
  return job.salaryText ? job.salaryText.slice(0, 22) : '—';
}

export function Progress({ value, indeterminate }) {
  return <div className={`progress ${indeterminate ? 'indeterminate' : ''}`}><div style={{ width: `${Math.max(0, Math.min(100, value || 0))}%` }} /></div>;
}

export function CountUp({ value = 0, duration = 700 }) {
  const [n, setN] = useState(0);
  const from = useRef(0);
  useEffect(() => {
    const start = performance.now();
    const a = from.current;
    let raf;
    const tick = (t) => {
      const k = Math.min(1, (t - start) / duration);
      setN(Math.round(a + (value - a) * (1 - Math.pow(1 - k, 3))));
      if (k < 1) raf = requestAnimationFrame(tick); else from.current = value;
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [value, duration]);
  return <>{n.toLocaleString()}</>;
}

export async function copyText(text) {
  try { await navigator.clipboard.writeText(text); return true; } catch {
    // Fallback for browsers without async clipboard permission.
    const ta = document.createElement('textarea');
    ta.value = text; ta.setAttribute('readonly', ''); ta.style.position = 'fixed'; ta.style.opacity = '0';
    document.body.appendChild(ta); ta.select();
    let ok = false; try { ok = document.execCommand('copy'); } catch { ok = false; }
    ta.remove();
    return ok;
  }
}

/** One-tap copy row used by the Quick-fill sheet. */
export function CopyRow({ k, v, onCopied, multiline }) {
  const [done, setDone] = useState(false);
  if (v == null || v === '' || (Array.isArray(v) && !v.length)) return null;
  const text = Array.isArray(v) ? v.join(', ') : String(v);
  return (
    <button type="button" className={`copy-row ${done ? 'done' : ''}`} data-copy-key={k} onClick={async () => {
      const ok = await copyText(text);
      setDone(ok); if (onCopied) onCopied(ok, k);
      setTimeout(() => setDone(false), 1500);
    }}>
      <div className="grow">
        <div className="k">{k}</div>
        <div className={multiline ? 'small prewrap' : 'v'} style={multiline ? { maxHeight: 120, overflow: 'hidden' } : null}>{text}</div>
      </div>
      <span className="act">{done ? <Check size={18} /> : <Copy size={18} />}</span>
    </button>
  );
}

export function Markdown({ text = '' }) {
  const blocks = [];
  let list = null;
  const inline = (s, k) => s.split(/(\*\*[^*]+\*\*)/g).map((p, i) => (p.startsWith('**') ? <strong key={`${k}-${i}`}>{p.slice(2, -2)}</strong> : p));
  text.split('\n').forEach((line, i) => {
    const l = line.trimEnd();
    const li = l.match(/^\s*(?:[-*•]|\d+\.)\s+(.*)/);
    if (li) { if (!list) { list = []; blocks.push({ list }); } list.push(inline(li[1], i)); return; }
    list = null;
    if (!l.trim()) return;
    const h = l.match(/^(#{1,4})\s+(.*)/);
    if (h) blocks.push({ h: h[1].length, c: inline(h[2], i) });
    else blocks.push({ p: inline(l, i) });
  });
  return (
    <div className="prose">
      {blocks.map((b, i) => (b.list ? <ul key={i}>{b.list.map((x, j) => <li key={j}>{x}</li>)}</ul> : b.h ? React.createElement(`h${Math.min(b.h + 1, 4)}`, { key: i }, b.c) : <p key={i}>{b.p}</p>))}
    </div>
  );
}

export function downloadFile(name, data, type = 'application/octet-stream') {
  const blob = data instanceof Blob ? data : new Blob([data], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = name; a.rel = 'noopener';
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}
