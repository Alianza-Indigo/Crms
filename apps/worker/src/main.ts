import { createLogger } from '@crms/kernel';
import { closeDb } from '@crms/database';
import { dispatchBatch } from '@crms/outbox';
import type { DomainEvent } from '@crms/events';
import { runWithBuiltContext, buildContext } from '@crms/tenant-context';
import { onEvent, runAutomation } from '@crms/automation-engine';
import { drainAutomationRuns } from './automation-runner.js';
import { archiveAuditLogs } from './audit-archiver.js';
import { enqueueWebhookDeliveries, drainWebhookDeliveries } from './webhooks.js';
import { refreshExpiringCredentials } from './credential-refresher.js';
import { drainMigrationJobs } from './migration-runner.js';
import { dispatchNotifications } from './notification-dispatcher.js';
import { registerPostgresMigrationProvider } from '@crms/tenant-migration';
import { publishEvent } from '@crms/realtime';

const logger = createLogger('worker');

/**
 * Persistent worker (PRD §35.2). Runs long/asynchronous jobs OFF the request
 * path: transactional-outbox dispatch, automation execution, audit archival,
 * OAuth credential refresh. Uses DB-backed polling with SKIP LOCKED so multiple
 * replicas scale horizontally without double-processing (PRD §41).
 */

let running = true;

/**
 * Outbox handler: for each published event, create the automation runs it
 * triggers (webhooks + notifications would also fan out here). Runs inside a
 * system context bound to the event's tenant/application/environment.
 */
async function handleEvent(event: DomainEvent): Promise<void> {
  const ctx = buildContext({
    tenantId: event.tenantId,
    applicationId: event.applicationId,
    environment: event.environment as never,
    origin: 'worker',
    correlationId: event.correlationId,
    roleIds: ['__owner__'], // system actor; automations further constrained by their own config
  });
  await runWithBuiltContext(ctx, async () => {
    const runIds = await onEvent(event);
    if (runIds.length) logger.info({ event: event.type, runs: runIds.length }, 'Automations triggered');
  });
  // Fan out to subscribed webhooks (delivered by the webhook loop, off-txn).
  const webhooks = await enqueueWebhookDeliveries(event);
  if (webhooks) logger.info({ event: event.type, webhooks }, 'Webhook deliveries queued');
  // Push to realtime subscribers (SSE) for this tenant.
  await publishEvent(event.tenantId, event);
}

async function loop(name: string, fn: () => Promise<number>, intervalMs: number): Promise<void> {
  while (running) {
    try {
      const processed = await fn();
      if (processed === 0) await sleep(intervalMs);
    } catch (err) {
      logger.error({ err, loop: name }, 'Worker loop error');
      await sleep(intervalMs);
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function main(): Promise<void> {
  logger.info('CRMS worker starting');
  registerPostgresMigrationProvider();

  const loops = [
    loop('outbox', () => dispatchBatch(handleEvent, 50), 1000),
    loop('automations', () => drainAutomationRuns(runAutomation, 20), 1000),
    loop('webhooks', () => drainWebhookDeliveries(25), 1000),
    loop('credential-refresh', () => refreshExpiringCredentials(), 60_000),
    loop('notifications', () => dispatchNotifications(25), 2000),
    loop('audit-archive', () => archiveAuditLogs(), 60_000),
    loop('tenant-migration', () => drainMigrationJobs(), 10_000),
  ];

  const shutdown = async () => {
    logger.info('Worker shutting down');
    running = false;
    await Promise.allSettled(loops);
    await closeDb();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  await Promise.all(loops);
}

main().catch((err) => {
  logger.error({ err }, 'Worker crashed');
  process.exit(1);
});
