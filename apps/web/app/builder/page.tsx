'use client';

import { useEffect, useState } from 'react';
import { api } from '../../lib/api';

interface ModuleDef {
  id: string;
  key: string;
  name: string;
  icon?: string | null;
}

/**
 * Builder shell (PRD §43.2). Lists the application's modules from the API. In a
 * full deployment this becomes the visual editor for modules/fields/views/etc.;
 * here it demonstrates the end-to-end authenticated, tenant-scoped data path.
 */
export default function BuilderPage() {
  const [modules, setModules] = useState<ModuleDef[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api<ModuleDef[]>('/modules')
      .then(setModules)
      .catch((e) => setError(e instanceof Error ? e.message : 'Error'))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="container grid" style={{ gap: '1.5rem' }}>
      <header>
        <span className="badge">Centro de construcción</span>
        <h1 style={{ margin: '0.5rem 0' }}>Módulos</h1>
        <p className="muted">Cada módulo es una entidad configurable de tu aplicación.</p>
      </header>

      {loading && <p className="muted">Cargando…</p>}
      {error && (
        <div className="card" style={{ borderColor: '#7f1d1d' }}>
          <p style={{ margin: 0, color: '#f87171' }}>{error}</p>
          <p className="muted" style={{ marginBottom: 0 }}>
            Inicia sesión y crea una organización para empezar.
          </p>
        </div>
      )}

      <section className="grid" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))' }}>
        {modules.map((m) => (
          <div key={m.id} className="card">
            <h3 style={{ marginTop: 0 }}>
              {m.icon ?? '📦'} {m.name}
            </h3>
            <code className="muted">{m.key}</code>
          </div>
        ))}
        {!loading && !error && modules.length === 0 && (
          <p className="muted">Aún no hay módulos. Créalos por IA o con el constructor visual.</p>
        )}
      </section>
    </div>
  );
}
