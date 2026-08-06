import { createHash } from 'node:crypto';
import { and, eq, schema, withTenant } from '@crms/database';
import { newId, AppError, createLogger } from '@crms/kernel';
import { IDEMPOTENCY_TTL_HOURS } from '@crms/config';
import { getContext } from '@crms/tenant-context';

const logger = createLogger('idempotency');

export function hashRequest(body: unknown): string {
  return createHash('sha256').update(JSON.stringify(body ?? null)).digest('base64url');
}

/**
 * Idempotency-Key handling (PRD §12.1).
 *
 * Wraps a side-effecting operation so that:
 *  - Same key + same request body  → returns the stored response, no re-exec.
 *  - Same key + different body      → rejected with IDEMPOTENCY_CONFLICT.
 *  - New key                        → executes `operation`, stores the result.
 *
 * The store row is created in-progress first (unique constraint prevents two
 * concurrent requests both executing) and finalized with the response reference.
 */
export async function withIdempotency<T>(
  params: { operation: string; key: string | null | undefined; request: unknown },
  operation: () => Promise<T>,
): Promise<T> {
  const { key } = params;
  if (!key) return operation();

  const ctx = getContext();
  const requestHash = hashRequest(params.request);
  const expiresAt = new Date(Date.now() + IDEMPOTENCY_TTL_HOURS * 3600 * 1000);

  const existing = await withTenant(async (tx) => {
    const [row] = await tx
      .select()
      .from(schema.idempotencyStore)
      .where(
        and(
          eq(schema.idempotencyStore.operation, params.operation),
          eq(schema.idempotencyStore.key, key),
        ),
      );
    return row ?? null;
  });

  if (existing) {
    if (existing.requestHash !== requestHash) {
      throw new AppError('IDEMPOTENCY_CONFLICT', 'Idempotency-Key reused with a different request body', {
        details: { operation: params.operation },
      });
    }
    if (existing.status === 'completed') {
      logger.info({ key, operation: params.operation }, 'Idempotent replay');
      return existing.responseReference as T;
    }
    // in_progress or failed: allow re-execution (previous attempt did not commit).
  } else {
    await withTenant(async (tx) => {
      await tx
        .insert(schema.idempotencyStore)
        .values({
          id: newId('outbox'),
          tenantId: ctx.tenantId,
          applicationId: ctx.applicationId,
          environment: ctx.environment,
          operation: params.operation,
          key,
          requestHash,
          status: 'in_progress',
          expiresAt,
        })
        .onConflictDoNothing();
    });
  }

  try {
    const result = await operation();
    await withTenant(async (tx) => {
      await tx
        .update(schema.idempotencyStore)
        .set({ status: 'completed', responseReference: result as Record<string, unknown> })
        .where(
          and(eq(schema.idempotencyStore.operation, params.operation), eq(schema.idempotencyStore.key, key)),
        );
    });
    return result;
  } catch (err) {
    await withTenant(async (tx) => {
      await tx
        .update(schema.idempotencyStore)
        .set({ status: 'failed' })
        .where(
          and(eq(schema.idempotencyStore.operation, params.operation), eq(schema.idempotencyStore.key, key)),
        );
    });
    throw err;
  }
}
