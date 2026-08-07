'use client';

import { useEffect, useState } from 'react';
import { getClient } from '../../../lib/crms';

interface ModuleRef {
  id: string;
  name: string;
}
interface Portal {
  id: string;
  key: string;
  name: string;
  audience?: string;
  active?: boolean;
}

export default function PortalsPage() {
  const [modules, setModules] = useState<ModuleRef[]>([]);
  const [portals, setPortals] = useState<Portal[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ key: '', name: '', audience: 'clients', moduleIds: [] as string[], allowRegistration: true });

  async function load() {
    try {
      const c = getClient();
      const [p, m] = await Promise.all([c.portals.list(), c.modules.list()]);
      setPortals(p as unknown as Portal[]);
      setModules(m as ModuleRef[]);
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
      await getClient().portals.create({
        key: form.key,
        name: form.name,
        audience: form.audience,
        exposure: { moduleIds: form.moduleIds, allowRegistration: form.allowRegistration },
      });
      setForm({ ...form, key: '', name: '', moduleIds: [] });
      setOpen(false);
      await load();
    } catch (e2) {
      setError(e2 instanceof Error ? e2.message : 'Error');
    }
  }

  return (
    <div style={{ display: 'grid', gap: '1.25rem', maxWidth: 820 }}>
      <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <span className="badge">Portales</span>
          <h1 style={{ margin: '0.4rem 0 0' }}>Portales de clientes</h1>
        </div>
        <button className="btn" onClick={() => setOpen((v) => !v)}>{open ? 'Cancelar' : '+ Portal'}</button>
      </header>
      <p className="muted" style={{ margin: 0 }}>
        Un portal deja que tus clientes externos se registren y vean/creen registros en los módulos que expongas.
      </p>

      {error && <div className="card" style={{ borderColor: '#7f1d1d', color: '#f87171' }}>{error}</div>}

      <section style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(220px,1fr))', gap: '0.8rem' }}>
        {portals.map((p) => (
          <div key={p.id} className="card">
            <h3 style={{ margin: '0 0 0.2rem' }}>{p.name}</h3>
            <code className="muted">{p.key}</code> {p.audience && <span className="badge">{p.audience}</span>}
          </div>
        ))}
        {portals.length === 0 && <p className="muted">Sin portales todavía.</p>}
      </section>

      {open && (
        <form onSubmit={create} className="card" style={{ display: 'grid', gap: '0.7rem' }}>
          <h3 style={{ margin: 0 }}>Nuevo portal</h3>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '0.7rem' }}>
            <label>
              Nombre
              <input className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
            </label>
            <label>
              Clave
              <input className="input" value={form.key} onChange={(e) => setForm({ ...form, key: e.target.value })} placeholder="clientes" required />
            </label>
            <label>
              Audiencia
              <select className="input" value={form.audience} onChange={(e) => setForm({ ...form, audience: e.target.value })}>
                {['clients', 'partners', 'suppliers', 'community'].map((a) => (
                  <option key={a}>{a}</option>
                ))}
              </select>
            </label>
          </div>
          <label>
            Módulos expuestos
            <select
              className="input"
              multiple
              value={form.moduleIds}
              onChange={(e) => setForm({ ...form, moduleIds: Array.from(e.target.selectedOptions).map((o) => o.value) })}
              style={{ minHeight: 110 }}
            >
              {modules.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </select>
          </label>
          <label style={{ display: 'flex', gap: '0.4rem', alignItems: 'center' }}>
            <input type="checkbox" checked={form.allowRegistration} onChange={(e) => setForm({ ...form, allowRegistration: e.target.checked })} /> Permitir auto-registro
          </label>
          <button className="btn">Crear portal</button>
        </form>
      )}
    </div>
  );
}
