'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { getClient } from '../../../lib/crms';

interface Module {
  id: string;
  key: string;
  name: string;
  icon?: string | null;
}

/** Module builder (PRD §8, §43.2): list + create modules. */
export default function BuilderPage() {
  const [modules, setModules] = useState<Module[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({ key: '', name: '' });

  async function load() {
    try {
      setModules(await getClient().modules.list());
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
      await getClient().modules.create({ key: form.key, name: form.name, namePlural: `${form.name}s` });
      setForm({ key: '', name: '' });
      setCreating(false);
      await load();
    } catch (e2) {
      setError(e2 instanceof Error ? e2.message : 'Error');
    }
  }

  return (
    <div style={{ display: 'grid', gap: '1.25rem' }}>
      <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <span className="badge">Constructor</span>
          <h1 style={{ margin: '0.4rem 0 0' }}>Módulos</h1>
        </div>
        <button className="btn" onClick={() => setCreating((v) => !v)}>
          {creating ? 'Cancelar' : '+ Nuevo módulo'}
        </button>
      </header>

      {error && <div className="card" style={{ borderColor: '#7f1d1d', color: '#f87171' }}>{error}</div>}

      {creating && (
        <form onSubmit={create} className="card" style={{ display: 'grid', gap: '0.6rem', maxWidth: 460 }}>
          <label>
            Clave (snake_case)
            <input className="input" value={form.key} onChange={(e) => setForm({ ...form, key: e.target.value })} placeholder="leads" required />
          </label>
          <label>
            Nombre
            <input className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Lead" required />
          </label>
          <button className="btn">Crear módulo</button>
        </form>
      )}

      <section style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(220px,1fr))', gap: '1rem' }}>
        {modules.map((m) => (
          <Link key={m.id} href={`/builder/${m.id}`} className="card" style={{ textDecoration: 'none', color: 'var(--fg)' }}>
            <h3 style={{ marginTop: 0 }}>
              {m.icon ?? '📦'} {m.name}
            </h3>
            <code className="muted">{m.key}</code>
          </Link>
        ))}
        {modules.length === 0 && !error && <p className="muted">Aún no hay módulos. Créalos aquí o pídeselos a la IA.</p>}
      </section>
    </div>
  );
}
