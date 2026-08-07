import { createHmac, timingSafeEqual } from 'node:crypto';
import nodemailer from 'nodemailer';
import { loadEnv } from '@crms/config';
import { AppError, ValidationError, createLogger } from '@crms/kernel';
import { upsertUserSession } from './session.js';

const logger = createLogger('auth:magic');
const TTL_MS = 15 * 60 * 1000;

function sign(secret: string, email: string, exp: number): string {
  const body = Buffer.from(JSON.stringify({ email, exp })).toString('base64url');
  const sig = createHmac('sha256', secret).update(body).digest('base64url');
  return `${body}.${sig}`;
}

function verify(secret: string, token: string): { email: string } {
  const [body, sig] = token.split('.');
  if (!body || !sig) throw new AppError('UNAUTHENTICATED', 'Invalid magic link', { expose: true });
  const expected = createHmac('sha256', secret).update(body).digest('base64url');
  if (sig.length !== expected.length || !timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) {
    throw new AppError('UNAUTHENTICATED', 'Invalid magic link', { expose: true });
  }
  const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as { email: string; exp: number };
  if (payload.exp < Date.now()) throw new AppError('UNAUTHENTICATED', 'This magic link has expired', { expose: true });
  return { email: payload.email };
}

/** Request a magic link. Emails it when SMTP is configured; otherwise returns
 *  the link directly so the flow is usable without a mail server (dev). */
export async function requestMagicLink(email: string): Promise<{ sent: boolean; link?: string }> {
  const env = loadEnv();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw ValidationError('Invalid email');
  const token = sign(env.JWT_SECRET, email.toLowerCase(), Date.now() + TTL_MS);
  const link = `${env.API_BASE_URL}/v1/auth/magic-link/verify?token=${encodeURIComponent(token)}`;

  if (env.SMTP_URL) {
    try {
      const transport = nodemailer.createTransport(env.SMTP_URL);
      await transport.sendMail({
        from: env.SMTP_FROM ?? 'no-reply@crms.app',
        to: email,
        subject: 'Tu enlace de acceso',
        text: `Entra con este enlace (válido 15 minutos):\n\n${link}`,
        html: `<p>Entra con este enlace (válido 15 minutos):</p><p><a href="${link}">Iniciar sesión</a></p>`,
      });
      logger.info({ email }, 'Magic link emailed');
      return { sent: true };
    } catch (err) {
      logger.error({ err }, 'Magic link email failed');
      throw new AppError('DEPENDENCY_FAILED', 'Could not send the magic link email', { expose: true });
    }
  }
  // No SMTP configured: return the link so the caller can deliver it.
  return { sent: false, link };
}

export async function verifyMagicLink(token: string, ip?: string): Promise<{ token: string; userId: string; isNewUser: boolean }> {
  const env = loadEnv();
  const { email } = verify(env.JWT_SECRET, token);
  return upsertUserSession({ email, provider: 'magic_link', ip });
}
