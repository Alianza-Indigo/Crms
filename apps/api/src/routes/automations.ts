import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { and, desc, eq, schema, withTenant } from '@crms/database';
import { newId, NotFound } from '@crms/kernel';
import { getContext } from '@crms/tenant-context';
import { assert } from '@crms/permissions';
import { resolveApproval } from '@crms/automation-engine';
import { authed } from '../lib/context.js';

/**
 * Automation definitions + runs (PRD §16). Definitions are versioned graphs;
 * runs execute asynchronously in the worker with resumable waits/approvals.
 */
export async function automationRoutes(app: FastifyInstance): Promise<void> {
  app.get('/automations', authed(async () => {
    const ctx = getContext();
    return withTenant(async (tx) =>
      tx
        .select()
        .from(schema.automationDefinitions)
        .where(
          and(
            eq(schema.automationDefinitions.applicationId, ctx.applicationId ?? ''),
            eq(schema.automationDefinitions.environment, ctx.environment),
          ),
        ),
    );
  }));

  app.post(
    '/automations',
    authed(async (req) => {
      await assert('manage_config', { type: 'automation' });
      const ctx = getContext();
      if (!ctx.applicationId) throw NotFound('application context');
      const body = z
        .object({
          key: z.string(),
          name: z.string(),
          status: z.enum(['active', 'paused', 'disabled', 'draft']).default('active'),
          trigger: z.record(z.unknown()).default({}),
          graph: z.object({ start: z.string().optional(), nodes: z.array(z.any()), edges: z.array(z.any()).optional() }),
        })
        .parse(req.body);
      const id = newId('automation');
      await withTenant(async (tx) => {
        await tx.insert(schema.automationDefinitions).values({
          id,
          tenantId: ctx.tenantId,
          applicationId: ctx.applicationId!,
          environment: ctx.environment,
          key: body.key,
          name: body.name,
          status: body.status,
          trigger: body.trigger,
          graph: body.graph as never,
          createdBy: ctx.userId,
        });
      });
      return { id };
    }),
  );

  app.get('/automations/runs', authed(async (req) => {
    const q = req.query as { automationId?: string };
    return withTenant(async (tx) =>
      tx
        .select()
        .from(schema.automationRuns)
        .where(q.automationId ? eq(schema.automationRuns.automationId, q.automationId) : undefined)
        .orderBy(desc(schema.automationRuns.createdAt))
        .limit(50),
    );
  }));

  app.post(
    '/automations/runs/:id/approve',
    authed(async (req) => {
      await assert('approve', { type: 'automation' });
      const { id } = req.params as { id: string };
      const body = z.object({ decision: z.enum(['approved', 'rejected']) }).parse(req.body);
      await resolveApproval(id, body.decision);
      return { ok: true };
    }),
  );
}
