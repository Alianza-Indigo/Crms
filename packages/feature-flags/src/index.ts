import { createHash } from 'node:crypto';
import { and, eq, isNull, or, schema, withTenant, withElevated } from '@crms/database';
import { newId } from '@crms/kernel';
import { getContext } from '@crms/tenant-context';

/**
 * Feature Flag Engine (PRD §44.1). Evaluates a flag for the current context,
 * honoring targeting rules (tenant/app/env/plan/reseller/user/role/region/
 * version/cohort) and percentage rollout. Flags NEVER replace permissions.
 */
export interface FlagRule {
  attribute: 'tenant' | 'application' | 'environment' | 'plan' | 'reseller' | 'user' | 'role' | 'region' | 'version' | 'cohort';
  operator: 'eq' | 'in';
  value: string | string[];
}

function stableBucket(key: string): number {
  const hash = createHash('sha1').update(key).digest();
  return (hash.readUInt32BE(0) % 10000) / 100; // 0..100
}

export async function isEnabled(flagKey: string, extra: Record<string, string> = {}): Promise<boolean> {
  const ctx = getContext();
  const flag = await withTenant(async (tx) => {
    const [row] = await tx
      .select()
      .from(schema.featureFlags)
      .where(
        and(
          eq(schema.featureFlags.key, flagKey),
          or(eq(schema.featureFlags.tenantId, ctx.tenantId), isNull(schema.featureFlags.tenantId)),
        ),
      )
      .limit(1);
    return row ?? null;
  });
  if (!flag || !flag.enabled) return false;

  const attributes: Record<string, string | undefined> = {
    tenant: ctx.tenantId,
    application: ctx.applicationId ?? undefined,
    environment: ctx.environment,
    user: ctx.userId ?? undefined,
    role: ctx.roleIds[0],
    ...extra,
  };

  const rules = (flag.rules as FlagRule[]) ?? [];
  for (const rule of rules) {
    const actual = attributes[rule.attribute];
    if (actual === undefined) return false;
    if (rule.operator === 'eq' && actual !== rule.value) return false;
    if (rule.operator === 'in' && Array.isArray(rule.value) && !rule.value.includes(actual)) return false;
  }

  const rollout = Number(flag.rolloutPercentage ?? '100');
  if (rollout >= 100) return true;
  const bucketKey = `${flag.id}:${ctx.tenantId}:${ctx.userId ?? 'anon'}`;
  return stableBucket(bucketKey) < rollout;
}

export async function setFlag(input: {
  key: string;
  enabled: boolean;
  tenantId?: string | null;
  rules?: FlagRule[];
  rolloutPercentage?: number;
  description?: string;
}): Promise<void> {
  const ctx = getContext();
  await withElevated(async (tx) => {
    await tx
      .insert(schema.featureFlags)
      .values({
        id: newId('featureFlag'),
        tenantId: input.tenantId === undefined ? ctx.tenantId : input.tenantId,
        key: input.key,
        enabled: input.enabled,
        rules: input.rules ?? [],
        rolloutPercentage: String(input.rolloutPercentage ?? 100),
        description: input.description,
        createdBy: ctx.userId,
      })
      .onConflictDoUpdate({
        target: [schema.featureFlags.tenantId, schema.featureFlags.key],
        set: {
          enabled: input.enabled,
          rules: input.rules ?? [],
          rolloutPercentage: String(input.rolloutPercentage ?? 100),
          updatedBy: ctx.userId,
        },
      });
  });
}
