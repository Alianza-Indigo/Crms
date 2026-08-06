import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { newId } from '@crms/kernel';
import { schema, withTenant } from '@crms/database';
import { getContext } from '@crms/tenant-context';
import { authService, createApiKey } from '@crms/auth';
import { assert } from '@crms/permissions';
import { audit } from '@crms/audit';
import { authed, pub } from '../lib/context.js';

/**
 * Service accounts, API keys, and impersonation (PRD §5.9, §29, §32.5).
 */
export async function adminRoutes(app: FastifyInstance): Promise<void> {
  app.post(
    '/service-accounts',
    authed(async (req) => {
      await assert('manage_config', { type: 'application' });
      const ctx = getContext();
      const body = z.object({ name: z.string(), roleIds: z.array(z.string()).default([]) }).parse(req.body);
      const id = newId('serviceAccount');
      await withTenant(async (tx) => {
        await tx.insert(schema.serviceAccounts).values({
          id,
          tenantId: ctx.tenantId,
          applicationId: ctx.applicationId,
          name: body.name,
          roleIds: body.roleIds,
          createdBy: ctx.userId,
        });
      });
      return { id };
    }),
  );

  app.post(
    '/api-keys',
    authed(async (req) => {
      await assert('manage_config', { type: 'application' });
      const ctx = getContext();
      const body = z
        .object({
          name: z.string(),
          serviceAccountId: z.string(),
          scopes: z.array(z.string()).default([]),
          allowedIps: z.array(z.string()).default([]),
          expiresAt: z.string().datetime().optional(),
        })
        .parse(req.body);
      const result = await createApiKey({
        tenantId: ctx.tenantId,
        applicationId: ctx.applicationId,
        serviceAccountId: body.serviceAccountId,
        name: body.name,
        scopes: body.scopes,
        allowedIps: body.allowedIps,
        expiresAt: body.expiresAt ? new Date(body.expiresAt) : null,
      });
      await audit({ action: 'apikey.create', resourceType: 'api_key', resourceId: result.id });
      // The token is returned exactly once.
      return { id: result.id, token: result.token, note: 'Store this token now; it will not be shown again.' };
    }),
  );

  // --- Impersonation (platform admin, PRD §5.1, §32.5) ---
  app.post(
    '/admin/impersonate',
    pub(async (req) => {
      const token = (req.headers.authorization ?? '').replace(/^Bearer /i, '');
      const body = z.object({ targetUserId: z.string(), ttlSeconds: z.number().optional() }).parse(req.body);
      await authService.startImpersonation({ adminToken: token, targetUserId: body.targetUserId, ttlSeconds: body.ttlSeconds });
      await audit({ action: 'impersonation.start', resourceType: 'user', resourceId: body.targetUserId });
      return { ok: true };
    }),
  );

  app.post(
    '/admin/impersonate/stop',
    pub(async (req) => {
      const token = (req.headers.authorization ?? '').replace(/^Bearer /i, '');
      await authService.stopImpersonation(token);
      return { ok: true };
    }),
  );
}
