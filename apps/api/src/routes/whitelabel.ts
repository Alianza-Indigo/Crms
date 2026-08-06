import type { FastifyInstance } from 'fastify';
import { eq, schema, withElevated } from '@crms/database';
import { pub } from '../lib/context.js';

/**
 * White-label runtime (PRD §25). Resolves per-tenant (or per-portal) branding
 * from the request host, so a custom domain / subdomain renders the tenant's
 * name, logo, colors and login screen. Public + unauthenticated: the login page
 * needs branding before a session exists.
 */
export async function whitelabelRoutes(app: FastifyInstance): Promise<void> {
  app.get(
    '/branding',
    pub(async (req) => {
      const host = ((req.query as { host?: string }).host ?? (req.headers['x-forwarded-host'] as string) ?? req.headers.host ?? '')
        .toString()
        .split(':')[0]!
        .toLowerCase();

      return withElevated(async (tx) => {
        const [domain] = await tx.select().from(schema.tenantDomains).where(eq(schema.tenantDomains.domain, host));
        if (!domain) return { resolved: false, branding: defaultBranding() };

        const [tenant] = await tx.select().from(schema.tenants).where(eq(schema.tenants.id, domain.tenantId));
        let branding = (tenant?.branding as Record<string, unknown>) ?? {};

        // Portal domains carry their own branding overriding the tenant's.
        if (domain.kind === 'portal' && domain.portalId) {
          const [portal] = await tx.select().from(schema.portalDefinitions).where(eq(schema.portalDefinitions.id, domain.portalId));
          if (portal) branding = { ...branding, ...(portal.branding as Record<string, unknown>) };
        }

        return {
          resolved: true,
          tenantId: domain.tenantId,
          kind: domain.kind,
          portalId: domain.portalId,
          branding: { ...defaultBranding(), ...branding },
        };
      });
    }),
  );
}

function defaultBranding(): Record<string, unknown> {
  return {
    name: 'CRMS',
    primaryColor: '#6366f1',
    backgroundColor: '#0f172a',
    logoUrl: null,
    faviconUrl: null,
  };
}
