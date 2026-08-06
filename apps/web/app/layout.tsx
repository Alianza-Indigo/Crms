import type { Metadata, Viewport } from 'next';
import './globals.css';
import { ImpersonationBanner } from '../components/ImpersonationBanner';
import { BrandingProvider } from '../components/BrandingProvider';

/**
 * Root layout (PRD §34.1, §27). Registers the PWA manifest and a theme; the app
 * is responsive + installable. White-label branding is injected per-tenant at
 * runtime in a full deployment.
 */
export const metadata: Metadata = {
  title: 'CRMS — Enterprise Application Platform',
  description: 'Build, operate and scale CRMs and business applications with AI, no-code builders and BYO credentials.',
  manifest: '/manifest.webmanifest',
  applicationName: 'CRMS',
};

export const viewport: Viewport = {
  themeColor: '#0f172a',
  width: 'device-width',
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es">
      <body>
        <BrandingProvider />
        <ImpersonationBanner />
        {children}
      </body>
    </html>
  );
}
