'use client';

import { use, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { getClient } from '../../../../lib/crms';

interface Field {
  id: string;
  key: string;
  name: string;
  type: string;
  config?: { options?: Array<{ value: string; label?: string }> };
}
interface Record_ {
  id: string;
  displayTitle: string | null;
  stage: string | null;
  data: Record<string, unknown>;
}

/** Records screen: table + kanban toggle + create record (PRD §12, §13). */
export default function DataPage({ params }: { params: Promise<{ moduleId: string }> }) {
  const { moduleId } = use(params);
  const [fields, setFields] = useState<Field[]>([]);
  const [records, setRecords] = useState<Record_[]>([]);
  const [view, setView] = useState<'table' | 'kanban'>('table');
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [open, setOpen] = useState(false);

  const stageField = useMemo(() => fields.find((f) => f.type === 'status' || f.key === 'stage'), [fields]);

  async function load() {
    try {
      const c = getClient();
      setFields(await c.request<Field[]>('GET', `/modules/${moduleId}/fields`));
      const page = await c.records.query(moduleId, { limit: 100 });
      setRecords(page.items as unknown as Record_[]);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error');
    }
  }
  useEffect(() => {
    load();
  }, [moduleId]);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    try {
      const data: Record<string, unknown> = {};
      for (const f of fields) {
        const v = draft[f.key];
        if (v !== undefined && v !== '') data[f.key] = ['integer', 'decimal', 'currency'].includes(f.type) ? Number(v) : v;
      }
      await getClient().records.create(moduleId, data);
      setDraft({});
      setOpen(false);
      await load();
    } catch (e2) {
      setError(e2 instanceof Error ? e2.message : 'Error');
    }
  }

  const columns = fields.slice(0, 5);
  const groups = useMemo(() => {
    if (!stageField) return [];
    const map = new Map<string, Record_[]>();
    const options = stageField.config?.options?.map((o) => o.value) ?? [];
    for (const opt of options) map.set(opt, []);
    for (const r of records) {
      const key = String(r.stage ?? r.data[stageField.key] ?? 'sin etapa');
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(r);
    }
    return [...map.entries()];
  }, [records, stageField]);

  return (
    <div style={{ display: 'grid', gap: '1.25rem' }}>
      <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <Link href={`/builder/${moduleId}`} className="muted" style={{ textDecoration: 'none' }}>
          ← Campos
        </Link>
        <div style={{ display: 'flex', gap: '0.5rem' }}>
          <button className="btn" style={{ background: view === 'table' ? 'var(--accent)' : 'transparent', border: '1px solid var(--border)' }} onClick={() => setView('table')}>
            Tabla
          </button>
          {stageField && (
            <button className="btn" style={{ background: view === 'kanban' ? 'var(--accent)' : 'transparent', border: '1px solid var(--border)' }} onClick={() => setView('kanban')}>
              Kanban
            </button>
          )}
          <button className="btn" onClick={() => setOpen((v) => !v)}>
            {open ? 'Cancelar' : '+ Registro'}
          </button>
        </div>
      </header>

      {error && <div className="card" style={{ borderColor: '#7f1d1d', color: '#f87171' }}>{error}</div>}

      {open && (
        <form onSubmit={create} className="card" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(180px,1fr))', gap: '0.6rem' }}>
          {fields.map((f) => (
            <label key={f.id}>
              {f.name}
              {f.config?.options ? (
                <select className="input" value={draft[f.key] ?? ''} onChange={(e) => setDraft({ ...draft, [f.key]: e.target.value })}>
                  <option value="">—</option>
                  {f.config.options.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label ?? o.value}
                    </option>
                  ))}
                </select>
              ) : (
                <input className="input" value={draft[f.key] ?? ''} onChange={(e) => setDraft({ ...draft, [f.key]: e.target.value })} />
              )}
            </label>
          ))}
          <button className="btn" style={{ alignSelf: 'end' }}>Guardar</button>
        </form>
      )}

      {view === 'table' && (
        <div className="card" style={{ padding: 0, overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ textAlign: 'left', color: 'var(--muted)' }}>
                <th style={{ padding: '0.6rem 0.9rem' }}>Título</th>
                {columns.map((c) => (
                  <th key={c.id}>{c.name}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {records.map((r) => (
                <tr key={r.id} style={{ borderTop: '1px solid var(--border)' }}>
                  <td style={{ padding: '0.6rem 0.9rem' }}>{r.displayTitle ?? '—'}</td>
                  {columns.map((c) => (
                    <td key={c.id}>{String(r.data[c.key] ?? '')}</td>
                  ))}
                </tr>
              ))}
              {records.length === 0 && (
                <tr>
                  <td className="muted" style={{ padding: '0.9rem' }} colSpan={columns.length + 1}>
                    Sin registros todavía.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {view === 'kanban' && stageField && (
        <div style={{ display: 'grid', gridAutoFlow: 'column', gridAutoColumns: 'minmax(240px,1fr)', gap: '1rem', overflowX: 'auto' }}>
          {groups.map(([stage, items]) => (
            <div key={stage} className="card" style={{ background: 'var(--bg)' }}>
              <h4 style={{ marginTop: 0, textTransform: 'capitalize' }}>
                {stage} <span className="badge">{items.length}</span>
              </h4>
              <div style={{ display: 'grid', gap: '0.5rem' }}>
                {items.map((r) => (
                  <div key={r.id} className="card" style={{ padding: '0.65rem 0.8rem' }}>
                    {r.displayTitle ?? '—'}
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
