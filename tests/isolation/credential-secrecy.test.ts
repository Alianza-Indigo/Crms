import { describe, it, expect, afterAll } from 'vitest';
import { encryptSecret, decryptSecret, credentialManager } from '@crms/credential-engine';
import { closeDb, schema, withElevated, eq } from '@crms/database';
import { runWithBuiltContext } from '@crms/tenant-context';
import { createTenantFixture } from '../helpers/seed.js';

/**
 * Credential secrecy suite (PRD §10.4, §47.10). Asserts envelope encryption
 * round-trips, tampering is detected, and that stored ciphertext never contains
 * the plaintext, and the public representation carries no secret.
 */
describe('credential secrecy', () => {
  afterAll(async () => {
    await closeDb();
  });

  it('encrypts and decrypts round-trip', () => {
    const blob = encryptSecret('super-secret-value');
    expect(blob.ciphertext).not.toContain('super-secret-value');
    expect(decryptSecret(blob.ciphertext)).toBe('super-secret-value');
  });

  it('detects tampering via the GCM auth tag', () => {
    const { ciphertext } = encryptSecret('abc123');
    const parts = ciphertext.split('.');
    // Flip a character in the ciphertext segment.
    parts[4] = parts[4]!.slice(0, -1) + (parts[4]!.endsWith('A') ? 'B' : 'A');
    expect(() => decryptSecret(parts.join('.'))).toThrow();
  });

  it('stores only ciphertext and never returns the secret from the API surface', async () => {
    const ctx = await createTenantFixture('cred-tenant');
    const created = await runWithBuiltContext(ctx, () =>
      credentialManager.create({
        key: 'OPENAI',
        name: 'OpenAI',
        provider: 'openai',
        authType: 'api_key',
        secret: { apiKey: 'sk-DO-NOT-LEAK-123' },
      }),
    );
    // Public object has no secret field of any kind.
    expect(JSON.stringify(created)).not.toContain('sk-DO-NOT-LEAK-123');

    // The stored secret row is ciphertext, not plaintext.
    const stored = await withElevated(async (tx) =>
      tx.select().from(schema.credentialSecrets).where(eq(schema.credentialSecrets.credentialId, created.id)),
    );
    expect(stored[0]!.ciphertext).not.toContain('sk-DO-NOT-LEAK-123');

    // useSecret (execution path) can still recover it.
    const resolved = await runWithBuiltContext(ctx, () => credentialManager.useSecret({ credentialId: created.id }));
    expect(resolved.secret.apiKey).toBe('sk-DO-NOT-LEAK-123');
  });
});
