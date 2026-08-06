import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { aiPlanService } from '@crms/ai-engine';
import { audit } from '@crms/audit';
import { authed } from '../lib/context.js';

/**
 * AI routes (PRD §9). The AI proposes a persisted, approvable plan; destructive
 * operations require explicit approval before execution. Every plan action is
 * audited.
 */
export async function aiRoutes(app: FastifyInstance): Promise<void> {
  app.post(
    '/ai/plans',
    authed(async (req) => {
      const planId = await aiPlanService.create(req.body as never);
      await audit({ action: 'ai.plan.create', resourceType: 'ai_plan', resourceId: planId });
      return { planId };
    }),
  );

  app.post(
    '/ai/plans/:id/approve',
    authed(async (req) => {
      const { id } = req.params as { id: string };
      await aiPlanService.approve(id);
      await audit({ action: 'ai.plan.approve', resourceType: 'ai_plan', resourceId: id });
      return { ok: true };
    }),
  );

  app.post(
    '/ai/plans/:id/execute',
    authed(async (req) => {
      const { id } = req.params as { id: string };
      const result = await aiPlanService.execute(id);
      await audit({ action: 'ai.plan.execute', resourceType: 'ai_plan', resourceId: id, metadata: { executionId: result.executionId } });
      return result;
    }),
  );

  void z;
}
