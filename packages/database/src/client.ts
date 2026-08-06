import postgres from 'postgres';
import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { sql } from 'drizzle-orm';
import { loadEnv, PG_CONTEXT } from '@crms/config';
import { createLogger } from '@crms/kernel';
import { getContext, tryGetContext, type TenantContext } from '@crms/tenant-context';
import * as schema from './schema/index.js';

const logger = createLogger('database');

export type Database = PostgresJsDatabase<typeof schema>;
export type DbTransaction = Parameters<Parameters<Database['transaction']>[0]>[0];
export type DbExecutor = Database | DbTransaction;

let _sql: postgres.Sql | null = null;
let _db: Database | null = null;

/**
 * The low-level connection pool. A single shared pool serves Tier-1 (shared DB)
 * tenants. Tier 2/3 routing is resolved via TenantRouting to dedicated pools
 * (see resolveConnection) — the same code path, different connection.
 */
export function getPool(): postgres.Sql {
  if (_sql) return _sql;
  const env = loadEnv();
  _sql = postgres(env.DATABASE_URL, {
    max: 20,
    idle_timeout: 20,
    connect_timeout: 10,
    prepare: true,
    onnotice: () => {},
  });
  return _sql;
}

/** The Drizzle instance bound to the shared pool. Prefer withTenant() for reads/writes. */
export function getDb(): Database {
  if (_db) return _db;
  _db = drizzle(getPool(), { schema, logger: false });
  return _db;
}

export async function closeDb(): Promise<void> {
  for (const pool of dedicatedPools.values()) await pool.sql.end({ timeout: 5 }).catch(() => {});
  dedicatedPools.clear();
  if (_sql) {
    await _sql.end({ timeout: 5 });
    _sql = null;
    _db = null;
  }
}

/**
 * Tenant tier routing (PRD §6.1-6.3). Tier-1 tenants share the default pool.
 * Tier-3 tenants get a dedicated database registered here (at boot, from routing
 * config); Tier-2 tenants get a dedicated schema via search_path. Resolution is
 * an O(1) map lookup on the hot path, so shared tenants pay nothing.
 */
const dedicatedPools = new Map<string, { sql: postgres.Sql; db: Database }>();
const tenantSchemas = new Map<string, string>();

export function registerDedicatedTenant(tenantId: string, connectionUrl: string): void {
  const s = postgres(connectionUrl, { max: 10, idle_timeout: 20, prepare: true, onnotice: () => {} });
  dedicatedPools.set(tenantId, { sql: s, db: drizzle(s, { schema, logger: false }) });
  logger.info({ tenantId }, 'Registered dedicated tenant database');
}

export function registerTenantSchema(tenantId: string, schemaName: string): void {
  tenantSchemas.set(tenantId, schemaName);
}

function resolveDb(tenantId: string): Database {
  return dedicatedPools.get(tenantId)?.db ?? getDb();
}

/**
 * Run `fn` inside a transaction with the tenant context pushed into Postgres
 * session variables (GUCs). RLS policies read these GUCs, so any query issued
 * inside — including raw ones — is automatically confined to the tenant.
 *
 * This is the ONLY sanctioned way to touch tenant data. Using getDb() directly
 * for tenant tables will hit RLS with no tenant set and return zero rows, which
 * the isolation tests assert.
 */
export async function withTenant<T>(fn: (tx: DbExecutor) => Promise<T>, ctx?: TenantContext): Promise<T> {
  const context = ctx ?? getContext();
  const db = resolveDb(context.tenantId);
  return db.transaction(async (tx) => {
    await applyContextGucs(tx, context, false);
    return fn(tx);
  });
}

/**
 * Elevated transaction that bypasses RLS. This is reserved for platform
 * administration and system workers (outbox dispatch, migrations) and is ALWAYS
 * audited by the caller. It still sets tenant GUCs so triggers/logging see them.
 */
export async function withElevated<T>(fn: (tx: DbExecutor) => Promise<T>, ctx?: TenantContext): Promise<T> {
  const context = ctx ?? tryGetContext();
  const db = context ? resolveDb(context.tenantId) : getDb();
  return db.transaction(async (tx) => {
    if (context) await applyContextGucs(tx, context, true);
    else await tx.execute(sql`SET LOCAL ${sql.raw(PG_CONTEXT.bypassRls)} = 'on'`);
    return fn(tx);
  });
}

async function applyContextGucs(tx: DbExecutor, ctx: TenantContext, bypass: boolean): Promise<void> {
  // set_config(name, value, is_local=true) scopes to this transaction only.
  await tx.execute(sql`select set_config(${PG_CONTEXT.tenantId}, ${ctx.tenantId}, true)`);
  await tx.execute(sql`select set_config(${PG_CONTEXT.applicationId}, ${ctx.applicationId ?? ''}, true)`);
  await tx.execute(sql`select set_config(${PG_CONTEXT.environment}, ${ctx.environment}, true)`);
  await tx.execute(sql`select set_config(${PG_CONTEXT.userId}, ${ctx.userId ?? ctx.serviceAccountId ?? ''}, true)`);
  await tx.execute(sql`select set_config(${PG_CONTEXT.bypassRls}, ${bypass ? 'on' : 'off'}, true)`);
  // Tier-2 (schema-isolated) tenants: confine to their schema for this txn.
  const schemaName = tenantSchemas.get(ctx.tenantId);
  if (schemaName) await tx.execute(sql`select set_config('search_path', ${schemaName + ', public'}, true)`);
}

export { schema, sql };
