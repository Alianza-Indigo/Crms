'use client';

import { useCallback, useEffect, useState } from 'react';
import { getClient } from '../../lib/crms';

interface FieldRef {
  id: string;
  name: string;
  type: string;
}
interface Stage {
  key: string;
  name: string;
}
interface Pipeline {
  id: string;
  key: string;
  name: string;
  stages: Stage[];
}

export function PipelinesTab({ moduleId, fields }: { moduleId: string; fields: FieldRef[] }) {
  const [pipelines, setPipelines] = useState<Pipeline[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ key: '', name: '', stageFieldId: '', stages: [{ key: 'nuevo', name: 'Nuevo' }] as Stage[] });
  const statusFields = fields.filter((f) => f.type === 'status' || f.type === 'select');

  const load = useCallback(async () => {
    try {
      setPipelines((await getClient().pipelines.list(moduleId)) as unknown as Pipeline[]);
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
      const stages = form.stages.filter((s) => s.key.trim());
      await getClient().pipelines.create({
        moduleId,
        key: form.key,
        name: form.name,
        stageFieldId: form.stageFieldId || undefined,
        stages,
        transitions: stages.flatMap((s, i) => (stages[i + 1] ? [{ from: s.key, to: stages[i + 1]!.key }] : [])),
      });
      setForm({ key: '', name: '', stageFieldId: '', stages: [{ key: 'nuevo', name: 'Nuevo' }] });
      setOpen(false);
      await load();
    } catch (e2) {
      setError(e2 instanceof Error ? e2.message : 'Error');
    }
  }

  return (
    <div style={{ display: 'grid', gap: '1rem' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <p className="muted" style={{ margin: 0 }}>{pipelines.length} pipeline(s).</p>
        <button className="btn" onClick={() => setOpen((v) => !v)}>{open ? 'Cancelar' : '+ Pipeline'}</button>
      </div>
      {error && <div className="card" style={{ borderColor: '#7f1d1d', color: '#f87171' }}>{error}</div>}

      <div style={{ display: 'grid', gap: '0.8rem' }}>
        {pipelines.map((p) => (
          <div key={p.id} className="card">
            <h3 style={{ margin: '0 0 0.4rem' }}>{p.name}</h3>
            <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap' }}>
              {(p.stages ?? []).map((s, i) => (
                <span key={s.key} className="badge">
                  {i + 1}. {s.name}
                </span>
              ))}
            </div>
          </div>
        ))}
        {pipelines.length === 0 && <p className="muted">Sin pipelines. Define etapas para vender/dar seguimiento por fases.</p>}
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
              <input className="input" value={form.key} onChange={(e) => setForm({ ...form, key: e.target.value })} placeholder="ventas" required />
            </label>
          </div>
          <label>
            Campo de etapa (status/select) — opcional
            <select className="input" value={form.stageFieldId} onChange={(e) => setForm({ ...form, stageFieldId: e.target.value })}>
              <option value="">Ninguno</option>
              {statusFields.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.name}
                </option>
              ))}
            </select>
          </label>
          <div className="card" style={{ display: 'grid', gap: '0.4rem' }}>
            <strong style={{ fontSize: '0.9rem' }}>Etapas</strong>
            {form.stages.map((s, i) => (
              <div key={i} style={{ display: 'grid', gridTemplateColumns: '1fr 1fr auto', gap: '0.4rem' }}>
                <input
                  className="input"
                  placeholder="clave"
                  value={s.key}
                  onChange={(e) => setForm({ ...form, stages: form.stages.map((x, j) => (j === i ? { ...x, key: e.target.value } : x)) })}
                />
                <input
                  className="input"
                  placeholder="Nombre"
                  value={s.name}
                  onChange={(e) => setForm({ ...form, stages: form.stages.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)) })}
                />
                <button type="button" className="btn ghost" onClick={() => setForm({ ...form, stages: form.stages.filter((_, j) => j !== i) })}>
                  ✕
                </button>
              </div>
            ))}
            <button type="button" className="btn ghost" onClick={() => setForm({ ...form, stages: [...form.stages, { key: '', name: '' }] })}>
              + Etapa
            </button>
          </div>
          <button className="btn">Crear pipeline</button>
        </form>
      )}
      <style jsx>{`
        .btn.ghost {
          background: transparent;
          border: 1px solid var(--border);
          color: var(--muted);
        }
      `}</style>
    </div>
  );
}
