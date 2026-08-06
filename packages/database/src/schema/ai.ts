import { pgTable, text, jsonb, timestamp, index } from 'drizzle-orm/pg-core';
import { lifecycleColumns, actorColumns } from './_shared';
import { aiPlanStatusEnum, riskLevelEnum } from './enums';

/**
 * AI trace entities (PRD §9.3). Conversation → Session → Context → Plan →
 * Execution. The AIPlan is the persisted, approvable change set that the AI must
 * produce BEFORE mutating an application; destructive ops require confirmation.
 */
export const aiConversations = pgTable(
  'ai_conversations',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id').notNull(),
    applicationId: text('application_id'),
    environment: text('environment').notNull().default('production'),
    title: text('title'),
    userId: text('user_id'),
    ...actorColumns,
    ...lifecycleColumns,
  },
  (t) => [index('ai_conversations_tenant_idx').on(t.tenantId)],
);

export const aiSessions = pgTable(
  'ai_sessions',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id').notNull(),
    conversationId: text('conversation_id').notNull(),
    provider: text('provider').notNull(),
    model: text('model'),
    credentialId: text('credential_id'),
    messages: jsonb('messages').notNull().default([]),
    /** Aggregate token/cost metrics reported by the provider (no prompt bodies). */
    usage: jsonb('usage').notNull().default({}),
    ...lifecycleColumns,
  },
  (t) => [index('ai_sessions_conversation_idx').on(t.conversationId)],
);

export const aiContexts = pgTable(
  'ai_contexts',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id').notNull(),
    conversationId: text('conversation_id').notNull(),
    /** Snapshot of application schema/permissions supplied to the model. */
    snapshot: jsonb('snapshot').notNull().default({}),
    ...lifecycleColumns,
  },
  (t) => [index('ai_contexts_conversation_idx').on(t.conversationId)],
);

export const aiPlans = pgTable(
  'ai_plans',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id').notNull(),
    applicationId: text('application_id'),
    environment: text('environment').notNull().default('production'),
    conversationId: text('conversation_id'),
    summary: text('summary').notNull(),
    /** Ordered list of schema/record operations to apply. */
    operations: jsonb('operations').notNull().default([]),
    riskLevel: riskLevelEnum('risk_level').notNull().default('low'),
    dependencies: jsonb('dependencies').notNull().default([]),
    environmentImpact: jsonb('environment_impact').notNull().default({}),
    requiredCredentials: jsonb('required_credentials').notNull().default([]),
    requiredApprovals: jsonb('required_approvals').notNull().default([]),
    rollbackPlan: jsonb('rollback_plan').notNull().default({}),
    status: aiPlanStatusEnum('status').notNull().default('draft'),
    createdByUserId: text('created_by_user_id'),
    approvedByUserId: text('approved_by_user_id'),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    ...actorColumns,
    ...lifecycleColumns,
  },
  (t) => [index('ai_plans_status_idx').on(t.tenantId, t.status)],
);

export const aiExecutions = pgTable(
  'ai_executions',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id').notNull(),
    planId: text('plan_id').notNull(),
    status: text('status').notNull().default('queued'),
    /** Per-operation results for auditability + partial rollback. */
    results: jsonb('results').notNull().default([]),
    error: jsonb('error'),
    startedAt: timestamp('started_at', { withTimezone: true }),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
    correlationId: text('correlation_id'),
    ...actorColumns,
    ...lifecycleColumns,
  },
  (t) => [index('ai_executions_plan_idx').on(t.planId)],
);
