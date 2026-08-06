import { and, eq, ilike, isNull, or, inArray, sql, schema, withTenant } from '@crms/database';
import { createLogger } from '@crms/kernel';
import { getContext } from '@crms/tenant-context';
import { check } from '@crms/permissions';
import { requireScope } from '@crms/records-engine';

const logger = createLogger('search-engine');

/**
 * Search (PRD §30). Tenant/app/env-scoped lexical search across records: matches
 * on the record title and on any indexed field value. Results are filtered by
 * permission (only modules the caller may view). Indexes are per tenant because
 * every query carries the tenant predicate + runs under RLS. A semantic mode can
 * be layered on via a BYO embeddings provider using the same result shape.
 */
export interface SearchHit {
  recordId: string;
  moduleId: string;
  title: string | null;
  snippet: string | null;
}

export async function searchRecords(term: string, opts: { moduleId?: string; limit?: number } = {}): Promise<SearchHit[]> {
  const s = requireScope();
  const limit = Math.min(Math.max(opts.limit ?? 25, 1), 100);
  const like = `%${term.replace(/[%_]/g, (m) => `\\${m}`)}%`;

  const hits = await withTenant(async (tx) => {
    // Record ids whose field values match.
    const valueMatches = await tx
      .select({ recordId: schema.recordValues.recordId })
      .from(schema.recordValues)
      .where(
        and(
          eq(schema.recordValues.tenantId, s.tenantId),
          eq(schema.recordValues.applicationId, s.applicationId),
          eq(schema.recordValues.environment, s.environment),
          opts.moduleId ? eq(schema.recordValues.moduleId, opts.moduleId) : undefined,
          ilike(schema.recordValues.valueText, like),
        ),
      )
      .limit(500);
    const valueIds = valueMatches.map((v) => v.recordId);

    const rows = await tx
      .select()
      .from(schema.records)
      .where(
        and(
          eq(schema.records.tenantId, s.tenantId),
          eq(schema.records.applicationId, s.applicationId),
          eq(schema.records.environment, s.environment),
          opts.moduleId ? eq(schema.records.moduleId, opts.moduleId) : undefined,
          isNull(schema.records.deletedAt),
          isNull(schema.records.archivedAt),
          or(ilike(schema.records.displayTitle, like), valueIds.length ? inArray(schema.records.id, valueIds) : sql`false`),
        ),
      )
      .limit(limit * 2);
    return rows;
  });

  // Permission filter: only modules the caller can view.
  const allowedModules = new Map<string, boolean>();
  const results: SearchHit[] = [];
  for (const row of hits) {
    if (!allowedModules.has(row.moduleId)) {
      const decision = await check('view', { type: 'record', selector: row.moduleId });
      allowedModules.set(row.moduleId, decision.allowed);
    }
    if (!allowedModules.get(row.moduleId)) continue;
    results.push({ recordId: row.id, moduleId: row.moduleId, title: row.displayTitle, snippet: makeSnippet(row.data as Record<string, unknown>, term) });
    if (results.length >= limit) break;
  }
  logger.debug({ term, hits: results.length, tenant: getContext().tenantId }, 'Search executed');
  return results;
}

function makeSnippet(data: Record<string, unknown>, term: string): string | null {
  const lower = term.toLowerCase();
  for (const v of Object.values(data)) {
    if (typeof v === 'string' && v.toLowerCase().includes(lower)) {
      const idx = v.toLowerCase().indexOf(lower);
      return v.slice(Math.max(0, idx - 20), idx + term.length + 20);
    }
  }
  return null;
}
