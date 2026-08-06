'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { getClient } from '../../../lib/crms';

export default function DataIndex() {
  const [modules, setModules] = useState<Array<{ id: string; key: string; name: string }>>([]);
  useEffect(() => {
    getClient().modules.list().then(setModules).catch(() => {});
  }, []);
  return (
    <div style={{ display: 'grid', gap: '1.25rem' }}>
      <h1 style={{ margin: 0 }}>Datos</h1>
      <p className="muted">Elige un módulo para ver y capturar registros.</p>
      <section style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(220px,1fr))', gap: '1rem' }}>
        {modules.map((m) => (
          <Link key={m.id} href={`/data/${m.id}`} className="card" style={{ textDecoration: 'none', color: 'var(--fg)' }}>
            <h3 style={{ marginTop: 0 }}>📦 {m.name}</h3>
            <code className="muted">{m.key}</code>
          </Link>
        ))}
      </section>
    </div>
  );
}
