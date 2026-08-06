'use client';

import { useEffect, useState } from 'react';
import { getClient } from '../../../lib/crms';

interface Module {
  id: string;
  name: string;
}
interface Widget {
  key: string;
  title: string;
  type: 'metric' | 'bar';
  moduleId: string;
  aggregate: string;
  field?: string;
  groupBy?: string;
}
interface Dashboard {
  id: string;
  key: string;
  name: string;
  widgets: Widget[];
}
type WidgetResult = { metric?: number; series?: Array<{ label: string; value: number }> };

/** Dashboards (PRD §22): saved multi-widget dashboards + a live widget builder. */
export default function DashboardsPage() {
  const [modules, setModules] = useState<Module[]>([]);
  const [dashboards, setDashboards] = useState<Dashboard[]>([]);
  const [selected, setSelected] = useState<Dashboard | null>(null);
  const [results, setResults] = useState<Record<string, WidgetResult>>({});
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const [key, setKey] = useState('');
  const [draft, setDraft] = useState<Widget[]>([]);
  const [wf, setWf] = useState<Widget>({ key: '', title: '', type: 'metric', moduleId: '', aggregate: 'count', field: '', groupBy: '' });

  async function loadDashboards() {
    try {
      setDashboards((await getClient().dashboards.list()) as unknown as Dashboard[]);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error');
    }
  }
  useEffect(() => {
    getClient()
      .modules.list()
      .then((m) => {
        setModules(m);
        setWf((w) => ({ ...w, moduleId: m[0]?.id ?? '' }));
      });
    loadDashboards();
  }, []);

  async function open(d: Dashboard) {
    setSelected(d);
    setResults({});
    for (const w of d.widgets ?? []) {
      try {
        const r = await getClient().dashboards.runWidget(w as unknown as Record<string, unknown>);
        setResults((prev) => ({ ...prev, [w.key]: r }));
      } catch {
        /* skip a failing widget */
      }
    }
  }

  function addWidget() {
    if (!wf.moduleId) return;
    const k = wf.key || `w${draft.length + 1}`;
    setDraft([...draft, { ...wf, key: k, title: wf.title || k }]);
    setWf({ ...wf, key: '', title: '', field: '', groupBy: '' });
  }

  async function saveDashboard(e: React.FormEvent) {
    e.preventDefault();
    try {
      await getClient().dashboards.create({ key, name, widgets: draft });
      setCreating(false);
      setName('');
      setKey('');
      setDraft([]);
      await loadDashboards();
    } catch (e2) {
      setError(e2 instanceof Error ? e2.message : 'Error');
    }
  }

  return (
    <div style={{ display: 'grid', gap: '1.25rem', maxWidth: 900 }}>
      <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h1 style={{ margin: 0 }}>Dashboards</h1>
        <button className="btn" onClick={() => setCreating((v) => !v)}>{creating ? 'Cancelar' : '+ Nuevo dashboard'}</button>
      </header>

      {error && <div className="card" style={{ borderColor: '#7f1d1d', color: '#f87171' }}>{error}</div>}

      <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
        {dashboards.map((d) => (
          <button
            key={d.id}
            className="btn"
            style={{ background: selected?.id === d.id ? 'var(--accent)' : 'transparent', border: '1px solid var(--border)', color: selected?.id === d.id ? '#fff' : 'var(--muted)' }}
            onClick={() => open(d)}
          >
            {d.name}
          </button>
        ))}
        {dashboards.length === 0 && <p className="muted">Aún no hay dashboards guardados.</p>}
      </div>

      {selected && (
        <section style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(240px,1fr))', gap: '1rem' }}>
          {(selected.widgets ?? []).map((w) => {
            const r = results[w.key];
            const max = r?.series ? Math.max(...r.series.map((s) => s.value), 1) : 1;
            return (
              <div key={w.key} className="card">
                <div className="muted" style={{ fontSize: '0.85rem', marginBottom: '0.4rem' }}>{w.title}</div>
                {r?.metric !== undefined && <div style={{ fontSize: '2.4rem', fontWeight: 800 }}>{r.metric}</div>}
                {r?.series && (
                  <div style={{ display: 'grid', gap: '0.35rem' }}>
                    {r.series.map((s) => (
                      <div key={s.label} style={{ display: 'grid', gridTemplateColumns: '90px 1fr 34px', alignItems: 'center', gap: '0.4rem' }}>
                        <span className="muted" style={{ fontSize: '0.8rem', textTransform: 'capitalize' }}>{s.label}</span>
                        <div style={{ background: 'var(--accent)', height: 12, borderRadius: 4, width: `${(s.value / max) * 100}%` }} />
                        <span style={{ fontSize: '0.85rem' }}>{s.value}</span>
                      </div>
                    ))}
                  </div>
                )}
                {!r && <div className="muted">…</div>}
              </div>
            );
          })}
        </section>
      )}

      {creating && (
        <form onSubmit={saveDashboard} className="card" style={{ display: 'grid', gap: '0.8rem' }}>
          <h3 style={{ margin: 0 }}>Nuevo dashboard</h3>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.7rem' }}>
            <label>
              Nombre
              <input className="input" value={name} onChange={(e) => setName(e.target.value)} required />
            </label>
            <label>
              Clave
              <input className="input" value={key} onChange={(e) => setKey(e.target.value)} placeholder="ventas" required />
            </label>
          </div>

          <div className="card" style={{ display: 'grid', gap: '0.6rem' }}>
            <strong style={{ fontSize: '0.9rem' }}>Widgets ({draft.length})</strong>
            {draft.map((w) => (
              <div key={w.key} className="muted" style={{ fontSize: '0.85rem' }}>
                • {w.title} — {w.type} / {w.aggregate}
                {w.groupBy ? ` por ${w.groupBy}` : ''}
              </div>
            ))}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(120px,1fr))', gap: '0.5rem', alignItems: 'end' }}>
              <label>
                Título
                <input className="input" value={wf.title} onChange={(e) => setWf({ ...wf, title: e.target.value })} placeholder="Total" />
              </label>
              <label>
                Tipo
                <select className="input" value={wf.type} onChange={(e) => setWf({ ...wf, type: e.target.value as Widget['type'] })}>
                  <option value="metric">métrica</option>
                  <option value="bar">barras</option>
                </select>
              </label>
              <label>
                Módulo
                <select className="input" value={wf.moduleId} onChange={(e) => setWf({ ...wf, moduleId: e.target.value })}>
                  {modules.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Agregación
                <select className="input" value={wf.aggregate} onChange={(e) => setWf({ ...wf, aggregate: e.target.value })}>
                  {['count', 'sum', 'avg'].map((a) => (
                    <option key={a}>{a}</option>
                  ))}
                </select>
              </label>
              <label>
                Campo
                <input className="input" value={wf.field} onChange={(e) => setWf({ ...wf, field: e.target.value })} placeholder="monto" />
              </label>
              <label>
                Agrupar por
                <input className="input" value={wf.groupBy} onChange={(e) => setWf({ ...wf, groupBy: e.target.value })} placeholder="etapa" />
              </label>
              <button type="button" className="btn" onClick={addWidget}>
                + Agregar widget
              </button>
            </div>
          </div>

          <button className="btn" disabled={draft.length === 0}>
            Guardar dashboard
          </button>
        </form>
      )}
    </div>
  );
}
