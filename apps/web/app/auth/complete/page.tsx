'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { setToken } from '../../../lib/api';

/**
 * OAuth completion page. The API redirects here with the session token in the
 * URL fragment (never a query string, so it isn't logged server-side). We store
 * it and continue into the app.
 */
export default function AuthComplete() {
  const router = useRouter();
  const [msg, setMsg] = useState('Completando inicio de sesión…');

  useEffect(() => {
    const hash = new URLSearchParams(window.location.hash.slice(1));
    const token = hash.get('token');
    if (!token) {
      setMsg('No se recibió un token de sesión.');
      return;
    }
    setToken(token);
    // Clean the fragment so the token isn't left in the address bar.
    window.history.replaceState(null, '', '/auth/complete');
    router.replace(hash.get('new') === '1' ? '/builder' : '/builder');
  }, [router]);

  return (
    <div className="container">
      <p className="muted">{msg}</p>
    </div>
  );
}
