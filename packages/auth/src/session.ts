import { and, eq, schema, withElevated } from '@crms/database';
import { newId, newToken, createLogger } from '@crms/kernel';
import { hashToken } from './token.js';

const logger = createLogger('auth');

/**
 * Upsert a user by verified email (optionally linking an SSO provider/subject)
 * and open a session. Shared by every passwordless / federated login path
 * (OIDC, SAML, magic link) so they behave identically.
 */
export async function upsertUserSession(input: {
  email: string;
  name?: string;
  provider?: string;
  subject?: string;
  ip?: string;
}): Promise<{ token: string; userId: string; isNewUser: boolean }> {
  const email = input.email.toLowerCase();
  return withElevated(async (tx) => {
    let user: typeof schema.users.$inferSelect | undefined;
    if (input.provider && input.subject) {
      user = (
        await tx
          .select()
          .from(schema.users)
          .where(and(eq(schema.users.oauthProvider, input.provider), eq(schema.users.oauthSubject, input.subject)))
      )[0];
    }
    let isNewUser = false;
    if (!user) {
      const [byEmail] = await tx.select().from(schema.users).where(eq(schema.users.email, email));
      if (byEmail) {
        if (input.provider && input.subject) {
          await tx
            .update(schema.users)
            .set({ oauthProvider: input.provider, oauthSubject: input.subject, emailVerified: true })
            .where(eq(schema.users.id, byEmail.id));
        }
        user = byEmail;
      } else {
        const id = newId('user');
        await tx.insert(schema.users).values({
          id,
          email,
          emailVerified: true,
          name: input.name,
          oauthProvider: input.provider,
          oauthSubject: input.subject,
          type: 'internal',
        });
        user = (await tx.select().from(schema.users).where(eq(schema.users.id, id)))[0];
        isNewUser = true;
      }
    }
    const [membership] = await tx.select().from(schema.memberships).where(eq(schema.memberships.userId, user!.id));
    const token = newToken(32);
    await tx.insert(schema.sessions).values({
      id: newId('session'),
      userId: user!.id,
      tokenHash: hashToken(token),
      activeTenantId: membership?.tenantId ?? null,
      device: { provider: input.provider ?? 'magic_link' },
      ip: input.ip,
      expiresAt: new Date(Date.now() + 7 * 24 * 3600 * 1000),
    });
    logger.info({ userId: user!.id, isNewUser, via: input.provider ?? 'magic_link' }, 'Session opened');
    return { token, userId: user!.id, isNewUser };
  });
}
