'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, setToken } from '../../lib/api';
import { getClient } from '../../lib/crms';

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (mode === 'register') {
        await api('/auth/register', { method: 'POST', body: JSON.stringify({ email, password }) });
      }
      const res = await api<{ token: string }>('/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email, password }),
      });
      setToken(res.token);
      // If the account has no organization yet, go through onboarding first.
      const apps = await getClient().applications.list().catch(() => []);
      router.push(apps.length ? '/builder' : '/onboarding');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="container" style={{ maxWidth: 420 }}>
      <div className="card">
        <h2 style={{ marginTop: 0 }}>{mode === 'login' ? 'Iniciar sesión' : 'Crear cuenta'}</h2>
        <form onSubmit={submit} className="grid">
          <label>
            Email
            <input className="input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
          </label>
          <label>
            Contraseña
            <input className="input" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required />
          </label>
          {error && <p style={{ color: '#f87171' }}>{error}</p>}
          <button className="btn" disabled={busy}>
            {busy ? '…' : mode === 'login' ? 'Entrar' : 'Registrarme'}
          </button>
        </form>

        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', margin: '1rem 0' }}>
          <hr style={{ flex: 1, borderColor: 'var(--border)' }} />
          <span className="muted" style={{ fontSize: '0.8rem' }}>o</span>
          <hr style={{ flex: 1, borderColor: 'var(--border)' }} />
        </div>
        <button
          className="btn"
          style={{ width: '100%', background: '#fff', color: '#111' }}
          onClick={async () => {
            try {
              const res = await api<{ url?: string; configured?: boolean }>('/auth/google/start');
              if (res.url) window.location.href = res.url;
              else setError('Google OAuth no está configurado en este despliegue.');
            } catch (e) {
              setError(e instanceof Error ? e.message : 'Error');
            }
          }}
        >
          Continuar con Google
        </button>
        <button
          type="button"
          className="btn"
          style={{ width: '100%', background: 'transparent', border: '1px solid var(--border)', color: 'var(--muted)', marginTop: '0.5rem' }}
          onClick={async () => {
            setError(null);
            if (!email) {
              setError('Escribe tu email primero.');
              return;
            }
            try {
              const res = await api<{ sent: boolean; link?: string }>('/auth/magic-link/request', { method: 'POST', body: JSON.stringify({ email }) });
              if (res.sent) setError('Te enviamos un enlace de acceso. Revisa tu correo.');
              else if (res.link) window.location.href = res.link;
              else setError('No se pudo generar el enlace.');
            } catch (e) {
              setError(e instanceof Error ? e.message : 'Error');
            }
          }}
        >
          Enviar enlace mágico por email
        </button>
        <button
          type="button"
          className="btn"
          style={{ width: '100%', background: 'transparent', border: '1px solid var(--border)', color: 'var(--muted)', marginTop: '0.5rem' }}
          onClick={async () => {
            try {
              const res = await api<{ url?: string; configured?: boolean }>('/auth/saml/start');
              if (res.url) window.location.href = res.url;
              else setError('SSO (SAML) no está configurado en este despliegue.');
            } catch (e) {
              setError(e instanceof Error ? e.message : 'Error');
            }
          }}
        >
          SSO empresarial (SAML)
        </button>
        <p className="muted" style={{ marginBottom: 0 }}>
          {mode === 'login' ? '¿No tienes cuenta? ' : '¿Ya tienes cuenta? '}
          <a onClick={() => setMode(mode === 'login' ? 'register' : 'login')} style={{ cursor: 'pointer' }}>
            {mode === 'login' ? 'Regístrate' : 'Inicia sesión'}
          </a>
        </p>
      </div>
    </div>
  );
}
