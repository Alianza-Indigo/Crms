import { and, eq, schema, withTenant, withElevated } from '@crms/database';
import { newId, NotFound, ValidationError, Conflict, createLogger } from '@crms/kernel';
import { getContext, buildContext, runWithBuiltContext } from '@crms/tenant-context';
import { assert } from '@crms/permissions';
import { recordsEngine, query } from '@crms/records-engine';

const logger = createLogger('builder-engine:forms');

export async function createForm(input: {
  moduleId?: string;
  key: string;
  name: string;
  kind?: string;
  fields?: unknown[];
  layout?: Record<string, unknown>;
  publicSlug?: string;
  dedupeConfig?: Record<string, unknown>;
  captchaEnabled?: boolean;
}): Promise<typeof schema.formDefinitions.$inferSelect> {
  await assert('manage_config', { type: 'application' });
  const ctx = getContext();
  if (!ctx.applicationId) throw ValidationError('Form operations require an application context');
  const id = newId('form');
  return withTenant(async (tx) => {
    await tx.insert(schema.formDefinitions).values({
      id,
      tenantId: ctx.tenantId,
      applicationId: ctx.applicationId!,
      environment: ctx.environment,
      moduleId: input.moduleId,
      key: input.key,
      name: input.name,
      kind: input.kind ?? 'internal',
      fields: input.fields ?? [],
      layout: input.layout ?? {},
      publicSlug: input.publicSlug,
      dedupeConfig: input.dedupeConfig ?? {},
      captchaEnabled: input.captchaEnabled ?? false,
      createdBy: ctx.userId,
    });
    const [row] = await tx.select().from(schema.formDefinitions).where(eq(schema.formDefinitions.id, id));
    return row!;
  });
}

export async function listForms(): Promise<Array<typeof schema.formDefinitions.$inferSelect>> {
  const ctx = getContext();
  return withTenant(async (tx) =>
    tx
      .select()
      .from(schema.formDefinitions)
      .where(and(eq(schema.formDefinitions.applicationId, ctx.applicationId ?? ''), eq(schema.formDefinitions.environment, ctx.environment))),
  );
}

/** Public form metadata (no session) — safe subset for rendering. */
export async function getPublicForm(slug: string): Promise<{
  id: string;
  name: string;
  fields: unknown[];
  layout: Record<string, unknown>;
  captchaEnabled: boolean;
}> {
  const form = await withElevated(async (tx) => {
    const [row] = await tx.select().from(schema.formDefinitions).where(eq(schema.formDefinitions.publicSlug, slug));
    return row ?? null;
  });
  if (!form) throw NotFound('Form', slug);
  return { id: form.id, name: form.name, fields: form.fields as unknown[], layout: form.layout as Record<string, unknown>, captchaEnabled: form.captchaEnabled };
}

async function applyDedupe(form: typeof schema.formDefinitions.$inferSelect, data: Record<string, unknown>): Promise<{ mode: 'create' | 'update' | 'reject'; recordId?: string }> {
  const cfg = form.dedupeConfig as { field?: string; onDuplicate?: 'update' | 'reject' };
  if (!cfg.field || !form.moduleId) return { mode: 'create' };
  const value = data[cfg.field];
  if (value === undefined) return { mode: 'create' };
  const page = await query({ moduleId: form.moduleId, filters: [{ field: cfg.field, operator: 'eq', value }], limit: 1 });
  const existing = page.items[0];
  if (!existing) return { mode: 'create' };
  return cfg.onDuplicate === 'update' ? { mode: 'update', recordId: existing.id } : { mode: 'reject', recordId: existing.id };
}

/** Submit a public form (no session): create/update a record in the form's module. */
export async function submitPublicForm(slug: string, data: Record<string, unknown>): Promise<{ recordId: string; mode: string }> {
  const form = await withElevated(async (tx) => {
    const [row] = await tx.select().from(schema.formDefinitions).where(eq(schema.formDefinitions.publicSlug, slug));
    return row ?? null;
  });
  if (!form || !form.moduleId) throw NotFound('Public form', slug);

  // The form itself is the authorization boundary for anonymous intake (PRD §14).
  const ctx = buildContext({
    tenantId: form.tenantId,
    applicationId: form.applicationId,
    environment: form.environment as never,
    origin: 'form',
    roleIds: ['__owner__'],
  });
  return runWithBuiltContext(ctx, async () => {
    const dedupe = await applyDedupe(form, data);
    if (dedupe.mode === 'reject') throw Conflict('A record with this value already exists');
    if (dedupe.mode === 'update' && dedupe.recordId) {
      await recordsEngine.update(form.moduleId!, dedupe.recordId, data);
      return { recordId: dedupe.recordId, mode: 'update' };
    }
    const rec = await recordsEngine.create({ moduleId: form.moduleId!, data });
    logger.info({ formId: form.id, recordId: rec.id }, 'Public form submitted');
    return { recordId: rec.id, mode: 'create' };
  }) as Promise<{ recordId: string; mode: string }>;
}

/** Submit a form as an authenticated user (permissions enforced normally). */
export async function submitForm(formId: string, data: Record<string, unknown>): Promise<{ recordId: string; mode: string }> {
  const form = await withTenant(async (tx) => {
    const [row] = await tx.select().from(schema.formDefinitions).where(eq(schema.formDefinitions.id, formId));
    return row ?? null;
  });
  if (!form || !form.moduleId) throw NotFound('Form', formId);
  const dedupe = await applyDedupe(form, data);
  if (dedupe.mode === 'reject') throw Conflict('A record with this value already exists');
  if (dedupe.mode === 'update' && dedupe.recordId) {
    await recordsEngine.update(form.moduleId, dedupe.recordId, data);
    return { recordId: dedupe.recordId, mode: 'update' };
  }
  const rec = await recordsEngine.create({ moduleId: form.moduleId, data });
  return { recordId: rec.id, mode: 'create' };
}
