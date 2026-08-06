import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { recordsEngine } from '@crms/records-engine';
import { withIdempotency } from '@crms/idempotency';
import { IDEMPOTENCY_HEADER } from '@crms/config';
import { authed } from '../lib/context.js';

/**
 * Record CRUD (PRD §12). Creation + critical mutations honor Idempotency-Key
 * (PRD §12.1). All access flows through the records engine → query engine, so
 * tenant/app/env scoping and permissions are always applied.
 */
export async function recordRoutes(app: FastifyInstance): Promise<void> {
  app.post(
    '/modules/:moduleId/records/query',
    authed(async (req) => {
      const { moduleId } = req.params as { moduleId: string };
      const body = z
        .object({
          filters: z.array(z.object({ field: z.string(), operator: z.string(), value: z.unknown().optional() })).optional(),
          sorts: z.array(z.object({ field: z.string(), direction: z.enum(['asc', 'desc']) })).optional(),
          limit: z.number().optional(),
          cursor: z.string().optional(),
          includeArchived: z.boolean().optional(),
        })
        .parse(req.body ?? {});
      return recordsEngine.list({ moduleId, ...(body as object) } as never);
    }),
  );

  app.get(
    '/modules/:moduleId/records/:recordId',
    authed(async (req) => {
      const { moduleId, recordId } = req.params as { moduleId: string; recordId: string };
      return recordsEngine.get(moduleId, recordId);
    }),
  );

  app.post(
    '/modules/:moduleId/records',
    authed(async (req) => {
      const { moduleId } = req.params as { moduleId: string };
      const body = z
        .object({
          data: z.record(z.unknown()),
          ownerUserId: z.string().optional(),
          assigneeUserId: z.string().optional(),
          teamId: z.string().optional(),
          branchId: z.string().optional(),
          stage: z.string().optional(),
        })
        .parse(req.body);
      const key = req.headers[IDEMPOTENCY_HEADER] as string | undefined;
      return withIdempotency({ operation: `record.create:${moduleId}`, key, request: body }, () =>
        recordsEngine.create({ moduleId, ...body }),
      );
    }),
  );

  app.patch(
    '/modules/:moduleId/records/:recordId',
    authed(async (req) => {
      const { moduleId, recordId } = req.params as { moduleId: string; recordId: string };
      const body = z.object({ patch: z.record(z.unknown()) }).parse(req.body);
      return recordsEngine.update(moduleId, recordId, body.patch);
    }),
  );

  app.post(
    '/modules/:moduleId/records/:recordId/archive',
    authed(async (req) => {
      const { moduleId, recordId } = req.params as { moduleId: string; recordId: string };
      await recordsEngine.archive(moduleId, recordId);
      return { ok: true };
    }),
  );

  app.delete(
    '/modules/:moduleId/records/:recordId',
    authed(async (req) => {
      const { moduleId, recordId } = req.params as { moduleId: string; recordId: string };
      const confirm = (req.query as { confirm?: string }).confirm === 'true';
      await recordsEngine.delete(moduleId, recordId, { confirm });
      return { ok: true };
    }),
  );
}
