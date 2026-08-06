import { and, eq, schema, withTenant } from '@crms/database';
import { newId, NotFound, ValidationError, Forbidden, createLogger } from '@crms/kernel';
import { getContext } from '@crms/tenant-context';
import { assert } from '@crms/permissions';
import { recordsEngine } from '@crms/records-engine';

const logger = createLogger('builder-engine:pipelines');

export interface Stage {
  key: string;
  name: string;
  requiredFields?: string[];
}
export interface Transition {
  from: string;
  to: string;
  /** Optional role gate for this transition. */
  roles?: string[];
}

export async function createPipeline(input: {
  moduleId: string;
  key: string;
  name: string;
  stages: Stage[];
  transitions: Transition[];
  stageFieldId?: string;
}): Promise<typeof schema.pipelineDefinitions.$inferSelect> {
  await assert('manage_config', { type: 'application' });
  const ctx = getContext();
  if (!ctx.applicationId) throw ValidationError('Pipeline operations require an application context');
  const id = newId('workflow');
  return withTenant(async (tx) => {
    await tx.insert(schema.pipelineDefinitions).values({
      id,
      tenantId: ctx.tenantId,
      applicationId: ctx.applicationId!,
      environment: ctx.environment,
      moduleId: input.moduleId,
      key: input.key,
      name: input.name,
      stages: input.stages,
      transitions: input.transitions,
      stageFieldId: input.stageFieldId,
      createdBy: ctx.userId,
    });
    const [row] = await tx.select().from(schema.pipelineDefinitions).where(eq(schema.pipelineDefinitions.id, id));
    return row!;
  });
}

export async function listPipelines(moduleId: string): Promise<Array<typeof schema.pipelineDefinitions.$inferSelect>> {
  return withTenant(async (tx) => tx.select().from(schema.pipelineDefinitions).where(eq(schema.pipelineDefinitions.moduleId, moduleId)));
}

/**
 * Move a record to a new stage (PRD §15). Validates the transition is allowed
 * from the record's current stage, that stage-required fields are present, and
 * (optionally) that the actor holds a required role. Applies via records-engine.
 */
export async function transition(pipelineId: string, recordId: string, toStage: string): Promise<void> {
  const ctx = getContext();
  const pipeline = await withTenant(async (tx) => {
    const [row] = await tx.select().from(schema.pipelineDefinitions).where(eq(schema.pipelineDefinitions.id, pipelineId));
    return row ?? null;
  });
  if (!pipeline) throw NotFound('Pipeline', pipelineId);

  const record = await recordsEngine.get(pipeline.moduleId, recordId);
  const from = record.stage ?? '';
  const stages = pipeline.stages as Stage[];
  const transitions = pipeline.transitions as Transition[];

  const target = stages.find((s) => s.key === toStage);
  if (!target) throw ValidationError(`Unknown stage '${toStage}'`);

  const allowed = transitions.find((t) => t.from === from && t.to === toStage) ?? (from === '' ? { from: '', to: toStage } : null);
  if (!allowed) throw ValidationError(`Transition '${from}' → '${toStage}' is not allowed`);
  if (allowed.roles?.length && !allowed.roles.some((r) => ctx.roleIds.includes(r)) && !ctx.roleIds.includes('__owner__')) {
    throw Forbidden(`You are not permitted to perform the '${from}' → '${toStage}' transition`);
  }

  const data = record.data as Record<string, unknown>;
  const missing = (target.requiredFields ?? []).filter((f) => data[f] === undefined || data[f] === null || data[f] === '');
  if (missing.length) throw ValidationError(`Stage '${toStage}' requires: ${missing.join(', ')}`);

  await recordsEngine.update(pipeline.moduleId, recordId, { stage: toStage });
  logger.info({ pipelineId, recordId, from, to: toStage }, 'Pipeline transition applied');
}
