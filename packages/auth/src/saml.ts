import { SAML } from '@node-saml/node-saml';
import { loadEnv } from '@crms/config';
import { AppError, ValidationError, createLogger } from '@crms/kernel';
import { upsertUserSession } from './session.js';

const logger = createLogger('auth:saml');

export function isSamlConfigured(): boolean {
  const env = loadEnv();
  return !!(env.SAML_ENTRY_POINT && env.SAML_ISSUER && env.SAML_CERT);
}

function client(): SAML {
  const env = loadEnv();
  if (!isSamlConfigured()) throw new AppError('NOT_IMPLEMENTED', 'SAML SSO is not configured on this deployment', { expose: true });
  // The cert may be provided base64-encoded or as raw PEM.
  let cert = env.SAML_CERT!;
  if (!cert.includes('BEGIN CERTIFICATE') && !cert.includes('\n')) {
    try {
      cert = Buffer.from(cert, 'base64').toString('utf8');
    } catch {
      /* keep as-is */
    }
  }
  return new SAML({
    entryPoint: env.SAML_ENTRY_POINT!,
    issuer: env.SAML_ISSUER!,
    idpCert: cert,
    callbackUrl: env.SAML_CALLBACK_URL ?? `${env.API_BASE_URL}/v1/auth/saml/callback`,
    wantAssertionsSigned: true,
    disableRequestedAuthnContext: true,
  });
}

/** SP-initiated login: the URL to redirect the browser to the IdP. */
export async function buildSamlLoginUrl(): Promise<{ url: string }> {
  const url = await client().getAuthorizeUrlAsync('', '', {});
  return { url };
}

/** Handle the IdP's signed SAMLResponse (HTTP-POST binding). */
export async function handleSamlCallback(samlResponse: string, ip?: string): Promise<{ token: string; userId: string; isNewUser: boolean }> {
  const { profile } = await client().validatePostResponseAsync({ SAMLResponse: samlResponse });
  if (!profile) throw new AppError('UNAUTHENTICATED', 'SAML authentication failed', { expose: true });
  const email = (profile.email ?? profile.nameID ?? (profile['urn:oid:0.9.2342.19200300.100.1.3'] as string | undefined)) as string | undefined;
  if (!email || !email.includes('@')) throw ValidationError('SAML assertion has no email');
  const name = (profile.displayName ?? profile['urn:oid:2.16.840.1.113730.3.1.241']) as string | undefined;
  logger.info({ email }, 'SAML login');
  return upsertUserSession({ email, name, provider: 'saml', subject: String(profile.nameID ?? email), ip });
}
