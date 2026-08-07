'use client';

import { useEffect, useState } from 'react';
import { getClient } from '../../../lib/crms';

interface Integration {
  id: string;
  key: string;
  name: string;
  provider: string;
}
interface Template {
  key?: string;
  name?: string;
  provider?: string;
}
interface Cred {
  id: string;
  name: string;
  provider: string;
}

export default function IntegrationsPage() {
  const [items, setItems] = useState<Integration[]>([]);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [creds, setCreds] = useState<Cred[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ key: '', name: '', provider: '', template: '', credentialId: '' });

  async function load() {
    try {
      const c = getClient();
      const [list, tpl, cr] = await Promise.all([c.integrations.list(), c.integrations.templates(), c.credentials.list()]);
      setItems(list as unknown as Integration[]);
      setTemplates((tpl.templates ?? []) as Template[]);
      setCreds(cr as unknown as Cred[]);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error');
    }
  }
  useEffect(() => {
    load();
  }, []);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    try {
      await getClient().integrations.create({
        key: form.key,
        name: form.name,
        provider: form.provider || form.template || 'custom_api',
        template: form.template || undefined,
        credentialId: form.credentialId || undefined,
      });
      setForm({ key: '', name: '', provider: '', template: '', credentialId: '' });
      setOpen(false);
      await load();
    } catch (e2) {
      setError(e2 instanceof Error ? e2.message : 'Error');
    }
  }

  async function execute(i: Integration) {
    setStatus(null);
    try {
      const res = await getClient().integrations.execute(i.id, {});
      setStatus(`Ejecutado "${i.name}": ${JSON.stringify(res).slice(0, 160)}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error');
    }
  }

  return (
    <div style={{ display: 'grid', gap: '1.25rem', maxWidth: 820 }}>
      <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <span className="badge">Conexiones</span>
          <h1 style={{ margin: '0.4rem 0 0' }}>Integraciones</h1>
        </div>
        <button className="btn" onClick={() => setOpen((v) => !v)}>{open ? 'Cancelar' : '+ Integración'}</button>
      </header>
      <p className="muted" style={{ margin: 0 }}>Conecta APIs externas (usa una plantilla oficial o define la tuya) con la credencial del tenant.</p>

      {error && <div className="card" style={{ borderColor: '#7f1d1d', color: '#f87171' }}>{error}</div>}
      {status && <div className="card" style={{ borderColor: '#14532d', color: '#4ade80', wordBreak: 'break-all' }}>{status}</div>}

      <section style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(220px,1fr))', gap: '0.8rem' }}>
        {items.map((i) => (
          <div key={i.id} className="card" style={{ display: 'grid', gap: '0.4rem' }}>
            <h3 style={{ margin: 0 }}>{i.name}</h3>
            <code className="muted">{i.provider}</code>
            <button className="mini" style={{ justifySelf: 'start' }} onClick={() => execute(i)}>Probar</button>
          </div>
        ))}
        {items.length === 0 && <p className="muted">Sin integraciones todavía.</p>}
      </section>

      {open && (
        <form onSubmit={create} className="card" style={{ display: 'grid', gap: '0.7rem' }}>
          <h3 style={{ margin: 0 }}>Nueva integración</h3>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.7rem' }}>
            <label>
              Nombre
              <input className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
            </label>
            <label>
              Clave
              <input className="input" value={form.key} onChange={(e) => setForm({ ...form, key: e.target.value })} placeholder="mi_api" required />
            </label>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.7rem' }}>
            <label>
              Plantilla (opcional)
              <select className="input" value={form.template} onChange={(e) => setForm({ ...form, template: e.target.value })}>
                <option value="">— Personalizada —</option>
                {templates.map((t, i) => (
                  <option key={i} value={(t.key as string) ?? t.name}>
                    {t.name ?? t.key} {t.provider ? `(${t.provider})` : ''}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Credencial
              <select className="input" value={form.credentialId} onChange={(e) => setForm({ ...form, credentialId: e.target.value })}>
                <option value="">Ninguna</option>
                {creds.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name} ({c.provider})
                  </option>
                ))}
              </select>
            </label>
          </div>
          {!form.template && (
            <label>
              Proveedor
              <input className="input" value={form.provider} onChange={(e) => setForm({ ...form, provider: e.target.value })} placeholder="custom_api" />
            </label>
          )}
          <button className="btn">Crear integración</button>
        </form>
      )}

      <style jsx>{`
        .mini {
          background: transparent;
          border: 1px solid var(--border);
          color: var(--muted);
          border-radius: 6px;
          padding: 0.25rem 0.6rem;
          cursor: pointer;
          font-size: 0.82rem;
        }
      `}</style>
    </div>
  );
}
