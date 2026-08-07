'use client';

import { useEffect, useState } from 'react';
import { getClient } from '../../../lib/crms';

interface ModuleRef {
  id: string;
  name: string;
}
interface Automation {
  id: string;
  key: string;
  name: string;
  status: string;
}
interface Run {
  id: string;
  automationId: string;
  status: string;
  createdAt: string;
}

const EVENTS = [
  ['record.created', 'Al crear un registro'],
  ['record.updated', 'Al actualizar un registro'],
  ['record.stage_changed', 'Al cambiar de etapa'],
  ['record.deleted', 'Al eliminar un registro'],
];
const ACTIONS = [
  ['notify', 'Notificar'],
  ['create_record', 'Crear registro'],
  ['update_record', 'Actualizar registro'],
  ['run_ai', 'Ejecutar IA'],
];

export default function AutomationsPage() {
  const [modules, setModules] = useState<ModuleRef[]>([]);
  const [automations, setAutomations] = useState<Automation[]>([]);
  const [runs, setRuns] = useState<Run[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({
    key: '',
    name: '',
    event: 'record.created',
    moduleId: '',
    action: 'notify',
    config: '{\n  "message": "Nuevo registro creado"\n}',
  });

  async function load() {
    try {
      const c = getClient();
      const [a, r, m] = await Promise.all([c.automations.list(), c.automations.runs(), c.modules.list()]);
      setAutomations(a as unknown as Automation[]);
      setRuns(r as unknown as Run[]);
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
      let config: Record<string, unknown> = {};
      try {
        config = JSON.parse(form.config || '{}');
      } catch {
        throw new Error('El config no es JSON válido');
      }
      await getClient().automations.create({
        key: form.key,
        name: form.name,
        status: 'active',
        trigger: { event: form.event, moduleId: form.moduleId || undefined },
        graph: { start: 'a1', nodes: [{ id: 'a1', type: 'action', config: { action: form.action, ...config } }], edges: [] },
      });
      setForm({ ...form, key: '', name: '' });
      setOpen(false);
      await load();
    } catch (e2) {
      setError(e2 instanceof Error ? e2.message : 'Error');
    }
  }

  async function decide(run: Run, decision: 'approved' | 'rejected') {
    try {
      await getClient().automations.approve(run.id, decision);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error');
    }
  }

  const nameOfAuto = (id: string) => automations.find((a) => a.id === id)?.name ?? id;

  return (
    <div style={{ display: 'grid', gap: '1.25rem', maxWidth: 860 }}>
      <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <span className="badge">Automatizaciones</span>
          <h1 style={{ margin: '0.4rem 0 0' }}>Flujos</h1>
        </div>
        <button className="btn" onClick={() => setOpen((v) => !v)}>{open ? 'Cancelar' : '+ Automatización'}</button>
      </header>

      {error && <div className="card" style={{ borderColor: '#7f1d1d', color: '#f87171' }}>{error}</div>}

      <section style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(220px,1fr))', gap: '0.8rem' }}>
        {automations.map((a) => (
          <div key={a.id} className="card">
            <h3 style={{ margin: '0 0 0.2rem' }}>{a.name}</h3>
            <code className="muted">{a.key}</code> <span className="badge">{a.status}</span>
          </div>
        ))}
        {automations.length === 0 && <p className="muted">Sin automatizaciones. Crea una que reaccione a eventos de tus registros.</p>}
      </section>

      {open && (
        <form onSubmit={create} className="card" style={{ display: 'grid', gap: '0.7rem' }}>
          <h3 style={{ margin: 0 }}>Nueva automatización</h3>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.7rem' }}>
            <label>
              Nombre
              <input className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
            </label>
            <label>
              Clave
              <input className="input" value={form.key} onChange={(e) => setForm({ ...form, key: e.target.value })} placeholder="notificar_lead" required />
            </label>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.7rem' }}>
            <label>
              Cuándo (disparador)
              <select className="input" value={form.event} onChange={(e) => setForm({ ...form, event: e.target.value })}>
                {EVENTS.map(([v, l]) => (
                  <option key={v} value={v}>
                    {l}
                  </option>
                ))}
              </select>
            </label>
            <label>
              En el módulo
              <select className="input" value={form.moduleId} onChange={(e) => setForm({ ...form, moduleId: e.target.value })}>
                <option value="">Cualquiera</option>
                {modules.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <label>
            Acción
            <select className="input" value={form.action} onChange={(e) => setForm({ ...form, action: e.target.value })}>
              {ACTIONS.map(([v, l]) => (
                <option key={v} value={v}>
                  {l}
                </option>
              ))}
            </select>
          </label>
          <label>
            Configuración de la acción (JSON)
            <textarea className="input" rows={4} value={form.config} onChange={(e) => setForm({ ...form, config: e.target.value })} />
          </label>
          <button className="btn">Crear automatización</button>
        </form>
      )}

      <section style={{ display: 'grid', gap: '0.5rem' }}>
        <h2 style={{ margin: '0.5rem 0 0', fontSize: '1.1rem' }}>Ejecuciones recientes</h2>
        <div className="card" style={{ padding: 0, overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 520 }}>
            <thead>
              <tr style={{ textAlign: 'left', color: 'var(--muted)' }}>
                <th style={{ padding: '0.6rem 0.9rem' }}>Automatización</th>
                <th>Estado</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {runs.map((r) => (
                <tr key={r.id} style={{ borderTop: '1px solid var(--border)' }}>
                  <td style={{ padding: '0.55rem 0.9rem' }}>{nameOfAuto(r.automationId)}</td>
                  <td>
                    <span className="badge">{r.status}</span>
                  </td>
                  <td style={{ textAlign: 'right', paddingRight: '0.9rem' }}>
                    {r.status === 'awaiting_approval' && (
                      <>
                        <button className="mini" onClick={() => decide(r, 'approved')}>Aprobar</button>{' '}
                        <button className="mini danger" onClick={() => decide(r, 'rejected')}>Rechazar</button>
                      </>
                    )}
                  </td>
                </tr>
              ))}
              {runs.length === 0 && (
                <tr>
                  <td colSpan={3} className="muted" style={{ padding: '1rem 0.9rem' }}>
                    Sin ejecuciones todavía.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      <style jsx>{`
        .mini {
          background: transparent;
          border: 1px solid var(--border);
          color: var(--muted);
          border-radius: 6px;
          padding: 0.2rem 0.55rem;
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
