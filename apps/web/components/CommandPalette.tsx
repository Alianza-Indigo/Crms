'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';

interface Command {
  label: string;
  hint?: string;
  href: string;
}

const BASE_COMMANDS: Command[] = [
  { label: 'Constructor', hint: 'Módulos y campos', href: '/builder' },
  { label: 'Datos', hint: 'Ver / capturar registros', href: '/data' },
  { label: 'Dashboards', href: '/dashboards' },
  { label: 'Automatizaciones', href: '/automations' },
  { label: 'Documentos', href: '/documents' },
  { label: 'Portales', href: '/portals' },
  { label: 'Agentes', href: '/agents' },
  { label: 'Búsqueda', href: '/search' },
  { label: 'IA — Generar aplicación', hint: 'Crea con IA', href: '/ai' },
  { label: 'Integraciones', href: '/integrations' },
  { label: 'Credenciales', href: '/credentials' },
  { label: 'Roles y permisos', href: '/roles' },
  { label: 'Configuración', href: '/settings' },
  { label: 'Nuevo módulo', hint: 'Constructor', href: '/builder' },
];

/** Global command palette (PRD §43.3). Cmd/Ctrl-K to jump anywhere. */
export function CommandPalette({ isAdmin }: { isAdmin?: boolean }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [i, setI] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const commands = useMemo(
    () => (isAdmin ? [...BASE_COMMANDS, { label: 'Consola de administración', hint: 'Plataforma', href: '/admin' }] : BASE_COMMANDS),
    [isAdmin],
  );
  const results = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return commands;
    return commands.filter((c) => (c.label + ' ' + (c.hint ?? '')).toLowerCase().includes(s));
  }, [q, commands]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setOpen((v) => !v);
      } else if (e.key === 'Escape') {
        setOpen(false);
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => {
    if (open) {
      setQ('');
      setI(0);
      setTimeout(() => inputRef.current?.focus(), 0);
    }
  }, [open]);

  if (!open) return null;

  function go(href: string) {
    setOpen(false);
    router.push(href);
  }

  return (
    <div
      onClick={() => setOpen(false)}
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'flex-start', justifyContent: 'center', paddingTop: '12vh', zIndex: 1000 }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="card"
        style={{ width: 'min(560px, 92vw)', padding: 0, overflow: 'hidden' }}
      >
        <input
          ref={inputRef}
          className="input"
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setI(0);
          }}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') setI((n) => Math.min(n + 1, results.length - 1));
            else if (e.key === 'ArrowUp') setI((n) => Math.max(n - 1, 0));
            else if (e.key === 'Enter' && results[i]) go(results[i]!.href);
          }}
          placeholder="Buscar acción o sección…  (Esc para cerrar)"
          style={{ border: 'none', borderRadius: 0, borderBottom: '1px solid var(--border)', fontSize: '1rem', padding: '0.9rem 1rem' }}
        />
        <div style={{ maxHeight: '50vh', overflowY: 'auto' }}>
          {results.map((c, idx) => (
            <button
              key={c.href + c.label}
              onMouseEnter={() => setI(idx)}
              onClick={() => go(c.href)}
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                width: '100%',
                textAlign: 'left',
                border: 'none',
                background: idx === i ? 'var(--accent)' : 'transparent',
                color: idx === i ? '#fff' : 'var(--fg)',
                padding: '0.6rem 1rem',
                cursor: 'pointer',
                fontSize: '0.95rem',
              }}
            >
              <span>{c.label}</span>
              {c.hint && <span style={{ opacity: 0.7, fontSize: '0.8rem' }}>{c.hint}</span>}
            </button>
          ))}
          {results.length === 0 && <div className="muted" style={{ padding: '1rem' }}>Sin resultados.</div>}
        </div>
      </div>
    </div>
  );
}
