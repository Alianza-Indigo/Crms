import { pgTable, text, jsonb, boolean, timestamp, index, uniqueIndex, integer } from 'drizzle-orm/pg-core';
import { lifecycleColumns, actorColumns } from './_shared';

/**
 * Dynamic records (PRD §11.1, §39). These EAV-style tables hold the actual
 * business data described by the builder definitions. They are NEVER queried
 * with ad-hoc SQL from feature code — only through the Query Engine, which
 * injects tenant_id + application_id + environment and enforces permissions.
 *
 * RLS additionally guards these tables so that even a raw query cannot cross a
 * tenant boundary (defense in depth).
 */
export const records = pgTable(
  'records',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id').notNull(),
    applicationId: text('application_id').notNull(),
    environment: text('environment').notNull().default('production'),
    moduleId: text('module_id').notNull(),
    /** Denormalized display title for lists/search. */
    displayTitle: text('display_title'),
    /** Ownership + assignment for ABAC (PRD §18). */
    ownerUserId: text('owner_user_id'),
    assigneeUserId: text('assignee_user_id'),
    teamId: text('team_id'),
    branchId: text('branch_id'),
    /** Current pipeline stage, when the module has a pipeline. */
    stage: text('stage'),
    /** Structured JSON snapshot of all field values (fast reads); the
     *  normalized recordValues rows enable filtering/indexing/rollups. */
    data: jsonb('data').notNull().default({}),
    archivedAt: timestamp('archived_at', { withTimezone: true }),
    lockedAt: timestamp('locked_at', { withTimezone: true }),
    lockedBy: text('locked_by'),
    ...actorColumns,
    ...lifecycleColumns,
  },
  (t) => [
    // Composite indexes ALWAYS lead with tenant_id (PRD §6.1).
    index('records_scope_idx').on(t.tenantId, t.applicationId, t.environment, t.moduleId),
    index('records_owner_idx').on(t.tenantId, t.ownerUserId),
    index('records_assignee_idx').on(t.tenantId, t.assigneeUserId),
    index('records_stage_idx').on(t.tenantId, t.moduleId, t.stage),
  ],
);

/**
 * Normalized field values. One row per (record, field). Enables filtering,
 * sorting, uniqueness, and rollups without scanning JSON. valueText/valueNumber/
 * valueDate hold the typed projection used by indexes.
 */
export const recordValues = pgTable(
  'record_values',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id').notNull(),
    applicationId: text('application_id').notNull(),
    environment: text('environment').notNull().default('production'),
    recordId: text('record_id').notNull(),
    moduleId: text('module_id').notNull(),
    fieldId: text('field_id').notNull(),
    fieldKey: text('field_key').notNull(),
    valueText: text('value_text'),
    valueNumber: text('value_number'),
    valueBool: boolean('value_bool'),
    valueDate: timestamp('value_date', { withTimezone: true }),
    valueJson: jsonb('value_json'),
    ...lifecycleColumns,
  },
  (t) => [
    uniqueIndex('record_values_unique_idx').on(t.recordId, t.fieldId),
    index('record_values_filter_idx').on(t.tenantId, t.applicationId, t.environment, t.fieldId, t.valueText),
    index('record_values_number_idx').on(t.tenantId, t.fieldId, t.valueNumber),
  ],
);

/** Relation instances between records (PRD §11.4). */
export const recordRelations = pgTable(
  'record_relations',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id').notNull(),
    applicationId: text('application_id').notNull(),
    environment: text('environment').notNull().default('production'),
    relationId: text('relation_id').notNull(),
    sourceRecordId: text('source_record_id').notNull(),
    targetRecordId: text('target_record_id').notNull(),
    /** Optional per-link metadata for m2m junctions. */
    metadata: jsonb('metadata').notNull().default({}),
    position: integer('position').notNull().default(0),
    ...actorColumns,
    ...lifecycleColumns,
  },
  (t) => [
    uniqueIndex('record_relations_unique_idx').on(t.relationId, t.sourceRecordId, t.targetRecordId),
    index('record_relations_source_idx').on(t.tenantId, t.sourceRecordId),
    index('record_relations_target_idx').on(t.tenantId, t.targetRecordId),
  ],
);

/**
 * Record history (PRD §12: versionar, consultar historial). Immutable change log
 * per record; retained per module settings.
 */
export const recordHistory = pgTable(
  'record_history',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id').notNull(),
    applicationId: text('application_id').notNull(),
    environment: text('environment').notNull().default('production'),
    recordId: text('record_id').notNull(),
    moduleId: text('module_id').notNull(),
    version: integer('version').notNull(),
    changeType: text('change_type').notNull(), // create | update | archive | restore | delete | merge
    changes: jsonb('changes').notNull().default({}),
    actor: text('actor'),
    correlationId: text('correlation_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('record_history_record_idx').on(t.recordId, t.version)],
);

/**
 * Files (PRD §32.2, §34.6). Binaries live in S3-compatible storage segmented by
 * tenant; only metadata + storage key live here. Never store binaries in PG.
 */
export const files = pgTable(
  'files',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id').notNull(),
    applicationId: text('application_id'),
    environment: text('environment').notNull().default('production'),
    recordId: text('record_id'),
    moduleId: text('module_id'),
    fieldId: text('field_id'),
    name: text('name').notNull(),
    contentType: text('content_type').notNull(),
    sizeBytes: text('size_bytes').notNull().default('0'),
    /** Tenant-segmented storage key: t/<tenant>/app/<app>/... */
    storageKey: text('storage_key').notNull(),
    /** BYO storage credential id, if the tenant attached its own bucket. */
    storageCredentialId: text('storage_credential_id'),
    checksum: text('checksum'),
    /** Antivirus scan status (PRD §32.2). */
    scanStatus: text('scan_status').notNull().default('pending'),
    ...actorColumns,
    ...lifecycleColumns,
  },
  (t) => [index('files_tenant_idx').on(t.tenantId), index('files_record_idx').on(t.recordId)],
);

/** Comments on records (PRD §20). Supports mentions + threading. */
export const comments = pgTable(
  'comments',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id').notNull(),
    applicationId: text('application_id').notNull(),
    environment: text('environment').notNull().default('production'),
    recordId: text('record_id').notNull(),
    moduleId: text('module_id').notNull(),
    parentCommentId: text('parent_comment_id'),
    body: text('body').notNull(),
    mentions: jsonb('mentions').notNull().default([]),
    ...actorColumns,
    ...lifecycleColumns,
  },
  (t) => [index('comments_record_idx').on(t.recordId)],
);

/** Activity feed / audit-lite per record (PRD §20). */
export const activities = pgTable(
  'activities',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id').notNull(),
    applicationId: text('application_id').notNull(),
    environment: text('environment').notNull().default('production'),
    recordId: text('record_id'),
    moduleId: text('module_id'),
    type: text('type').notNull(),
    summary: text('summary'),
    payload: jsonb('payload').notNull().default({}),
    actor: text('actor'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('activities_record_idx').on(t.recordId), index('activities_tenant_idx').on(t.tenantId)],
);

/** Record followers for notifications (PRD §20). */
export const recordFollowers = pgTable(
  'record_followers',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id').notNull(),
    recordId: text('record_id').notNull(),
    userId: text('user_id').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('record_followers_unique_idx').on(t.recordId, t.userId)],
);
