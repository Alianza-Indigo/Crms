import { schema, withElevated } from '@crms/database';
import { newId } from '@crms/kernel';
import { buildContext, type TenantContext } from '@crms/tenant-context';

/** Create a tenant + owner user + application, returning a ready TenantContext. */
export async function createTenantFixture(label: string): Promise<TenantContext> {
  const tenantId = newId('tenant');
  const userId = newId('user');
  const applicationId = newId('application');
  await withElevated(async (tx) => {
    await tx.insert(schema.tenants).values({ id: tenantId, name: label, slug: `${label}-${tenantId.slice(-6)}` });
    await tx.insert(schema.tenantRouting).values({ tenantId, isolationTier: 'shared' });
    await tx.insert(schema.users).values({ id: userId, email: `${tenantId}@example.test`, type: 'internal' });
    await tx.insert(schema.memberships).values({
      id: newId('membership'),
      tenantId,
      userId,
      status: 'active',
      isOwner: true,
    });
    await tx.insert(schema.applications).values({ id: applicationId, tenantId, name: 'App', slug: 'main' });
  });
  return buildContext({
    tenantId,
    userId,
    applicationId,
    environment: 'production',
    roleIds: ['__owner__'],
    origin: 'test',
  });
}
