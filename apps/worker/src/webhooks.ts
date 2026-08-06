import { createHmac } from 'node:crypto';
import { and, eq, inArray, lte, or, isNull, schema, withElevated } from '@crms/database';
import { newId, createLogger } from '@crms/kernel';
import { decryptSecret } from '@crms/credential-engine';
import type { DomainEvent } from '@crms/events';

const logger = createLogger('worker:webhooks');
const MAX_ATTEMPTS = 8;

function backoffMs(attempt: number): number {
  return Math.min(2 ** attempt * 1000, 5 * 60 * 1000);
}

/**
 * Webhook fan-out (PRD §16.5, §29). Called from the outbox dispatcher: for each
 * published event, create a delivery row per subscription that matches the event
 * type. Deliveries are sent by drainWebhookDeliveries, NEVER inside the mutation
 * transaction.
 */
export async function enqueueWebhookDeliveries(event: DomainEvent): Promise<number> {
  return withElevated(async (tx) => {
    const subs = await tx
      .select()
      .from(schema.webhookSubscriptions)
      .where(
        and(
          eq(schema.webhookSubscriptions.tenantId, event.tenantId),
          eq(schema.webhookSubscriptions.applicationId, event.applicationId ?? ''),
          eq(schema.webhookSubscriptions.environment, event.environment),
          eq(schema.webhookSubscriptions.active, true),
        ),
      );
    let created = 0;
    for (const sub of subs) {
      const events = sub.events as string[];
      if (events.length && !events.includes(event.type) && !events.includes('*')) continue;
      await tx.insert(schema.webhookDeliveries).values({
        id: newId('webhook'),
        tenantId: event.tenantId,
        subscriptionId: sub.id,
        outboxMessageId: event.id,
        eventType: event.type,
        status: 'pending',
        nextAttemptAt: new Date(),
      });
      created++;
    }
    return created;
  });
}

/**
 * Deliver due webhook deliveries with HMAC signing, retries + backoff, and a
 * dead-letter terminal state (PRD §16.4). Uses SKIP LOCKED for horizontal scale.
 */
export async function drainWebhookDeliveries(batchSize = 25): Promise<number> {
  const claimed = await withElevated(async (tx) => {
    const due = await tx
      .select()
      .from(schema.webhookDeliveries)
      .where(
        and(
          inArray(schema.webhookDeliveries.status, ['pending', 'failed']),
          or(isNull(schema.webhookDeliveries.nextAttemptAt), lte(schema.webhookDeliveries.nextAttemptAt, new Date())),
        ),
      )
      .limit(batchSize)
      .for('update', { skipLocked: true });
    if (due.length === 0) return [];
    await tx
      .update(schema.webhookDeliveries)
      .set({ status: 'delivering' })
      .where(inArray(schema.webhookDeliveries.id, due.map((d) => d.id)));
    return due;
  });

  for (const delivery of claimed) {
    await deliverOne(delivery);
  }
  return claimed.length;
}

async function deliverOne(delivery: typeof schema.webhookDeliveries.$inferSelect): Promise<void> {
  const sub = await withElevated(async (tx) => {
    const [row] = await tx
      .select()
      .from(schema.webhookSubscriptions)
      .where(eq(schema.webhookSubscriptions.id, delivery.subscriptionId));
    return row ?? null;
  });
  const attempt = delivery.attempts + 1;

  if (!sub || !sub.active) {
    await finalize(delivery.id, 'dead_letter', attempt, 'Subscription missing or inactive');
    return;
  }

  const body = JSON.stringify({
    id: delivery.id,
    type: delivery.eventType,
    outboxMessageId: delivery.outboxMessageId,
    deliveredAt: new Date().toISOString(),
  });
  const signature = sub.secretRef
    ? createHmac('sha256', decryptSecret(sub.secretRef)).update(body).digest('hex')
    : '';

  try {
    const res = await fetch(sub.url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-crms-event': delivery.eventType,
        'x-crms-signature': `sha256=${signature}`,
        'x-crms-delivery': delivery.id,
      },
      body,
      signal: AbortSignal.timeout(15000),
    });
    if (res.ok) {
      await finalize(delivery.id, 'delivered', attempt, null, res.status);
    } else {
      await retryOrDead(delivery.id, attempt, `HTTP ${res.status}`, res.status);
    }
  } catch (err) {
    await retryOrDead(delivery.id, attempt, err instanceof Error ? err.message : 'network error');
  }
}

async function retryOrDead(id: string, attempt: number, error: string, responseStatus?: number): Promise<void> {
  const dead = attempt >= MAX_ATTEMPTS;
  await withElevated(async (tx) => {
    await tx
      .update(schema.webhookDeliveries)
      .set({
        status: dead ? 'dead_letter' : 'failed',
        attempts: attempt,
        lastError: error,
        responseStatus,
        nextAttemptAt: dead ? null : new Date(Date.now() + backoffMs(attempt)),
      })
      .where(eq(schema.webhookDeliveries.id, id));
  });
  if (dead) logger.warn({ deliveryId: id, error }, 'Webhook delivery dead-lettered');
}

async function finalize(
  id: string,
  status: (typeof schema.webhookDeliveryStatusEnum.enumValues)[number],
  attempt: number,
  error: string | null,
  responseStatus?: number,
): Promise<void> {
  await withElevated(async (tx) => {
    await tx
      .update(schema.webhookDeliveries)
      .set({
        status,
        attempts: attempt,
        lastError: error,
        responseStatus,
        deliveredAt: status === 'delivered' ? new Date() : undefined,
      })
      .where(eq(schema.webhookDeliveries.id, id));
  });
}
