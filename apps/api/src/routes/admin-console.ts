import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { count, eq, schema, withElevated } from '@crms/database';
import { getContext } from '@crms/tenant-context';
import { newId, Forbidden } from '@crms/kernel';
import { setFlag } from '@crms/feature-flags';
import { audit } from '@crms/audit';
import { authed } from '../lib/context.js';

/** Reject anyone who is not a platform administrator (PRD §44). */
function assertPlatformAdmin(): void {
  if (!getContext().isPlatformAdmin) throw Forbidden('Platform administrator access required');
}

/**
 * Global administration console (PRD §44). Platform-admin only. Reads/writes
 * cross every tenant via an elevated (RLS-bypassing) transaction — which is why
 * each handler first asserts the caller is a platform admin.
 */
export async function adminConsoleRoutes(app: FastifyInstance): Promise<void> {
  app.get(
    '/admin/overview',
    authed(async () => {
      assertPlatformAdmin();
      return withElevated(async (tx) => {
        const [t] = await tx.select({ v: count() }).from(schema.tenants);
        const [u] = await tx.select({ v: count() }).from(schema.users);
        const [a] = await tx.select({ v: count() }).from(schema.applications);
        const byStatus = await tx.select({ status: schema.tenants.status, v: count() }).from(schema.tenants).groupBy(schema.tenants.status);
        return {
          tenants: Number(t?.v ?? 0),
          users: Number(u?.v ?? 0),
          applications: Number(a?.v ?? 0),
          tenantsByStatus: byStatus.map((r) => ({ status: r.status, count: Number(r.v) })),
        };
      });
    }),
  );

  app.get(
    '/admin/tenants',
    authed(async () => {
      assertPlatformAdmin();
      return withElevated(async (tx) =>
        tx
          .select({
            id: schema.tenants.id,
            name: schema.tenants.name,
            slug: schema.tenants.slug,
            status: schema.tenants.status,
            isolationTier: schema.tenants.isolationTier,
            region: schema.tenants.region,
            resellerId: schema.tenants.resellerId,
          })
          .from(schema.tenants),
      );
    }),
  );

  app.post(
    '/admin/tenants/:id/status',
    authed(async (req) => {
      assertPlatformAdmin();
      const { id } = req.params as { id: string };
      const body = z.object({ status: z.enum(['active', 'suspended', 'deleting', 'migrating']) }).parse(req.body);
      await withElevated(async (tx) => {
        await tx.update(schema.tenants).set({ status: body.status }).where(eq(schema.tenants.id, id));
      });
      await audit({ action: 'admin.tenant.status', resourceType: 'tenant', resourceId: id, metadata: { status: body.status } });
      return { ok: true };
    }),
  );

  app.get(
    '/admin/resellers',
    authed(async () => {
      assertPlatformAdmin();
      return withElevated(async (tx) => tx.select().from(schema.resellers));
    }),
  );

  app.post(
    '/admin/resellers',
    authed(async (req) => {
      assertPlatformAdmin();
      const body = z.object({ name: z.string().min(1), slug: z.string().min(1) }).parse(req.body);
      const id = newId('reseller');
      await withElevated(async (tx) => {
        await tx.insert(schema.resellers).values({ id, name: body.name, slug: body.slug });
      });
      await audit({ action: 'admin.reseller.create', resourceType: 'reseller', resourceId: id });
      return { id };
    }),
  );

  app.get(
    '/admin/flags',
    authed(async () => {
      assertPlatformAdmin();
      // Platform-global flags (tenantId NULL) plus any tenant overrides.
      return withElevated(async (tx) =>
        tx
          .select({ id: schema.featureFlags.id, key: schema.featureFlags.key, enabled: schema.featureFlags.enabled, rolloutPercentage: schema.featureFlags.rolloutPercentage, tenantId: schema.featureFlags.tenantId })
          .from(schema.featureFlags),
      );
    }),
  );

  app.post(
    '/admin/flags',
    authed(async (req) => {
      assertPlatformAdmin();
      const body = z.object({ key: z.string(), enabled: z.boolean(), rolloutPercentage: z.number().optional() }).parse(req.body);
      await setFlag(body);
      await audit({ action: 'admin.flag.set', resourceType: 'feature_flag', resourceId: body.key, metadata: { enabled: body.enabled } });
      return { ok: true };
    }),
  );
}
