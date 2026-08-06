import { pgTable, text, jsonb, boolean, timestamp, integer, index, uniqueIndex } from 'drizzle-orm/pg-core';
import { lifecycleColumns, actorColumns } from './_shared';
import {
  outboxStatusEnum,
  webhookDeliveryStatusEnum,
  idempotencyStatusEnum,
  subscriptionStatusEnum,
} from './enums';

/**
 * OutboxMessage (PRD §16.5). Every mutation that emits events writes an outbox
 * row in the SAME transaction. A worker later publishes events / runs
 * automations / sends webhooks. Webhooks are NEVER sent inside the main txn.
 */
export const outboxMessages = pgTable(
  'outbox_messages',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id').notNull(),
    applicationId: text('application_id'),
    environment: text('environment').notNull().default('production'),
    /** Event type, e.g. record.created, record.updated, stage.changed. */
    type: text('type').notNull(),
    /** Versioned event payload (PRD §40). */
    payload: jsonb('payload').notNull().default({}),
    schemaVersion: integer('schema_version').notNull().default(1),
    aggregateType: text('aggregate_type'),
    aggregateId: text('aggregate_id'),
    correlationId: text('correlation_id'),
    status: outboxStatusEnum('status').notNull().default('pending'),
    attempts: integer('attempts').notNull().default(0),
    nextAttemptAt: timestamp('next_attempt_at', { withTimezone: true }).notNull().defaultNow(),
    lastError: text('last_error'),
    availableAt: timestamp('available_at', { withTimezone: true }).notNull().defaultNow(),
    publishedAt: timestamp('published_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('outbox_dispatch_idx').on(t.status, t.nextAttemptAt),
    index('outbox_tenant_idx').on(t.tenantId),
  ],
);

/**
 * WebhookSubscription — tenant-registered endpoints subscribing to events
 * (PRD §29). Each has a rotatable HMAC secret (stored as a credential ref).
 */
export const webhookSubscriptions = pgTable(
  'webhook_subscriptions',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id').notNull(),
    applicationId: text('application_id').notNull(),
    environment: text('environment').notNull().default('production'),
    url: text('url').notNull(),
    events: jsonb('events').notNull().default([]),
    /** HMAC signing secret reference (never the raw secret). */
    secretRef: text('secret_ref'),
    active: boolean('active').notNull().default(true),
    ...actorColumns,
    ...lifecycleColumns,
  },
  (t) => [index('webhook_subs_app_idx').on(t.tenantId, t.applicationId, t.environment)],
);

/** WebhookDelivery (PRD §16.5). Independent record of each delivery attempt. */
export const webhookDeliveries = pgTable(
  'webhook_deliveries',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id').notNull(),
    subscriptionId: text('subscription_id').notNull(),
    outboxMessageId: text('outbox_message_id'),
    eventType: text('event_type').notNull(),
    status: webhookDeliveryStatusEnum('status').notNull().default('pending'),
    attempts: integer('attempts').notNull().default(0),
    requestHash: text('request_hash'),
    responseStatus: integer('response_status'),
    lastError: text('last_error'),
    nextAttemptAt: timestamp('next_attempt_at', { withTimezone: true }),
    deliveredAt: timestamp('delivered_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('webhook_deliveries_status_idx').on(t.status, t.nextAttemptAt)],
);

/**
 * IdempotencyStore (PRD §12.1). A key + request hash guarantees at-most-once
 * side effects. Same key + same body → replay stored response; same key +
 * different body → reject.
 */
export const idempotencyStore = pgTable(
  'idempotency_store',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id').notNull(),
    applicationId: text('application_id'),
    environment: text('environment').notNull().default('production'),
    operation: text('operation').notNull(),
    key: text('key').notNull(),
    requestHash: text('request_hash').notNull(),
    responseReference: jsonb('response_reference'),
    status: idempotencyStatusEnum('status').notNull().default('in_progress'),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('idempotency_unique_idx').on(t.tenantId, t.applicationId, t.environment, t.operation, t.key),
    index('idempotency_expiry_idx').on(t.expiresAt),
  ],
);

/**
 * AuditEvent (PRD §32.4). Append-only record of security-sensitive actions.
 * Impersonation identities are always captured. Secret VALUES are never stored.
 */
