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

  // Mobile/offline delta sync (PRD §27.1): changes + tombstones since a cursor.
  app.get(
    '/modules/:moduleId/sync',
    authed(async (req) => {
      const { moduleId } = req.params as { moduleId: string };
      const q = req.query as { since?: string; limit?: string };
      return recordsEngine.sync(moduleId, q.since, q.limit ? Number(q.limit) : undefined);
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

  app.post(
    '/modules/:moduleId/records/:recordId/restore',
    authed(async (req) => {
      const { moduleId, recordId } = req.params as { moduleId: string; recordId: string };
      await recordsEngine.restore(moduleId, recordId);
      return { ok: true };
    }),
  );

  app.post(
    '/modules/:moduleId/records/:recordId/duplicate',
    authed(async (req) => {
      const { moduleId, recordId } = req.params as { moduleId: string; recordId: string };
      return recordsEngine.duplicate(moduleId, recordId);
    }),
  );

  app.post(
    '/modules/:moduleId/records/:recordId/assign',
    authed(async (req) => {
      const { moduleId, recordId } = req.params as { moduleId: string; recordId: string };
      const body = z.object({ assigneeUserId: z.string().nullable() }).parse(req.body);
      await recordsEngine.assign(moduleId, recordId, body.assigneeUserId);
      return { ok: true };
    }),
  );

  app.post(
    '/modules/:moduleId/records/:recordId/transfer',
    authed(async (req) => {
      const { moduleId, recordId } = req.params as { moduleId: string; recordId: string };
      const body = z.object({ ownerUserId: z.string() }).parse(req.body);
      await recordsEngine.transfer(moduleId, recordId, body.ownerUserId);
      return { ok: true };
    }),
  );

  app.post(
    '/modules/:moduleId/records/:recordId/approval',
    authed(async (req) => {
      const { moduleId, recordId } = req.params as { moduleId: string; recordId: string };
      const body = z.object({ decision: z.enum(['approved', 'rejected']), reason: z.string().optional() }).parse(req.body);
      await recordsEngine.setApproval(moduleId, recordId, body.decision, body.reason);
      return { ok: true };
    }),
  );

  app.post(
    '/modules/:moduleId/records/:recordId/lock',
    authed(async (req) => {
      const { moduleId, recordId } = req.params as { moduleId: string; recordId: string };
      const lock = (req.query as { unlock?: string }).unlock !== 'true';
      if (lock) await recordsEngine.lock(moduleId, recordId);
      else await recordsEngine.unlock(moduleId, recordId);
      return { ok: true, locked: lock };
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
