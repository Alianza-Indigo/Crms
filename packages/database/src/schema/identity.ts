import { pgTable, text, jsonb, boolean, timestamp, index, uniqueIndex } from 'drizzle-orm/pg-core';
import { lifecycleColumns, actorColumns } from './_shared';
import { userTypeEnum } from './enums';

/**
 * Users are GLOBAL identities (not tenant-scoped) because one person can belong
 * to many tenants (PRD §7). Tenant-specific authorization lives in memberships.
 * External/portal users are still users but typed 'external' and constrained to
 * portal access only.
 */
export const users = pgTable(
  'users',
  {
    id: text('id').primaryKey(),
    email: text('email').notNull(),
    emailVerified: boolean('email_verified').notNull().default(false),
    passwordHash: text('password_hash'),
    name: text('name'),
    avatarUrl: text('avatar_url'),
    type: userTypeEnum('type').notNull().default('internal'),
    locale: text('locale').notNull().default('es'),
    timezone: text('timezone').notNull().default('UTC'),
    /** MFA (PRD §32.1). Secret stored encrypted; only metadata here. */
    mfaEnabled: boolean('mfa_enabled').notNull().default(false),
    mfaSecretRef: text('mfa_secret_ref'),
    recoveryCodesRef: text('recovery_codes_ref'),
    isPlatformAdmin: boolean('is_platform_admin').notNull().default(false),
    failedLoginAttempts: text('failed_login_attempts').notNull().default('0'),
    lockedUntil: timestamp('locked_until', { withTimezone: true }),
    lastLoginAt: timestamp('last_login_at', { withTimezone: true }),
    ...lifecycleColumns,
  },
  (t) => [uniqueIndex('users_email_idx').on(t.email)],
);

/** Roles are tenant-scoped RBAC definitions (PRD §18). */
export const roles = pgTable(
  'roles',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id').notNull(),
    applicationId: text('application_id'),
    name: text('name').notNull(),
    description: text('description'),
    /** Permission strings, e.g. "record:create:module:mod_x". */
    permissions: jsonb('permissions').notNull().default([]),
    /** ABAC conditions expressed as a JSON rule tree (PRD §18). */
    conditions: jsonb('conditions').notNull().default({}),
    isSystem: boolean('is_system').notNull().default(false),
    ...actorColumns,
    ...lifecycleColumns,
  },
  (t) => [index('roles_tenant_idx').on(t.tenantId), index('roles_app_idx').on(t.applicationId)],
);

/** Teams group users for assignment + team-scoped permissions (PRD §7, §18). */
export const teams = pgTable(
  'teams',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id').notNull(),
    name: text('name').notNull(),
    parentTeamId: text('parent_team_id'),
    memberUserIds: jsonb('member_user_ids').notNull().default([]),
    leadUserId: text('lead_user_id'),
    ...actorColumns,
    ...lifecycleColumns,
  },
  (t) => [index('teams_tenant_idx').on(t.tenantId)],
);

/** Branches / business units (PRD §7). */
export const branches = pgTable(
  'branches',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id').notNull(),
    name: text('name').notNull(),
    parentBranchId: text('parent_branch_id'),
    metadata: jsonb('metadata').notNull().default({}),
    ...actorColumns,
    ...lifecycleColumns,
  },
  (t) => [index('branches_tenant_idx').on(t.tenantId)],
);

/**
 * Service accounts — non-human identities for APIs/integrations/agents
 * (PRD §5.9). They carry roles like users and are fully subject to permissions.
 */
export const serviceAccounts = pgTable(
  'service_accounts',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id').notNull(),
    applicationId: text('application_id'),
    name: text('name').notNull(),
    roleIds: jsonb('role_ids').notNull().default([]),
    active: boolean('active').notNull().default(true),
    ...actorColumns,
    ...lifecycleColumns,
  },
  (t) => [index('service_accounts_tenant_idx').on(t.tenantId)],
);

/**
 * API keys (PRD §29). Only a hash is stored; the plaintext is shown once at
 * creation. Scopes constrain what the key can do; keys are revocable + expiring.
 */
export const apiKeys = pgTable(
  'api_keys',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id').notNull(),
    applicationId: text('application_id'),
    serviceAccountId: text('service_account_id'),
    name: text('name').notNull(),
    prefix: text('prefix').notNull(),
    keyHash: text('key_hash').notNull(),
    scopes: jsonb('scopes').notNull().default([]),
    allowedIps: jsonb('allowed_ips').notNull().default([]),
    lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    ...actorColumns,
    ...lifecycleColumns,
  },
  (t) => [index('api_keys_tenant_idx').on(t.tenantId), uniqueIndex('api_keys_prefix_idx').on(t.prefix)],
);

/**
 * Sessions — revocable interactive sessions with device/trust metadata and
 * optional impersonation identity (PRD §32.1, §32.5).
 */
export const sessions = pgTable(
  'sessions',
  {
    id: text('id').primaryKey(),
    userId: text('user_id').notNull(),
    tokenHash: text('token_hash').notNull(),
    /** Active tenant selected for this session. */
    activeTenantId: text('active_tenant_id'),
    device: jsonb('device').notNull().default({}),
    ip: text('ip'),
    trusted: boolean('trusted').notNull().default(false),
    /** Impersonation (PRD §32.5): all three ids recorded, banner + expiry enforced. */
    impersonatedUserId: text('impersonated_user_id'),
    impersonatedBy: text('impersonated_by'),
    impersonationExpiresAt: timestamp('impersonation_expires_at', { withTimezone: true }),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).notNull().defaultNow(),
    ...lifecycleColumns,
  },
  (t) => [
    uniqueIndex('sessions_token_idx').on(t.tokenHash),
    index('sessions_user_idx').on(t.userId),
  ],
);
