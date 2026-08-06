import { schema, sql, eq, and, lte, inArray, withElevated, type DbExecutor } from '@crms/database';
import { newId, createLogger } from '@crms/kernel';
import type { DomainEvent } from '@crms/events';

const logger = createLogger('outbox');

/**
 * Transactional Outbox (PRD §16.5).
 *
 * `writeEvent` MUST be called with the SAME transaction handle as the mutation
 * that produced the event, so the event and the state change commit atomically.
 * A separate dispatcher (run by the worker) then publishes events, runs
 * automations and enqueues webhook deliveries — never inside the write path.
 */
export async function writeEvent(tx: DbExecutor, event: DomainEvent): Promise<void> {
  await tx.insert(schema.outboxMessages).values({
    id: newId('outbox'),
    tenantId: event.tenantId,
    applicationId: event.applicationId,
    environment: event.environment,
    type: event.type,
    payload: event as unknown as Record<string, unknown>,
    schemaVersion: event.schemaVersion,
    aggregateType: event.moduleId ? 'record' : null,
    aggregateId: event.recordId ?? null,
    correlationId: event.correlationId,
    status: 'pending',
  });
}

export interface DispatchHandler {
  /** Publish a single event. Throw to trigger retry/backoff. */
  (event: DomainEvent): Promise<void>;
}

const MAX_ATTEMPTS = 8;

function backoffMs(attempt: number): number {
  return Math.min(2 ** attempt * 1000, 5 * 60 * 1000);
}

/**
 * Claim a batch of due outbox messages, publish them via `handler`, and mark
 * results. Uses SELECT ... FOR UPDATE SKIP LOCKED so multiple worker instances
 * can dispatch concurrently without double-processing (backpressure-friendly).
 */
export async function dispatchBatch(handler: DispatchHandler, batchSize = 50): Promise<number> {
  return withElevated(async (tx) => {
    const due = await tx
      .select()
      .from(schema.outboxMessages)
      .where(
        and(
          inArray(schema.outboxMessages.status, ['pending', 'failed']),
          lte(schema.outboxMessages.nextAttemptAt, new Date()),
        ),
      )
      .limit(batchSize)
      .for('update', { skipLocked: true });

    if (due.length === 0) return 0;

    const ids = due.map((m) => m.id);
    await tx
      .update(schema.outboxMessages)
      .set({ status: 'processing' })
      .where(inArray(schema.outboxMessages.id, ids));

    let processed = 0;
    for (const msg of due) {
      const attempt = msg.attempts + 1;
      try {
        await handler(msg.payload as unknown as DomainEvent);
        await tx
          .update(schema.outboxMessages)
          .set({ status: 'published', publishedAt: new Date(), attempts: attempt, lastError: null })
          .where(eq(schema.outboxMessages.id, msg.id));
        processed++;
      } catch (err) {
        const dead = attempt >= MAX_ATTEMPTS;
        await tx
          .update(schema.outboxMessages)
          .set({
            status: dead ? 'dead_letter' : 'failed',
            attempts: attempt,
            lastError: err instanceof Error ? err.message : String(err),
            nextAttemptAt: new Date(Date.now() + backoffMs(attempt)),
          })
          .where(eq(schema.outboxMessages.id, msg.id));
        logger.warn({ err, outboxId: msg.id, attempt, dead }, 'Outbox dispatch failed');
      }
    }
    return processed;
  });
}
