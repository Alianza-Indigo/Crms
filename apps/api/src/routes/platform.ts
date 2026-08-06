import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { explain, type Action, type ResourceType } from '@crms/permissions';
import { listAudit } from '@crms/audit';
import { isEnabled, setFlag } from '@crms/feature-flags';
import { runFederatedQuery } from '@crms/federated-query';
import { createManifest, approveManifest, promote } from '@crms/deployment-engine';
import { PageParamsSchema } from '@crms/kernel';
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
}
