'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { getClient } from '../../../lib/crms';
import { VersionsPanel } from '../../../components/builder/VersionsPanel';
import { TemplatesPanel } from '../../../components/builder/TemplatesPanel';

interface Module {
  id: string;
  key: string;
  name: string;
  namePlural?: string | null;
  icon?: string | null;
  color?: string | null;
  description?: string | null;
}

const emptyForm = { key: '', name: '', namePlural: '', icon: '', color: '', description: '' };

/** Module builder (PRD §8, §43.2): list + create + edit + delete modules. */
export default function BuilderPage() {
  const [modules, setModules] = useState<Module[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null); // 'new', a module id, or null
  const [form, setForm] = useState(emptyForm);

  async function load() {
    try {
      setModules((await getClient().modules.list()) as unknown as Module[]);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error');
    }
  }
  useEffect(() => {
    load();
  }, []);

  function openNew() {
    setForm(emptyForm);
    setEditingId('new');
  }
  function openEdit(m: Module) {
    setForm({
      key: m.key,
      name: m.name,
      namePlural: m.namePlural ?? '',
      icon: m.icon ?? '',
      color: m.color ?? '',
      description: m.description ?? '',
    });
    setEditingId(m.id);
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    try {
      const payload = {
        name: form.name,
        namePlural: form.namePlural || `${form.name}s`,
        icon: form.icon || undefined,
        color: form.color || undefined,
        description: form.description || undefined,
      };
      if (editingId === 'new') {
        await getClient().modules.create({ key: form.key, ...payload });
      } else if (editingId) {
        await getClient().modules.update(editingId, payload);
      }
      setForm(emptyForm);
      setEditingId(null);
      await load();
    } catch (e2) {
      setError(e2 instanceof Error ? e2.message : 'Error');
    }
  }

  async function remove(m: Module) {
    if (!confirm(`¿Eliminar el módulo "${m.name}" y todos sus registros y campos?`)) return;
    try {
      await getClient().modules.remove(m.id, true);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error');
    }
  }

  return (
    <div style={{ display: 'grid', gap: '1.25rem' }}>
      <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <span className="badge">Constructor</span>
          <h1 style={{ margin: '0.4rem 0 0' }}>Módulos</h1>
        </div>
        <button className="btn" onClick={editingId === 'new' ? () => setEditingId(null) : openNew}>
          {editingId === 'new' ? 'Cancelar' : '+ Nuevo módulo'}
        </button>
      </header>

      {error && <div className="card" style={{ borderColor: '#7f1d1d', color: '#f87171' }}>{error}</div>}

      {editingId && (
        <form onSubmit={save} className="card" style={{ display: 'grid', gap: '0.7rem', maxWidth: 560 }}>
          <h3 style={{ margin: 0 }}>{editingId === 'new' ? 'Nuevo módulo' : 'Editar módulo'}</h3>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.7rem' }}>
            <label>
              Nombre (singular)
              <input className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Lead" required />
            </label>
            <label>
              Nombre (plural)
              <input className="input" value={form.namePlural} onChange={(e) => setForm({ ...form, namePlural: e.target.value })} placeholder="Leads" />
            </label>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr', gap: '0.7rem' }}>
            <label>
              Clave (snake_case)
              <input
                className="input"
                value={form.key}
                onChange={(e) => setForm({ ...form, key: e.target.value })}
                placeholder="leads"
                required
                disabled={editingId !== 'new'}
              />
            </label>
            <label>
              Ícono (emoji)
              <input className="input" value={form.icon} onChange={(e) => setForm({ ...form, icon: e.target.value })} placeholder="📇" />
            </label>
            <label>
              Color
              <input className="input" type="color" value={form.color || '#4f46e5'} onChange={(e) => setForm({ ...form, color: e.target.value })} />
            </label>
          </div>
          <label>
            Descripción
            <input className="input" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="Prospectos de venta" />
          </label>
          <button className="btn">{editingId === 'new' ? 'Crear módulo' : 'Guardar cambios'}</button>
        </form>
      )}

      <section style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(240px,1fr))', gap: '1rem' }}>
        {modules.map((m) => (
          <div key={m.id} className="card" style={{ display: 'grid', gap: '0.5rem', borderLeft: `4px solid ${m.color || 'var(--border)'}` }}>
            <Link href={`/builder/${m.id}`} style={{ textDecoration: 'none', color: 'var(--fg)' }}>
              <h3 style={{ margin: 0 }}>
                {m.icon ?? '📦'} {m.name}
              </h3>
              <code className="muted">{m.key}</code>
              {m.description && <p className="muted" style={{ margin: '0.3rem 0 0', fontSize: '0.85rem' }}>{m.description}</p>}
            </Link>
            <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.2rem' }}>
              <button className="mini" onClick={() => openEdit(m)}>Editar</button>
              <button className="mini danger" onClick={() => remove(m)}>Eliminar</button>
            </div>
          </div>
        ))}
        {modules.length === 0 && !error && <p className="muted">Aún no hay módulos. Créalos aquí, pídeselos a la IA, o instala una plantilla.</p>}
      </section>

      <TemplatesPanel onApplied={load} />
      <VersionsPanel />

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
        .mini.danger {
          color: #f87171;
          border-color: #7f1d1d;
        }
      `}</style>
    </div>
  );
}
