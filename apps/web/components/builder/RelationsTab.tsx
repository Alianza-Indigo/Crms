'use client';

import { useCallback, useEffect, useState } from 'react';
import { getClient } from '../../lib/crms';

interface ModuleRef {
  id: string;
  name: string;
}
interface Relation {
  id: string;
  key: string;
  name: string;
  type: string;
  sourceModuleId: string;
  targetModuleId: string;
  onDelete: string;
}

const REL_TYPES = ['one_to_one', 'one_to_many', 'many_to_many', 'hierarchical', 'self'];
const ON_DELETE = ['restrict', 'cascade', 'set_null', 'unlink'];

export function RelationsTab({ moduleId, modules }: { moduleId: string; modules: ModuleRef[] }) {
  const [relations, setRelations] = useState<Relation[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ key: '', name: '', type: 'one_to_many', targetModuleId: '', onDelete: 'restrict' });
  const nameOf = (id: string) => modules.find((m) => m.id === id)?.name ?? id;

  const load = useCallback(async () => {
    try {
      const all = (await getClient().relations.list()) as unknown as Relation[];
      setRelations(all.filter((r) => r.sourceModuleId === moduleId || r.targetModuleId === moduleId));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error');
    }
  }, [moduleId]);
  useEffect(() => {
    load();
  }, [load]);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    try {
      await getClient().relations.create({
        key: form.key,
        name: form.name,
        type: form.type,
        sourceModuleId: moduleId,
        targetModuleId: form.type === 'self' ? moduleId : form.targetModuleId,
        onDelete: form.onDelete,
      });
      setForm({ key: '', name: '', type: 'one_to_many', targetModuleId: '', onDelete: 'restrict' });
      setOpen(false);
      await load();
    } catch (e2) {
      setError(e2 instanceof Error ? e2.message : 'Error');
    }
  }

  async function remove(r: Relation) {
    if (!confirm(`¿Eliminar la relación "${r.name}"?`)) return;
    try {
      await getClient().relations.remove(r.id);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error');
    }
  }

  return (
    <div style={{ display: 'grid', gap: '1rem' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <p className="muted" style={{ margin: 0 }}>{relations.length} relación(es).</p>
        <button className="btn" onClick={() => setOpen((v) => !v)}>{open ? 'Cancelar' : '+ Relación'}</button>
      </div>
      {error && <div className="card" style={{ borderColor: '#7f1d1d', color: '#f87171' }}>{error}</div>}

      <div className="card" style={{ padding: 0, overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 560 }}>
          <thead>
            <tr style={{ textAlign: 'left', color: 'var(--muted)' }}>
              <th style={{ padding: '0.6rem 0.9rem' }}>Nombre</th>
              <th>Tipo</th>
              <th>Destino</th>
              <th>Al borrar</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {relations.map((r) => (
              <tr key={r.id} style={{ borderTop: '1px solid var(--border)' }}>
                <td style={{ padding: '0.55rem 0.9rem' }}>{r.name}</td>
                <td>
                  <span className="badge">{r.type}</span>
                </td>
                <td>{nameOf(r.targetModuleId)}</td>
                <td>{r.onDelete}</td>
                <td style={{ textAlign: 'right', paddingRight: '0.9rem' }}>
                  <button className="mini danger" onClick={() => remove(r)}>Eliminar</button>
                </td>
              </tr>
            ))}
            {relations.length === 0 && (
              <tr>
                <td colSpan={5} className="muted" style={{ padding: '1rem 0.9rem' }}>
                  Sin relaciones.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {open && (
        <form onSubmit={create} className="card" style={{ display: 'grid', gap: '0.7rem', maxWidth: 560 }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.7rem' }}>
            <label>
              Nombre
              <input className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
            </label>
            <label>
              Clave
              <input className="input" value={form.key} onChange={(e) => setForm({ ...form, key: e.target.value })} placeholder="cliente" required />
            </label>
          </div>
          <label>
            Tipo
            <select className="input" value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}>
              {REL_TYPES.map((t) => (
                <option key={t}>{t}</option>
              ))}
            </select>
          </label>
          {form.type !== 'self' && (
            <label>
              Módulo destino
              <select className="input" value={form.targetModuleId} onChange={(e) => setForm({ ...form, targetModuleId: e.target.value })} required>
                <option value="">Elige…</option>
                {modules.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                  </option>
                ))}
              </select>
            </label>
          )}
          <label>
            Al borrar el registro relacionado
            <select className="input" value={form.onDelete} onChange={(e) => setForm({ ...form, onDelete: e.target.value })}>
              {ON_DELETE.map((o) => (
                <option key={o}>{o}</option>
              ))}
            </select>
          </label>
          <button className="btn">Crear relación</button>
        </form>
      )}
      <style jsx>{`
        .mini {
          background: transparent;
          border: 1px solid var(--border);
          border-radius: 6px;
          padding: 0.2rem 0.5rem;
          cursor: pointer;
          font-size: 0.8rem;
        }
        .mini.danger {
          color: #f87171;
          border-color: #7f1d1d;
        }
      `}</style>
    </div>
  );
}
