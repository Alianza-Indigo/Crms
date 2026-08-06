import { sql } from 'drizzle-orm';
import { timestamp, text, uuid, jsonb, boolean } from 'drizzle-orm/pg-core';

/**
 * Column mixins shared by every table. Centralizing them keeps the multi-tenant
 * invariants consistent: every business entity carries tenant_id, and every
 * table carries audit timestamps + soft-delete + optimistic-concurrency version.
 */

/** Timestamps + soft delete + sync fields (PRD §27.1 mobile sync needs these). */
export const lifecycleColumns = {
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
  /** Monotonic per-row version for offline sync + optimistic concurrency. */
  syncVersion: text('sync_version')
    .notNull()
    .default(sql`'1'`),
};

/** Actor attribution — who created/last-touched a row (nullable for system rows). */
export const actorColumns = {
  createdBy: text('created_by'),
  updatedBy: text('updated_by'),
};

/** tenant_id present on every business entity (PRD §6.1). */
export const tenantColumn = {
  tenantId: text('tenant_id').notNull(),
};

/** application_id + environment for entities scoped to an application (PRD §8.2). */
export const applicationScope = {
  applicationId: text('application_id').notNull(),
  environment: text('environment').notNull().default('production'),
};

export { sql, jsonb, boolean, uuid };