export const auditEvents = pgTable(
  'audit_events',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id').notNull(),
    applicationId: text('application_id'),
    environment: text('environment'),
    action: text('action').notNull(),
    resourceType: text('resource_type'),
    resourceId: text('resource_id'),
    /** Actor + impersonation trail (PRD §32.5). */
    actorUserId: text('actor_user_id'),
    actorServiceAccountId: text('actor_service_account_id'),
    originalUserId: text('original_user_id'),
    impersonatedUserId: text('impersonated_user_id'),
    impersonatedBy: text('impersonated_by'),
    ip: text('ip'),
    userAgent: text('user_agent'),
    correlationId: text('correlation_id'),
    /** Non-secret metadata about the change (diffs redacted of secrets). */
    metadata: jsonb('metadata').notNull().default({}),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('audit_events_tenant_idx').on(t.tenantId, t.createdAt),
    index('audit_events_resource_idx').on(t.tenantId, t.resourceType, t.resourceId),
  ],
);

/** AuditArchiveJob (PRD §32.6). Tracks cold-storage archival of old audit rows. */
export const auditArchiveJobs = pgTable(
  'audit_archive_jobs',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id').notNull(),
    cutoffDate: timestamp('cutoff_date', { withTimezone: true }).notNull(),
    status: text('status').notNull().default('pending'),
    archivedCount: integer('archived_count').notNull().default(0),
    storageKey: text('storage_key'),
    legalHold: boolean('legal_hold').notNull().default(false),
    startedAt: timestamp('started_at', { withTimezone: true }),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('audit_archive_jobs_tenant_idx').on(t.tenantId)],
);

/** Notifications (PRD §31). Multi-channel; operational sends use BYO creds. */
export const notifications = pgTable(
  'notifications',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id').notNull(),
    applicationId: text('application_id'),
    userId: text('user_id').notNull(),
    channel: text('channel').notNull().default('in_app'),
    title: text('title').notNull(),
    body: text('body'),
    data: jsonb('data').notNull().default({}),
    readAt: timestamp('read_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('notifications_user_idx').on(t.tenantId, t.userId, t.readAt)],
);

/**
 * UsageEvent + UsageMetric (PRD §29.1 Usage Metering Proxy). Records ONLY
 * operational metrics (counts, duration, bytes, provider-reported tokens).
 * Never content, prompts, message bodies, files or secrets.
 */
export const usageEvents = pgTable(
  'usage_events',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id').notNull(),
    applicationId: text('application_id'),
    environment: text('environment'),
    provider: text('provider'),
    /** api_call | ai_tokens | automation_run | document | storage | ... */
    kind: text('kind').notNull(),
    requests: integer('requests').notNull().default(1),
    durationMs: integer('duration_ms').notNull().default(0),
    bytesIn: integer('bytes_in').notNull().default(0),
    bytesOut: integer('bytes_out').notNull().default(0),
    tokens: integer('tokens').notNull().default(0),
    status: text('status'),
    errorCount: integer('error_count').notNull().default(0),
    retries: integer('retries').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('usage_events_tenant_idx').on(t.tenantId, t.createdAt)],
);

export const usageMetrics = pgTable(
  'usage_metrics',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id').notNull(),
    period: text('period').notNull(), // e.g. 2026-08
    metric: text('metric').notNull(),
    value: text('value').notNull().default('0'),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('usage_metrics_unique_idx').on(t.tenantId, t.period, t.metric)],
);

/**
 * Subscription (PRD §26). Billing of the SaaS itself uses the PLATFORM's
 * credentials. Payments inside CRMs use the TENANT's credentials and never flow
 * through platform accounts — enforced by keeping those two entirely separate.
 */
export const subscriptions = pgTable(
  'subscriptions',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id').notNull(),
    resellerId: text('reseller_id'),
    plan: text('plan').notNull(),
    status: subscriptionStatusEnum('status').notNull().default('trialing'),
    seats: integer('seats').notNull().default(1),
    /** Metered add-ons + limits. */
    limits: jsonb('limits').notNull().default({}),
    /** Platform payment provider references (Stripe customer/sub ids). */
    providerRefs: jsonb('provider_refs').notNull().default({}),
    trialEndsAt: timestamp('trial_ends_at', { withTimezone: true }),
    currentPeriodEnd: timestamp('current_period_end', { withTimezone: true }),
    ...actorColumns,
    ...lifecycleColumns,
  },
  (t) => [uniqueIndex('subscriptions_tenant_idx').on(t.tenantId)],
);

/**
 * TenantMigrationJob (PRD §6.3). Tracks moving a tenant between isolation tiers.
 */
export const tenantMigrationJobs = pgTable(
  'tenant_migration_jobs',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id').notNull(),
    fromTier: text('from_tier').notNull(),
    toTier: text('to_tier').notNull(),
    status: text('status').notNull().default('pending'),
    phase: text('phase').notNull().default('created'),
    checksums: jsonb('checksums').notNull().default({}),
    rollbackDeadline: timestamp('rollback_deadline', { withTimezone: true }),
    error: text('error'),
    startedAt: timestamp('started_at', { withTimezone: true }),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('tenant_migration_jobs_tenant_idx').on(t.tenantId)],
);
