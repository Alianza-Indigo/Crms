import { pgEnum } from 'drizzle-orm/pg-core';

export const isolationTierEnum = pgEnum('isolation_tier', ['shared', 'schema', 'dedicated']);
export const environmentEnum = pgEnum('environment', [
  'draft',
  'development',
  'testing',
  'staging',
  'production',
]);
export const tenantStatusEnum = pgEnum('tenant_status', ['active', 'suspended', 'deleting', 'migrating']);
export const membershipStatusEnum = pgEnum('membership_status', ['invited', 'active', 'suspended', 'removed']);
export const userTypeEnum = pgEnum('user_type', ['internal', 'external', 'service']);

export const credentialStatusEnum = pgEnum('credential_status', [
  'pending',
  'active',
  'invalid',
  'expired',
  'revoked',
  'insufficient_scopes',
  'limit_exceeded',
  'suspended',
]);

export const authTypeEnum = pgEnum('auth_type', [
  'api_key',
  'bearer',
  'basic',
  'oauth2',
  'oauth2_refresh',
  'client_credentials',
  'jwt',
  'hmac',
  'service_account',
  'certificate',
  'custom_headers',
  'temporary_token',
]);

export const fieldTypeEnum = pgEnum('field_type', [
  'text_short',
  'text_long',
  'text_rich',
  'integer',
  'decimal',
  'currency',
  'percent',
  'date',
  'time',
  'datetime',
  'duration',
  'email',
  'phone',
  'url',
  'boolean',
  'select',
  'multi_select',
  'status',
  'user',
  'team',
  'file',
  'image',
  'signature',
  'location',
  'coordinates',
  'color',
  'code',
  'json',
  'auto_id',
  'relation',
  'formula',
  'computed',
  'rollup',
  'count',
  'autonumber',
  'qr',
  'barcode',
  'ai_generated',
]);

export const relationTypeEnum = pgEnum('relation_type', [
  'one_to_one',
  'one_to_many',
  'many_to_many',
  'polymorphic',
  'hierarchical',
  'self',
]);

export const onDeleteEnum = pgEnum('relation_on_delete', ['restrict', 'cascade', 'set_null', 'unlink']);

export const deploymentStatusEnum = pgEnum('deployment_status', [
  'draft',
  'pending_approval',
  'approved',
  'deploying',
  'deployed',
  'failed',
  'rolled_back',
]);

export const aiPlanStatusEnum = pgEnum('ai_plan_status', [
  'draft',
  'pending_approval',
  'approved',
  'executing',
  'executed',
  'rejected',
  'failed',
  'rolled_back',
]);

export const riskLevelEnum = pgEnum('risk_level', ['low', 'medium', 'high', 'critical']);

export const automationStatusEnum = pgEnum('automation_status', ['active', 'paused', 'disabled', 'draft']);
export const runStatusEnum = pgEnum('run_status', [
  'queued',
  'running',
  'waiting',
  'succeeded',
  'failed',
  'cancelled',
  'compensating',
  'dead_letter',
]);

export const outboxStatusEnum = pgEnum('outbox_status', ['pending', 'processing', 'published', 'failed', 'dead_letter']);
export const webhookDeliveryStatusEnum = pgEnum('webhook_delivery_status', [
  'pending',
  'delivering',
  'delivered',
  'failed',
  'dead_letter',
]);
export const idempotencyStatusEnum = pgEnum('idempotency_status', ['in_progress', 'completed', 'failed']);

export const subscriptionStatusEnum = pgEnum('subscription_status', [
  'trialing',
  'active',
  'past_due',
  'suspended',
  'cancelled',
]);

export const auditRetentionEnum = pgEnum('audit_retention', ['1y', '3y', '5y', 'indefinite', 'custom']);
