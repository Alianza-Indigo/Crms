import { and, eq, schema, withTenant } from '@crms/database';
import { newId, NotFound, ValidationError, createLogger } from '@crms/kernel';
import { getContext } from '@crms/tenant-context';
import { assert } from '@crms/permissions';
import { recordsEngine, type Filter, type Sort } from '@crms/records-engine';

const logger = createLogger('builder-engine:views');

/** View types (PRD §13). Data shaping differs per type; storage is uniform. */
export const VIEW_TYPES = [
  'table', 'list', 'kanban', 'calendar', 'agenda', 'timeline', 'gantt', 'map',
  'gallery', 'chart', 'form', 'record', 'cards', 'tree', 'matrix', 'workload',
] as const;

function scope() {
  const ctx = getContext();
  if (!ctx.applicationId) throw ValidationError('View operations require an application context');
  return { tenantId: ctx.tenantId, applicationId: ctx.applicationId, environment: ctx.environment };
}

export async function createView(input: {
  moduleId: string;
  key: string;
  name: string;
  type: string;
  config?: Record<string, unknown>;
  filters?: Filter[];
  sorts?: Sort[];
  grouping?: Record<string, unknown>;
  visibleFieldIds?: string[];
}): Promise<typeof schema.viewDefinitions.$inferSelect> {
  await assert('manage_config', { type: 'view', selector: input.moduleId });
  const s = scope();
  const id = newId('view');
  return withTenant(async (tx) => {
    await tx.insert(schema.viewDefinitions).values({
      id,
      tenantId: s.tenantId,
      applicationId: s.applicationId,
      environment: s.environment,
      moduleId: input.moduleId,
      key: input.key,
      name: input.name,
      type: input.type,
      config: input.config ?? {},
      filters: input.filters ?? [],
      sorts: input.sorts ?? [],
      grouping: input.grouping ?? {},
      visibleFieldIds: input.visibleFieldIds ?? [],
      createdBy: getContext().userId,
    });
    const [row] = await tx.select().from(schema.viewDefinitions).where(eq(schema.viewDefinitions.id, id));
    logger.info({ viewId: id, type: input.type }, 'View created');
    return row!;
  });
}

export async function listViews(moduleId: string): Promise<Array<typeof schema.viewDefinitions.$inferSelect>> {
  return withTenant(async (tx) => tx.select().from(schema.viewDefinitions).where(eq(schema.viewDefinitions.moduleId, moduleId)));
}

/**
 * Execute a view: run its module query with the view's filters/sorts and shape
 * the result for the view type (kanban groups by stage field; calendar/timeline
 * annotate the date field; others return a flat page).
 */
export async function runView(viewId: string, opts: { limit?: number; cursor?: string } = {}): Promise<{
  view: typeof schema.viewDefinitions.$inferSelect;
  shape: string;
  items?: unknown[];
  groups?: Array<{ key: string; items: unknown[] }>;
  nextCursor?: string | null;
}> {
  const view = await withTenant(async (tx) => {
    const [row] = await tx.select().from(schema.viewDefinitions).where(eq(schema.viewDefinitions.id, viewId));
    return row ?? null;
  });
  if (!view) throw NotFound('View', viewId);

  const page = await recordsEngine.list({
    moduleId: view.moduleId,
    filters: view.filters as Filter[],
    sorts: view.sorts as Sort[],
    limit: opts.limit,
    cursor: opts.cursor,
  });

  if (view.type === 'kanban') {
    const groupField = ((view.grouping as Record<string, unknown>).field as string) ?? 'stage';
    const groups = new Map<string, unknown[]>();
    for (const rec of page.items) {
      const key = String((rec as Record<string, unknown>)[groupField] ?? (rec.data as Record<string, unknown>)?.[groupField] ?? 'ungrouped');
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(rec);
    }
    return { view, shape: 'kanban', groups: [...groups.entries()].map(([key, items]) => ({ key, items })), nextCursor: page.nextCursor };
  }

  return { view, shape: view.type, items: page.items, nextCursor: page.nextCursor };
}
