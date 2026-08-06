import { eq, schema, withElevated, withTenant } from '@crms/database';
import { newId, NotFound, createLogger } from '@crms/kernel';
import { getContext } from '@crms/tenant-context';

export { registerStripeIfConfigured } from './stripe.js';

const logger = createLogger('billing');

/**
 * Billing (PRD §26). CRITICAL separation:
 *   - SaaS billing (this module) charges tenants for platform usage using the
 *     PLATFORM's own payment credentials.
 *   - Payments INSIDE tenant CRMs use the TENANT's BYO credentials and flow
 *     through the integration-engine — funds never pass through platform
 *     accounts. Those are deliberately NOT handled here.
 */

export interface PlatformPaymentProvider {
  createCustomer(input: { tenantId: string; email?: string }): Promise<string>;
  createSubscription(input: { customerId: string; plan: string; seats: number }): Promise<{ subscriptionRef: string; currentPeriodEnd: Date }>;
  changePlan(input: { subscriptionRef: string; plan: string; seats: number }): Promise<void>;
  cancel(subscriptionRef: string): Promise<void>;
}

let provider: PlatformPaymentProvider | null = null;
export function registerPaymentProvider(p: PlatformPaymentProvider): void {
  provider = p;
}

export async function createSubscription(input: {
  tenantId: string;
  plan: string;
  seats?: number;
  trialDays?: number;
}): Promise<string> {
  const id = newId('subscription');
  const trialEndsAt = input.trialDays ? new Date(Date.now() + input.trialDays * 86400_000) : null;
  let providerRefs: Record<string, unknown> = {};
  let currentPeriodEnd: Date | null = trialEndsAt;
  if (provider) {
    const customerId = await provider.createCustomer({ tenantId: input.tenantId });
    const sub = await provider.createSubscription({ customerId, plan: input.plan, seats: input.seats ?? 1 });
    providerRefs = { customerId, subscriptionRef: sub.subscriptionRef };
    currentPeriodEnd = sub.currentPeriodEnd;
  }
  await withElevated(async (tx) => {
    await tx
      .insert(schema.subscriptions)
      .values({
        id,
        tenantId: input.tenantId,
        plan: input.plan,
        status: trialEndsAt ? 'trialing' : 'active',
        seats: input.seats ?? 1,
        providerRefs,
        trialEndsAt,
        currentPeriodEnd,
      })
      .onConflictDoUpdate({
        target: schema.subscriptions.tenantId,
        set: { plan: input.plan, seats: input.seats ?? 1, status: 'active' },
      });
  });
  logger.info({ tenantId: input.tenantId, plan: input.plan }, 'Subscription created');
  return id;
}

export async function changePlan(tenantId: string, plan: string, seats: number): Promise<void> {
  await withElevated(async (tx) => {
    const [sub] = await tx.select().from(schema.subscriptions).where(eq(schema.subscriptions.tenantId, tenantId));
    if (!sub) throw NotFound('Subscription for tenant', tenantId);
    if (provider && (sub.providerRefs as { subscriptionRef?: string }).subscriptionRef) {
      await provider.changePlan({ subscriptionRef: (sub.providerRefs as { subscriptionRef: string }).subscriptionRef, plan, seats });
    }
    await tx.update(schema.subscriptions).set({ plan, seats }).where(eq(schema.subscriptions.tenantId, tenantId));
  });
}

/** Roll up a usage metric for consumption-based billing (PRD §26.3). */
export async function incrementMetric(metric: string, by = 1): Promise<void> {
  const ctx = getContext();
  const period = new Date().toISOString().slice(0, 7);
  await withTenant(async (tx) => {
    const [row] = await tx
      .select()
      .from(schema.usageMetrics)
      .where(eq(schema.usageMetrics.tenantId, ctx.tenantId));
    void row;
    await tx
      .insert(schema.usageMetrics)
      .values({ id: newId('usage'), tenantId: ctx.tenantId, period, metric, value: String(by) })
      .onConflictDoUpdate({
        target: [schema.usageMetrics.tenantId, schema.usageMetrics.period, schema.usageMetrics.metric],
        set: { value: sqlIncrement(by), updatedAt: new Date() },
      });
  });
}

// Helper to increment via SQL to avoid read-modify-write races.
import { sql } from '@crms/database';
function sqlIncrement(by: number) {
  return sql`(${schema.usageMetrics.value})::numeric + ${by}`;
}
