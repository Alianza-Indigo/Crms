'use client';

import { useEffect, useState } from 'react';
import { api } from '../lib/api';

interface Me {
  userId: string | null;
  impersonation: { impersonatedUserId: string; impersonatedBy: string; expiresAt: string } | null;
}

/**
 * Permanent red impersonation banner (PRD §32.5). Shows who is being
 * impersonated, a live countdown, and a button to end the session immediately.
 */
export function ImpersonationBanner() {
  const [imp, setImp] = useState<Me['impersonation']>(null);
  const [remaining, setRemaining] = useState<number>(0);

  useEffect(() => {
    let active = true;
    api<Me>('/auth/me')
      .then((me) => active && setImp(me.impersonation))
      .catch(() => {});
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!imp) return;
    const tick = () => setRemaining(Math.max(0, Math.floor((new Date(imp.expiresAt).getTime() - Date.now()) / 1000)));
    tick();
    const t = setInterval(tick, 1000);
    return () => clearInterval(t);
  }, [imp]);

  if (!imp) return null;

  return (
    <div
      style={{
        position: 'sticky',
        top: 0,
        zIndex: 9999,
        background: '#b91c1c',
        color: 'white',
        padding: '0.5rem 1rem',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: '1rem',
        fontWeight: 600,
      }}
    >
      <span>
        ⚠️ Suplantando a <code>{imp.impersonatedUserId}</code> — expira en {Math.floor(remaining / 60)}:
        {String(remaining % 60).padStart(2, '0')}
      </span>
      <button
        style={{ background: 'white', color: '#b91c1c', border: 'none', borderRadius: 6, padding: '0.25rem 0.75rem', cursor: 'pointer', fontWeight: 700 }}
        onClick={async () => {
          await api('/admin/impersonate/stop', { method: 'POST' });
          window.location.reload();
        }}
      >
        Terminar
      </button>
    </div>
  );
}
