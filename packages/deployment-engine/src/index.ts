import { and, eq, schema, withTenant } from '@crms/database';
import type { Environment } from '@crms/config';
import { newId, NotFound, Forbidden, DestructiveUnconfirmed, ValidationError, createLogger } from '@crms/kernel';
import { getContext } from '@crms/tenant-context';

const logger = createLogger('deployment-engine');

/**
 * Deployment Engine (PRD §8.3, §8.4). Promotes application configuration between
 * environments via a DeploymentManifest. Rules enforced:
 *  - Production destructive changes require double approval.
 *  - Credentials are referenced by logical variable, NEVER copied.
 *  - Every deployment is auditable and reversible; publish is atomic.
 */

const BUILDER_TABLES = [
  schema.moduleDefinitions,
  schema.fieldDefinitions,
  schema.relationDefinitions,
  schema.viewDefinitions,
  schema.formDefinitions,
  schema.dashboardDefinitions,
  schema.pipelineDefinitions,
  schema.automationDefinitions,
  schema.documentTemplates,
  schema.portalDefinitions,
] as const;

export interface CreateManifestInput {
  applicationId: string;
  sourceVersion: string;
  sourceEnvironment: Environment;
  targetEnvironment: Environment;
  changes?: unknown[];
  risks?: unknown[];
  requiredVariables?: string[];
  credentialRefs?: string[];
}

export async function createManifest(input: CreateManifestInput): Promise<string> {
  const ctx = getContext();
  const id = newId('deployment');
  const destructiveToProd =
    input.targetEnvironment === 'production' && (input.risks ?? []).length > 0;
  await withTenant(async (tx) => {
    await tx.insert(schema.deploymentManifests).values({
      id,
      tenantId: ctx.tenantId,
      applicationId: input.applicationId,
      sourceVersion: input.sourceVersion,
      sourceEnvironment: input.sourceEnvironment,
      targetEnvironment: input.targetEnvironment,
      changes: input.changes ?? [],
      risks: input.risks ?? [],
      requiredVariables: input.requiredVariables ?? [],
      credentialRefs: input.credentialRefs ?? [],
      riskLevel: destructiveToProd ? 'high' : 'low',
      requiredApprovals: destructiveToProd ? '2' : '1',
      status: 'draft',
      createdBy: ctx.userId,
    });
  });
  logger.info({ manifestId: id, target: input.targetEnvironment }, 'Deployment manifest created');
  return id;
}

export async function approveManifest(manifestId: string): Promise<{ approvals: number; required: number }> {
  const ctx = getContext();
  return withTenant(async (tx) => {
    const [m] = await tx.select().from(schema.deploymentManifests).where(eq(schema.deploymentManifests.id, manifestId));
    if (!m) throw NotFound('DeploymentManifest', manifestId);
    const approvals = [...(m.approvals as Array<{ userId: string }>)];
    if (approvals.some((a) => a.userId === ctx.userId)) throw ValidationError('You have already approved this manifest');
    approvals.push({ userId: ctx.userId! });
    const required = Number(m.requiredApprovals);
    const status = approvals.length >= required ? 'approved' : 'pending_approval';
    await tx
      .update(schema.deploymentManifests)
      .set({ approvals, status })
      .where(eq(schema.deploymentManifests.id, manifestId));
    return { approvals: approvals.length, required };
  });
}

/**
 * Promote: clone all builder definitions from source env → target env for the
 * application. Atomic (single transaction). Credential *references* travel;
 * credential *values* never do — each environment resolves its own by key.
 */
export async function promote(manifestId: string): Promise<void> {
  const ctx = getContext();
  await withTenant(async (tx) => {
    const [m] = await tx.select().from(schema.deploymentManifests).where(eq(schema.deploymentManifests.id, manifestId));
    if (!m) throw NotFound('DeploymentManifest', manifestId);

    const required = Number(m.requiredApprovals);
    if ((m.approvals as unknown[]).length < required) {
      throw DestructiveUnconfirmed('deployment_promote', { required, have: (m.approvals as unknown[]).length });
    }
    if (m.targetEnvironment === 'production' && m.status !== 'approved') {
      throw Forbidden('Production deployments require approval before promotion');
    }

    await tx
      .update(schema.deploymentManifests)
      .set({ status: 'deploying' })
      .where(eq(schema.deploymentManifests.id, manifestId));

    for (const table of BUILDER_TABLES) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const t = table as any;
      const sourceRows = await tx
        .select()
        .from(t)
        .where(and(eq(t.applicationId, m.applicationId), eq(t.environment, m.sourceEnvironment)));
      // Remove existing target-env config for a clean, atomic replace.
      await tx.delete(t).where(and(eq(t.applicationId, m.applicationId), eq(t.environment, m.targetEnvironment)));
      for (const row of sourceRows) {
        await tx.insert(t).values({
          ...row,
          id: newId('module'),
          environment: m.targetEnvironment,
          createdBy: ctx.userId,
        });
      }
    }

    await tx
      .update(schema.deploymentManifests)
      .set({ status: 'deployed', result: { deployedAt: new Date().toISOString() } })
      .where(eq(schema.deploymentManifests.id, manifestId));
  });
  logger.info({ manifestId }, 'Deployment promoted');
}
