'use client';

import { useCallback, useEffect, useState } from 'react';
import { getClient } from '../../lib/crms';

interface FieldRef {
  id: string;
  key: string;
  name: string;
}
interface Form {
  id: string;
  key: string;
  name: string;
  kind: string;
  publicSlug?: string | null;
}

export function FormsTab({ moduleId, fields }: { moduleId: string; fields: FieldRef[] }) {
  const [forms, setForms] = useState<Form[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ key: '', name: '', kind: 'internal', publicSlug: '', fieldIds: [] as string[] });

  const load = useCallback(async () => {
    try {
      const all = (await getClient().forms.list()) as unknown as Array<Form & { moduleId?: string }>;
      setForms(all.filter((f) => !f.moduleId || f.moduleId === moduleId));
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
      await getClient().forms.create({
        moduleId,
        key: form.key,
        name: form.name,
        kind: form.kind,
        publicSlug: form.kind === 'public' && form.publicSlug ? form.publicSlug : undefined,
        fields: form.fieldIds.map((id) => ({ fieldId: id })),
      });
      setForm({ key: '', name: '', kind: 'internal', publicSlug: '', fieldIds: [] });
      setOpen(false);
      await load();
    } catch (e2) {
      setError(e2 instanceof Error ? e2.message : 'Error');
    }
  }

  return (
    <div style={{ display: 'grid', gap: '1rem' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <p className="muted" style={{ margin: 0 }}>{forms.length} formulario(s).</p>
        <button className="btn" onClick={() => setOpen((v) => !v)}>{open ? 'Cancelar' : '+ Formulario'}</button>
      </div>
      {error && <div className="card" style={{ borderColor: '#7f1d1d', color: '#f87171' }}>{error}</div>}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(220px,1fr))', gap: '0.8rem' }}>
        {forms.map((f) => (
          <div key={f.id} className="card">
            <h3 style={{ margin: '0 0 0.2rem' }}>{f.name}</h3>
            <span className="badge">{f.kind}</span>
            {f.publicSlug && (
              <div className="muted" style={{ fontSize: '0.8rem', marginTop: '0.4rem' }}>
                Público: <code>/f/{f.publicSlug}</code>
              </div>
            )}
          </div>
        ))}
        {forms.length === 0 && <p className="muted">Sin formularios.</p>}
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
              <input className="input" value={form.key} onChange={(e) => setForm({ ...form, key: e.target.value })} placeholder="alta_lead" required />
            </label>
          </div>
          <label>
            Tipo
            <select className="input" value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value })}>
              {['internal', 'public', 'embed', 'portal', 'multi_step', 'survey'].map((k) => (
                <option key={k}>{k}</option>
              ))}
            </select>
          </label>
          {form.kind === 'public' && (
            <label>
              Slug público
              <input className="input" value={form.publicSlug} onChange={(e) => setForm({ ...form, publicSlug: e.target.value })} placeholder="contacto" />
            </label>
          )}
          <label>
            Campos del formulario
            <select
              className="input"
              multiple
              value={form.fieldIds}
              onChange={(e) => setForm({ ...form, fieldIds: Array.from(e.target.selectedOptions).map((o) => o.value) })}
              style={{ minHeight: 120 }}
            >
              {fields.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.name}
                </option>
              ))}
            </select>
          </label>
          <button className="btn">Crear formulario</button>
        </form>
      )}
    </div>
  );
}
