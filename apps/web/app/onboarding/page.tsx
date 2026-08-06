'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { getClient, setActiveApp } from '../../lib/crms';

/** First-run onboarding (PRD §43.1): create an organization + first application. */
export default function OnboardingPage() {
  const router = useRouter();
  const [name, setName] = useState('');
  const [appName, setAppName] = useState('CRM');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const slug = `${name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${Math.random().toString(36).slice(2, 7)}`;
      const res = await getClient().auth.createTenant(name, slug, appName);
      setActiveApp(res.applicationId, 'production');
      router.push('/builder');
    } catch (e2) {
      setError(e2 instanceof Error ? e2.message : 'Error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="container" style={{ maxWidth: 460 }}>
      <div className="card">
        <span className="badge">Bienvenida</span>
        <h2 style={{ marginTop: '0.5rem' }}>Crea tu organización</h2>
        <form onSubmit={submit} className="grid" style={{ gap: '0.7rem' }}>
          <label>
            Nombre de la organización
            <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Acme S.A." required />
          </label>
          <label>
            Primera aplicación
            <input className="input" value={appName} onChange={(e) => setAppName(e.target.value)} required />
          </label>
          {error && <p style={{ color: '#f87171' }}>{error}</p>}
          <button className="btn" disabled={busy}>
            {busy ? '…' : 'Crear y continuar'}
          </button>
        </form>
      </div>
    </div>
  );
}
