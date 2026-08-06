'use client';

import { use, useEffect, useState } from 'react';
import Link from 'next/link';
import { getClient } from '../../../../lib/crms';

interface Field {
  id: string;
  key: string;
  name: string;
  type: string;
  required: boolean;
}

const FIELD_TYPES = ['text_short', 'text_long', 'integer', 'decimal', 'currency', 'date', 'datetime', 'email', 'phone', 'url', 'boolean', 'select', 'status', 'user'];

/** Module detail: fields list + add field (PRD §11). */
export default function ModulePage({ params }: { params: Promise<{ moduleId: string }> }) {
  const { moduleId } = use(params);
  const [fields, setFields] = useState<Field[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({ key: '', name: '', type: 'text_short', required: false });

  async function load() {
    try {
      setFields(await getClient().request<Field[]>('GET', `/modules/${moduleId}/fields`));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error');
    }
  }
  useEffect(() => {
    load();
  }, [moduleId]);

  async function addField(e: React.FormEvent) {
    e.preventDefault();
    try {
      const config = form.type === 'select' || form.type === 'status' ? { options: [{ value: 'a', label: 'A' }, { value: 'b', label: 'B' }] } : {};
      await getClient().modules.createField(moduleId, { ...form, config });
      setForm({ key: '', name: '', type: 'text_short', required: false });
      await load();
    } catch (e2) {
      setError(e2 instanceof Error ? e2.message : 'Error');
    }
  }

  return (
    <div style={{ display: 'grid', gap: '1.25rem' }}>
      <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <Link href="/builder" className="muted" style={{ textDecoration: 'none' }}>
            ← Módulos
          </Link>
          <h1 style={{ margin: '0.3rem 0 0' }}>Campos</h1>
        </div>
        <Link className="btn" href={`/data/${moduleId}`}>
          Ver datos →
        </Link>
      </header>

      {error && <div className="card" style={{ borderColor: '#7f1d1d', color: '#f87171' }}>{error}</div>}

      <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ textAlign: 'left', color: 'var(--muted)' }}>
              <th style={{ padding: '0.6rem 0.9rem' }}>Nombre</th>
              <th>Clave</th>
              <th>Tipo</th>
              <th>Requerido</th>
            </tr>
          </thead>
          <tbody>
            {fields.map((f) => (
              <tr key={f.id} style={{ borderTop: '1px solid var(--border)' }}>
                <td style={{ padding: '0.6rem 0.9rem' }}>{f.name}</td>
                <td>
                  <code className="muted">{f.key}</code>
                </td>
                <td>
                  <span className="badge">{f.type}</span>
                </td>
                <td>{f.required ? 'Sí' : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <form onSubmit={addField} className="card" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr auto auto auto', gap: '0.6rem', alignItems: 'end' }}>
        <label>
          Nombre
          <input className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
        </label>
        <label>
          Clave
          <input className="input" value={form.key} onChange={(e) => setForm({ ...form, key: e.target.value })} required />
        </label>
        <label>
          Tipo
          <select className="input" value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}>
            {FIELD_TYPES.map((t) => (
              <option key={t}>{t}</option>
            ))}
          </select>
        </label>
        <label style={{ display: 'flex', gap: '0.4rem', alignItems: 'center' }}>
          <input type="checkbox" checked={form.required} onChange={(e) => setForm({ ...form, required: e.target.checked })} /> Req.
        </label>
        <button className="btn">+ Campo</button>
      </form>
    </div>
  );
}
