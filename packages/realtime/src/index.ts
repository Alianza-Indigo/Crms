import { Redis } from 'ioredis';
import { loadEnv, redisTenantKey } from '@crms/config';
import { createLogger } from '@crms/kernel';

const logger = createLogger('realtime');

/**
 * Realtime fan-out over Redis pub/sub (PRD §34.7). The worker publishes each
 * dispatched domain event to a PER-TENANT channel; the API streams it to
 * connected clients over SSE. Channels are tenant-scoped so a subscriber can
 * only ever receive its own tenant's events.
 */
let pub: Redis | null = null;

function publisher(): Redis {
  if (!pub) pub = new Redis(loadEnv().REDIS_URL, { maxRetriesPerRequest: null, lazyConnect: false });
  return pub;
}

export async function publishEvent(tenantId: string, event: unknown): Promise<void> {
  try {
    await publisher().publish(redisTenantKey(tenantId, 'events'), JSON.stringify(event));
  } catch (err) {
    logger.warn({ err }, 'Failed to publish realtime event');
  }
}

export interface Subscription {
  close: () => Promise<void>;
}

/**
 * Subscribe to a tenant's event channel. Each subscription uses its own Redis
 * connection (required for subscriber mode) and is closed when the client
 * disconnects.
 */
export async function subscribeTenant(tenantId: string, onEvent: (event: unknown) => void): Promise<Subscription> {
  const sub = new Redis(loadEnv().REDIS_URL, { maxRetriesPerRequest: null });
  const channel = redisTenantKey(tenantId, 'events');
  await sub.subscribe(channel);
  sub.on('message', (_ch, payload) => {
    try {
      onEvent(JSON.parse(payload));
    } catch {
      /* ignore malformed */
    }
  });
  return {
    close: async () => {
      await sub.unsubscribe(channel).catch(() => {});
      sub.disconnect();
    },
  };
}

export async function closeRealtime(): Promise<void> {
  if (pub) {
    pub.disconnect();
    pub = null;
  }
}
