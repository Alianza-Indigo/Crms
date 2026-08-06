import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { credentialManager, listProviders } from '@crms/credential-engine';
import { assert } from '@crms/permissions';
import { audit } from '@crms/audit';
import { authed } from '../lib/context.js';

/**
 * Credential routes (PRD §10). Secrets are write-only over the API: the value is
 * accepted on create/rotate, validated, encrypted, and NEVER returned. Reads
 * expose metadata only. Every action is audited without the secret value.
 */
export async function credentialRoutes(app: FastifyInstance): Promise<void> {
  app.get('/credentials/providers', authed(async () => ({ providers: listProviders() })));

  app.get('/credentials', authed(async (req) => {
    await assert('manage_credentials', { type: 'credential' });
    const q = req.query as { applicationId?: string };
    return credentialManager.list(q.applicationId);
  }));

  app.post(
    '/credentials',
    authed(async (req) => {
      await assert('manage_credentials', { type: 'credential' });
      const body = z
        .object({
          key: z.string(),
          name: z.string(),
          provider: z.string(),
          authType: z.string(),
          applicationId: z.string().nullish(),
          environment: z.string().nullish(),
          secret: z.record(z.unknown()),
          metadata: z.record(z.unknown()).optional(),
          scopes: z.array(z.string()).optional(),
          accountLabel: z.string().optional(),
        })
        .parse(req.body);
      const cred = await credentialManager.create(body as never);
      await audit({ action: 'credential.create', resourceType: 'credential', resourceId: cred.id, metadata: { provider: cred.provider } });
      return cred; // metadata only — no secret
    }),
  );

  app.post(
    '/credentials/:id/rotate',
    authed(async (req) => {
      await assert('manage_credentials', { type: 'credential' });
      const { id } = req.params as { id: string };
      const body = z.object({ secret: z.record(z.unknown()) }).parse(req.body);
      const cred = await credentialManager.rotate(id, body.secret);
      await audit({ action: 'credential.rotate', resourceType: 'credential', resourceId: id });
      return cred;
    }),
  );

  app.post(
    '/credentials/:id/revoke',
    authed(async (req) => {
      await assert('manage_credentials', { type: 'credential' });
      const { id } = req.params as { id: string };
      await credentialManager.revoke(id);
      await audit({ action: 'credential.revoke', resourceType: 'credential', resourceId: id });
      return { ok: true };
    }),
  );

  app.get(
    '/credentials/:id/dependencies',
    authed(async (req) => {
      await assert('manage_credentials', { type: 'credential' });
      const { id } = req.params as { id: string };
      return credentialManager.dependencies(id);
    }),
  );
}
