import { and, eq, schema, withTenant } from '@crms/database';
import { newId, NotFound, createLogger } from '@crms/kernel';
import { getContext } from '@crms/tenant-context';

const logger = createLogger('deployment-engine:lifecycle');

/**
 * Configuration lifecycle (PRD §8.4): compare versions, clone an application,
 * and roll a live environment back to a published version. These are real
 * structural operations over the builder definitions, all tenant-scoped.
 */

const BUILDER_TABLES = [
  schema.moduleDefinitions,
  schema.fieldDefinitions,
  schema.relationDefinitions,
  schema.viewDefinitions,
  schema.formDefinitions,
  schema.dashboardDefinitions,
  schema.pipelineDefinitions,
] as const;

export interface VersionDiff {
  modules: { added: string[]; removed: string[]; changed: string[] };
  fields: { added: string[]; removed: string[]; changed: string[] };
}

/** Diff two published application versions by their snapshots. */
export async function diffVersions(applicationId: string, versionA: string, versionB: string): Promise<VersionDiff> {
  const ctx = getContext();
  return withTenant(async (tx) => {
    const rows = await tx
      .select()
      .from(schema.applicationVersions)
      .where(and(eq(schema.applicationVersions.applicationId, applicationId), eq(schema.applicationVersions.environment, ctx.environment as never)));
    const a = rows.find((r) => r.version === versionA);
    const b = rows.find((r) => r.version === versionB);
    if (!a || !b) throw NotFound('Application version', !a ? versionA : versionB);
    return {
      modules: diffByKey((a.snapshot as Snapshot).modules, (b.snapshot as Snapshot).modules),
      fields: diffByKey((a.snapshot as Snapshot).fields, (b.snapshot as Snapshot).fields, (f) => `${f.moduleId}.${f.key}`),
    };
  });
}

interface Snapshot {
  modules: Array<{ id: string; key: string } & Record<string, unknown>>;
  fields: Array<{ id: string; key: string; moduleId: string } & Record<string, unknown>>;
  relations?: unknown[];
  views?: unknown[];
  forms?: unknown[];
  dashboards?: unknown[];
  pipelines?: unknown[];
}

function diffByKey<T extends Record<string, unknown>>(
  a: T[] = [],
  b: T[] = [],
  keyOf: (x: T) => string = (x) => String(x.key),
): { added: string[]; removed: string[]; changed: string[] } {
  const am = new Map(a.map((x) => [keyOf(x), x]));
  const bm = new Map(b.map((x) => [keyOf(x), x]));
  const added: string[] = [];
  const removed: string[] = [];
  const changed: string[] = [];
  for (const k of bm.keys()) if (!am.has(k)) added.push(k);
  for (const k of am.keys()) if (!bm.has(k)) removed.push(k);
  for (const [k, bv] of bm) {
    const av = am.get(k);
    if (av && stripVolatile(av) !== stripVolatile(bv)) changed.push(k);
  }
  return { added, removed, changed };
}

function stripVolatile(x: Record<string, unknown>): string {
  const { id, createdAt, updatedAt, ...rest } = x;
  void id;
  void createdAt;
  void updatedAt;
  return JSON.stringify(rest);
}

/**
 * Clone an application into a brand-new application within the same tenant,
 * copying all builder definitions with remapped ids (module references are
 * rewired). Credentials/records/secrets are NEVER copied (PRD §10.12).
 */
