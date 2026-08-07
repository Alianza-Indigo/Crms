import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { explain, type Action, type ResourceType } from '@crms/permissions';
import { listAudit } from '@crms/audit';
import { isEnabled, setFlag } from '@crms/feature-flags';
import { runFederatedQuery } from '@crms/federated-query';
import { createManifest, approveManifest, promote } from '@crms/deployment-engine';
import { listConnectorTemplates, getConnectorTemplate, executeConnector } from '@crms/integration-engine';
import { PageParamsSchema, newId, newToken, NotFound } from '@crms/kernel';
import { encryptSecret } from '@crms/credential-engine';
import { schema, withTenant, eq, and, isNull } from '@crms/database';
import { getContext } from '@crms/tenant-context';
import { authed } from '../lib/context.js';

/**
 * Cross-cutting platform routes: permission explain (PRD §18), audit query
 * (§32.4), feature flags (§44.1), federated query (§17.1), deployments (§8.3).
 */
export async function platformRoutes(app: FastifyInstance): Promise<void> {
  app.post(
    '/permissions/explain',
    authed(async (req) => {
      const body = z
        .object({ action: z.string(), resourceType: z.string(), selector: z.string().optional(), ownerUserId: z.string().optional() })
        .parse(req.body);
      return explain(body.action as Action, { type: body.resourceType as ResourceType, selector: body.selector, ownerUserId: body.ownerUserId });
    }),
  );

  app.get(
    '/audit',
    authed(async (req) => {
      const q = req.query as Record<string, string>;
      const page = PageParamsSchema.parse(q);
      return listAudit({ resourceType: q.resourceType, resourceId: q.resourceId }, page);
    }),
  );

  app.get(
    '/feature-flags/:key',
    authed(async (req) => {
      const { key } = req.params as { key: string };
      return { key, enabled: await isEnabled(key) };
    }),
  );

  app.post(
    '/feature-flags',
    authed(async (req) => {
      const body = z
        .object({ key: z.string(), enabled: z.boolean(), rolloutPercentage: z.number().optional() })
        .parse(req.body);
      await setFlag(body);
      return { ok: true };
    }),
  );

  app.post(
    '/federated-query/:connectionId',
    authed(async (req) => {
      const { connectionId } = req.params as { connectionId: string };
      const body = z.object({ sql: z.string() }).parse(req.body);
      return runFederatedQuery(connectionId, body.sql);
    }),
  );

  app.post(
    '/deployments',
    authed(async (req) => {
      const id = await createManifest(req.body as never);
      return { manifestId: id };
    }),
  );
  app.post(
    '/deployments/:id/approve',
    authed(async (req) => {
      const { id } = req.params as { id: string };
      return approveManifest(id);
    }),
  );
  app.post(
    '/deployments/:id/promote',
    authed(async (req) => {
      const { id } = req.params as { id: string };
      await promote(id);
      return { ok: true };
    }),
  );

  // --- Integrations (PRD §17) ---
  app.get('/integrations/templates', authed(async () => ({ templates: listConnectorTemplates() })));

  app.post(
    '/integrations',
    authed(async (req) => {
      const ctx = getContext();
      if (!ctx.applicationId) throw NotFound('application context');
      const body = z
        .object({ key: z.string(), name: z.string(), provider: z.string(), credentialId: z.string().optional(), template: z.string().optional(), definition: z.record(z.unknown()).optional() })
        .parse(req.body);
      const tpl = body.template ? getConnectorTemplate(body.template) : undefined;
      const id = newId('integration');
      await withTenant(async (tx) => {
        await tx.insert(schema.integrationConnections).values({
          id,
          tenantId: ctx.tenantId,
          applicationId: ctx.applicationId!,
          environment: ctx.environment,
          key: body.key,
          name: body.name,
          provider: body.provider,
          credentialId: body.credentialId,
          definition: (body.definition ?? tpl?.definition ?? {}) as never,
          createdBy: ctx.userId,
        });
      });
      return { id };
    }),
  );

  app.post(
    '/integrations/:id/execute',
    authed(async (req) => {
      const { id } = req.params as { id: string };
      const body = z.object({ variables: z.record(z.unknown()).optional(), body: z.unknown().optional() }).parse(req.body ?? {});
      return executeConnector(id, { variables: body.variables, overrideBody: body.body });
    }),
  );

  // --- Webhooks (PRD §29) ---
  app.post(
    '/webhooks',
    authed(async (req) => {
      const ctx = getContext();
      if (!ctx.applicationId) throw NotFound('application context');
      const body = z.object({ url: z.string().url(), events: z.array(z.string()).default(['*']) }).parse(req.body);
      const secret = newToken(24); // shown ONCE; stored encrypted
      const id = newId('webhook');
      await withTenant(async (tx) => {
        await tx.insert(schema.webhookSubscriptions).values({
          id,
          tenantId: ctx.tenantId,
          applicationId: ctx.applicationId!,
          environment: ctx.environment,
          url: body.url,
          events: body.events,
          secretRef: encryptSecret(secret).ciphertext,
          createdBy: ctx.userId,
        });
      });
      // The signing secret is returned exactly once (like an API key).
      return { id, signingSecret: secret, note: 'Store this secret now; it will not be shown again.' };
    }),
  );

  app.post(
    '/webhook-deliveries/:id/replay',
    authed(async (req) => {
      const { id } = req.params as { id: string };
      await withTenant(async (tx) => {
        await tx
          .update(schema.webhookDeliveries)
          .set({ status: 'pending', nextAttemptAt: new Date(), attempts: 0 })
          .where(eq(schema.webhookDeliveries.id, id));
      });
      return { ok: true };
    }),
  );

  // --- Integrations list (PRD §17) ---
  app.get('/integrations', authed(async () => {
    const ctx = getContext();
    return withTenant(async (tx) =>
      tx
        .select({ id: schema.integrationConnections.id, key: schema.integrationConnections.key, name: schema.integrationConnections.name, provider: schema.integrationConnections.provider })
        .from(schema.integrationConnections)
        .where(and(eq(schema.integrationConnections.applicationId, ctx.applicationId ?? ''), eq(schema.integrationConnections.environment, ctx.environment))),
    );
  }));

  // --- Roles & permissions (PRD §18) ---
  app.get('/roles', authed(async () => {
    const ctx = getContext();
    return withTenant(async (tx) =>
      tx
        .select()
        .from(schema.roles)
        .where(and(eq(schema.roles.tenantId, ctx.tenantId), isNull(schema.roles.deletedAt))),
    );
  }));

  app.post('/roles', authed(async (req) => {
    await assertManage();
    const ctx = getContext();
    const body = z.object({ name: z.string().min(1), description: z.string().optional(), permissions: z.array(z.string()).default([]) }).parse(req.body);
    const id = newId('role');
    await withTenant(async (tx) => {
      await tx.insert(schema.roles).values({ id, tenantId: ctx.tenantId, applicationId: ctx.applicationId ?? null, name: body.name, description: body.description ?? null, permissions: body.permissions, createdBy: ctx.userId });
    });
    return { id };
  }));

  app.patch('/roles/:id', authed(async (req) => {
    await assertManage();
    const { id } = req.params as { id: string };
    const body = z.object({ name: z.string().optional(), description: z.string().optional(), permissions: z.array(z.string()).optional() }).parse(req.body);
    await withTenant(async (tx) => {
      await tx.update(schema.roles).set({ ...body, updatedAt: new Date() }).where(eq(schema.roles.id, id));
    });
    return { ok: true };
  }));

  app.delete('/roles/:id', authed(async (req) => {
    await assertManage();
    const { id } = req.params as { id: string };
    await withTenant(async (tx) => {
      await tx.update(schema.roles).set({ deletedAt: new Date() }).where(eq(schema.roles.id, id));
    });
    return { ok: true };
  }));

  // --- Tenant settings + branding (PRD §25) ---
  app.get('/settings', authed(async () => {
    const ctx = getContext();
    return withTenant(async (tx) => {
      const [t] = await tx.select({ id: schema.tenants.id, name: schema.tenants.name, slug: schema.tenants.slug, branding: schema.tenants.branding }).from(schema.tenants).where(eq(schema.tenants.id, ctx.tenantId));
      return t ?? { branding: {} };
    });
  }));

  app.patch('/settings/branding', authed(async (req) => {
    await assertManage();
    const ctx = getContext();
    const body = z.record(z.unknown()).parse(req.body);
    await withTenant(async (tx) => {
      const [t] = await tx.select({ branding: schema.tenants.branding }).from(schema.tenants).where(eq(schema.tenants.id, ctx.tenantId));
      const merged = { ...((t?.branding as Record<string, unknown>) ?? {}), ...body };
      await tx.update(schema.tenants).set({ branding: merged }).where(eq(schema.tenants.id, ctx.tenantId));
    });
    return { ok: true };
  }));

  // --- Antivirus scan of an uploaded file (PRD §32.2) ---
  app.post('/files/scan', authed(async (req) => {
    const { scanBuffer } = await import('@crms/storage');
    const body = z.object({ content: z.string() }).parse(req.body); // base64
    return scanBuffer(Buffer.from(body.content, 'base64'));
  }));

  app.get('/service-accounts', authed(async () => {
    const ctx = getContext();
    return withTenant(async (tx) =>
      tx.select({ id: schema.serviceAccounts.id, name: schema.serviceAccounts.name }).from(schema.serviceAccounts).where(eq(schema.serviceAccounts.tenantId, ctx.tenantId)),
    );
  }));
}

/** Require configuration-management permission for tenant-config writes. */
async function assertManage(): Promise<void> {
  const { assert } = await import('@crms/permissions');
  await assert('manage_config', { type: 'application' });
}
