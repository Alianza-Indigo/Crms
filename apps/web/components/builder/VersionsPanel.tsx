'use client';

import { useCallback, useEffect, useState } from 'react';
import { getClient, getActiveApp } from '../../lib/crms';

interface Version {
  id: string;
  version: string;
  environment: string;
  changelog?: string | null;
  publishedAt: string;
}

/** Publish + history + rollback of the app schema (PRD §8.4). */
export function VersionsPanel() {
  const [appId, setAppId] = useState<string | null>(null);
  const [versions, setVersions] = useState<Version[]>([]);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ver, setVer] = useState('');
  const [changelog, setChangelog] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async (id: string) => {
    try {
      setVersions((await getClient().applications.versions(id)) as unknown as Version[]);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error');
    }
  }, []);

  useEffect(() => {
    const id = getActiveApp().applicationId;
    setAppId(id);
    if (id) load(id);
  }, [load]);

  async function publish(e: React.FormEvent) {
    e.preventDefault();
    if (!appId) return;
    setBusy(true);
    try {
      await getClient().applications.publish(ver, changelog || undefined);
      setVer('');
      setChangelog('');
      await load(appId);
    } catch (e2) {
      setError(e2 instanceof Error ? e2.message : 'Error');
    } finally {
      setBusy(false);
    }
  }

  async function rollback(v: Version) {
    if (!appId) return;
    if (!confirm(`¿Revertir el entorno a la versión ${v.version}? Reemplaza el esquema actual.`)) return;
    try {
      await getClient().applications.rollback(appId, v.version);
      await load(appId);
      alert(`Revertido a ${v.version}.`);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error');
    }
  }

  return (
    <div className="card" style={{ display: 'grid', gap: '0.7rem' }}>
      <button
        onClick={() => setOpen((v) => !v)}
        style={{ background: 'transparent', border: 'none', color: 'var(--fg)', cursor: 'pointer', textAlign: 'left', fontWeight: 700, fontSize: '1rem', padding: 0, display: 'flex', justifyContent: 'space-between' }}
      >
        <span>🏷️ Versiones y publicación</span>
        <span className="muted">{open ? '–' : '+'}</span>
      </button>

      {open && (
        <>
          {error && <div style={{ color: '#f87171', fontSize: '0.9rem' }}>{error}</div>}
          <form onSubmit={publish} style={{ display: 'grid', gridTemplateColumns: '1fr 2fr auto', gap: '0.5rem', alignItems: 'end' }}>
            <label>
              Versión
              <input className="input" value={ver} onChange={(e) => setVer(e.target.value)} placeholder="1.0.0" required />
            </label>
            <label>
              Notas (changelog)
              <input className="input" value={changelog} onChange={(e) => setChangelog(e.target.value)} placeholder="Qué cambió" />
            </label>
            <button className="btn" disabled={busy}>{busy ? '…' : 'Publicar'}</button>
          </form>

          <div style={{ display: 'grid', gap: '0.35rem' }}>
            {versions.length === 0 && <p className="muted" style={{ margin: 0 }}>Sin versiones publicadas.</p>}
            {versions.map((v) => (
              <div key={v.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderTop: '1px solid var(--border)', paddingTop: '0.35rem' }}>
                <div>
                  <strong>{v.version}</strong> <span className="badge">{v.environment}</span>
                  {v.changelog && <span className="muted" style={{ marginLeft: '0.5rem', fontSize: '0.85rem' }}>{v.changelog}</span>}
                </div>
                <button
                  onClick={() => rollback(v)}
                  style={{ background: 'transparent', border: '1px solid var(--border)', color: 'var(--muted)', borderRadius: 6, padding: '0.2rem 0.6rem', cursor: 'pointer', fontSize: '0.82rem' }}
                >
                  Revertir
                </button>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
