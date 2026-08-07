'use client';

import { useEffect, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { getClient, setActiveApp, getActiveApp, isAuthed, logout } from '../lib/crms';
import { CommandPalette } from './CommandPalette';

interface App {
  id: string;
  name: string;
}

const NAV = [
  ['/builder', '🧱 Constructor'],
  ['/data', '🗂️ Datos'],
  ['/dashboards', '📊 Dashboards'],
  ['/automations', '⚡ Automatizaciones'],
  ['/documents', '📄 Documentos'],
  ['/portals', '🌐 Portales'],
  ['/agents', '🤖 Agentes'],
  ['/search', '🔎 Búsqueda'],
  ['/ai', '✨ IA'],
  ['/integrations', '🔌 Integraciones'],
  ['/credentials', '🔐 Credenciales'],
  ['/roles', '🛂 Roles'],
  ['/settings', '⚙️ Configuración'],
];

/** App shell: responsive sidebar nav + application/environment selector (PRD §43.2). */
export function Shell({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [apps, setApps] = useState<App[]>([]);
  const [active, setActive] = useState<string | null>(null);
  const [env, setEnv] = useState('production');
  const [isAdmin, setIsAdmin] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);

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
    getClient()
      .auth.me()
      .then((me) => setIsAdmin(Boolean((me as { isPlatformAdmin?: boolean }).isPlatformAdmin)))
      .catch(() => {});
  }, [router]);

  // Close the mobile drawer whenever the route changes.
  useEffect(() => {
    setMenuOpen(false);
  }, [pathname]);

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

  const navItems = isAdmin ? [...NAV, ['/admin', '🛡️ Admin']] : NAV;

  return (
    <div className="shell">
      {/* Mobile top bar */}
      <header className="topbar">
        <button className="hamburger" aria-label="Menú" onClick={() => setMenuOpen((v) => !v)}>
          ☰
        </button>
        <span className="brand">CRMS</span>
      </header>

      {menuOpen && <div className="overlay" onClick={() => setMenuOpen(false)} />}

      <aside className={`sidebar${menuOpen ? ' open' : ''}`}>
        <Link href="/builder" className="brand-link" onClick={() => setMenuOpen(false)}>
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
        <nav className="nav">
          {navItems.map(([href, label]) => {
            const activeLink = pathname.startsWith(href);
            return (
              <Link
                key={href}
                href={href}
                onClick={() => setMenuOpen(false)}
                style={{
                  padding: '0.6rem 0.7rem',
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

      <main className="main">{children}</main>
      <CommandPalette isAdmin={isAdmin} />

      <style jsx>{`
        .shell {
          display: flex;
          min-height: 100vh;
        }
        .topbar {
          display: none;
        }
        .sidebar {
          width: 240px;
          flex: none;
          border-right: 1px solid var(--border);
          padding: 1.25rem 1rem;
          display: flex;
          flex-direction: column;
          gap: 0.5rem;
          background: var(--bg);
        }
        .brand-link {
          font-weight: 800;
          font-size: 1.2rem;
          color: var(--fg);
          text-decoration: none;
          margin-bottom: 0.5rem;
        }
        .nav {
          display: flex;
          flex-direction: column;
          gap: 0.15rem;
          margin-top: 0.75rem;
          overflow-y: auto;
        }
        .main {
          flex: 1;
          min-width: 0;
          padding: 1.75rem 2rem;
          overflow-x: hidden;
        }
        .overlay {
          display: none;
        }

        @media (max-width: 820px) {
          .topbar {
            display: flex;
            align-items: center;
            gap: 0.75rem;
            position: sticky;
            top: 0;
            z-index: 40;
            padding: 0.6rem 0.9rem;
            background: var(--bg);
            border-bottom: 1px solid var(--border);
          }
          .topbar .brand {
            font-weight: 800;
            font-size: 1.05rem;
          }
          .hamburger {
            background: transparent;
            border: 1px solid var(--border);
            color: var(--fg);
            border-radius: 8px;
            font-size: 1.1rem;
            padding: 0.25rem 0.6rem;
            cursor: pointer;
          }
          .shell {
            flex-direction: column;
          }
          .sidebar {
            position: fixed;
            top: 0;
            left: 0;
            height: 100%;
            width: 260px;
            max-width: 82vw;
            z-index: 60;
            transform: translateX(-100%);
            transition: transform 0.2s ease;
            box-shadow: 0 0 40px rgba(0, 0, 0, 0.4);
            overflow-y: auto;
          }
          .sidebar.open {
            transform: translateX(0);
          }
          .overlay {
            display: block;
            position: fixed;
            inset: 0;
            background: rgba(0, 0, 0, 0.5);
            z-index: 50;
          }
          .main {
            padding: 1.1rem 1rem 3rem;
          }
        }
      `}</style>
    </div>
  );
}
