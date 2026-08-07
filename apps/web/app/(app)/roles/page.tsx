'use client';

import { useEffect, useState } from 'react';
import { getClient } from '../../../lib/crms';

interface Role {
  id: string;
  name: string;
  description?: string | null;
  permissions: string[];
  isSystem?: boolean;
}

// Curated grants (format: action:resourceType[/scope]).
const PRESETS: Array<[string, string]> = [
  ['view:record/all', 'Ver registros (todos)'],
  ['view:record/own', 'Ver registros (propios)'],
  ['create:record', 'Crear registros'],
  ['edit:record/all', 'Editar registros (todos)'],
  ['edit:record/own', 'Editar registros (propios)'],
  ['delete:record', 'Eliminar registros'],
  ['export:record', 'Exportar'],
  ['import:record', 'Importar'],
  ['assign:record', 'Asignar'],
  ['approve:record', 'Aprobar'],
  ['view:dashboard', 'Ver dashboards'],
  ['execute_ai:application', 'Usar IA'],
  ['execute_automation:automation', 'Ejecutar automatizaciones'],
  ['manage_credentials:credential', 'Gestionar credenciales'],
  ['manage_config:application', 'Configurar la aplicación (admin)'],
];

const emptyForm = { name: '', description: '', permissions: [] as string[] };

export default function RolesPage() {
  const [roles, setRoles] = useState<Role[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState(emptyForm);

  async function load() {
    try {
      setRoles((await getClient().roles.list()) as unknown as Role[]);
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
  function openEdit(r: Role) {
    setForm({ name: r.name, description: r.description ?? '', permissions: r.permissions ?? [] });
    setEditingId(r.id);
  }
  function toggle(grant: string) {
    setForm((f) => ({ ...f, permissions: f.permissions.includes(grant) ? f.permissions.filter((p) => p !== grant) : [...f.permissions, grant] }));
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    try {
      if (editingId === 'new') await getClient().roles.create(form);
      else if (editingId) await getClient().roles.update(editingId, form);
      setForm(emptyForm);
      setEditingId(null);
      await load();
    } catch (e2) {
      setError(e2 instanceof Error ? e2.message : 'Error');
    }
  }
  async function remove(r: Role) {
    if (!confirm(`¿Eliminar el rol "${r.name}"?`)) return;
    try {
      await getClient().roles.remove(r.id);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error');
    }
  }

  return (
    <div style={{ display: 'grid', gap: '1.25rem', maxWidth: 820 }}>
      <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <span className="badge">Seguridad</span>
          <h1 style={{ margin: '0.4rem 0 0' }}>Roles y permisos</h1>
        </div>
        <button className="btn" onClick={editingId === 'new' ? () => setEditingId(null) : openNew}>
          {editingId === 'new' ? 'Cancelar' : '+ Rol'}
        </button>
      </header>

      {error && <div className="card" style={{ borderColor: '#7f1d1d', color: '#f87171' }}>{error}</div>}

      {editingId && (
        <form onSubmit={save} className="card" style={{ display: 'grid', gap: '0.7rem' }}>
          <h3 style={{ margin: 0 }}>{editingId === 'new' ? 'Nuevo rol' : 'Editar rol'}</h3>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: '0.7rem' }}>
            <label>
              Nombre
              <input className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
            </label>
            <label>
              Descripción
              <input className="input" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
            </label>
          </div>
          <div>
            <strong style={{ fontSize: '0.9rem' }}>Permisos</strong>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(230px,1fr))', gap: '0.3rem', marginTop: '0.4rem' }}>
              {PRESETS.map(([grant, label]) => (
                <label key={grant} style={{ display: 'flex', gap: '0.4rem', alignItems: 'center', fontSize: '0.9rem' }}>
                  <input type="checkbox" checked={form.permissions.includes(grant)} onChange={() => toggle(grant)} /> {label}
                </label>
              ))}
            </div>
          </div>
          <button className="btn">{editingId === 'new' ? 'Crear rol' : 'Guardar'}</button>
        </form>
      )}

      <section style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(240px,1fr))', gap: '0.8rem' }}>
        {roles.map((r) => (
          <div key={r.id} className="card" style={{ display: 'grid', gap: '0.4rem' }}>
            <h3 style={{ margin: 0 }}>{r.name}</h3>
            {r.description && <p className="muted" style={{ margin: 0, fontSize: '0.85rem' }}>{r.description}</p>}
            <div className="muted" style={{ fontSize: '0.8rem' }}>{(r.permissions ?? []).length} permiso(s)</div>
            {!r.isSystem && (
              <div style={{ display: 'flex', gap: '0.5rem' }}>
                <button className="mini" onClick={() => openEdit(r)}>Editar</button>
                <button className="mini danger" onClick={() => remove(r)}>Eliminar</button>
              </div>
            )}
          </div>
        ))}
        {roles.length === 0 && <p className="muted">Sin roles. Crea roles como &quot;Vendedor&quot; o &quot;Gerente&quot;.</p>}
      </section>

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