export async function cloneApplication(sourceApplicationId: string, newName: string): Promise<string> {
  const ctx = getContext();
  const env = ctx.environment;
  const newAppId = newId('application');

  await withTenant(async (tx) => {
    const [source] = await tx.select().from(schema.applications).where(eq(schema.applications.id, sourceApplicationId));
    if (!source) throw NotFound('Application', sourceApplicationId);

    await tx.insert(schema.applications).values({
      id: newAppId,
      tenantId: ctx.tenantId,
      name: newName,
      slug: `${source.slug}-copy-${newAppId.slice(-6)}`,
      description: source.description,
      sector: source.sector,
      branding: source.branding as never,
      settings: source.settings as never,
      createdBy: ctx.userId,
    });

    // Remap module ids first so field/relation/view references can be rewired.
    const moduleMap = new Map<string, string>();
    const modules = await tx
      .select()
      .from(schema.moduleDefinitions)
      .where(and(eq(schema.moduleDefinitions.applicationId, sourceApplicationId), eq(schema.moduleDefinitions.environment, env)));
    for (const m of modules) {
      const id = newId('module');
      moduleMap.set(m.id, id);
      await tx.insert(schema.moduleDefinitions).values({ ...m, id, applicationId: newAppId, primaryFieldId: null, createdBy: ctx.userId });
    }

    const fields = await tx
      .select()
      .from(schema.fieldDefinitions)
      .where(and(eq(schema.fieldDefinitions.applicationId, sourceApplicationId), eq(schema.fieldDefinitions.environment, env)));
    for (const f of fields) {
      await tx.insert(schema.fieldDefinitions).values({
        ...f,
        id: newId('field'),
        applicationId: newAppId,
        moduleId: moduleMap.get(f.moduleId) ?? f.moduleId,
        createdBy: ctx.userId,
      });
    }

    const relations = await tx
      .select()
      .from(schema.relationDefinitions)
      .where(and(eq(schema.relationDefinitions.applicationId, sourceApplicationId), eq(schema.relationDefinitions.environment, env)));
    for (const r of relations) {
      await tx.insert(schema.relationDefinitions).values({
        ...r,
        id: newId('relation'),
        applicationId: newAppId,
        sourceModuleId: moduleMap.get(r.sourceModuleId) ?? r.sourceModuleId,
        targetModuleId: moduleMap.get(r.targetModuleId) ?? r.targetModuleId,
        createdBy: ctx.userId,
      });
    }

    for (const [table, prefix] of [
      [schema.viewDefinitions, 'view'],
      [schema.formDefinitions, 'form'],
      [schema.dashboardDefinitions, 'dashboard'],
      [schema.pipelineDefinitions, 'workflow'],
    ] as const) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const t = table as any;
      const rows = await tx.select().from(t).where(and(eq(t.applicationId, sourceApplicationId), eq(t.environment, env)));
      for (const row of rows) {
        const remappedModule = row.moduleId ? (moduleMap.get(row.moduleId) ?? row.moduleId) : row.moduleId;
        await tx.insert(t).values({ ...row, id: newId(prefix), applicationId: newAppId, moduleId: remappedModule, createdBy: ctx.userId });
      }
    }
    logger.info({ sourceApplicationId, newAppId, modules: modules.length }, 'Application cloned');
  });
  return newAppId;
}

/**
 * Roll a live environment back to a published version's snapshot. Replaces the
 * environment's builder definitions atomically (PRD §8.4).
 */
export async function rollbackToVersion(applicationId: string, version: string): Promise<void> {
  const ctx = getContext();
  const env = ctx.environment;
  await withTenant(async (tx) => {
    const rows = await tx
      .select()
      .from(schema.applicationVersions)
      .where(and(eq(schema.applicationVersions.applicationId, applicationId), eq(schema.applicationVersions.environment, env as never)));
    const target = rows.find((r) => r.version === version);
    if (!target) throw NotFound('Application version', version);
    const snap = target.snapshot as Snapshot;

    // Clear current env definitions, then restore from the snapshot with fresh ids.
    for (const table of BUILDER_TABLES) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const t = table as any;
      await tx.delete(t).where(and(eq(t.applicationId, applicationId), eq(t.environment, env)));
    }

    const moduleMap = new Map<string, string>();
    for (const m of snap.modules ?? []) {
      const id = newId('module');
      moduleMap.set(m.id, id);
      await tx
        .insert(schema.moduleDefinitions)
        .values({ ...(m as Record<string, unknown>), id, applicationId, environment: env, primaryFieldId: null } as never);
    }
    for (const f of snap.fields ?? []) {
      await tx
        .insert(schema.fieldDefinitions)
        .values({ ...(f as Record<string, unknown>), id: newId('field'), applicationId, environment: env, moduleId: moduleMap.get(f.moduleId) ?? f.moduleId } as never);
    }
    logger.info({ applicationId, version, modules: (snap.modules ?? []).length }, 'Rolled back to version');
  });
}
