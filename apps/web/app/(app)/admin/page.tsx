'use client';

import { useEffect, useState } from 'react';
import { getClient } from '../../../lib/crms';

interface Overview {
  tenants: number;
  users: number;
  applications: number;
  tenantsByStatus: Array<{ status: string; count: number }>;
}
interface Tenant {
  id: string;
  name: string;
  slug: string;
  status: string;
  isolationTier: string;
  region: string;
}
interface Reseller {
  id: string;
  name: string;
  slug: string;
}
interface Flag {
  id: string;
  key: string;
  enabled: boolean;
  rolloutPercentage: string;
  tenantId?: string | null;
}

/** Global administration console (PRD §44) — platform admins only. */
export default function AdminPage() {
  const [overview, setOverview] = useState<Overview | null>(null);
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [resellers, setResellers] = useState<Reseller[]>([]);
  const [flags, setFlags] = useState<Flag[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [denied, setDenied] = useState(false);
  const [reseller, setReseller] = useState({ name: '', slug: '' });
  const [flag, setFlag] = useState({ key: '', enabled: true });
  const [impersonateId, setImpersonateId] = useState('');

  async function load() {
    try {
      const c = getClient();
      const [ov, tn, rs, fl] = await Promise.all([c.admin.overview(), c.admin.tenants(), c.admin.resellers(), c.admin.flags()]);
      setOverview(ov);
      setTenants(tn as unknown as Tenant[]);
      setResellers(rs as unknown as Reseller[]);
      setFlags(fl as unknown as Flag[]);
      setError(null);
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Error';
      if (/administrator|forbidden|permission/i.test(msg)) setDenied(true);
      else setError(msg);
    }
  }
  useEffect(() => {
    load();
  }, []);

  async function setTenantStatus(t: Tenant, status: string) {
    try {
      await getClient().admin.setTenantStatus(t.id, status);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error');
    }
  }
  async function createReseller(e: React.FormEvent) {
    e.preventDefault();
    try {
      await getClient().admin.createReseller(reseller.name, reseller.slug);
      setReseller({ name: '', slug: '' });
      await load();
    } catch (e2) {
      setError(e2 instanceof Error ? e2.message : 'Error');
    }
  }
  async function saveFlag(e: React.FormEvent) {
    e.preventDefault();
    try {
      await getClient().admin.setFlag(flag.key, flag.enabled);
      setFlag({ key: '', enabled: true });
      await load();
    } catch (e2) {
      setError(e2 instanceof Error ? e2.message : 'Error');
    }
  }
  async function toggleFlag(f: Flag) {
    try {
      await getClient().admin.setFlag(f.key, !f.enabled, Number(f.rolloutPercentage) || 100);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error');
    }
  }
  async function impersonate(e: React.FormEvent) {
    e.preventDefault();
    try {
      await getClient().admin.impersonate(impersonateId);
      setImpersonateId('');
      alert('Impersonación iniciada. Recarga para ver el banner.');
    } catch (e2) {
      setError(e2 instanceof Error ? e2.message : 'Error');
    }
  }

  if (denied) {
    return (
      <div className="card" style={{ maxWidth: 560 }}>
        <h1 style={{ marginTop: 0 }}>Administración</h1>
        <p className="muted">Esta consola es solo para administradores de la plataforma.</p>
      </div>
    );
  }

  return (
    <div style={{ display: 'grid', gap: '1.5rem', maxWidth: 960 }}>
      <header>
        <span className="badge">Plataforma</span>
        <h1 style={{ margin: '0.4rem 0 0' }}>🛡️ Consola de administración</h1>
      </header>
      {error && <div className="card" style={{ borderColor: '#7f1d1d', color: '#f87171' }}>{error}</div>}

      {overview && (
        <section style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(150px,1fr))', gap: '0.8rem' }}>
          {[
            ['Tenants', overview.tenants],
            ['Usuarios', overview.users],
            ['Aplicaciones', overview.applications],
          ].map(([label, value]) => (
            <div key={label as string} className="card" style={{ textAlign: 'center' }}>
              <div style={{ fontSize: '2.2rem', fontWeight: 800 }}>{value as number}</div>
              <div className="muted">{label as string}</div>
            </div>
          ))}
        </section>
      )}

      {/* Tenants */}
      <section style={{ display: 'grid', gap: '0.5rem' }}>
        <h2 style={{ margin: 0, fontSize: '1.15rem' }}>Tenants</h2>
        <div className="card" style={{ padding: 0, overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 620 }}>
            <thead>
              <tr style={{ textAlign: 'left', color: 'var(--muted)' }}>
                <th style={{ padding: '0.6rem 0.9rem' }}>Nombre</th>
                <th>Tier</th>
                <th>Región</th>
                <th>Estado</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {tenants.map((t) => (
                <tr key={t.id} style={{ borderTop: '1px solid var(--border)' }}>
                  <td style={{ padding: '0.55rem 0.9rem' }}>{t.name} <code className="muted">{t.slug}</code></td>
                  <td>{t.isolationTier}</td>
                  <td>{t.region}</td>
                  <td>
                    <span className="badge">{t.status}</span>
                  </td>
                  <td style={{ textAlign: 'right', paddingRight: '0.9rem', whiteSpace: 'nowrap' }}>
                    {t.status === 'active' ? (
                      <button className="mini danger" onClick={() => setTenantStatus(t, 'suspended')}>Suspender</button>
                    ) : (
                      <button className="mini" onClick={() => setTenantStatus(t, 'active')}>Activar</button>
                    )}
                  </td>
                </tr>
              ))}
              {tenants.length === 0 && (
                <tr><td colSpan={5} className="muted" style={{ padding: '1rem 0.9rem' }}>Sin tenants.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      {/* Feature flags */}
      <section style={{ display: 'grid', gap: '0.5rem' }}>
        <h2 style={{ margin: 0, fontSize: '1.15rem' }}>Feature flags</h2>
        <div className="card" style={{ display: 'grid', gap: '0.4rem' }}>
          {flags.map((f) => (
            <div key={f.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderTop: '1px solid var(--border)', paddingTop: '0.4rem' }}>
              <span><code>{f.key}</code> {f.tenantId ? <span className="badge">tenant</span> : <span className="badge">global</span>} · {f.rolloutPercentage}%</span>
              <button className="mini" onClick={() => toggleFlag(f)}>{f.enabled ? '🟢 Activo' : '⚪ Inactivo'}</button>
            </div>
          ))}
          {flags.length === 0 && <p className="muted" style={{ margin: 0 }}>Sin flags.</p>}
          <form onSubmit={saveFlag} style={{ display: 'grid', gridTemplateColumns: '2fr auto auto', gap: '0.5rem', alignItems: 'center', marginTop: '0.4rem' }}>
            <input className="input" value={flag.key} onChange={(e) => setFlag({ ...flag, key: e.target.value })} placeholder="nueva_feature" required />
            <label style={{ display: 'flex', gap: '0.3rem', alignItems: 'center' }}>
              <input type="checkbox" checked={flag.enabled} onChange={(e) => setFlag({ ...flag, enabled: e.target.checked })} /> activo
            </label>
            <button className="btn">Guardar</button>
          </form>
        </div>
      </section>

      {/* Resellers */}
      <section style={{ display: 'grid', gap: '0.5rem' }}>
        <h2 style={{ margin: 0, fontSize: '1.15rem' }}>Resellers (white-label)</h2>
        <div className="card" style={{ display: 'grid', gap: '0.4rem' }}>
          {resellers.map((r) => (
            <div key={r.id} style={{ borderTop: '1px solid var(--border)', paddingTop: '0.35rem' }}>
              {r.name} <code className="muted">{r.slug}</code>
            </div>
          ))}
          {resellers.length === 0 && <p className="muted" style={{ margin: 0 }}>Sin resellers.</p>}
          <form onSubmit={createReseller} style={{ display: 'grid', gridTemplateColumns: '1fr 1fr auto', gap: '0.5rem', marginTop: '0.4rem' }}>
            <input className="input" value={reseller.name} onChange={(e) => setReseller({ ...reseller, name: e.target.value })} placeholder="Nombre" required />
            <input className="input" value={reseller.slug} onChange={(e) => setReseller({ ...reseller, slug: e.target.value })} placeholder="slug" required />
            <button className="btn">+ Reseller</button>
          </form>
        </div>
      </section>

      {/* Impersonation */}
      <section style={{ display: 'grid', gap: '0.5rem' }}>
        <h2 style={{ margin: 0, fontSize: '1.15rem' }}>Impersonar usuario</h2>
        <form onSubmit={impersonate} className="card" style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: '0.5rem' }}>
          <input className="input" value={impersonateId} onChange={(e) => setImpersonateId(e.target.value)} placeholder="usr_..." required />
          <button className="btn">Impersonar</button>
        </form>
        <p className="muted" style={{ margin: 0, fontSize: '0.85rem' }}>Se registra en auditoría, muestra banner rojo y expira automáticamente.</p>
      </section>

      <style jsx>{`
        .mini {
          background: transparent;
          border: 1px solid var(--border);
          color: var(--muted);
          border-radius: 6px;
          padding: 0.25rem 0.6rem;
          cursor: pointer;
          font-size: 0.82rem;
        }
        .mini.danger {
          color: #f87171;
          border-color: #7f1d1d;
        }
      `}</style>
    </div>
  );
}
