import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { aiPlanService, generatePlanFromPrompt } from '@crms/ai-engine';
import { audit } from '@crms/audit';
import { authed } from '../lib/context.js';

/**
 * AI routes (PRD §9). The AI proposes a persisted, approvable plan; destructive
 * operations require explicit approval before execution. Every plan action is
 * audited.
 */
export async function aiRoutes(app: FastifyInstance): Promise<void> {
  // Generate an application design from a natural-language description (PRD §9.1).
  // Uses the tenant's BYO AI credential; returns a plan to review + approve.
  app.post(
    '/ai/generate',
    authed(async (req) => {
      const body = z
        .object({ prompt: z.string().min(4), provider: z.string().default('openai'), credentialKey: z.string().optional(), credentialId: z.string().optional() })
        .parse(req.body);
      const result = await generatePlanFromPrompt(body);
      await audit({ action: 'ai.generate', resourceType: 'ai_plan', resourceId: result.planId });
      return result;
    }),
  );

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
}
