import { FEDERATED_QUERY } from '@crms/config';
import { ValidationError } from '@crms/kernel';

/**
 * Federated Query guard (PRD §17.1). Enforces a read-only, bounded query policy
 * BEFORE anything reaches an external database:
 *   - single statement only (no ';' chaining)
 *   - must start with SELECT (no INSERT/UPDATE/DELETE/DROP/ALTER/TRUNCATE/…)
 *   - WHERE clause required
 *   - SELECT * forbidden
 *   - LIMIT required and capped
 *   - short timeout
 * These are validated with a lightweight lexical AST pass; the executor also runs
 * against a connection pool that is separate from the platform core.
 */

const FORBIDDEN_KEYWORDS = [
  'insert', 'update', 'delete', 'drop', 'alter', 'truncate', 'execute', 'exec',
  'copy', 'grant', 'revoke', 'create', 'merge', 'call', 'do', 'vacuum', 'analyze',
  'comment', 'reindex', 'cluster', 'listen', 'notify', 'set', 'reset',
];

export interface GuardResult {
  sql: string;
  limit: number;
  timeoutMs: number;
}

export function guardQuery(
  rawSql: string,
  opts: { maxRows?: number; timeoutMs?: number } = {},
): GuardResult {
  const sql = rawSql.trim().replace(/;+\s*$/, '');

  if (sql.includes(';')) throw ValidationError('Multiple statements are not allowed');

  // Strip string literals + comments before keyword scanning to avoid false hits.
  const scrubbed = sql
    .replace(/'(?:[^']|'')*'/g, "''")
    .replace(/--[^\n]*/g, ' ')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .toLowerCase();

  if (!/^\s*(with\s+[\s\S]+?\s+)?select\b/.test(scrubbed)) {
    throw ValidationError('Only SELECT queries are permitted');
  }
  for (const kw of FORBIDDEN_KEYWORDS) {
    if (new RegExp(`\\b${kw}\\b`).test(scrubbed)) {
      throw ValidationError(`Keyword '${kw.toUpperCase()}' is not allowed in federated queries`);
    }
  }
  if (/select\s+\*/.test(scrubbed)) {
    throw ValidationError('SELECT * is not allowed; enumerate columns explicitly');
  }
  if (!/\bwhere\b/.test(scrubbed)) {
    throw ValidationError('A WHERE clause is required');
  }

  const maxRows = Math.min(opts.maxRows ?? FEDERATED_QUERY.defaultRowLimit, FEDERATED_QUERY.maxRowLimit);
  let limit = maxRows;
  const limitMatch = scrubbed.match(/\blimit\s+(\d+)/);
  let finalSql = sql;
  if (limitMatch) {
    limit = Math.min(Number(limitMatch[1]), maxRows);
    finalSql = sql.replace(/\blimit\s+\d+/i, `LIMIT ${limit}`);
  } else {
    finalSql = `${sql} LIMIT ${limit}`;
  }

  const timeoutMs = Math.min(opts.timeoutMs ?? FEDERATED_QUERY.defaultTimeoutMs, FEDERATED_QUERY.maxTimeoutMs);
  return { sql: finalSql, limit, timeoutMs };
}
