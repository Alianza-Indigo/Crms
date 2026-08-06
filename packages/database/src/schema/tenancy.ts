import { pgTable, text, jsonb, boolean, index, uniqueIndex, timestamp } from 'drizzle-orm/pg-core';
import { lifecycleColumns, actorColumns } from './_shared';
import { isolationTierEnum, tenantStatusEnum, membershipStatusEnum, auditRetentionEnum } from './enums';

/**
 * Resellers / agencies (PRD §5.2, §7). A reseller operates white-label and owns
 * a set of dependent tenants, but has NO access to tenant operational data.
 */
export const resellers = pgTable('resellers', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  slug: text('slug').notNull().unique(),
  branding: jsonb('branding').notNull().default({}),
  planCatalog: jsonb('plan_catalog').notNull().default({}),
  featureRestrictions: jsonb('feature_restrictions').notNull().default({}),
  ...actorColumns,
  ...lifecycleColumns,
});

/**
 * Tenant — the top-level organizational boundary (PRD §6, §7). Every business
 * entity references tenant_id. isolationTier drives which physical location the
 * tenant's data lives in; TenantRouting resolves the actual connection.
 */
export const tenants = pgTable(
  'tenants',
  {
    id: text('id').primaryKey(),
    resellerId: text('reseller_id'),
    name: text('name').notNull(),
    slug: text('slug').notNull().unique(),
    status: tenantStatusEnum('status').notNull().default('active'),
    isolationTier: isolationTierEnum('isolation_tier').notNull().default('shared'),
    region: text('region').notNull().default('us-east-1'),
    branding: jsonb('branding').notNull().default({}),
    limits: jsonb('limits').notNull().default({}),
    auditRetention: auditRetentionEnum('audit_retention').notNull().default('1y'),
    auditRetentionCustomDays: text('audit_retention_custom_days'),
    settings: jsonb('settings').notNull().default({}),
    ...actorColumns,
    ...lifecycleColumns,
  },
  (t) => [index('tenants_reseller_idx').on(t.resellerId), index('tenants_status_idx').on(t.status)],
);

/** Custom domains / subdomains for white-label (PRD §25). */
export const tenantDomains = pgTable(
  'tenant_domains',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id').notNull(),
    domain: text('domain').notNull(),
    kind: text('kind').notNull().default('app'), // app | portal
    portalId: text('portal_id'),
    verified: boolean('verified').notNull().default(false),
    verificationToken: text('verification_token'),
    sslStatus: text('ssl_status').notNull().default('pending'),
    ...lifecycleColumns,
  },
  (t) => [uniqueIndex('tenant_domains_domain_idx').on(t.domain), index('tenant_domains_tenant_idx').on(t.tenantId)],
);

/**
 * TenantRouting (PRD §11.2, §6.3). Maps a tenant to its physical data location.
 * The connection resolver reads this to pick the right pool for tier 2/3 tenants
 * and to perform atomic cutover during a tenant migration.
 */
export const tenantRouting = pgTable(
  'tenant_routing',
  {
    tenantId: text('tenant_id').primaryKey(),
    isolationTier: isolationTierEnum('isolation_tier').notNull().default('shared'),
    /** For tier=schema: the postgres schema name. */
    schemaName: text('schema_name'),
    /** For tier=dedicated: a logical connection key resolved to a secret. */
    connectionRef: text('connection_ref'),
    /** During migration, routing may point reads/writes at old vs new. */
    routingState: text('routing_state').notNull().default('stable'), // stable | migrating | cutover
    region: text('region').notNull().default('us-east-1'),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
);

/**
 * Membership — a user's relationship to a tenant (PRD §7: a user can belong to
 * many tenants with different permissions in each). Roles are assigned here.
 */
export const memberships = pgTable(
  'memberships',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id').notNull(),
    userId: text('user_id').notNull(),
    status: membershipStatusEnum('status').notNull().default('invited'),
    roleIds: jsonb('role_ids').notNull().default([]),
    teamIds: jsonb('team_ids').notNull().default([]),
    branchId: text('branch_id'),
    /** Owner has irrevocable full control of the tenant (PRD §5.3). */
    isOwner: boolean('is_owner').notNull().default(false),
    invitedBy: text('invited_by'),
    invitedAt: timestamp('invited_at', { withTimezone: true }),
    acceptedAt: timestamp('accepted_at', { withTimezone: true }),
    ...lifecycleColumns,
  },
  (t) => [
    uniqueIndex('memberships_tenant_user_idx').on(t.tenantId, t.userId),
    index('memberships_user_idx').on(t.userId),
  ],
);
