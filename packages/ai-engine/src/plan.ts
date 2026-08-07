import { z } from 'zod';
import { and, eq, schema, withTenant } from '@crms/database';
import { newId, NotFound, Forbidden, DestructiveUnconfirmed, createLogger } from '@crms/kernel';
import { getContext } from '@crms/tenant-context';
import { schemaEngine } from '@crms/schema-engine';
import { createView, createForm, createPipeline, createDashboard } from '@crms/builder-engine';

const logger = createLogger('ai-engine');

/**
 * AIPlan (PRD §9.3). Before the AI mutates an application it MUST produce a
 * persisted, structured, approvable plan. Destructive operations (delete
 * module/field, drop data) require explicit human approval (PRD §9.4). Execution
 * is auditable and each operation records its result for partial rollback.
 */
export const AiOperationSchema = z.object({
  op: z.enum([
    'create_module',
    'create_field',
    'create_relation',
    'create_view',
    'create_form',
    'create_pipeline',
    'create_dashboard',
    'create_automation',
    'create_role',
    'create_document_template',
    'create_portal',
    'create_agent',
    'delete_module',
    'delete_field',
  ]),
  args: z.record(z.unknown()),
  destructive: z.boolean().default(false),
});
export type AiOperation = z.infer<typeof AiOperationSchema>;

export const AiPlanInputSchema = z.object({
  summary: z.string(),
  operations: z.array(AiOperationSchema),
  conversationId: z.string().optional(),
  requiredCredentials: z.array(z.string()).default([]),
  expiresInHours: z.number().default(24),
});
export type AiPlanInput = z.infer<typeof AiPlanInputSchema>;

function riskOf(operations: AiOperation[]): 'low' | 'medium' | 'high' | 'critical' {
  if (operations.some((o) => o.destructive)) return 'high';
  if (operations.length > 10) return 'medium';
  return 'low';
}

export class AiPlanService {
  async create(input: AiPlanInput): Promise<string> {
    const data = AiPlanInputSchema.parse(input);
    const ctx = getContext();
    const id = newId('aiPlan');
    const risk = riskOf(data.operations);
    await withTenant(async (tx) => {
      await tx.insert(schema.aiPlans).values({
        id,
        tenantId: ctx.tenantId,
        applicationId: ctx.applicationId,
        environment: ctx.environment,
        conversationId: data.conversationId,
        summary: data.summary,
        operations: data.operations,
        riskLevel: risk,
        requiredCredentials: data.requiredCredentials,
        requiredApprovals: risk === 'high' ? [{ role: 'admin' }] : [],
        status: data.operations.some((o) => o.destructive) ? 'pending_approval' : 'draft',
        createdByUserId: ctx.userId,
        expiresAt: new Date(Date.now() + data.expiresInHours * 3600 * 1000),
      });
    });
    logger.info({ planId: id, risk, ops: data.operations.length }, 'AIPlan created');
    return id;
  }

  async approve(planId: string): Promise<void> {
    const ctx = getContext();
    await withTenant(async (tx) => {
      const [plan] = await tx.select().from(schema.aiPlans).where(eq(schema.aiPlans.id, planId));
      if (!plan) throw NotFound('AIPlan', planId);
      if (plan.expiresAt && plan.expiresAt < new Date()) throw Forbidden('This plan has expired');
      await tx
        .update(schema.aiPlans)
        .set({ status: 'approved', approvedByUserId: ctx.userId })
        .where(eq(schema.aiPlans.id, planId));
    });
  }

