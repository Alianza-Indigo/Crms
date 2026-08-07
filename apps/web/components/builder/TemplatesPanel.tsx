'use client';

import { useEffect, useState } from 'react';
import { getClient } from '../../lib/crms';

interface Template {
  key: string;
  name: string;
  description: string;
  modules: number;
}

/** Official templates (PRD §45): instantiate a ready-made app in one click. */
export function TemplatesPanel({ onApplied }: { onApplied?: () => void }) {
  const [templates, setTemplates] = useState<Template[]>([]);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);

  useEffect(() => {
    getClient().templates.list().then(setTemplates).catch(() => {});
  }, []);

  async function apply(t: Template) {
    if (!confirm(`Instalar la plantilla "${t.name}"? Crea sus módulos, vistas, pipeline y dashboard en esta aplicación.`)) return;
    setBusy(t.key);
    setError(null);
    setStatus(null);
    try {
      const res = await getClient().templates.apply(t.key);
      setStatus(`Plantilla "${t.name}" instalada (${res.applied} operaciones).`);
      onApplied?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error');
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="card" style={{ display: 'grid', gap: '0.7rem' }}>
      <button
        onClick={() => setOpen((v) => !v)}
        style={{ background: 'transparent', border: 'none', color: 'var(--fg)', cursor: 'pointer', textAlign: 'left', fontWeight: 700, fontSize: '1rem', padding: 0, display: 'flex', justifyContent: 'space-between' }}
      >
        <span>📦 Plantillas oficiales</span>
        <span className="muted">{open ? '–' : '+'}</span>
      </button>
      {open && (
        <>
          {error && <div style={{ color: '#f87171', fontSize: '0.9rem' }}>{error}</div>}
          {status && <div style={{ color: '#4ade80', fontSize: '0.9rem' }}>{status}</div>}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(230px,1fr))', gap: '0.7rem' }}>
            {templates.map((t) => (
              <div key={t.key} className="card" style={{ background: 'var(--bg)', display: 'grid', gap: '0.4rem' }}>
                <strong>{t.name}</strong>
                <span className="muted" style={{ fontSize: '0.83rem' }}>{t.description}</span>
                <span className="muted" style={{ fontSize: '0.75rem' }}>{t.modules} módulos</span>
                <button className="btn" disabled={busy === t.key} onClick={() => apply(t)} style={{ justifySelf: 'start' }}>
                  {busy === t.key ? 'Instalando…' : 'Instalar'}
                </button>
              </div>
            ))}
            {templates.length === 0 && <p className="muted">Cargando plantillas…</p>}
          </div>
        </>
      )}
    </div>
  );
}
