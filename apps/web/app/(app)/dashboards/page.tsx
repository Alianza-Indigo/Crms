'use client';

import { useEffect, useState } from 'react';
import { getClient } from '../../../lib/crms';

interface Module {
  id: string;
  name: string;
}

/** Dashboards (PRD §22): run a widget aggregation live. */
export default function DashboardsPage() {
  const [modules, setModules] = useState<Module[]>([]);
  const [moduleId, setModuleId] = useState('');
  const [aggregate, setAggregate] = useState('count');
  const [field, setField] = useState('');
  const [groupBy, setGroupBy] = useState('');
  const [result, setResult] = useState<{ metric?: number; series?: Array<{ label: string; value: number }> } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getClient().modules.list().then((m) => {
      setModules(m);
      if (m[0]) setModuleId(m[0].id);
    });
  }, []);

  async function run() {
    try {
      const widget = { key: 'w', type: 'metric', moduleId, aggregate, field: field || undefined, groupBy: groupBy || undefined };
      setResult(await getClient().request('POST', '/dashboards/widget/run', widget));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error');
    }
  }

  const max = result?.series ? Math.max(...result.series.map((s) => s.value), 1) : 1;

  return (
    <div style={{ display: 'grid', gap: '1.25rem', maxWidth: 720 }}>
      <h1 style={{ margin: 0 }}>Dashboards</h1>
      <div className="card" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(140px,1fr)) auto', gap: '0.6rem', alignItems: 'end' }}>
        <label>
          Módulo
          <select className="input" value={moduleId} onChange={(e) => setModuleId(e.target.value)}>
            {modules.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Agregación
          <select className="input" value={aggregate} onChange={(e) => setAggregate(e.target.value)}>
            {['count', 'sum', 'avg'].map((a) => (
              <option key={a}>{a}</option>
            ))}
          </select>
        </label>
        <label>
          Campo (sum/avg)
          <input className="input" value={field} onChange={(e) => setField(e.target.value)} placeholder="value" />
        </label>
        <label>
          Agrupar por
          <input className="input" value={groupBy} onChange={(e) => setGroupBy(e.target.value)} placeholder="stage" />
        </label>
        <button className="btn" onClick={run}>
          Ejecutar
        </button>
      </div>

      {error && <div className="card" style={{ borderColor: '#7f1d1d', color: '#f87171' }}>{error}</div>}

      {result?.metric !== undefined && (
        <div className="card" style={{ textAlign: 'center' }}>
          <div style={{ fontSize: '3rem', fontWeight: 800 }}>{result.metric}</div>
          <div className="muted">{aggregate}</div>
        </div>
      )}
      {result?.series && (
        <div className="card" style={{ display: 'grid', gap: '0.5rem' }}>
          {result.series.map((s) => (
            <div key={s.label} style={{ display: 'grid', gridTemplateColumns: '120px 1fr 40px', alignItems: 'center', gap: '0.5rem' }}>
              <span className="muted" style={{ textTransform: 'capitalize' }}>{s.label}</span>
              <div style={{ background: 'var(--accent)', height: 14, borderRadius: 4, width: `${(s.value / max) * 100}%` }} />
              <span>{s.value}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