  /**
   * Execute an approved (or non-destructive draft) plan against the schema
   * engine. Destructive ops without approval are rejected. Each op result is
   * recorded for auditability and possible rollback.
   */
  async execute(planId: string): Promise<{ executionId: string; results: unknown[] }> {
    const ctx = getContext();
    const plan = await withTenant(async (tx) => {
      const [row] = await tx.select().from(schema.aiPlans).where(eq(schema.aiPlans.id, planId));
      return row ?? null;
    });
    if (!plan) throw NotFound('AIPlan', planId);

    const operations = plan.operations as AiOperation[];
    const needsApproval = operations.some((o) => o.destructive);
    if (needsApproval && plan.status !== 'approved') {
      throw DestructiveUnconfirmed('ai_plan_execute', { planId, summary: plan.summary });
    }

    const executionId = newId('aiExecution');
    await withTenant(async (tx) => {
      await tx.insert(schema.aiExecutions).values({
        id: executionId,
        tenantId: ctx.tenantId,
        planId,
        status: 'running',
        startedAt: new Date(),
        correlationId: ctx.correlationId,
      });
      await tx.update(schema.aiPlans).set({ status: 'executing' }).where(eq(schema.aiPlans.id, planId));
    });

    const results: unknown[] = [];
    try {
      for (const op of operations) {
        results.push(await this.applyOperation(op));
      }
      await withTenant(async (tx) => {
        await tx
          .update(schema.aiExecutions)
          .set({ status: 'succeeded', results, finishedAt: new Date() })
          .where(eq(schema.aiExecutions.id, executionId));
        await tx.update(schema.aiPlans).set({ status: 'executed' }).where(eq(schema.aiPlans.id, planId));
      });
      logger.info({ planId, executionId, count: results.length }, 'AIPlan executed');
    } catch (err) {
      await withTenant(async (tx) => {
        await tx
          .update(schema.aiExecutions)
          .set({ status: 'failed', results, error: { message: (err as Error).message }, finishedAt: new Date() })
          .where(eq(schema.aiExecutions.id, executionId));
        await tx.update(schema.aiPlans).set({ status: 'failed' }).where(eq(schema.aiPlans.id, planId));
      });
      throw err;
    }
    return { executionId, results };
  }

  private async applyOperation(op: AiOperation): Promise<unknown> {
    // Generated plans reference modules by key; resolve to ids at execution.
    const args = await resolveModuleKeys(op.args);
    switch (op.op) {
      case 'create_module':
        return schemaEngine.createModule(args as never);
      case 'create_field':
        return schemaEngine.createField(args as never);
      case 'create_relation':
        return schemaEngine.createRelation(args as never);
      case 'create_view':
        return createView(args as never);
      case 'create_form':
        return createForm(args as never);
      case 'create_pipeline':
        return createPipeline(args as never);
      case 'create_dashboard': {
        // Each widget references its module by key; resolve to ids.
        const widgets = Array.isArray(args.widgets) ? (args.widgets as Array<Record<string, unknown>>) : [];
        for (const w of widgets) {
          if (typeof w.moduleKey === 'string' && !w.moduleId) {
            const id = await moduleIdForKey(w.moduleKey);
            if (id) w.moduleId = id;
          }
        }
        return createDashboard({ key: args.key as string, name: args.name as string, widgets: widgets as never });
      }
      case 'create_automation': {
        const ctx = getContext();
        const trigger = { ...((args.trigger as Record<string, unknown>) ?? {}) };
        if (typeof trigger.moduleKey === 'string' && !trigger.moduleId) {
          const id = await moduleIdForKey(trigger.moduleKey);
          if (id) trigger.moduleId = id;
        }
        const autoId = newId('automation');
        await withTenant(async (tx) => {
          await tx.insert(schema.automationDefinitions).values({
            id: autoId,
            tenantId: ctx.tenantId,
            applicationId: ctx.applicationId!,
            environment: ctx.environment,
            key: args.key as string,
            name: args.name as string,
            status: 'active',
            trigger,
            graph: (args.graph as never) ?? ({ nodes: [] } as never),
            createdBy: ctx.userId,
          });
        });
        return { id: autoId, op: 'create_automation' };
      }
      case 'create_role': {
        const ctx = getContext();
        const roleId = newId('role');
        await withTenant(async (tx) => {
          await tx.insert(schema.roles).values({
            id: roleId,
            tenantId: ctx.tenantId,
            applicationId: ctx.applicationId ?? null,
            name: args.name as string,
            description: (args.description as string) ?? null,
            permissions: (args.permissions as string[]) ?? [],
            createdBy: ctx.userId,
          });
        });
        return { id: roleId, op: 'create_role' };
      }
      case 'create_document_template': {
        const ctx = getContext();
        const tplId = newId('documentTemplate');
        await withTenant(async (tx) => {
          await tx.insert(schema.documentTemplates).values({
            id: tplId,
            tenantId: ctx.tenantId,
            applicationId: ctx.applicationId ?? '',
            environment: ctx.environment,
            key: args.key as string,
            name: args.name as string,
            kind: 'document',
            body: { html: (args.html as string) ?? '<h1>{{title}}</h1>' },
            outputs: ['pdf'],
            moduleId: (args.moduleId as string) ?? null,
            createdBy: ctx.userId,
          });
        });
        return { id: tplId, op: 'create_document_template' };
      }
      case 'create_portal': {
        const ctx = getContext();
        const moduleIds = await moduleIdsForKeys((args.moduleKeys as string[]) ?? []);
        const portalId = newId('portal');
        await withTenant(async (tx) => {
          await tx.insert(schema.portalDefinitions).values({
            id: portalId,
            tenantId: ctx.tenantId,
            applicationId: ctx.applicationId ?? '',
            environment: ctx.environment,
            key: args.key as string,
            name: args.name as string,
            audience: (args.audience as string) ?? 'clients',
            exposure: { modules: moduleIds.map((id) => ({ moduleId: id, actions: ['view', 'create'] })) } as never,
            active: true,
            createdBy: ctx.userId,
          });
        });
        return { id: portalId, op: 'create_portal' };
      }
      case 'create_agent': {
        const ctx = getContext();
        const accessibleModuleIds = await moduleIdsForKeys((args.accessibleModuleKeys as string[]) ?? []);
        const agentId = newId('agent');
        await withTenant(async (tx) => {
          await tx.insert(schema.agentDefinitions).values({
            id: agentId,
            tenantId: ctx.tenantId,
            applicationId: ctx.applicationId!,
            environment: ctx.environment,
            name: args.name as string,
            purpose: (args.purpose as string) ?? null,
            instructions: (args.instructions as string) ?? null,
            provider: (args.provider as string) ?? 'google_ai',
            accessibleModuleIds,
            allowedActions: (args.allowedActions as string[]) ?? ['read_records'],
            createdBy: ctx.userId,
          });
        });
        return { id: agentId, op: 'create_agent' };
      }
      case 'delete_module':
        return schemaEngine.deleteModule(args.moduleId as string, { confirm: true });
      case 'delete_field':
        return schemaEngine.deleteField(args.fieldId as string, { confirm: true });
      default:
        return { skipped: op.op, reason: 'operation not yet supported' };
    }
  }
}

