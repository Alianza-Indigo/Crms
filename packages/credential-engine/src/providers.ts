import { isTest } from '@crms/config';
import { createLogger } from '@crms/kernel';

const logger = createLogger('credential-providers');

export interface ValidateInput {
  authType: string;
  secret: Record<string, unknown>;
  metadata: Record<string, unknown>;
}

export interface ValidateResult {
  ok: boolean;
  reason?: string;
  accountLabel?: string | null;
  scopes?: string[];
  missingScopes?: string[];
}

export interface ProviderValidator {
  provider: string;
  /** Required secret keys per auth type. */
  validate(input: ValidateInput): Promise<ValidateResult>;
}

/**
 * Provider registry (PRD §10.2). Each validator performs a NON-destructive check
 * (PRD §10.8): it validates the secret's shape and, when a live probe endpoint
 * is known and we're not in a test run, issues a harmless read to confirm the
 * account + scopes. Network failures during probe do not silently pass — they
 * surface as a validation reason so the tenant can retry.
 */

const REQUIRED_FIELDS: Record<string, string[]> = {
  api_key: ['apiKey'],
  bearer: ['token'],
  basic: ['username', 'password'],
  oauth2: ['accessToken'],
  oauth2_refresh: ['accessToken', 'refreshToken'],
  client_credentials: ['clientId', 'clientSecret'],
  jwt: ['privateKey'],
  hmac: ['secret'],
  service_account: ['keyJson'],
  certificate: ['cert', 'key'],
  custom_headers: ['headers'],
  temporary_token: ['token'],
};

function checkShape(input: ValidateInput): ValidateResult {
  const required = REQUIRED_FIELDS[input.authType];
  if (!required) return { ok: false, reason: `Unsupported auth type '${input.authType}'` };
  const missing = required.filter((k) => {
    const v = input.secret[k];
    return v === undefined || v === null || v === '';
  });
  if (missing.length) return { ok: false, reason: `Missing required secret fields: ${missing.join(', ')}` };
  return { ok: true };
}

/**
 * Optional live probe. Returns null when no probe is configured. Providers can
 * override with real endpoints; default GET a metadata URL with the credential.
 */
async function liveProbe(url: string, headers: Record<string, string>): Promise<ValidateResult> {
  try {
    const res = await fetch(url, { method: 'GET', headers });
    if (res.status === 401 || res.status === 403) {
      return { ok: false, reason: `Provider rejected the credential (HTTP ${res.status})` };
    }
    if (!res.ok) return { ok: false, reason: `Provider probe failed (HTTP ${res.status})` };
    return { ok: true };
  } catch (err) {
    logger.warn({ err, url }, 'Credential live-probe network error');
    return { ok: false, reason: 'Could not reach provider to validate credential' };
  }
}

class GenericValidator implements ProviderValidator {
  constructor(
    readonly provider: string,
    private readonly probe?: (input: ValidateInput) => { url: string; headers: Record<string, string> } | null,
  ) {}

  async validate(input: ValidateInput): Promise<ValidateResult> {
    const shape = checkShape(input);
    if (!shape.ok) return shape;
    if (isTest() || !this.probe) return { ok: true, accountLabel: (input.metadata.accountLabel as string) ?? null };
    const probe = this.probe(input);
    if (!probe) return { ok: true };
    return liveProbe(probe.url, probe.headers);
  }
}

const registry = new Map<string, ProviderValidator>();

function register(v: ProviderValidator): void {
  registry.set(v.provider, v);
}

// Official providers with known probe endpoints.
register(
  new GenericValidator('openai', (i) => ({
    url: 'https://api.openai.com/v1/models',
    headers: { authorization: `Bearer ${i.secret.apiKey as string}` },
  })),
);
register(
  new GenericValidator('anthropic', (i) => ({
    url: 'https://api.anthropic.com/v1/models',
    headers: { 'x-api-key': i.secret.apiKey as string, 'anthropic-version': '2023-06-01' },
  })),
);
register(
  new GenericValidator('stripe', (i) => ({
    url: 'https://api.stripe.com/v1/account',
    headers: { authorization: `Bearer ${i.secret.apiKey as string}` },
  })),
);

// Providers validated by shape only (probe requires OAuth dance / signed reqs).
for (const p of [
  'google_ai',
  'azure_openai',
  'gmail',
  'outlook',
  'smtp',
  'whatsapp',
  'twilio',
  'telegram',
  'slack',
  'mercadopago',
  'google_calendar',
  'microsoft_calendar',
  's3',
  'r2',
  'google_drive',
  'onedrive',
  'dropbox',
  'shopify',
  'woocommerce',
  'esignature',
  'custom_api',
  'external_db',
]) {
  register(new GenericValidator(p));
}

export function getProviderValidator(provider: string): ProviderValidator {
  return registry.get(provider) ?? new GenericValidator(provider);
}

export function listProviders(): string[] {
  return [...registry.keys()];
}
