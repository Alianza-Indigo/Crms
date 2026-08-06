import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { closeDb, schema, withElevated } from '@crms/database';
import { newId } from '@crms/kernel';
import { runWithBuiltContext, buildContext } from '@crms/tenant-context';
import { schemaEngine } from '@crms/schema-engine';
import { recordsEngine } from '@crms/records-engine';
import { createTenantFixture } from '../helpers/seed.js';

/**
 * Field-level permissions (PRD §18). A field restricted to a role must be masked
 * on read and rejected on write for a subject lacking that role — while owners
 * bypass. Uses a real non-owner role with record grants.
 */
describe('field-level permissions', () => {
  let owner: Awaited<ReturnType<typeof createTenantFixture>>;
  let editor: ReturnType<typeof buildContext>;
  let moduleId: string;
  let recordId: string;

  beforeAll(async () => {
    owner = await createTenantFixture('fieldperms');

    // A non-owner "editor" role that can view/create/edit records but is NOT the
    // admin role the salary field is restricted to.
    const editorRoleId = newId('role');
    await withElevated(async (tx) => {
      await tx.insert(schema.roles).values({
        id: editorRoleId,
        tenantId: owner.tenantId,
        name: 'Editor',
        permissions: ['view:record:*', 'create:record:*', 'edit:record:*'],
      });
    }, owner);
    editor = buildContext({ tenantId: owner.tenantId, userId: newId('user'), applicationId: owner.applicationId, roleIds: [editorRoleId], origin: 'test' });

    await runWithBuiltContext(owner, async () => {
      const mod = await schemaEngine.createModule({ key: 'employees', name: 'Employee' });
      moduleId = mod.id;
      await schemaEngine.createField({ moduleId: mod.id, key: 'name', name: 'Name', type: 'text_short' } as never);
      await schemaEngine.createField({
        moduleId: mod.id,
        key: 'salary',
        name: 'Salary',
        type: 'currency',
        permissions: { readRoles: ['rol_admin_only'], writeRoles: ['rol_admin_only'] },
      } as never);
      const rec = await recordsEngine.create({ moduleId: mod.id, data: { name: 'Ada', salary: 90000 } });
      recordId = rec.id;
    });
  });

  afterAll(async () => {
    await closeDb();
  });

  it('owner sees restricted fields', async () => {
    const rec = await runWithBuiltContext(owner, () => recordsEngine.get(moduleId, recordId));
    expect((rec.data as Record<string, unknown>).salary).toBe(90000);
  });

  it('editor cannot read the restricted field (masked)', async () => {
    const rec = await runWithBuiltContext(editor, () => recordsEngine.get(moduleId, recordId));
    expect((rec.data as Record<string, unknown>).name).toBe('Ada');
    expect('salary' in (rec.data as Record<string, unknown>)).toBe(false);
  });

  it('editor cannot write the restricted field', async () => {
    await expect(
      runWithBuiltContext(editor, () => recordsEngine.update(moduleId, recordId, { salary: 1 })),
    ).rejects.toThrow(/cannot modify field/i);
  });

  it('editor can still write allowed fields', async () => {
    const updated = await runWithBuiltContext(editor, () => recordsEngine.update(moduleId, recordId, { name: 'Ada L.' }));
    expect((updated.data as Record<string, unknown>).name).toBe('Ada L.');
  });
});
