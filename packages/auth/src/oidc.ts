import { randomBytes, createHmac, timingSafeEqual } from 'node:crypto';
import { loadEnv } from '@crms/config';
import { and, eq, schema, withElevated } from '@crms/database';
import { newId, newToken, AppError, ValidationError, createLogger } from '@crms/kernel';
import { hashToken } from './token.js';

const logger = createLogger('auth:oidc');

/**
 * Generic OIDC SSO (PRD §32.1). Works with ANY OpenID Connect provider (Okta,
 * Auth0, Microsoft Entra, Keycloak, …): set OIDC_ISSUER + client id/secret and
 * the platform discovers the endpoints from the issuer's well-known document.
 * Nothing else to change — this is the "just plug credentials" SSO path.
 */
interface Discovery {
  authorization_endpoint: string;
  token_endpoint: string;
  issuer: string;
}
let discoveryCache: Discovery | null = null;

function cfg() {
  const env = loadEnv();
  if (!env.OIDC_ISSUER || !env.OIDC_CLIENT_ID || !env.OIDC_CLIENT_SECRET) {
    throw new AppError('NOT_IMPLEMENTED', 'OIDC SSO is not configured on this deployment', { expose: true });
  }
  return {
    issuer: env.OIDC_ISSUER,
    clientId: env.OIDC_CLIENT_ID,
    clientSecret: env.OIDC_CLIENT_SECRET,
    redirectUri: env.OIDC_REDIRECT_URI ?? `${env.API_BASE_URL}/v1/auth/oidc/callback`,
    jwtSecret: env.JWT_SECRET,
  };
}

export function isOidcConfigured(): boolean {
  const env = loadEnv();
  return !!(env.OIDC_ISSUER && env.OIDC_CLIENT_ID && env.OIDC_CLIENT_SECRET);
}

async function discover(issuer: string): Promise<Discovery> {
  if (discoveryCache) return discoveryCache;
  const res = await fetch(`${issuer.replace(/\/$/, '')}/.well-known/openid-configuration`);
  if (!res.ok) throw new AppError('DEPENDENCY_FAILED', `OIDC discovery failed (${res.status})`, { expose: true });
  discoveryCache = (await res.json()) as Discovery;
  return discoveryCache;
}

function signState(secret: string, payload: Record<string, unknown>): string {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = createHmac('sha256', secret).update(body).digest('base64url');
  return `${body}.${sig}`;
}
function verifyState(secret: string, state: string): boolean {
  const [body, sig] = state.split('.');
  if (!body || !sig) return false;
  const expected = createHmac('sha256', secret).update(body).digest('base64url');
  return sig.length === expected.length && timingSafeEqual(Buffer.from(sig), Buffer.from(expected));
}

export async function buildOidcAuthUrl(): Promise<{ url: string }> {
  const c = cfg();
  const d = await discover(c.issuer);
  const state = signState(c.jwtSecret, { nonce: randomBytes(12).toString('base64url') });
  const params = new URLSearchParams({
    client_id: c.clientId,
    redirect_uri: c.redirectUri,
    response_type: 'code',
    scope: 'openid email profile',
    state,
  });
  return { url: `${d.authorization_endpoint}?${params.toString()}` };
}

interface Claims {
  sub: string;
  email?: string;
  name?: string;
  picture?: string;
}

export async function handleOidcCallback(input: { code: string; state: string; ip?: string }): Promise<{ token: string; userId: string; isNewUser: boolean }> {
  const c = cfg();
  if (!verifyState(c.jwtSecret, input.state)) throw new AppError('UNAUTHENTICATED', 'Invalid OIDC state', { expose: true });
  const d = await discover(c.issuer);

  const tokenRes = await fetch(d.token_endpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code: input.code,
      redirect_uri: c.redirectUri,
      client_id: c.clientId,
      client_secret: c.clientSecret,
    }),
  });
  if (!tokenRes.ok) throw new AppError('UNAUTHENTICATED', 'OIDC authentication failed', { expose: true });
  const tokens = (await tokenRes.json()) as { id_token?: string };
  if (!tokens.id_token) throw new AppError('UNAUTHENTICATED', 'OIDC returned no id_token', { expose: true });

  const parts = tokens.id_token.split('.');
  const claims = JSON.parse(Buffer.from(parts[1]!, 'base64url').toString('utf8')) as Claims;
  if (!claims.email) throw ValidationError('OIDC identity has no email claim');

  return withElevated(async (tx) => {
    let [user] = await tx
      .select()
      .from(schema.users)
      .where(and(eq(schema.users.oauthProvider, 'oidc'), eq(schema.users.oauthSubject, claims.sub)));
    let isNewUser = false;
    if (!user) {
      const [byEmail] = await tx.select().from(schema.users).where(eq(schema.users.email, claims.email!.toLowerCase()));
      if (byEmail) {
        await tx.update(schema.users).set({ oauthProvider: 'oidc', oauthSubject: claims.sub, emailVerified: true }).where(eq(schema.users.id, byEmail.id));
        user = byEmail;
      } else {
        const id = newId('user');
        await tx.insert(schema.users).values({
          id,
          email: claims.email!.toLowerCase(),
          emailVerified: true,
          name: claims.name,
          avatarUrl: claims.picture,
          oauthProvider: 'oidc',
          oauthSubject: claims.sub,
          type: 'internal',
        });
        [user] = await tx.select().from(schema.users).where(eq(schema.users.id, id));
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
      device: { provider: 'oidc' },
      ip: input.ip,
      expiresAt: new Date(Date.now() + 7 * 24 * 3600 * 1000),
    });
    logger.info({ userId: user!.id, isNewUser }, 'OIDC login');
    return { token, userId: user!.id, isNewUser };
  });
}
