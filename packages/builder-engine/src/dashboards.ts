import { and, eq, isNull, sql, schema, withTenant } from '@crms/database';
import { newId, NotFound, ValidationError, createLogger } from '@crms/kernel';
import { getContext } from '@crms/tenant-context';
import { assert } from '@crms/permissions';
import { requireScope } from '@crms/records-engine';

const logger = createLogger('builder-engine:dashboards');

export interface Widget {
  key: string;
  type: 'metric' | 'bar' | 'line' | 'pie' | 'table';
  moduleId: string;
  aggregate: 'count' | 'sum' | 'avg';
  field?: string;
  groupBy?: string; // 'stage' | 'owner' | field key
}

export async function createDashboard(input: { key: string; name: string; widgets: Widget[] }): Promise<typeof schema.dashboardDefinitions.$inferSelect> {
  await assert('manage_config', { type: 'dashboard' });
  const ctx = getContext();
  if (!ctx.applicationId) throw ValidationError('Dashboard operations require an application context');
  const id = newId('dashboard');
  return withTenant(async (tx) => {
    await tx.insert(schema.dashboardDefinitions).values({
      id,
      tenantId: ctx.tenantId,
      applicationId: ctx.applicationId!,
      environment: ctx.environment,
      key: input.key,
      name: input.name,
      widgets: input.widgets,
      createdBy: ctx.userId,
    });
    const [row] = await tx.select().from(schema.dashboardDefinitions).where(eq(schema.dashboardDefinitions.id, id));
    return row!;
  });
}

export async function listDashboards(): Promise<Array<typeof schema.dashboardDefinitions.$inferSelect>> {
  const ctx = getContext();
  return withTenant(async (tx) =>
    tx
      .select()
      .from(schema.dashboardDefinitions)
      .where(and(eq(schema.dashboardDefinitions.applicationId, ctx.applicationId ?? ''), eq(schema.dashboardDefinitions.environment, ctx.environment))),
  );
}

const RESERVED_GROUP: Record<string, keyof typeof schema.records.$inferSelect> = {
  stage: 'stage',
  owner: 'ownerUserId',
  assignee: 'assigneeUserId',
  team: 'teamId',
  branch: 'branchId',
};

/**
 * Execute a widget aggregation (PRD §22) over the records table, tenant/app/env
 * scoped (RLS + explicit predicates). Returns a metric or a labeled series.
 */
export async function runWidget(widget: Widget): Promise<{ metric?: number; series?: Array<{ label: string; value: number }> }> {
  await assert('view', { type: 'record', selector: widget.moduleId });
  const s = requireScope();

  return withTenant(async (tx) => {
    const scopeConds = and(
      eq(schema.records.tenantId, s.tenantId),
      eq(schema.records.applicationId, s.applicationId),
      eq(schema.records.environment, s.environment),
      eq(schema.records.moduleId, widget.moduleId),
      isNull(schema.records.deletedAt),
    );

    // Grouped aggregation.
    if (widget.groupBy) {
      const reserved = RESERVED_GROUP[widget.groupBy];
      if (reserved) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const col = (schema.records as any)[reserved];
        const rows = await tx
          .select({ label: sql<string>`coalesce(${col}::text, 'none')`, value: sql<string>`count(*)::text` })
          .from(schema.records)
          .where(scopeConds)
          .groupBy(col);
        return { series: rows.map((r) => ({ label: r.label, value: Number(r.value) })) };
      }
      // Group by a dynamic field via record_values.
      const rows = await tx
        .select({
          label: sql<string>`coalesce(${schema.recordValues.valueText}, 'none')`,
          value: sql<string>`count(distinct ${schema.recordValues.recordId})::text`,
        })
        .from(schema.recordValues)
        .where(
          and(
            eq(schema.recordValues.tenantId, s.tenantId),
            eq(schema.recordValues.applicationId, s.applicationId),
            eq(schema.recordValues.environment, s.environment),
            eq(schema.recordValues.moduleId, widget.moduleId),
            eq(schema.recordValues.fieldKey, widget.groupBy),
          ),
        )
        .groupBy(schema.recordValues.valueText);
      return { series: rows.map((r) => ({ label: r.label, value: Number(r.value) })) };
    }

    // Scalar metric.
    if (widget.aggregate === 'count') {
      const rows = await tx.select({ n: sql<string>`count(*)::text` }).from(schema.records).where(scopeConds);
      return { metric: Number(rows[0]?.n ?? 0) };
    }
    if (!widget.field) throw ValidationError('sum/avg widgets require a field');
    const agg = widget.aggregate === 'avg' ? sql`avg((value_number)::numeric)` : sql`sum((value_number)::numeric)`;
    const rows = await tx
      .select({ n: sql<string>`coalesce(${agg}, 0)::text` })
      .from(schema.recordValues)
      .where(
        and(
          eq(schema.recordValues.tenantId, s.tenantId),
          eq(schema.recordValues.applicationId, s.applicationId),
          eq(schema.recordValues.environment, s.environment),
          eq(schema.recordValues.moduleId, widget.moduleId),
          eq(schema.recordValues.fieldKey, widget.field),
        ),
      );
    logger.debug({ widget: widget.key }, 'Widget executed');
    return { metric: Number(rows[0]?.n ?? 0) };
  });
}
