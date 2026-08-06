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
  if (conn.driver !== 'postgres') {
    throw new AppError('NOT_IMPLEMENTED', `Federated driver '${conn.driver}' not yet supported`, { expose: true });
  }

  const guarded = guardQuery(rawSql, { maxRows: Number(conn.maxRows), timeoutMs: Number(conn.timeoutMs) });

  // Resolve BYO credential (host password etc.) — decrypted only for execution.
  const { secret } = await credentialManager.useSecret({ credentialId: conn.credentialId });
  const meta = conn.metadata as Record<string, unknown>;

  const sql = postgres({
    host: String(meta.host ?? 'localhost'),
    port: Number(meta.port ?? 5432),
    database: String(meta.database ?? ''),
    username: String(secret.username ?? meta.username ?? ''),
    password: String(secret.password ?? ''),
    max: 2,
    idle_timeout: 5,
    connect_timeout: 10,
    connection: { statement_timeout: guarded.timeoutMs },
    ssl: meta.ssl ? 'require' : undefined,
  });

  const start = Date.now();
  try {
    const rows = (await sql.unsafe(guarded.sql)) as unknown as Record<string, unknown>[];
    const durationMs = Date.now() - start;
    const maskingRules = (conn.maskingRules as Array<{ column: string }>) ?? [];
    logger.info({ connectionId, rows: rows.length, durationMs, tenant: ctx.tenantId }, 'Federated query executed');
    return {
      rows: applyMasking(rows, maskingRules),
      rowCount: rows.length,
      durationMs,
      truncated: rows.length >= guarded.limit,
    };
  } finally {
    await sql.end({ timeout: 5 });
  }
}
