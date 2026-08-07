import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { createPortal, registerPortalUser, loginPortalUser, listPortalRecords, createPortalRecord } from '@crms/portal-engine';
import { getPublicForm, submitPublicForm } from '@crms/builder-engine';
import { and, eq, schema, withTenant } from '@crms/database';
import { getContext } from '@crms/tenant-context';
import { assert } from '@crms/permissions';
import { authed, pub } from '../lib/context.js';

function portalToken(req: { headers: Record<string, unknown> }): string {
  const h = (req.headers.authorization as string) ?? '';
  return h.replace(/^Bearer /i, '');
}

/**
 * Portals (PRD §19) + public forms (PRD §14). Portal auth + data endpoints are
 * public (external users) and scoped to the portal's exposure by the engine.
 */
export async function portalRoutes(app: FastifyInstance): Promise<void> {
  // Tenant-side: list + create portals (authenticated).
  app.get('/portals', authed(async () => {
    const ctx = getContext();
    return withTenant(async (tx) =>
      tx
        .select()
        .from(schema.portalDefinitions)
        .where(
          and(
            eq(schema.portalDefinitions.applicationId, ctx.applicationId ?? ''),
            eq(schema.portalDefinitions.environment, ctx.environment),
          ),
        ),
    );
  }));

  app.post('/portals', authed(async (req) => {
    await assert('manage_config', { type: 'portal' });
    const ctx = getContext();
    return createPortal({ applicationId: ctx.applicationId ?? '', ...(req.body as Record<string, unknown>) } as never);
  }));

  // External portal auth (public).
  app.post('/portals/:portalId/register', pub(async (req) => {
    const { portalId } = req.params as { portalId: string };
    const body = z.object({ email: z.string().email(), password: z.string().min(8), name: z.string().optional() }).parse(req.body);
    return registerPortalUser(portalId, body);
  }));

  app.post('/portals/:portalId/login', pub(async (req) => {
    const { portalId } = req.params as { portalId: string };
    const body = z.object({ email: z.string().email(), password: z.string() }).parse(req.body);
    return loginPortalUser(portalId, body);
  }));

  // Portal data (external user's own records in exposed modules).
  app.get('/portal/modules/:moduleId/records', pub(async (req) => {
    const { moduleId } = req.params as { moduleId: string };
    return { items: await listPortalRecords(portalToken(req), moduleId) };
  }));

  app.post('/portal/modules/:moduleId/records', pub(async (req) => {
    const { moduleId } = req.params as { moduleId: string };
    const body = z.object({ data: z.record(z.unknown()) }).parse(req.body);
    return createPortalRecord(portalToken(req), moduleId, body.data);
  }));

  // Public forms (PRD §14).
  app.get('/forms/public/:slug', pub(async (req) => getPublicForm((req.params as { slug: string }).slug)));
  app.post('/forms/public/:slug/submit', pub(async (req) => {
    const { slug } = req.params as { slug: string };
    const body = z.object({ data: z.record(z.unknown()) }).parse(req.body);
    return submitPublicForm(slug, body.data);
  }));
}
