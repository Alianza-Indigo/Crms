'use client';

import { useEffect, useState } from 'react';
import { getClient } from '../../../lib/crms';

interface ServiceAccount {
  id: string;
  name: string;
}

export default function SettingsPage() {
  const [name, setName] = useState('');
  const [branding, setBranding] = useState({ name: '', primaryColor: '#4f46e5', backgroundColor: '#0f172a', logoUrl: '' });
  const [accounts, setAccounts] = useState<ServiceAccount[]>([]);
  const [saName, setSaName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);

  async function load() {
    try {
      const c = getClient();
      const [s, sa] = await Promise.all([c.settings.get(), c.settings.serviceAccounts()]);
      setName(s.name ?? '');
      const b = (s.branding ?? {}) as Record<string, string>;
      setBranding({
        name: b.name ?? s.name ?? '',
        primaryColor: b.primaryColor ?? '#4f46e5',
        backgroundColor: b.backgroundColor ?? '#0f172a',
        logoUrl: b.logoUrl ?? '',
      });
      setAccounts(sa as unknown as ServiceAccount[]);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error');
    }
  }
  useEffect(() => {
    load();
  }, []);

  async function saveBranding(e: React.FormEvent) {
    e.preventDefault();
    setStatus(null);
    try {
      await getClient().settings.setBranding({
        name: branding.name || undefined,
        primaryColor: branding.primaryColor,
        backgroundColor: branding.backgroundColor,
        logoUrl: branding.logoUrl || null,
      });
      setStatus('Marca guardada.');
    } catch (e2) {
      setError(e2 instanceof Error ? e2.message : 'Error');
    }
  }
  async function createSa(e: React.FormEvent) {
    e.preventDefault();
    try {
      await getClient().settings.createServiceAccount(saName);
      setSaName('');
      await load();
    } catch (e2) {
      setError(e2 instanceof Error ? e2.message : 'Error');
    }
  }

  return (
    <div style={{ display: 'grid', gap: '1.5rem', maxWidth: 720 }}>
      <header>
        <span className="badge">Configuración</span>
        <h1 style={{ margin: '0.4rem 0 0' }}>Configuración {name && <span className="muted">· {name}</span>}</h1>
      </header>

      {error && <div className="card" style={{ borderColor: '#7f1d1d', color: '#f87171' }}>{error}</div>}
      {status && <div className="card" style={{ borderColor: '#14532d', color: '#4ade80' }}>{status}</div>}

      <section className="card" style={{ display: 'grid', gap: '0.7rem' }}>
        <h2 style={{ margin: 0, fontSize: '1.15rem' }}>Marca (white-label)</h2>
        <p className="muted" style={{ margin: 0, fontSize: '0.88rem' }}>Se aplica en dominios/portales del tenant.</p>
        <form onSubmit={saveBranding} style={{ display: 'grid', gap: '0.7rem' }}>
          <label>
            Nombre visible
            <input className="input" value={branding.name} onChange={(e) => setBranding({ ...branding, name: e.target.value })} placeholder="Mi Empresa" />
          </label>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.7rem' }}>
            <label>
              Color primario
              <input className="input" type="color" value={branding.primaryColor} onChange={(e) => setBranding({ ...branding, primaryColor: e.target.value })} />
            </label>
            <label>
              Color de fondo
              <input className="input" type="color" value={branding.backgroundColor} onChange={(e) => setBranding({ ...branding, backgroundColor: e.target.value })} />
            </label>
          </div>
          <label>
            URL del logo
            <input className="input" value={branding.logoUrl} onChange={(e) => setBranding({ ...branding, logoUrl: e.target.value })} placeholder="https://…/logo.png" />
          </label>
          <button className="btn">Guardar marca</button>
        </form>
      </section>

      <section className="card" style={{ display: 'grid', gap: '0.7rem' }}>
        <h2 style={{ margin: 0, fontSize: '1.15rem' }}>Cuentas de servicio</h2>
        <p className="muted" style={{ margin: 0, fontSize: '0.88rem' }}>Identidades para API keys e integraciones automatizadas.</p>
        <div style={{ display: 'grid', gap: '0.3rem' }}>
          {accounts.map((a) => (
            <div key={a.id} style={{ borderTop: '1px solid var(--border)', paddingTop: '0.35rem' }}>
              {a.name} <code className="muted">{a.id}</code>
            </div>
          ))}
          {accounts.length === 0 && <p className="muted" style={{ margin: 0 }}>Sin cuentas de servicio.</p>}
        </div>
        <form onSubmit={createSa} style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: '0.5rem' }}>
          <input className="input" value={saName} onChange={(e) => setSaName(e.target.value)} placeholder="Integración X" required />
          <button className="btn">+ Cuenta</button>
        </form>
      </section>
    </div>
  );
}
