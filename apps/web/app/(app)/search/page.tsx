'use client';

import { useState } from 'react';
import Link from 'next/link';
import { getClient } from '../../../lib/crms';

interface Hit {
  recordId: string;
  moduleId: string;
  title: string | null;
  snippet: string | null;
}

/** Global search (PRD §30). */
export default function SearchPage() {
  const [q, setQ] = useState('');
  const [hits, setHits] = useState<Hit[]>([]);
  const [searched, setSearched] = useState(false);

  async function run(e: React.FormEvent) {
    e.preventDefault();
    const res = await getClient().request<{ hits: Hit[] }>('GET', `/search?q=${encodeURIComponent(q)}`);
    setHits(res.hits);
    setSearched(true);
  }

  return (
    <div style={{ display: 'grid', gap: '1.25rem', maxWidth: 720 }}>
      <h1 style={{ margin: 0 }}>Búsqueda</h1>
      <form onSubmit={run} style={{ display: 'flex', gap: '0.5rem' }}>
        <input className="input" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar registros…" />
        <button className="btn">Buscar</button>
      </form>
      <div style={{ display: 'grid', gap: '0.5rem' }}>
        {hits.map((h) => (
          <Link key={h.recordId} href={`/data/${h.moduleId}`} className="card" style={{ textDecoration: 'none', color: 'var(--fg)' }}>
            <strong>{h.title ?? '(sin título)'}</strong>
            {h.snippet && <p className="muted" style={{ margin: '0.25rem 0 0' }}>…{h.snippet}…</p>}
          </Link>
        ))}
        {searched && hits.length === 0 && <p className="muted">Sin resultados.</p>}
      </div>
    </div>
  );
}
