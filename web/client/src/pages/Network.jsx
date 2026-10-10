import React, { useMemo, useRef, useState } from 'react';
import { Users, Upload, Trash2, Pencil, Plus, Search, ExternalLink, ShieldCheck, Loader2 } from 'lucide-react';
import { useApp } from '../lib/store.jsx';
import { Button, Empty, Sheet, Field, Logo, timeAgo } from '../components/ui.jsx';
import { allConnections, importConnections, clearConnections, saveConnection, removeConnection } from '../lib/network.js';
import { readCsvFile } from '../lib/trackerIo.js';
import { openUrl } from '../lib/bridge.js';

function ContactEditor({ state, onClose }) {
  const app = useApp();
  const [c, setC] = useState(state || {});
  const [busy, setBusy] = useState(false);
  React.useEffect(() => setC(state || {}), [state]);
  const save = async () => {
    setBusy(true);
    try { await saveConnection(app, c); app.toast(state && state.id ? 'Contact saved' : 'Contact added', 'success'); onClose(); } catch (e) { app.toast(e.message, 'error'); } finally { setBusy(false); }
  };
  const up = (k) => (e) => setC({ ...c, [k]: e.target.value });
  return (
    <Sheet open={!!state} onClose={onClose} title={state && state.id ? 'Edit contact' : 'Add a contact'}
      footer={<><Button size="lg" variant="ghost" onClick={onClose}>Cancel</Button><Button size="lg" variant="primary" loading={busy} disabled={!(c.name || '').trim() || !(c.company || '').trim()} onClick={save} data-testid="contact-save">Save</Button></>}>
      <div className="col" style={{ gap: 12 }}>
        <Field label="Name" required><input className="input" value={c.name || ''} onChange={up('name')} data-testid="contact-name" /></Field>
        <Field label="Company" required><input className="input" value={c.company || ''} onChange={up('company')} data-testid="contact-company" /></Field>
        <Field label="Position"><input className="input" value={c.position || ''} onChange={up('position')} /></Field>
        <Field label="LinkedIn profile URL" help="https://www.linkedin.com/in/…"><input className="input" type="url" inputMode="url" value={c.url || ''} onChange={up('url')} /></Field>
      </div>
    </Sheet>
  );
}

