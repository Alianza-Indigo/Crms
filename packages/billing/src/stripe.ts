import { loadEnv } from '@crms/config';
import { createLogger } from '@crms/kernel';
import { registerPaymentProvider, type PlatformPaymentProvider } from './index.js';

const logger = createLogger('billing:stripe');

/**
 * Stripe provider for PLATFORM SaaS billing (PRD §26.2). Uses the platform's own
 * Stripe secret key — never a tenant's. Tenant payments inside CRMs go through
 * the integration-engine with the tenant's BYO credential and never touch this.
 *
 * Implemented against Stripe's REST API via fetch (no SDK dependency). Once
 * STRIPE_SECRET_KEY is set, `registerStripeIfConfigured()` wires it in — nothing
 * else to change.
 */
class StripeProvider implements PlatformPaymentProvider {
  constructor(
    private readonly secretKey: string,
    private readonly prices: Record<string, string>,
  ) {}

  private async call(path: string, form: Record<string, string>): Promise<Record<string, unknown>> {
    const res = await fetch(`https://api.stripe.com${path}`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${this.secretKey}`,
        'content-type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams(form).toString(),
    });
    const json = (await res.json()) as Record<string, unknown>;
    if (!res.ok) {
      const message = (json.error as { message?: string })?.message ?? `Stripe error ${res.status}`;
      throw new Error(message);
    }
    return json;
  }

  async createCustomer(input: { tenantId: string; email?: string }): Promise<string> {
    const c = await this.call('/v1/customers', {
      'metadata[tenantId]': input.tenantId,
      ...(input.email ? { email: input.email } : {}),
    });
    return c.id as string;
  }

  async createSubscription(input: { customerId: string; plan: string; seats: number; coupon?: string; automaticTax?: boolean }): Promise<{ subscriptionRef: string; currentPeriodEnd: Date }> {
    const price = this.prices[input.plan];
    if (!price) throw new Error(`No Stripe price configured for plan '${input.plan}' (set STRIPE_PRICES)`);
    const sub = await this.call('/v1/subscriptions', {
      customer: input.customerId,
      'items[0][price]': price,
      'items[0][quantity]': String(input.seats),
      ...(input.coupon ? { 'discounts[0][coupon]': input.coupon } : {}),
      ...(input.automaticTax ? { 'automatic_tax[enabled]': 'true' } : {}),
    });
    return {
      subscriptionRef: sub.id as string,
      currentPeriodEnd: new Date(((sub.current_period_end as number) ?? 0) * 1000),
    };
  }

  async changePlan(input: { subscriptionRef: string; plan: string; seats: number }): Promise<void> {
    const price = this.prices[input.plan];
    if (!price) throw new Error(`No Stripe price configured for plan '${input.plan}'`);
    // Fetch the current item id to update it in place (proration handled by Stripe).
    const sub = await this.call(`/v1/subscriptions/${input.subscriptionRef}`, {});
    const itemId = ((sub.items as { data?: Array<{ id: string }> })?.data ?? [])[0]?.id;
    await this.call(`/v1/subscriptions/${input.subscriptionRef}`, {
      ...(itemId ? { 'items[0][id]': itemId } : {}),
      'items[0][price]': price,
      'items[0][quantity]': String(input.seats),
    });
  }

  async cancel(subscriptionRef: string): Promise<void> {
    await fetch(`https://api.stripe.com/v1/subscriptions/${subscriptionRef}`, {
      method: 'DELETE',
      headers: { authorization: `Bearer ${this.secretKey}` },
    });
  }
}

/** Auto-register the Stripe provider if a secret key is configured. */
export function registerStripeIfConfigured(): boolean {
  const env = loadEnv();
  if (!env.STRIPE_SECRET_KEY) return false;
  registerPaymentProvider(new StripeProvider(env.STRIPE_SECRET_KEY, env.STRIPE_PRICES ?? {}));
  logger.info('Stripe platform billing provider registered');
  return true;
}
