import { and, or, eq, ne, gt, lt, gte, lte, ilike, inArray, desc, asc, isNull, schema, withTenant } from '@crms/database';
import { ValidationError, TenantContextMissing, buildPage, decodeCursor, type Page } from '@crms/kernel';
import { getContext } from '@crms/tenant-context';

/**
 * Query Engine (PRD §6.1, §11.1, §34.3).
 *
 * The ONLY sanctioned way to read dynamic records. It ALWAYS injects
 * tenant_id + application_id + environment from the ambient context and REFUSES
 * to build a query without them. This is the application-layer complement to
 * RLS: together they make a mis-scoped dynamic read impossible.
 *
 * Feature code never writes ad-hoc SQL against records/record_values — it calls
 * this engine, and the isolation tests assert queries without context are
 * rejected.
 */

export type FilterOperator = 'eq' | 'neq' | 'gt' | 'gte' | 'lt' | 'lte' | 'contains' | 'in' | 'is_null';

export interface Filter {
  field: string; // 'display_title' | 'owner' | 'stage' | field key
  operator: FilterOperator;
  value?: unknown;
}

export interface Sort {
  field: string;
  direction: 'asc' | 'desc';
}

export interface QuerySpec {
  moduleId: string;
  filters?: Filter[];
  sorts?: Sort[];
  limit?: number;
  cursor?: string;
  includeArchived?: boolean;
}

interface InjectedScope {
  tenantId: string;
  applicationId: string;
  environment: string;
}

/** Extract and validate the mandatory scope. Throws if any part is missing. */
export function requireScope(): InjectedScope {
  const ctx = getContext();
  if (!ctx.tenantId) throw TenantContextMissing();
  if (!ctx.applicationId) throw ValidationError('Query Engine requires an application context');
  if (!ctx.environment) throw ValidationError('Query Engine requires an environment context');
  return { tenantId: ctx.tenantId, applicationId: ctx.applicationId, environment: ctx.environment };
}

const RESERVED_COLUMNS: Record<string, keyof typeof schema.records.$inferSelect> = {
  display_title: 'displayTitle',
  owner: 'ownerUserId',
  assignee: 'assigneeUserId',
  team: 'teamId',
  branch: 'branchId',
  stage: 'stage',
  created_at: 'createdAt',
  updated_at: 'updatedAt',
};

/**
 * Execute a structured query. Filters on reserved columns run directly against
 * the records table; filters on dynamic fields resolve through record_values.
 * The scope predicate (tenant+app+env) is ALWAYS prepended.
 */
