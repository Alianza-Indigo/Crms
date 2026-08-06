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
import { schema, withTenant, eq } from '@crms/database';
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
}
