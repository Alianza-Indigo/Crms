'use client';

import { useEffect } from 'react';

const BASE = process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:4000';

/**
 * White-label theming (PRD §25). On load, resolve the tenant/portal branding for
 * the current host and apply it as CSS variables + document title, so custom
 * domains render the tenant's identity (including the login screen).
 */
export function BrandingProvider() {
  useEffect(() => {
    const host = window.location.host;
    fetch(`${BASE}/v1/branding?host=${encodeURIComponent(host)}`)
      .then((r) => r.json())
      .then((res: { branding?: Record<string, string> }) => {
        const b = res.branding ?? {};
        const root = document.documentElement;
        if (b.primaryColor) root.style.setProperty('--accent', b.primaryColor);
        if (b.backgroundColor) root.style.setProperty('--bg', b.backgroundColor);
        if (b.name) document.title = `${b.name} — CRMS`;
        if (b.faviconUrl) {
          let link = document.querySelector<HTMLLinkElement>('link[rel="icon"]');
          if (!link) {
            link = document.createElement('link');
            link.rel = 'icon';
            document.head.appendChild(link);
          }
          link.href = b.faviconUrl;
        }
      })
      .catch(() => {});
  }, []);
  return null;
}
