import { createHmac } from 'node:crypto';
import { and, eq, schema, withTenant } from '@crms/database';
import { NotFound, ValidationError, createLogger, AppError } from '@crms/kernel';
import { getContext } from '@crms/tenant-context';
import { credentialManager } from '@crms/credential-engine';
import { meteredFetch } from '@crms/usage-metering';

const logger = createLogger('integration-engine');

/**
 * Universal Integration Engine (PRD §17). Executes a configured REST connector:
 * resolves the tenant's BYO credential, applies the auth scheme, interpolates
 * variables into url/headers/body, and runs the call through the metered proxy.
 * Cross-application communication also flows through here (PRD §8.2) — never a
 * direct table read of another application.
 */

export interface ConnectorDefinition {
  baseUrl: string;
  endpoint: string;
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  headers?: Record<string, string>;
  query?: Record<string, string>;
  body?: unknown;
  auth?: { type: string; in?: 'header' | 'query'; name?: string };
}

function interpolate(template: string, vars: Record<string, unknown>): string {
  return template.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_, key: string) => {
    const val = key.split('.').reduce<unknown>((acc, k) => (acc as Record<string, unknown>)?.[k], vars);
    return val == null ? '' : String(val);
  });
}

function applyAuth(
  headers: Record<string, string>,
  query: Record<string, string>,
  auth: ConnectorDefinition['auth'],
  secret: Record<string, unknown>,
  body: string,
): void {
  if (!auth) return;
  switch (auth.type) {
    case 'api_key': {
      const name = auth.name ?? 'x-api-key';
      if (auth.in === 'query') query[name] = String(secret.apiKey);
      else headers[name] = String(secret.apiKey);
      break;
    }
    case 'bearer':
    case 'oauth2':
    case 'oauth2_refresh':
      headers['authorization'] = `Bearer ${secret.accessToken ?? secret.token}`;
      break;
    case 'basic':
      headers['authorization'] = `Basic ${Buffer.from(`${secret.username}:${secret.password}`).toString('base64')}`;
      break;
    case 'hmac': {
      const sig = createHmac('sha256', String(secret.secret)).update(body).digest('hex');
      headers[auth.name ?? 'x-signature'] = sig;
      break;
    }
    case 'custom_headers':
      Object.assign(headers, (secret.headers as Record<string, string>) ?? {});
      break;
    default:
      break;
  }
}

export interface ExecuteResult {
  status: number;
  ok: boolean;
  data: unknown;
}

export async function executeConnector(
  integrationId: string,
  input: { variables?: Record<string, unknown>; overrideBody?: unknown } = {},
): Promise<ExecuteResult> {
  const ctx = getContext();
  const integration = await withTenant(async (tx) => {
    const [row] = await tx
      .select()
      .from(schema.integrationConnections)
      .where(and(eq(schema.integrationConnections.id, integrationId)));
    return row ?? null;
  });
  if (!integration || !integration.active) throw NotFound('Integration', integrationId);

  const def = integration.definition as ConnectorDefinition;
  if (!def.baseUrl) throw ValidationError('Connector definition is missing baseUrl');

  let secret: Record<string, unknown> = {};
  if (integration.credentialId) {
    const resolved = await credentialManager.useSecret({ credentialId: integration.credentialId });
    secret = resolved.secret;
  }

  const vars = { ...input.variables, secret };
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  for (const [k, v] of Object.entries(def.headers ?? {})) headers[k] = interpolate(v, vars);
  const query: Record<string, string> = {};
  for (const [k, v] of Object.entries(def.query ?? {})) query[k] = interpolate(v, vars);

  const bodyObj = input.overrideBody ?? def.body;
  const body = def.method === 'GET' || bodyObj == null ? '' : interpolate(JSON.stringify(bodyObj), vars);

  applyAuth(headers, query, def.auth, secret, body);

  const url = new URL(interpolate(def.baseUrl + def.endpoint, vars));
  for (const [k, v] of Object.entries(query)) url.searchParams.set(k, v);

  logger.info({ integrationId, provider: integration.provider, method: def.method }, 'Executing connector');
  const res = await meteredFetch(integration.provider, url, {
    method: def.method,
    headers,
    body: body || undefined,
    kind: 'api_call',
  });

  const text = await res.text();
  let data: unknown = text;
  try {
    data = JSON.parse(text);
  } catch {
    /* non-JSON response */
  }
  if (!res.ok && res.status >= 500) {
    throw new AppError('DEPENDENCY_FAILED', `Integration '${integration.provider}' returned ${res.status}`, {
      details: { status: res.status },
    });
  }
  void ctx;
  return { status: res.status, ok: res.ok, data };
}
