'use client';

import { useCallback, useEffect, useState } from 'react';
import { getClient } from '../../lib/crms';

interface FieldRef {
  id: string;
  name: string;
}
interface View {
  id: string;
  key: string;
  name: string;
  type: string;
  isDefault?: boolean;
  visibleFieldIds?: string[];
}

const VIEW_TYPES = [
  'table', 'list', 'kanban', 'calendar', 'agenda', 'timeline', 'gantt', 'map',
  'gallery', 'chart', 'cards', 'tree', 'matrix', 'workload', 'form', 'record',
];

export function ViewsTab({ moduleId, fields }: { moduleId: string; fields: FieldRef[] }) {
  const [views, setViews] = useState<View[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ key: '', name: '', type: 'table', isDefault: false, visibleFieldIds: [] as string[] });

  const load = useCallback(async () => {
    try {
      setViews((await getClient().views.list(moduleId)) as unknown as View[]);
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
      await getClient().views.create(moduleId, {
        key: form.key,
        name: form.name,
        type: form.type,
        isDefault: form.isDefault,
        visibleFieldIds: form.visibleFieldIds,
      });
      setForm({ key: '', name: '', type: 'table', isDefault: false, visibleFieldIds: [] });
      setOpen(false);
      await load();
    } catch (e2) {
      setError(e2 instanceof Error ? e2.message : 'Error');
    }
  }

  return (
    <div style={{ display: 'grid', gap: '1rem' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <p className="muted" style={{ margin: 0 }}>{views.length} vista(s).</p>
        <button className="btn" onClick={() => setOpen((v) => !v)}>{open ? 'Cancelar' : '+ Vista'}</button>
      </div>
      {error && <div className="card" style={{ borderColor: '#7f1d1d', color: '#f87171' }}>{error}</div>}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(200px,1fr))', gap: '0.8rem' }}>
        {views.map((v) => (
          <div key={v.id} className="card">
            <h3 style={{ margin: '0 0 0.2rem' }}>{v.name}</h3>
            <span className="badge">{v.type}</span> {v.isDefault && <span className="badge">por defecto</span>}
            <div className="muted" style={{ fontSize: '0.8rem', marginTop: '0.4rem' }}>
              {(v.visibleFieldIds?.length ?? 0)} campos visibles
            </div>
          </div>
        ))}
        {views.length === 0 && <p className="muted">Sin vistas. La vista de Datos usa una tabla por defecto.</p>}
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
              <input className="input" value={form.key} onChange={(e) => setForm({ ...form, key: e.target.value })} placeholder="tabla_principal" required />
            </label>
          </div>
          <label>
            Tipo de vista
            <select className="input" value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}>
              {VIEW_TYPES.map((t) => (
                <option key={t}>{t}</option>
              ))}
            </select>
          </label>
          <label>
            Campos visibles
            <select
              className="input"
              multiple
              value={form.visibleFieldIds}
              onChange={(e) => setForm({ ...form, visibleFieldIds: Array.from(e.target.selectedOptions).map((o) => o.value) })}
              style={{ minHeight: 120 }}
            >
              {fields.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.name}
                </option>
              ))}
            </select>
          </label>
          <label style={{ display: 'flex', gap: '0.4rem', alignItems: 'center' }}>
            <input type="checkbox" checked={form.isDefault} onChange={(e) => setForm({ ...form, isDefault: e.target.checked })} /> Vista por defecto
          </label>
          <button className="btn">Crear vista</button>
        </form>
      )}
    </div>
  );
}
