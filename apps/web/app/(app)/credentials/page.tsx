'use client';

import { useEffect, useState } from 'react';
import { getClient } from '../../../lib/crms';

interface Cred {
  id: string;
  key: string;
  name: string;
  provider: string;
  status: string;
}

/** BYO credentials (PRD §10): list + connect. Secrets are write-only. */
export default function CredentialsPage() {
  const [creds, setCreds] = useState<Cred[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ key: 'OPENAI', name: 'OpenAI', provider: 'openai', authType: 'api_key', apiKey: '' });

  async function load() {
    try {
      setCreds((await getClient().credentials.list()) as unknown as Cred[]);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error');
    }
  }
  useEffect(() => {
    load();
  }, []);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    try {
      await getClient().credentials.create({
        key: form.key,
        name: form.name,
        provider: form.provider,
        authType: form.authType,
        secret: { apiKey: form.apiKey },
      });
      setForm({ ...form, apiKey: '' });
      setOpen(false);
      await load();
    } catch (e2) {
      setError(e2 instanceof Error ? e2.message : 'Error');
    }
  }

  return (
    <div style={{ display: 'grid', gap: '1.25rem', maxWidth: 720 }}>
      <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <span className="badge">BYO Credentials</span>
          <h1 style={{ margin: '0.4rem 0 0' }}>Credenciales</h1>
        </div>
        <button className="btn" onClick={() => setOpen((v) => !v)}>
          {open ? 'Cancelar' : '+ Conectar'}
        </button>
      </header>

      {error && <div className="card" style={{ borderColor: '#7f1d1d', color: '#f87171' }}>{error}</div>}

      {open && (
        <form onSubmit={create} className="card" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.6rem' }}>
          <label>
            Clave lógica
            <input className="input" value={form.key} onChange={(e) => setForm({ ...form, key: e.target.value })} />
          </label>
          <label>
            Nombre
            <input className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </label>
          <label>
            Proveedor
            <select className="input" value={form.provider} onChange={(e) => setForm({ ...form, provider: e.target.value })}>
              {[
                ['openai', 'OpenAI'],
                ['anthropic', 'Anthropic (Claude)'],
                ['google_ai', 'Google Gemini'],
                ['stripe', 'Stripe'],
                ['slack', 'Slack'],
                ['whatsapp', 'WhatsApp'],
                ['twilio', 'Twilio'],
                ['smtp', 'SMTP (correo)'],
              ].map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <label>
            API key / secreto
            <input className="input" type="password" value={form.apiKey} onChange={(e) => setForm({ ...form, apiKey: e.target.value })} required />
          </label>
          <button className="btn" style={{ gridColumn: '1 / -1' }}>
            Validar y guardar
          </button>
        </form>
      )}

      <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ textAlign: 'left', color: 'var(--muted)' }}>
              <th style={{ padding: '0.6rem 0.9rem' }}>Nombre</th>
              <th>Clave</th>
              <th>Proveedor</th>
              <th>Estado</th>
            </tr>
          </thead>
          <tbody>
            {creds.map((c) => (
              <tr key={c.id} style={{ borderTop: '1px solid var(--border)' }}>
                <td style={{ padding: '0.6rem 0.9rem' }}>{c.name}</td>
                <td>
                  <code className="muted">{c.key}</code>
                </td>
                <td>{c.provider}</td>
                <td>
                  <span className="badge">{c.status}</span>
                </td>
              </tr>
            ))}
            {creds.length === 0 && (
              <tr>
                <td colSpan={4} className="muted" style={{ padding: '0.9rem' }}>
                  Sin credenciales. Conecta OpenAI, Stripe, WhatsApp, etc.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
