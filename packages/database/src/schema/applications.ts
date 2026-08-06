import { pgTable, text, jsonb, boolean, timestamp, index, uniqueIndex } from 'drizzle-orm/pg-core';
import { lifecycleColumns, actorColumns } from './_shared';
import { environmentEnum, deploymentStatusEnum, riskLevelEnum } from './enums';

/**
 * Application — an independent configuration/data/permission/credential/deploy
 * boundary within a tenant (PRD §4.9, §8). Applications CANNOT share modules,
 * records, schemas or credentials; cross-app communication is only via
 * API/Webhook/Automation/Integration.
 */
export const applications = pgTable(
  'applications',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id').notNull(),
    name: text('name').notNull(),
    slug: text('slug').notNull(),
    description: text('description'),
    icon: text('icon'),
    color: text('color'),
    /** Sector hint used by AI + templates; NEVER hard-codes core behavior. */
    sector: text('sector'),
    branding: jsonb('branding').notNull().default({}),
    status: text('status').notNull().default('active'),
    /** Currently published config version per environment. */
    publishedVersions: jsonb('published_versions').notNull().default({}),
    settings: jsonb('settings').notNull().default({}),
    ...actorColumns,
    ...lifecycleColumns,
  },
  (t) => [
    uniqueIndex('applications_tenant_slug_idx').on(t.tenantId, t.slug),
    index('applications_tenant_idx').on(t.tenantId),
  ],
);

/**
 * A configuration version snapshot of an application (PRD §8.4). Immutable once
 * published; the builder edits a draft and publishes a new version.
 */
export const applicationVersions = pgTable(
  'application_versions',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id').notNull(),
    applicationId: text('application_id').notNull(),
    version: text('version').notNull(),
    environment: environmentEnum('environment').notNull(),
    /** Full serialized configuration snapshot (modules, fields, views, …). */
    snapshot: jsonb('snapshot').notNull().default({}),
    changelog: text('changelog'),
    publishedAt: timestamp('published_at', { withTimezone: true }),
    ...actorColumns,
    ...lifecycleColumns,
  },
  (t) => [
    index('application_versions_app_idx').on(t.applicationId, t.environment),
    uniqueIndex('application_versions_unique_idx').on(t.applicationId, t.environment, t.version),
  ],
);

/**
 * DeploymentManifest (PRD §8.3). Promotes configuration between environments.
 * Credentials are referenced by logical variable ({{OPENAI_CREDENTIAL_ID}}),
 * NEVER copied — each environment resolves its own.
 */
export const deploymentManifests = pgTable(
  'deployment_manifests',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id').notNull(),
    applicationId: text('application_id').notNull(),
    sourceVersion: text('source_version').notNull(),
    sourceEnvironment: environmentEnum('source_environment').notNull(),
    targetEnvironment: environmentEnum('target_environment').notNull(),
    changes: jsonb('changes').notNull().default([]),
    dependencies: jsonb('dependencies').notNull().default([]),
    requiredVariables: jsonb('required_variables').notNull().default([]),
    credentialRefs: jsonb('credential_refs').notNull().default([]),
    migrationPlan: jsonb('migration_plan').notNull().default({}),
    rollbackPlan: jsonb('rollback_plan').notNull().default({}),
    risks: jsonb('risks').notNull().default([]),
    riskLevel: riskLevelEnum('risk_level').notNull().default('low'),
    approvals: jsonb('approvals').notNull().default([]),
    /** Production destructive changes require double approval (PRD §8.3). */
    requiredApprovals: text('required_approvals').notNull().default('1'),
    status: deploymentStatusEnum('status').notNull().default('draft'),
    result: jsonb('result').notNull().default({}),
    ...actorColumns,
    ...lifecycleColumns,
  },
  (t) => [index('deployment_manifests_app_idx').on(t.applicationId, t.status)],
);

/**
 * FeatureFlag (PRD §44.1). Flags can target tenant/app/env/plan/reseller/user/
 * role/region/version/cohort. Flags never replace permissions.
 */
export const featureFlags = pgTable(
  'feature_flags',
  {
    id: text('id').primaryKey(),
    /** Null tenant = platform-global flag. */
    tenantId: text('tenant_id'),
    key: text('key').notNull(),
    description: text('description'),
    enabled: boolean('enabled').notNull().default(false),
    /** Targeting rules evaluated by the feature-flags engine. */
    rules: jsonb('rules').notNull().default([]),
    rolloutPercentage: text('rollout_percentage').notNull().default('100'),
    ...actorColumns,
    ...lifecycleColumns,
  },
  (t) => [uniqueIndex('feature_flags_scope_key_idx').on(t.tenantId, t.key)],
);
