import React, { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { X, Loader2, CircleAlert, Check, Info } from 'lucide-react';

export const fade = { initial: { opacity: 0, y: 8 }, animate: { opacity: 1, y: 0 }, exit: { opacity: 0, y: -6 }, transition: { duration: 0.22, ease: [0.4, 0, 0.2, 1] } };
export const stagger = (i) => ({ initial: { opacity: 0, y: 12 }, animate: { opacity: 1, y: 0 }, transition: { duration: 0.28, delay: Math.min(i, 14) * 0.035, ease: [0.4, 0, 0.2, 1] } });

export function Button({ variant = 'outline', size, icon: Icon, loading, children, className = '', ...rest }) {
  return (
    <button className={`btn btn-${variant} ${size ? `btn-${size}` : ''} ${!children ? 'btn-icon' : ''} ${className}`} disabled={loading || rest.disabled} {...rest}>
      {loading ? <Loader2 size={15} className="spin" /> : Icon ? <Icon size={15} /> : null}
      {children}
    </button>
  );
}

export function Modal({ open, onClose, title, children, footer, wide }) {
  useEffect(() => {
    if (!open) return;
    const k = (e) => e.key === 'Escape' && onClose && onClose();
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [open, onClose]);
  return (
    <AnimatePresence>
      {open && (
        <motion.div className="overlay" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onMouseDown={(e) => e.target === e.currentTarget && onClose && onClose()}>
          <motion.div className={`modal ${wide ? 'wide' : ''}`} initial={{ opacity: 0, scale: 0.96, y: 10 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.97 }} transition={{ type: 'spring', stiffness: 380, damping: 30 }}>
            <div className="modal-head"><h2>{title}</h2><Button variant="ghost" icon={X} onClick={onClose} /></div>
            <div className="modal-body">{children}</div>
            {footer && <div className="modal-foot">{footer}</div>}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

export function Drawer({ open, onClose, header, children }) {
  useEffect(() => {
    if (!open) return;
    const k = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [open, onClose]);
  return (
    <AnimatePresence>
      {open && (
        <div className="drawer-wrap">
          <motion.div className="drawer-bg" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose} />
          <motion.div className="drawer" initial={{ x: '100%' }} animate={{ x: 0 }} exit={{ x: '100%' }} transition={{ type: 'spring', stiffness: 320, damping: 34 }}>
            <div className="drawer-head">
              <div style={{ position: 'absolute', right: 14, top: 44 }}><Button variant="ghost" icon={X} onClick={onClose} /></div>
              {header}
            </div>
            <div className="drawer-body">{children}</div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}

export function Toasts({ toasts }) {
  return (
    <div className="toasts">
      <AnimatePresence>
        {toasts.map((t) => (
          <motion.div key={t.id} className={`toast ${t.kind}`} initial={{ opacity: 0, x: 40, scale: 0.95 }} animate={{ opacity: 1, x: 0, scale: 1 }} exit={{ opacity: 0, x: 40 }} layout>
            {t.kind === 'error' ? <CircleAlert size={17} color="var(--red)" /> : t.kind === 'success' ? <Check size={17} color="var(--green)" /> : <Info size={17} color="var(--accent-2)" />}
            <div style={{ flex: 1 }}>{t.message}</div>
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}

export function Switch({ on, onChange, disabled }) {
  return <button type="button" className={`switch ${on ? 'on' : ''}`} disabled={disabled} onClick={() => onChange(!on)} aria-pressed={!!on} />;
}

export function Seg({ value, options, onChange }) {
  return (
    <div className="seg">
      {options.map((o) => {
        const v = typeof o === 'string' ? o : o.value;
        const l = typeof o === 'string' ? o : o.label;
        return <button type="button" key={v} className={value === v ? 'on' : ''} onClick={() => onChange(v)}>{l}</button>;
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

export function TagInput({ value = [], onChange, placeholder, suggestions }) {
  const [text, setText] = useState('');
  const ref = useRef(null);
  const add = (raw) => {
    const parts = raw.split(/[,\n]/).map((s) => s.trim()).filter(Boolean);
    if (!parts.length) return;
    const next = [...value];
    parts.forEach((p) => { if (!next.some((x) => x.toLowerCase() === p.toLowerCase())) next.push(p); });
    onChange(next);
    setText('');
  };
  return (
    <div>
      <div className="tag-input" onClick={() => ref.current && ref.current.focus()}>
        {value.map((t) => (
          <span className="tag" key={t}>{t}<button type="button" onClick={(e) => { e.stopPropagation(); onChange(value.filter((x) => x !== t)); }}><X size={12} /></button></span>
        ))}
        <input
          ref={ref}
          value={text}
          placeholder={value.length ? '' : placeholder || 'Type and press Enter'}
          onChange={(e) => { if (e.target.value.includes(',')) add(e.target.value); else setText(e.target.value); }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') { e.preventDefault(); add(text); }
            if (e.key === 'Backspace' && !text && value.length) onChange(value.slice(0, -1));
          }}
          onBlur={() => text && add(text)}
        />
      </div>
      {suggestions && suggestions.length > 0 && (
        <div className="chips" style={{ marginTop: 8 }}>
          {suggestions.filter((s) => !value.includes(s)).slice(0, 10).map((s) => <span key={s} className="chip" onClick={() => onChange([...value, s])}>+ {s}</span>)}
        </div>
      )}
    </div>
  );
}

export function MultiChips({ value = [], options, onChange }) {
  return (
    <div className="chips">
      {options.map((o) => {
        const on = value.includes(o);
        return <span key={o} className={`chip ${on ? 'on' : ''}`} onClick={() => onChange(on ? value.filter((x) => x !== o) : [...value, o])}>{on && <Check size={12} />}{o}</span>;
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
export function Logo({ name = '?', src, size }) {
  const [bad, setBad] = useState(false);
  const h = [...name].reduce((a, ch) => a + ch.charCodeAt(0), 0);
  const bg = `linear-gradient(135deg, ${PALETTE[h % PALETTE.length]}, ${PALETTE[(h + 3) % PALETTE.length]})`;
  return (
    <div className={`logo-tile ${size === 'sm' ? 'sm' : ''}`} style={{ background: src && !bad ? 'white' : bg }}>
      {src && !bad ? <img src={src} alt="" onError={() => setBad(true)} /> : (name.trim()[0] || '?').toUpperCase()}
    </div>
  );
}

export function Empty({ icon: Icon, title, children, action }) {
  return (
    <motion.div className="empty" {...fade}>
      {Icon && <Icon size={34} />}
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
  if (s < 0) { const m = -s / 60; return m < 60 ? `in ${Math.round(m)}m` : `in ${Math.round(m / 60)}h`; }
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

// Minimal Markdown → React (headings, lists, bold, paragraphs).
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
      const v = Math.round(a + (value - a) * (1 - Math.pow(1 - k, 3)));
      setN(v);
      if (k < 1) raf = requestAnimationFrame(tick); else from.current = value;
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [value, duration]);
  return <>{n.toLocaleString()}</>;
}

export function ConfirmDialog({ state, onClose }) {
  return (
    <Modal open={!!state} onClose={() => onClose(false)} title={state ? state.title || 'Are you sure?' : ''} footer={state && <>
      <Button variant="ghost" onClick={() => onClose(false)}>Cancel</Button>
      <Button variant={state.danger === false ? 'primary' : 'danger'} autoFocus onClick={() => onClose(true)}>{state.confirmLabel || 'Delete'}</Button>
    </>}>
      {state && <p className="muted" style={{ margin: 0, lineHeight: 1.6 }}>{state.message}</p>}
    </Modal>
  );
}
