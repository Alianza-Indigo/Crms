import { randomBytes, createHmac, timingSafeEqual } from 'node:crypto';
import { loadEnv } from '@crms/config';
import { and, eq, schema, withElevated } from '@crms/database';
import { newId, newToken, AppError, ValidationError, createLogger } from '@crms/kernel';
import { hashToken } from './token.js';

const logger = createLogger('auth:google');

/**
 * Google OAuth 2.0 login (PRD §32.1). Standard authorization-code flow:
 *   1. buildAuthUrl → redirect the user to Google with a signed `state`.
 *   2. Google redirects back with `code` + `state`.
 *   3. handleCallback verifies `state`, exchanges `code` for tokens, reads the
 *      id_token claims, links/creates the user by the stable `sub`, and mints a
 *      CRMS session.
 *
 * MFA is intentionally not part of this flow.
 */

function config() {
  const env = loadEnv();
  if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET) {
    throw new AppError('NOT_IMPLEMENTED', 'Google OAuth is not configured on this deployment', { expose: true });
  }
  return {
    clientId: env.GOOGLE_CLIENT_ID,
    clientSecret: env.GOOGLE_CLIENT_SECRET,
    redirectUri: env.GOOGLE_REDIRECT_URI ?? `${env.API_BASE_URL}/v1/auth/google/callback`,
    jwtSecret: env.JWT_SECRET,
  };
}

export function isGoogleConfigured(): boolean {
  const env = loadEnv();
  return !!(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET);
}

/** Sign a short-lived state token binding the CSRF nonce + optional return path. */
function signState(secret: string, payload: Record<string, unknown>): string {
  const body = Buffer.from(JSON.stringify({ ...payload, ts: undefined })).toString('base64url');
  const sig = createHmac('sha256', secret).update(body).digest('base64url');
  return `${body}.${sig}`;
}
function verifyState(secret: string, state: string): Record<string, unknown> | null {
  const [body, sig] = state.split('.');
  if (!body || !sig) return null;
  const expected = createHmac('sha256', secret).update(body).digest('base64url');
  if (sig.length !== expected.length || !timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  return JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
}

export function buildAuthUrl(returnPath?: string): { url: string; state: string } {
  const cfg = config();
  const nonce = randomBytes(16).toString('base64url');
  const state = signState(cfg.jwtSecret, { nonce, returnPath });
  const params = new URLSearchParams({
    client_id: cfg.clientId,
    redirect_uri: cfg.redirectUri,
    response_type: 'code',
    scope: 'openid email profile',
    access_type: 'offline',
    include_granted_scopes: 'true',
    state,
    prompt: 'select_account',
  });
  return { url: `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`, state };
}

interface GoogleClaims {
  sub: string;
  email: string;
  email_verified?: boolean;
  name?: string;
  picture?: string;
}

function decodeIdToken(idToken: string): GoogleClaims {
  const parts = idToken.split('.');
  if (parts.length !== 3) throw ValidationError('Malformed id_token from Google');
  return JSON.parse(Buffer.from(parts[1]!, 'base64url').toString('utf8')) as GoogleClaims;
}

export interface GoogleSession {
  token: string;
  sessionId: string;
  userId: string;
  activeTenantId: string | null;
  isNewUser: boolean;
}

export async function handleCallback(input: {
  code: string;
  state: string;
  ip?: string;
}): Promise<GoogleSession> {
  const cfg = config();
  const parsed = verifyState(cfg.jwtSecret, input.state);
  if (!parsed) throw new AppError('UNAUTHENTICATED', 'Invalid OAuth state', { expose: true });

  // Exchange the authorization code for tokens.
  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code: input.code,
      client_id: cfg.clientId,
      client_secret: cfg.clientSecret,
      redirect_uri: cfg.redirectUri,
      grant_type: 'authorization_code',
    }),
  });
  if (!tokenRes.ok) {
    logger.warn({ status: tokenRes.status }, 'Google token exchange failed');
    throw new AppError('UNAUTHENTICATED', 'Google authentication failed', { expose: true });
  }
  const tokens = (await tokenRes.json()) as { id_token?: string };
  if (!tokens.id_token) throw new AppError('UNAUTHENTICATED', 'Google did not return an id_token', { expose: true });

  const claims = decodeIdToken(tokens.id_token);
  if (!claims.email) throw ValidationError('Google account has no email');

  return withElevated(async (tx) => {
    // Link by stable subject first, then fall back to email.
    let [user] = await tx
      .select()
      .from(schema.users)
      .where(and(eq(schema.users.oauthProvider, 'google'), eq(schema.users.oauthSubject, claims.sub)));
    let isNewUser = false;

    if (!user) {
      const [byEmail] = await tx.select().from(schema.users).where(eq(schema.users.email, claims.email.toLowerCase()));
      if (byEmail) {
        await tx
          .update(schema.users)
          .set({ oauthProvider: 'google', oauthSubject: claims.sub, emailVerified: true, avatarUrl: claims.picture })
          .where(eq(schema.users.id, byEmail.id));
        user = byEmail;
      } else {
        const id = newId('user');
        await tx.insert(schema.users).values({
          id,
          email: claims.email.toLowerCase(),
          emailVerified: claims.email_verified ?? true,
          name: claims.name,
          avatarUrl: claims.picture,
          oauthProvider: 'google',
          oauthSubject: claims.sub,
          type: 'internal',
        });
        [user] = await tx.select().from(schema.users).where(eq(schema.users.id, id));
        isNewUser = true;
      }
    }

    const [membership] = await tx.select().from(schema.memberships).where(eq(schema.memberships.userId, user!.id));
    const token = newToken(32);
    const sessionId = newId('session');
    await tx.insert(schema.sessions).values({
      id: sessionId,
      userId: user!.id,
      tokenHash: hashToken(token),
      activeTenantId: membership?.tenantId ?? null,
      device: { provider: 'google' },
      ip: input.ip,
      expiresAt: new Date(Date.now() + 7 * 24 * 3600 * 1000),
    });
    await tx.update(schema.users).set({ lastLoginAt: new Date() }).where(eq(schema.users.id, user!.id));

    logger.info({ userId: user!.id, isNewUser }, 'Google login');
    return { token, sessionId, userId: user!.id, activeTenantId: membership?.tenantId ?? null, isNewUser };
  });
}
