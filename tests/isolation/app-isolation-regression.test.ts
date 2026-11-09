import { describe, it, expect, afterAll } from 'vitest';
import { closeDb, schema, withElevated } from '@crms/database';
import { runWithBuiltContext } from '@crms/tenant-context';
import { schemaEngine } from '@crms/schema-engine';
import { recordsEngine } from '@crms/records-engine';
import { newId } from '@crms/kernel';
import { createTenantFixture } from '../helpers/seed.js';

describe('application isolation and cursor regressions', () => {
  afterAll(async () => { await closeDb(); });

  it('prevents access across applications within one tenant', async () => {
    const ctxA = await createTenantFixture('app-boundary');
    const appB = newId('application');
    await withElevated(async (tx) => {
      await tx.insert(schema.applications).values({
        id: appB, tenantId: ctxA.tenantId, name: 'Second app', slug: 'second',
      });
    });
    const ctxB = { ...ctxA, applicationId: appB };
    let recordId = '';
    let moduleId = '';
    await runWithBuiltContext(ctxA, async () => {
      const module = await schemaEngine.createModule({ key: 'leads', name: 'Lead' });
      moduleId = module.id;
      recordId = (await recordsEngine.create({ moduleId, data: {} })).id;
    });
    await runWithBuiltContext(ctxB, async () => {
      await expect(recordsEngine.get(moduleId, recordId)).rejects.toThrow();
    });
  });

  it('resumes created_at cursor pagination without duplicating the first page', async () => {
    const ctx = await createTenantFixture('cursor-regression');
    await runWithBuiltContext(ctx, async () => {
      const module = await schemaEngine.createModule({ key: 'tasks', name: 'Task' });
      for (let i = 0; i < 5; i++) {
        await recordsEngine.create({ moduleId: module.id, data: {} });
      }
      const first = await recordsEngine.list({ moduleId: module.id, limit: 2 });
      expect(first.items).toHaveLength(2);
      expect(first.hasMore).toBe(true);
      expect(first.nextCursor).toBeTruthy();
      const next = await recordsEngine.list({
        moduleId: module.id, limit: 2, cursor: first.nextCursor!,
      });
      expect(next.items).toHaveLength(2);
      const ids = [...first.items, ...next.items].map((r) => r.id);
      expect(new Set(ids).size).toBe(4);
    });
  });
});
