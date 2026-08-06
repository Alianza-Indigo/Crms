import nodemailer from 'nodemailer';
import { and, eq, inArray, ne, schema, withElevated } from '@crms/database';
import { createLogger } from '@crms/kernel';
import { buildContext, runWithBuiltContext } from '@crms/tenant-context';
import { credentialManager } from '@crms/credential-engine';
import { meteredFetch } from '@crms/usage-metering';

const logger = createLogger('worker:notifications');
const MAX_ATTEMPTS = 5;

/**
 * Notification delivery (PRD §31). In-app notifications need no delivery. For
 * email/WhatsApp/SMS/Slack/webhook the dispatcher resolves the TENANT's BYO
 * credential (by a conventional key per channel) and sends via that provider —
 * never a platform credential. Failures retry up to a cap, then mark 'failed'.
 */
export async function dispatchNotifications(batchSize = 25): Promise<number> {
  const claimed = await withElevated(async (tx) => {
    const due = await tx
      .select()
      .from(schema.notifications)
      .where(and(eq(schema.notifications.status, 'pending'), ne(schema.notifications.channel, 'in_app')))
      .limit(batchSize)
      .for('update', { skipLocked: true });
    if (due.length) {
      await tx
        .update(schema.notifications)
        .set({ status: 'sending' })
        .where(inArray(schema.notifications.id, due.map((n) => n.id)));
    }
    return due;
  });

  for (const n of claimed) {
    const ctx = buildContext({
      tenantId: n.tenantId,
      applicationId: n.applicationId,
      environment: 'production',
      origin: 'worker',
      roleIds: ['__owner__'],
    });
    await runWithBuiltContext(ctx, () => deliver(n));
  }
  return claimed.length;
}

async function deliver(n: typeof schema.notifications.$inferSelect): Promise<void> {
  const attempt = n.attempts + 1;
  try {
    switch (n.channel) {
      case 'email':
        await sendEmail(n);
        break;
      case 'slack':
        await sendSlack(n);
        break;
      case 'whatsapp':
        await sendWhatsapp(n);
        break;
      case 'sms':
        await sendSms(n);
        break;
      case 'webhook':
        await sendWebhook(n);
        break;
      default:
        throw new Error(`Unsupported channel '${n.channel}'`);
    }
    await mark(n.id, 'sent', attempt, null);
  } catch (err) {
    const dead = attempt >= MAX_ATTEMPTS;
    await mark(n.id, dead ? 'failed' : 'pending', attempt, err instanceof Error ? err.message : String(err));
    logger.warn({ err, notificationId: n.id, channel: n.channel, dead }, 'Notification delivery failed');
  }
}

async function mark(id: string, status: string, attempts: number, error: string | null): Promise<void> {
  await withElevated(async (tx) => {
    await tx
      .update(schema.notifications)
      .set({ status, attempts, lastError: error, sentAt: status === 'sent' ? new Date() : undefined })
      .where(eq(schema.notifications.id, id));
  });
}

async function sendEmail(n: typeof schema.notifications.$inferSelect): Promise<void> {
  const { secret } = await credentialManager.useSecret({ key: 'EMAIL_SMTP' });
  const transport = nodemailer.createTransport({
    host: String(secret.host),
    port: Number(secret.port ?? 587),
    secure: Boolean(secret.secure ?? false),
    auth: { user: String(secret.username ?? secret.user), pass: String(secret.password ?? secret.pass) },
  });
  await transport.sendMail({
    from: String(secret.from ?? secret.username),
    to: n.recipient ?? '',
    subject: n.title,
    text: n.body ?? '',
  });
}

async function sendSlack(n: typeof schema.notifications.$inferSelect): Promise<void> {
  const { secret } = await credentialManager.useSecret({ key: 'SLACK' });
  const res = await meteredFetch('slack', 'https://slack.com/api/chat.postMessage', {
    method: 'POST',
    headers: { authorization: `Bearer ${secret.token ?? secret.apiKey}`, 'content-type': 'application/json' },
    body: JSON.stringify({ channel: n.recipient ?? (n.data as Record<string, unknown>).channel, text: `*${n.title}*\n${n.body ?? ''}` }),
  });
  if (!res.ok) throw new Error(`Slack HTTP ${res.status}`);
}

async function sendWhatsapp(n: typeof schema.notifications.$inferSelect): Promise<void> {
  const { secret } = await credentialManager.useSecret({ key: 'WHATSAPP' });
  const phoneId = String(secret.phoneNumberId ?? (n.data as Record<string, unknown>).phoneNumberId);
  const res = await meteredFetch('whatsapp', `https://graph.facebook.com/v20.0/${phoneId}/messages`, {
    method: 'POST',
    headers: { authorization: `Bearer ${secret.accessToken ?? secret.token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ messaging_product: 'whatsapp', to: n.recipient, type: 'text', text: { body: `${n.title}\n${n.body ?? ''}` } }),
  });
  if (!res.ok) throw new Error(`WhatsApp HTTP ${res.status}`);
}

async function sendSms(n: typeof schema.notifications.$inferSelect): Promise<void> {
  const { secret } = await credentialManager.useSecret({ key: 'TWILIO' });
  const sid = String(secret.accountSid ?? secret.username);
  const res = await meteredFetch('twilio', `https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
    method: 'POST',
    headers: {
      authorization: `Basic ${Buffer.from(`${sid}:${secret.authToken ?? secret.password}`).toString('base64')}`,
      'content-type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({ To: n.recipient ?? '', From: String(secret.from), Body: `${n.title}: ${n.body ?? ''}` }).toString(),
  });
  if (!res.ok) throw new Error(`Twilio HTTP ${res.status}`);
}

async function sendWebhook(n: typeof schema.notifications.$inferSelect): Promise<void> {
  const url = n.recipient ?? String((n.data as Record<string, unknown>).url ?? '');
  if (!url) throw new Error('Webhook notification has no target url');
  const res = await meteredFetch('webhook', url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ title: n.title, body: n.body, data: n.data }),
  });
  if (!res.ok) throw new Error(`Webhook HTTP ${res.status}`);
}
