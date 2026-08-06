import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { closeDb, schema, withElevated, eq } from '@crms/database';
import { newId } from '@crms/kernel';
import { runWithBuiltContext } from '@crms/tenant-context';
import { schemaEngine } from '@crms/schema-engine';
import { recordsEngine } from '@crms/records-engine';
import { onEvent, runAutomation } from '@crms/automation-engine';
import type { DomainEvent } from '@crms/events';
import { createTenantFixture } from '../helpers/seed.js';

describe('mobile delta sync (PRD §27.1)', () => {
  let ctx: Awaited<ReturnType<typeof createTenantFixture>>;
  let moduleId: string;

  beforeAll(async () => {
    ctx = await createTenantFixture('sync');
    await runWithBuiltContext(ctx, async () => {
      const mod = await schemaEngine.createModule({ key: 'contacts', name: 'Contact' });
      moduleId = mod.id;
      await schemaEngine.createField({ moduleId: mod.id, key: 'name', name: 'Name', type: 'text_short' } as never);
    });
  });
  afterAll(async () => {
    await closeDb();
  });

  it('returns changes since a cursor and tombstones for deletions', async () => {
    const rec = await runWithBuiltContext(ctx, () => recordsEngine.create({ moduleId, data: { name: 'One' } }));
    const first = await runWithBuiltContext(ctx, () => recordsEngine.sync(moduleId, undefined));
    expect(first.changed.some((r) => r.id === rec.id)).toBe(true);

    // Delete → next sync from the new cursor yields a tombstone.
    await runWithBuiltContext(ctx, () => recordsEngine.delete(moduleId, rec.id, { confirm: true }));
    const second = await runWithBuiltContext(ctx, () => recordsEngine.sync(moduleId, first.nextSince));
    expect(second.deleted.some((d) => d.id === rec.id)).toBe(true);
  });
});

describe('automation execution (PRD §16)', () => {
  let ctx: Awaited<ReturnType<typeof createTenantFixture>>;
  let sourceModuleId: string;
  let targetModuleId: string;

  beforeAll(async () => {
    ctx = await createTenantFixture('autox');
    await runWithBuiltContext(ctx, async () => {
      const src = await schemaEngine.createModule({ key: 'orders', name: 'Order' });
      const tgt = await schemaEngine.createModule({ key: 'tasks', name: 'Task' });
      sourceModuleId = src.id;
      targetModuleId = tgt.id;
      await schemaEngine.createField({ moduleId: tgt.id, key: 'title', name: 'Title', type: 'text_short' } as never);
    });

    // An automation: when an order is created, create a follow-up task.
    await withElevated(async (tx) => {
      await tx.insert(schema.automationDefinitions).values({
        id: newId('automation'),
        tenantId: ctx.tenantId,
        applicationId: ctx.applicationId!,
        environment: ctx.environment,
        key: 'order_to_task',
        name: 'Order → Task',
        status: 'active',
        trigger: { event: 'record.created', moduleId: sourceModuleId },
        graph: {
          start: 'n1',
          nodes: [{ id: 'n1', type: 'action', config: { action: 'create_record', moduleId: targetModuleId, data: { title: 'Follow up' } } }],
        },
      });
    }, ctx);
  });
  afterAll(async () => {
    await closeDb();
  });

  it('runs the triggered automation and performs its action', async () => {
    await runWithBuiltContext(ctx, async () => {
      const event: DomainEvent = {
        id: newId('event'),
        type: 'record.created',
        schemaVersion: 1,
        tenantId: ctx.tenantId,
        applicationId: ctx.applicationId,
        moduleId: sourceModuleId,
        recordId: newId('record'),
        environment: ctx.environment,
        actor: ctx.userId,
        correlationId: ctx.correlationId,
        timestamp: new Date().toISOString(),
        payload: { data: { total: 100 } },
      };
      const runIds = await onEvent(event);
      expect(runIds.length).toBe(1);
      await runAutomation(runIds[0]!);

      const run = await withElevated(async (tx) => {
        const [r] = await tx.select().from(schema.automationRuns).where(eq(schema.automationRuns.id, runIds[0]!));
        return r;
      }, ctx);
      expect(run?.status).toBe('succeeded');

      const tasks = await recordsEngine.list({ moduleId: targetModuleId });
      expect(tasks.items.some((t) => (t.data as Record<string, unknown>).title === 'Follow up')).toBe(true);
    });
  });
});
