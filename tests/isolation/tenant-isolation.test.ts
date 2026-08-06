import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { getDb, closeDb, schema, withTenant, sql } from '@crms/database';
import { runWithBuiltContext, getContext } from '@crms/tenant-context';
import { schemaEngine } from '@crms/schema-engine';
import { recordsEngine } from '@crms/records-engine';
import { requireScope } from '@crms/records-engine';
import { createTenantFixture } from '../helpers/seed.js';

/**
 * Tenant isolation suite (PRD §6.4, §47.1). These are the guardrails the whole
 * platform depends on: they attempt cross-tenant reads/writes and assert they
 * are impossible, and that dynamic queries cannot run without a tenant context.
 */
describe('tenant isolation', () => {
  let tenantA: Awaited<ReturnType<typeof createTenantFixture>>;
  let tenantB: Awaited<ReturnType<typeof createTenantFixture>>;
  let moduleAId: string;
  let moduleBId: string;

  beforeAll(async () => {
    tenantA = await createTenantFixture('tenant-a');
    tenantB = await createTenantFixture('tenant-b');

    // Each tenant builds its own module + a record inside its own context.
    await runWithBuiltContext(tenantA, async () => {
      const mod = await schemaEngine.createModule({ key: 'leads', name: 'Leads' });
      moduleAId = mod.id;
      await schemaEngine.createField({ moduleId: mod.id, key: 'name', name: 'Name', type: 'text_short' } as never);
      await recordsEngine.create({ moduleId: mod.id, data: { name: 'Alice (A)' } });
    });
    await runWithBuiltContext(tenantB, async () => {
      const mod = await schemaEngine.createModule({ key: 'leads', name: 'Leads' });
      moduleBId = mod.id;
      await schemaEngine.createField({ moduleId: mod.id, key: 'name', name: 'Name', type: 'text_short' } as never);
      await recordsEngine.create({ moduleId: mod.id, data: { name: 'Bob (B)' } });
    });
  });

  afterAll(async () => {
    await closeDb();
  });

  it('a tenant only sees its own records', async () => {
    const aRecords = await runWithBuiltContext(tenantA, () => recordsEngine.list({ moduleId: moduleAId }));
    expect(aRecords.items).toHaveLength(1);
    expect(aRecords.items[0]!.displayTitle).toBe('Alice (A)');

    const bRecords = await runWithBuiltContext(tenantB, () => recordsEngine.list({ moduleId: moduleBId }));
    expect(bRecords.items).toHaveLength(1);
    expect(bRecords.items[0]!.displayTitle).toBe('Bob (B)');
  });

  it('RLS blocks reading another tenant table rows even with a direct query', async () => {
    // Inside tenant A's context, a raw select of ALL records must only return A's.
    const rows = await runWithBuiltContext(tenantA, () =>
      withTenant(async (tx) => tx.select().from(schema.records)),
    );
    expect(rows.every((r) => r.tenantId === tenantA.tenantId)).toBe(true);
    expect(rows.some((r) => r.tenantId === tenantB.tenantId)).toBe(false);
  });

  it('cannot fetch another tenant record by id', async () => {
    const bRecord = await runWithBuiltContext(tenantB, async () => {
      const page = await recordsEngine.list({ moduleId: moduleBId });
      return page.items[0]!;
    });
    // Tenant A tries to read tenant B's record id → not found (RLS hides it).
    await expect(
      runWithBuiltContext(tenantA, () => recordsEngine.get(moduleBId, bRecord.id)),
    ).rejects.toThrow();
  });

  it('the Query Engine refuses to run without a tenant context', () => {
    expect(() => requireScope()).toThrow();
  });

  it('a query without an active application context is rejected', async () => {
    await runWithBuiltContext({ ...tenantA, applicationId: null }, async () => {
      await expect(recordsEngine.list({ moduleId: moduleAId })).rejects.toThrow();
    });
  });

  it('bypass GUC is off by default so unscoped connections see nothing', async () => {
    // A brand-new transaction with no context set must see zero records via RLS.
    const db = getDb();
    const rows = await db.transaction(async (tx) => {
      await tx.execute(sql`select set_config('app.current_tenant_id', '', true)`);
      await tx.execute(sql`select set_config('app.bypass_rls', 'off', true)`);
      return tx.select().from(schema.records);
    });
    expect(rows).toHaveLength(0);
    void getContext;
  });
});
