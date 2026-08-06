'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { getToken } from '../lib/api';
import { getClient } from '../lib/crms';

/**
 * Gate for the authenticated app area. A freshly-registered user has no tenant
 * yet, so any tenant-scoped call would fail with NO_ACTIVE_TENANT. Instead of
 * surfacing that raw error, send them to onboarding (and to /login if the
 * session is missing/expired). Children only render once a tenant is confirmed.
 */
export function TenantGuard({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [state, setState] = useState<'checking' | 'ready'>('checking');

  useEffect(() => {
    if (!getToken()) {
      router.replace('/login');
      return;
    }
    let cancelled = false;
    // applications.list() needs only an active tenant (no specific app), so it's
    // the cheapest way to tell "onboarded" from "not onboarded".
    getClient()
      .applications.list()
      .then(() => {
        if (!cancelled) setState('ready');
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        const code = (err as { code?: string })?.code;
        const msg = err instanceof Error ? err.message : '';
        if (code === 'NO_ACTIVE_TENANT' || /active tenant/i.test(msg)) router.replace('/onboarding');
        else if (code === 'UNAUTHENTICATED') router.replace('/login');
        // Any other error: let the page render and handle it itself.
        else setState('ready');
      });
    return () => {
      cancelled = true;
    };
  }, [router]);

  if (state === 'checking') {
    return (
      <div className="container" style={{ padding: '3rem 1rem' }}>
        <p className="muted">Cargando…</p>
      </div>
    );
  }
  return <>{children}</>;
}
