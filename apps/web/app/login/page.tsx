'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, setToken } from '../../lib/api';

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
      router.push('/builder');
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