export async function query(spec: QuerySpec): Promise<Page<typeof schema.records.$inferSelect>> {
  const scope = requireScope();
  const limit = Math.min(Math.max(spec.limit ?? 50, 1), 200);

  return withTenant(async (tx) => {
    const conds = [
      // Non-negotiable scope injection.
      eq(schema.records.tenantId, scope.tenantId),
      eq(schema.records.applicationId, scope.applicationId),
      eq(schema.records.environment, scope.environment),
      eq(schema.records.moduleId, spec.moduleId),
    ];
    if (!spec.includeArchived) conds.push(isNull(schema.records.archivedAt));
    conds.push(isNull(schema.records.deletedAt));

    // Dynamic-field filters: resolve matching record ids from record_values.
    for (const filter of spec.filters ?? []) {
      const reserved = RESERVED_COLUMNS[filter.field];
      if (reserved) {
        conds.push(reservedCondition(reserved, filter));
      } else {
        const ids = await resolveDynamicFilter(tx, scope, spec.moduleId, filter);
        conds.push(inArray(schema.records.id, ids.length ? ids : ['__none__']));
      }
    }

    const sorts = spec.sorts?.length ? spec.sorts : [{ field: 'created_at', direction: 'desc' as const }];
    if (spec.cursor) {
      // Cursors currently encode a record id. Only the default single-column
      // created_at sort can be resumed safely using that legacy cursor shape.
      if (sorts.length !== 1 || sorts[0]!.field !== 'created_at') {
        throw ValidationError('Cursor pagination requires sorting by created_at');
      }
      const decoded = decodeCursor(spec.cursor);
      if (!decoded || typeof decoded.id !== 'string') throw ValidationError('Invalid cursor');
      const [pivot] = await tx.select({ id: schema.records.id, createdAt: schema.records.createdAt })
        .from(schema.records).where(and(
          eq(schema.records.id, decoded.id), eq(schema.records.tenantId, scope.tenantId),
          eq(schema.records.applicationId, scope.applicationId),
          eq(schema.records.environment, scope.environment),
          eq(schema.records.moduleId, spec.moduleId),
        ));
      if (!pivot) throw ValidationError('Cursor is no longer valid');
      const isAsc = sorts[0]!.direction === 'asc';
      conds.push(or(
        isAsc ? gt(schema.records.createdAt, pivot.createdAt) : lt(schema.records.createdAt, pivot.createdAt),
        and(eq(schema.records.createdAt, pivot.createdAt),
          isAsc ? gt(schema.records.id, pivot.id) : lt(schema.records.id, pivot.id)),
      )!);
    }
    const orderBy = sorts.map((s) => {
      const col = RESERVED_COLUMNS[s.field] ?? 'createdAt';
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const column = (schema.records as any)[col];
      return s.direction === 'asc' ? asc(column) : desc(column);
    });

    const rows = await tx
      .select()
      .from(schema.records)
      .where(and(...conds))
      .orderBy(...orderBy, sorts[0]!.direction === 'asc' ? asc(schema.records.id) : desc(schema.records.id))
      .limit(limit + 1);

    return buildPage(rows, limit);
  });
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function reservedCondition(col: keyof typeof schema.records.$inferSelect, filter: Filter): any {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const column = (schema.records as any)[col];
  switch (filter.operator) {
    case 'eq':
      return eq(column, filter.value);
    case 'neq':
      return ne(column, filter.value);
    case 'gt':
      return gt(column, filter.value);
    case 'gte':
      return gte(column, filter.value);
    case 'lt':
      return lt(column, filter.value);
    case 'lte':
      return lte(column, filter.value);
    case 'contains':
      return ilike(column, `%${String(filter.value)}%`);
    case 'in':
      return inArray(column, (filter.value as unknown[]) ?? []);
    case 'is_null':
      return isNull(column);
    default:
      throw ValidationError(`Unsupported operator '${filter.operator}'`);
  }
}

async function resolveDynamicFilter(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  tx: any,
  scope: InjectedScope,
  moduleId: string,
  filter: Filter,
): Promise<string[]> {
  const conds = [
    eq(schema.recordValues.tenantId, scope.tenantId),
    eq(schema.recordValues.applicationId, scope.applicationId),
    eq(schema.recordValues.environment, scope.environment),
    eq(schema.recordValues.moduleId, moduleId),
    eq(schema.recordValues.fieldKey, filter.field),
  ];
  switch (filter.operator) {
    case 'eq':
      conds.push(eq(schema.recordValues.valueText, String(filter.value)));
      break;
    case 'neq':
      conds.push(ne(schema.recordValues.valueText, String(filter.value)));
      break;
    case 'contains':
      conds.push(ilike(schema.recordValues.valueText, `%${String(filter.value)}%`));
      break;
    case 'in':
      conds.push(inArray(schema.recordValues.valueText, ((filter.value as unknown[]) ?? []).map(String)));
      break;
    case 'is_null':
      conds.push(isNull(schema.recordValues.valueText));
      break;
    default:
      conds.push(eq(schema.recordValues.valueText, String(filter.value)));
  }
  const rows = await tx
    .select({ recordId: schema.recordValues.recordId })
    .from(schema.recordValues)
    .where(and(...conds));
  return rows.map((r: { recordId: string }) => r.recordId);
}
