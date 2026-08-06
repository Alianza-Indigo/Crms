import { scryptSync, randomBytes } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { newId } from '@crms/kernel';
import { schema, withElevated, closeDb } from './client.js';

/**
 * Development seed. Creates a platform admin, a demo tenant with an owner
 * membership, and a first application. Idempotent by email/slug. Uses the same
 * scrypt password format as @crms/auth (kept inline to avoid a dependency cycle).
 */
function hashPassword(password: string): string {
  const N = 16384, r = 8, p = 1;
  const salt = randomBytes(16);
  const derived = scryptSync(password, salt, 64, { N, r, p });
  return `scrypt$${N}$${r}$${p}$${salt.toString('base64')}$${derived.toString('base64')}`;
}

async function seed(): Promise<void> {
  const adminEmail = 'admin@crms.local';
  const password = hashPassword('ChangeMe123!');

  await withElevated(async (tx) => {
    const existing = await tx.select().from(schema.users).where(eq(schema.users.email, adminEmail));
    if (existing.length) {
      console.log('Seed already applied (admin exists).');
      return;
    }
    const adminId = newId('user');
    const tenantId = newId('tenant');
    const appId = newId('application');
    const moduleId = newId('module');

    await tx.insert(schema.users).values({
      id: adminId,
      email: adminEmail,
      passwordHash: password,
      name: 'Platform Admin',
      isPlatformAdmin: true,
      emailVerified: true,
      type: 'internal',
    });
    await tx.insert(schema.tenants).values({ id: tenantId, name: 'Demo Org', slug: 'demo' });
    await tx.insert(schema.tenantRouting).values({ tenantId, isolationTier: 'shared' });
    await tx.insert(schema.memberships).values({
      id: newId('membership'),
      tenantId,
      userId: adminId,
      status: 'active',
      isOwner: true,
      acceptedAt: new Date(),
    });
    await tx.insert(schema.applications).values({ id: appId, tenantId, name: 'Sales CRM', slug: 'sales' });
    await tx.insert(schema.moduleDefinitions).values({
      id: moduleId,
      tenantId,
      applicationId: appId,
      environment: 'production',
      key: 'leads',
      name: 'Lead',
      namePlural: 'Leads',
    });
    await tx.insert(schema.fieldDefinitions).values([
      { id: newId('field'), tenantId, applicationId: appId, environment: 'production', moduleId, key: 'name', name: 'Name', type: 'text_short', required: true },
      { id: newId('field'), tenantId, applicationId: appId, environment: 'production', moduleId, key: 'email', name: 'Email', type: 'email' },
      { id: newId('field'), tenantId, applicationId: appId, environment: 'production', moduleId, key: 'value', name: 'Value', type: 'currency' },
    ]);

    console.log(`Seeded:
  admin:       ${adminEmail} / ChangeMe123!
  tenant:      ${tenantId} (demo)
  application: ${appId} (sales)
  module:      leads`);
  });
}

seed()
  .then(() => closeDb())
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