export default function Network() {
  const app = useApp();
  const input = useRef(null);
  const [busy, setBusy] = useState('');
  const [q, setQ] = useState('');
  const [edit, setEdit] = useState(null);
  const [limit, setLimit] = useState(50);
  const people = useMemo(() => allConnections(app.sync), [app.rev]); // eslint-disable-line
  const meta = app.networkMeta;
  const shown = useMemo(() => { const t = q.trim().toLowerCase(); return people.filter((p) => !t || `${p.name} ${p.company} ${p.position}`.toLowerCase().includes(t)); }, [people, q]);
  const companies = new Set(people.map((p) => p.company.toLowerCase())).size;

  const onFile = async (files) => {
    const f = files && files[0];
    if (!f) return;
    if (people.length && !(await app.confirm({ title: 'Replace your connections?', message: `The ${people.length} contacts already imported are replaced by "${f.name}".`, confirmLabel: 'Replace', danger: false }))) { input.current.value = ''; return; }
    setBusy('Reading and encrypting…');
    try { const r = await importConnections(app, await readCsvFile(f), f.name); app.toast(`Imported ${r.count} connections across ${r.companies} companies`, 'success'); } catch (e) { app.toast(e.message, 'error'); } finally { setBusy(''); if (input.current) input.current.value = ''; }
  };
  const clear = async () => {
    if (!(await app.confirm({ title: 'Remove all connections?', message: 'The referral finder stops showing who you know at each company, on every device. You can import again anytime.', confirmLabel: 'Remove all' }))) return;
    setBusy('Removing…');
    try { await clearConnections(app); app.toast('Connections removed', 'success'); } catch (e) { app.toast(e.message, 'error'); } finally { setBusy(''); }
  };
  const del = async (p) => {
    if (!(await app.confirm({ title: 'Remove contact?', message: `${p.name} (${p.company}) is removed from your referral list.`, confirmLabel: 'Remove' }))) return;
    try { await removeConnection(app, p); app.toast('Contact removed', 'success'); } catch (e) { app.toast(e.message, 'error'); }
  };

  return (
    <div className="col" style={{ gap: 14 }}>
      <div className="card pad col" style={{ gap: 10 }}>
        <div className="section-title" style={{ margin: 0 }}><Users size={14} />Referral finder</div>
        <div className="small muted">Referrals get interviews several times more often than cold applications. Import your LinkedIn connections and every job shows <b style={{ color: 'var(--fg)' }}>who you already know there</b>, with an AI-written referral message.</div>
        <ol className="small muted" style={{ margin: 0, paddingLeft: 20, lineHeight: 1.7 }}>
          <li>LinkedIn → Settings → Data privacy → <b style={{ color: 'var(--fg)' }}>Get a copy of your data</b></li>
          <li>Choose <b style={{ color: 'var(--fg)' }}>Connections</b> → Request archive (emailed in ~10 min)</li>
          <li>Unzip it and import <b style={{ color: 'var(--fg)' }}>Connections.csv</b> here</li>
        </ol>
        <div className="row" style={{ gap: 10 }}>
          {busy ? <Loader2 size={18} className="spin" /> : <Users size={18} color={people.length ? 'var(--green)' : 'var(--muted)'} />}
          <div className="grow"><div style={{ fontWeight: 700 }} data-testid="network-count">{busy || (people.length ? `${people.length.toLocaleString()} connections · ${companies} companies` : 'No connections yet')}</div>
            {meta && meta.importedAt && <div className="tiny dim">Imported {timeAgo(meta.importedAt)}{meta.source ? ` from ${meta.source}` : ''}</div>}</div>
        </div>
        <div className="grid g2">
          <Button variant="primary" icon={Upload} disabled={!!busy} onClick={() => input.current.click()} data-testid="network-import">{people.length ? 'Re-import' : 'Import CSV'}</Button>
          {people.length > 0 ? <Button variant="danger" icon={Trash2} disabled={!!busy} onClick={clear} data-testid="network-clear">Remove all</Button> : <Button icon={Plus} onClick={() => setEdit({})}>Add contact</Button>}
        </div>
        <input ref={input} type="file" accept=".csv,text/csv" hidden onChange={(e) => onFile(e.target.files)} data-testid="network-file" />
        <div className="tiny dim row" style={{ alignItems: 'flex-start' }}><ShieldCheck size={12} style={{ flexShrink: 0, marginTop: 2 }} />Read on this phone and stored end-to-end encrypted. Email addresses in the file are not kept.</div>
      </div>

      {people.length > 0 && (
        <>
          <div className="row" style={{ gap: 8 }}>
            <div className="search-wrap grow"><Search size={16} /><input className="input" value={q} onChange={(e) => { setQ(e.target.value); setLimit(50); }} placeholder="Search people or companies" aria-label="Search connections" /></div>
            <Button icon={Plus} aria-label="Add contact" onClick={() => setEdit({})} data-testid="contact-add" />
          </div>
          <div className="card" style={{ padding: '4px 12px' }}>
            {shown.slice(0, limit).map((p) => (
              <div key={`${p.chunk}:${p.id}`} className="person-row" style={{ borderBottom: '1px solid var(--border)' }} data-testid="person-row">
                <Logo name={p.company} size="sm" />
                <div className="grow"><div className="small ellipsis" style={{ fontWeight: 600 }}>{p.name}</div><div className="tiny dim ellipsis">{p.position ? `${p.position} · ` : ''}{p.company}</div></div>
                {p.url && <Button size="sm" variant="ghost" icon={ExternalLink} aria-label={`Open ${p.name}'s profile`} onClick={() => openUrl(p.url)} />}
                <Button size="sm" variant="ghost" icon={Pencil} aria-label={`Edit ${p.name}`} onClick={() => setEdit(p)} />
                <Button size="sm" variant="ghost" icon={Trash2} aria-label={`Remove ${p.name}`} onClick={() => del(p)} />
              </div>
            ))}
            {!shown.length && <div className="small dim" style={{ padding: 12 }}>No one matches "{q}".</div>}
          </div>
          {shown.length > limit && <Button block onClick={() => setLimit(limit + 100)}>Show more ({shown.length - limit} left)</Button>}
        </>
      )}
      {!people.length && !busy && <Empty icon={Users} title="See who you know">Import once; the referral finder then appears on every job's details.</Empty>}
      <ContactEditor state={edit} onClose={() => setEdit(null)} />
    </div>
  );
}
