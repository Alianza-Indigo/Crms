import { and, eq, inArray, schema, withElevated } from '@crms/database';
import { createLogger } from '@crms/kernel';
import { buildContext, runWithBuiltContext } from '@crms/tenant-context';

const logger = createLogger('worker:automations');

/**
 * Claim queued automation runs (SKIP LOCKED) and execute each within its
 * tenant's context. Failures are left for the automation engine to mark
 * failed/dead-letter; this loop only handles claiming + context binding.
 */
export async function drainAutomationRuns(
  run: (runId: string) => Promise<void>,
  batchSize: number,
): Promise<number> {
  const claimed = await withElevated(async (tx) => {
    const due = await tx
      .select()
      .from(schema.automationRuns)
      .where(eq(schema.automationRuns.status, 'queued'))
      .limit(batchSize)
      .for('update', { skipLocked: true });
    if (due.length === 0) return [];
    await tx
      .update(schema.automationRuns)
      .set({ status: 'running' })
      .where(inArray(schema.automationRuns.id, due.map((r) => r.id)));
    return due;
  });

  for (const r of claimed) {
    const ctx = buildContext({
      tenantId: r.tenantId,
      applicationId: r.applicationId,
      environment: r.environment as never,
      origin: 'automation',
      correlationId: r.correlationId ?? undefined,
      roleIds: ['__owner__'],
    });
    try {
      await runWithBuiltContext(ctx, () => run(r.id));
    } catch (err) {
      logger.warn({ err, runId: r.id }, 'Automation run threw; engine will retry/dead-letter');
    }
  }
  void and;
  return claimed.length;
}
