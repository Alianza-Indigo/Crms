import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { closeDb } from '@crms/database';
import { runWithBuiltContext } from '@crms/tenant-context';
import { schemaEngine } from '@crms/schema-engine';
import { recordsEngine } from '@crms/records-engine';
import { createTenantFixture } from '../helpers/seed.js';

/**
 * Records operations + computed fields (PRD §11.3, §12). Validates that formula
 * and autonumber fields are computed server-side, and that the new record
 * operations (duplicate/archive/restore) behave correctly under tenant scope.
 */
describe('records operations + computed fields', () => {
  let ctx: Awaited<ReturnType<typeof createTenantFixture>>;
  let moduleId: string;

  beforeAll(async () => {
    ctx = await createTenantFixture('ops');
    await runWithBuiltContext(ctx, async () => {
      const mod = await schemaEngine.createModule({ key: 'invoices', name: 'Invoice' });
      moduleId = mod.id;
      await schemaEngine.createField({ moduleId: mod.id, key: 'qty', name: 'Qty', type: 'integer' } as never);
      await schemaEngine.createField({ moduleId: mod.id, key: 'price', name: 'Price', type: 'decimal' } as never);
      await schemaEngine.createField({
        moduleId: mod.id,
        key: 'total',
        name: 'Total',
        type: 'formula',
        config: { expression: 'qty * price' },
      } as never);
      await schemaEngine.createField({
        moduleId: mod.id,
        key: 'folio',
        name: 'Folio',
        type: 'autonumber',
        config: { prefix: 'INV-', pad: 4 },
      } as never);
    });
  });

  afterAll(async () => {
    await closeDb();
  });

  it('computes formula fields on create', async () => {
    const rec = await runWithBuiltContext(ctx, () =>
      recordsEngine.create({ moduleId, data: { qty: 3, price: 10 } }),
    );
    expect((rec.data as Record<string, unknown>).total).toBe(30);
  });

  it('generates incrementing autonumber values', async () => {
    const a = await runWithBuiltContext(ctx, () => recordsEngine.create({ moduleId, data: { qty: 1, price: 5 } }));
    const b = await runWithBuiltContext(ctx, () => recordsEngine.create({ moduleId, data: { qty: 1, price: 5 } }));
    const fa = (a.data as Record<string, unknown>).folio as string;
    const fb = (b.data as Record<string, unknown>).folio as string;
    expect(fa).toMatch(/^INV-\d{4}$/);
    expect(fb).toMatch(/^INV-\d{4}$/);
    expect(Number(fb.slice(4))).toBe(Number(fa.slice(4)) + 1);
  });

  it('recomputes formula on update', async () => {
    const rec = await runWithBuiltContext(ctx, () => recordsEngine.create({ moduleId, data: { qty: 2, price: 4 } }));
    const updated = await runWithBuiltContext(ctx, () => recordsEngine.update(moduleId, rec.id, { qty: 5 }));
    expect((updated.data as Record<string, unknown>).total).toBe(20);
  });

  it('duplicates, archives and restores records', async () => {
    const rec = await runWithBuiltContext(ctx, () => recordsEngine.create({ moduleId, data: { qty: 7, price: 2 } }));
    const dup = await runWithBuiltContext(ctx, () => recordsEngine.duplicate(moduleId, rec.id));
    expect(dup.id).not.toBe(rec.id);
    expect((dup.data as Record<string, unknown>).qty).toBe(7);

    await runWithBuiltContext(ctx, () => recordsEngine.archive(moduleId, rec.id));
    const afterArchive = await runWithBuiltContext(ctx, () => recordsEngine.list({ moduleId }));
    expect(afterArchive.items.some((r) => r.id === rec.id)).toBe(false);

    await runWithBuiltContext(ctx, () => recordsEngine.restore(moduleId, rec.id));
    const afterRestore = await runWithBuiltContext(ctx, () => recordsEngine.list({ moduleId }));
    expect(afterRestore.items.some((r) => r.id === rec.id)).toBe(true);
  });
});
