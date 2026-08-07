import { schema, withElevated } from '@crms/database';
import { newId, createLogger } from '@crms/kernel';
import { getContext } from '@crms/tenant-context';

const logger = createLogger('usage-metering');

/**
 * Usage Metering Proxy (PRD §29.1).
 *
 * Every call to an external service made with BYO credentials passes through
 * `meteredFetch`, which records ONLY operational metrics — request count,
 * duration, bytes, provider-reported tokens, status, errors, retries — scoped by
 * tenant/application/environment/provider. It NEVER records content, prompts,
 * message bodies, files or secrets.
 */
export interface UsageRecord {
  provider: string;
  kind: 'api_call' | 'ai_tokens' | 'automation_run' | 'document' | 'storage';
  requests?: number;
  durationMs?: number;
  bytesIn?: number;
  bytesOut?: number;
  tokens?: number;
  status?: string;
  errorCount?: number;
  retries?: number;
}

export async function recordUsage(usage: UsageRecord): Promise<void> {
  const ctx = getContext();
  try {
    await withElevated(async (tx) => {
      await tx.insert(schema.usageEvents).values({
        id: newId('usage'),
        tenantId: ctx.tenantId,
        applicationId: ctx.applicationId,
        environment: ctx.environment,
        provider: usage.provider,
        kind: usage.kind,
        requests: usage.requests ?? 1,
        durationMs: usage.durationMs ?? 0,
        bytesIn: usage.bytesIn ?? 0,
        bytesOut: usage.bytesOut ?? 0,
        tokens: usage.tokens ?? 0,
        status: usage.status,
        errorCount: usage.errorCount ?? 0,
        retries: usage.retries ?? 0,
      });
    }, ctx);
  } catch (err) {
    // Metering must never break the operation it measures.
    logger.warn({ err }, 'Failed to record usage');
  }
}

/**
 * Wrap an external fetch, capturing metrics without ever touching the body
 * contents beyond byte counts. The provider label and kind are supplied by the
 * caller (integration/ai runners).
 */
export async function meteredFetch(
  provider: string,
  input: string | URL | Request,
  init: RequestInit & { kind?: UsageRecord['kind'] } = {},
): Promise<Response> {
  const start = Date.now();
  const { kind = 'api_call', ...requestInit } = init;
  let bytesIn = 0;
  try {
    const reqBody = requestInit.body;
    if (typeof reqBody === 'string') bytesIn = Buffer.byteLength(reqBody);
    const res = await fetch(input, requestInit);
    const cloned = res.clone();
    const buf = await cloned.arrayBuffer().catch(() => new ArrayBuffer(0));
    await safeRecord({
      provider,
      kind,
      durationMs: Date.now() - start,
      bytesIn,
      bytesOut: buf.byteLength,
      status: String(res.status),
      errorCount: res.ok ? 0 : 1,
    });
    return res;
  } catch (err) {
    await safeRecord({ provider, kind, durationMs: Date.now() - start, bytesIn, status: 'network_error', errorCount: 1 });
    throw err;
  }
}

/** Usage telemetry must never break the actual request it is measuring. */
async function safeRecord(rec: Parameters<typeof recordUsage>[0]): Promise<void> {
  try {
    await recordUsage(rec);
  } catch {
    /* swallow: metering is best-effort */
  }
}
