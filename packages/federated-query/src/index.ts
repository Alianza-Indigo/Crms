import postgres from 'postgres';
import { and, eq, schema, withTenant } from '@crms/database';
import { NotFound, createLogger, AppError } from '@crms/kernel';
import { getContext } from '@crms/tenant-context';
import { credentialManager } from '@crms/credential-engine';
import { guardQuery } from './guard.js';

export * from './guard.js';

const logger = createLogger('federated-query');

/**
 * Execute a guarded, read-only query against an external database using the
 * tenant's BYO credential (PRD §17.1). A dedicated short-lived connection pool,
 * separate from the platform core, is used. Sensitive columns are masked per the
 * connection's masking rules. The query, duration, row count and errors are
 * auditable via the returned metadata.
 */
export interface FederatedResult {
  rows: Record<string, unknown>[];
  rowCount: number;
  durationMs: number;
  truncated: boolean;
}

function applyMasking(rows: Record<string, unknown>[], rules: Array<{ column: string; strategy?: string }>): Record<string, unknown>[] {
  if (!rules.length) return rows;
  const masked = new Set(rules.map((r) => r.column));
  return rows.map((row) => {
    const out: Record<string, unknown> = { ...row };
    for (const col of masked) if (col in out) out[col] = '***';
    return out;
  });
}

export async function runFederatedQuery(connectionId: string, rawSql: string): Promise<FederatedResult> {
  const ctx = getContext();
  const conn = await withTenant(async (tx) => {
    const [row] = await tx
      .select()
      .from(schema.federatedConnections)
      .where(and(eq(schema.federatedConnections.id, connectionId)));
    return row ?? null;
  });
  if (!conn || !conn.active) throw NotFound('Federated connection', connectionId);
  if (conn.driver !== 'postgres' && conn.driver !== 'mysql') {
    throw new AppError('NOT_IMPLEMENTED', `Federated driver '${conn.driver}' not yet supported`, { expose: true });
  }

  const guarded = guardQuery(rawSql, { maxRows: Number(conn.maxRows), timeoutMs: Number(conn.timeoutMs) });

  // Resolve BYO credential (host password etc.) — decrypted only for execution.
  const { secret } = await credentialManager.useSecret({ credentialId: conn.credentialId });
  const meta = conn.metadata as Record<string, unknown>;
  const maskingRules = (conn.maskingRules as Array<{ column: string }>) ?? [];

  const start = Date.now();
  const rows =
    conn.driver === 'mysql'
      ? await runMysql(meta, secret, guarded.sql, guarded.timeoutMs)
      : await runPostgres(meta, secret, guarded.sql, guarded.timeoutMs);
  const durationMs = Date.now() - start;
  logger.info({ connectionId, driver: conn.driver, rows: rows.length, durationMs, tenant: ctx.tenantId }, 'Federated query executed');
  return {
    rows: applyMasking(rows, maskingRules),
    rowCount: rows.length,
    durationMs,
    truncated: rows.length >= guarded.limit,
  };
}

async function runPostgres(meta: Record<string, unknown>, secret: Record<string, unknown>, sqlText: string, timeoutMs: number): Promise<Record<string, unknown>[]> {
  const sql = postgres({
    host: String(meta.host ?? 'localhost'),
    port: Number(meta.port ?? 5432),
    database: String(meta.database ?? ''),
    username: String(secret.username ?? meta.username ?? ''),
    password: String(secret.password ?? ''),
    max: 2,
    idle_timeout: 5,
    connect_timeout: 10,
    connection: { statement_timeout: timeoutMs },
    ssl: meta.ssl ? 'require' : undefined,
  });
  try {
    return (await sql.unsafe(sqlText)) as unknown as Record<string, unknown>[];
  } finally {
    await sql.end({ timeout: 5 });
  }
}

async function runMysql(meta: Record<string, unknown>, secret: Record<string, unknown>, sqlText: string, timeoutMs: number): Promise<Record<string, unknown>[]> {
  // mysql2 is an optional peer: imported lazily so Postgres-only deployments
  // don't need it installed. "Ready — just plug the driver + credentials."
  let mysql: typeof import('mysql2/promise');
  try {
    mysql = await import('mysql2/promise');
  } catch {
    throw new AppError('NOT_IMPLEMENTED', 'MySQL federated driver requires the mysql2 package to be installed', { expose: true });
  }
  const conn = await mysql.createConnection({
    host: String(meta.host ?? 'localhost'),
    port: Number(meta.port ?? 3306),
    database: String(meta.database ?? ''),
    user: String(secret.username ?? meta.username ?? ''),
    password: String(secret.password ?? ''),
    connectTimeout: 10000,
    ssl: meta.ssl ? {} : undefined,
  });
  try {
    await conn.query({ sql: `SET SESSION MAX_EXECUTION_TIME=${Math.max(1, Math.floor(timeoutMs))}` }).catch(() => {});
    const [rows] = await conn.query({ sql: sqlText });
    return rows as Record<string, unknown>[];
  } finally {
    await conn.end();
  }
}
