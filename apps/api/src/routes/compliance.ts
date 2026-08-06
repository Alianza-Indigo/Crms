import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { exportSubjectData, eraseSubjectData } from '@crms/compliance';
import { assert } from '@crms/permissions';
import { audit } from '@crms/audit';
import { authed } from '../lib/context.js';

/**
 * Data governance (PRD §33): data-subject access request (export) and erasure.
 * Restricted to tenant administrators and fully audited.
 */
export async function complianceRoutes(app: FastifyInstance): Promise<void> {
  app.post(
    '/compliance/export',
    authed(async (req) => {
      await assert('manage_config', { type: 'tenant' });
      const body = z.object({ userId: z.string() }).parse(req.body);
      const result = await exportSubjectData(body.userId);
      await audit({ action: 'compliance.export', resourceType: 'user', resourceId: body.userId, metadata: { records: result.records } });
      return result;
    }),
  );

  app.post(
    '/compliance/erase',
    authed(async (req) => {
      await assert('manage_config', { type: 'tenant' });
      const body = z.object({ userId: z.string(), confirm: z.boolean().default(false) }).parse(req.body);
      const result = await eraseSubjectData(body.userId, { confirm: body.confirm });
      await audit({ action: 'compliance.erase', resourceType: 'user', resourceId: body.userId, metadata: result });
      return result;
    }),
  );
}
