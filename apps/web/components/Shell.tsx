'use client';

import { useEffect, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { getClient, setActiveApp, getActiveApp, isAuthed, logout } from '../lib/crms';

interface App {
  id: string;
  name: string;
}

const NAV = [
  ['/builder', '🧱 Constructor'],
  ['/data', '🗂️ Datos'],
  ['/dashboards', '📊 Dashboards'],
  ['/search', '🔎 Búsqueda'],
  ['/ai', '✨ IA'],
  ['/credentials', '🔐 Credenciales'],
];

/** App shell: sidebar nav + application/environment selector (PRD §43.2). */
export function Shell({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [apps, setApps] = useState<App[]>([]);
  const [active, setActive] = useState<string | null>(null);
  const [env, setEnv] = useState('production');

  useEffect(() => {
    if (!isAuthed()) {
      router.replace('/login');
      return;
    }
    const a = getActiveApp();
    setActive(a.applicationId);
    setEnv(a.environment);
    getClient()
      .applications.list()
      .then((list) => {
        setApps(list);
        if (!a.applicationId && list[0]) {
          setActiveApp(list[0].id, a.environment);
          setActive(list[0].id);
        }
      })
      .catch(() => {});
  }, [router]);

  function pickApp(id: string) {
    setActiveApp(id, env);
    setActive(id);
    router.refresh();
  }
  function pickEnv(e: string) {
    setEnv(e);
    if (active) setActiveApp(active, e);
    router.refresh();
  }

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '240px 1fr', minHeight: '100vh' }}>
      <aside style={{ borderRight: '1px solid var(--border)', padding: '1.25rem 1rem', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
        <Link href="/builder" style={{ fontWeight: 800, fontSize: '1.2rem', color: 'var(--fg)', textDecoration: 'none', marginBottom: '0.5rem' }}>
          CRMS
        </Link>
        <select className="input" value={active ?? ''} onChange={(e) => pickApp(e.target.value)} style={{ marginBottom: '0.25rem' }}>
          {apps.length === 0 && <option value="">Sin aplicaciones</option>}
          {apps.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </select>
        <select className="input" value={env} onChange={(e) => pickEnv(e.target.value)}>
          {['draft', 'development', 'testing', 'staging', 'production'].map((e) => (
            <option key={e} value={e}>
              {e}
            </option>
          ))}
        </select>
        <nav style={{ display: 'flex', flexDirection: 'column', gap: '0.15rem', marginTop: '0.75rem' }}>
          {NAV.map(([href, label]) => {
            const activeLink = pathname.startsWith(href);
            return (
              <Link
                key={href}
                href={href}
                style={{
                  padding: '0.55rem 0.7rem',
                  borderRadius: 8,
                  textDecoration: 'none',
                  color: activeLink ? '#fff' : 'var(--muted)',
                  background: activeLink ? 'var(--accent)' : 'transparent',
                  fontWeight: 600,
                }}
              >
                {label}
              </Link>
            );
          })}
        </nav>
        <button
          className="btn"
          style={{ marginTop: 'auto', background: 'transparent', border: '1px solid var(--border)', color: 'var(--muted)' }}
          onClick={() => {
            logout();
            router.replace('/login');
          }}
        >
          Salir
        </button>
      </aside>
      <main style={{ padding: '1.75rem 2rem', overflowX: 'hidden' }}>{children}</main>
    </div>
  );
}