/** Resolve several module keys → ids (skips unknown keys). */
async function moduleIdsForKeys(keys: string[]): Promise<string[]> {
  const ids: string[] = [];
  for (const k of keys) {
    const id = await moduleIdForKey(k);
    if (id) ids.push(id);
  }
  return ids;
}

/** Resolve a single module key → id within the current app/env. */
async function moduleIdForKey(key: string): Promise<string | null> {
  const ctx = getContext();
  if (!ctx.applicationId) return null;
  return withTenant(async (tx) => {
    const [row] = await tx
      .select()
      .from(schema.moduleDefinitions)
      .where(
        and(
          eq(schema.moduleDefinitions.applicationId, ctx.applicationId!),
          eq(schema.moduleDefinitions.environment, ctx.environment),
          eq(schema.moduleDefinitions.key, key),
        ),
      );
    return row?.id ?? null;
  });
}

/** Resolve module keys → ids within the current app/env (for generated plans). */
async function resolveModuleKeys(args: Record<string, unknown>): Promise<Record<string, unknown>> {
  const ctx = getContext();
  if (!ctx.applicationId) return args;
  const out = { ...args };
  const map: Array<[string, string]> = [
    ['moduleKey', 'moduleId'],
    ['sourceModuleKey', 'sourceModuleId'],
    ['targetModuleKey', 'targetModuleId'],
  ];
  for (const [keyField, idField] of map) {
    const key = args[keyField];
    if (typeof key !== 'string' || out[idField]) continue;
    const mod = await withTenant(async (tx) => {
      const [row] = await tx
        .select()
        .from(schema.moduleDefinitions)
        .where(
          and(
            eq(schema.moduleDefinitions.applicationId, ctx.applicationId!),
            eq(schema.moduleDefinitions.environment, ctx.environment),
            eq(schema.moduleDefinitions.key, key),
          ),
        );
      return row ?? null;
    });
    if (mod) out[idField] = mod.id;
  }
  return out;
}

export const aiPlanService = new AiPlanService();
