/**
 * @crms/sdk — typed client for the CRMS public API (PRD §29, §36).
 *
 * Framework-free, runs in Node and the browser. Authenticates with a session
 * token or an API key (both use the Bearer header) and scopes calls to an
 * application + environment via headers.
 *
 * Example:
 *   const crms = new CrmsClient({ baseUrl, token });
 *   crms.setApplication(appId, 'production');
 *   const page = await crms.records.query(moduleId, { filters: [...] });
 */

export interface CrmsClientOptions {
  baseUrl: string;
  token?: string;
  applicationId?: string;
  environment?: string;
}

export interface Page<T> {
  items: T[];
  nextCursor: string | null;
  hasMore: boolean;
}

export interface Filter {
  field: string;
  operator: 'eq' | 'neq' | 'gt' | 'gte' | 'lt' | 'lte' | 'contains' | 'in' | 'is_null';
  value?: unknown;
}

export class CrmsError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: number,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = 'CrmsError';
  }
}

export class CrmsClient {
  private token?: string;
  private applicationId?: string;
  private environment?: string;

  constructor(private readonly opts: CrmsClientOptions) {
    this.token = opts.token;
    this.applicationId = opts.applicationId;
    this.environment = opts.environment;
  }

  setToken(token: string): void {
    this.token = token;
  }
  setApplication(applicationId: string, environment = 'production'): void {
    this.applicationId = applicationId;
    this.environment = environment;
  }

  async request<T = unknown>(method: string, path: string, body?: unknown, idempotencyKey?: string): Promise<T> {
    const headers: Record<string, string> = { 'content-type': 'application/json' };
    if (this.token) headers.authorization = `Bearer ${this.token}`;
    if (this.applicationId) headers['x-application-id'] = this.applicationId;
    if (this.environment) headers['x-environment'] = this.environment;
    if (idempotencyKey) headers['idempotency-key'] = idempotencyKey;

    const res = await fetch(`${this.opts.baseUrl}/v1${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    const json = text ? JSON.parse(text) : {};
    if (!res.ok) {
      const err = (json as { error?: { code?: string; message?: string; details?: unknown } }).error;
      throw new CrmsError(err?.code ?? 'ERROR', err?.message ?? `HTTP ${res.status}`, res.status, err?.details);
    }
    return json as T;
  }

  // --- Auth ---
  auth = {
    register: (email: string, password: string, name?: string) =>
      this.request<{ userId: string }>('POST', '/auth/register', { email, password, name }),
    login: async (email: string, password: string) => {
      const r = await this.request<{ token: string; activeTenantId: string | null }>('POST', '/auth/login', { email, password });
      this.setToken(r.token);
      return r;
    },
    me: () => this.request<{ tenantId: string; userId: string; applicationId: string | null; environment: string }>('GET', '/auth/me'),
    logout: () => this.request('POST', '/auth/logout'),
    createTenant: (name: string, slug: string, applicationName?: string) =>
      this.request<{ tenantId: string; applicationId: string }>('POST', '/onboarding/tenant', { name, slug, applicationName }),
  };

  // --- Builder ---
  applications = {
    list: () => this.request<Array<{ id: string; name: string; slug: string }>>('GET', '/applications'),
    clone: (appId: string, name: string) => this.request<{ applicationId: string }>('POST', `/applications/${appId}/clone`, { name }),
    rollback: (appId: string, version: string) => this.request('POST', `/applications/${appId}/rollback`, { version }),
    publish: (version: string, changelog?: string) => this.request<{ versionId: string }>('POST', '/applications/publish', { version, changelog }),
  };

  modules = {
    list: () => this.request<Array<{ id: string; key: string; name: string }>>('GET', '/modules'),
    create: (input: { key: string; name: string; namePlural?: string; icon?: string }) =>
      this.request<{ id: string }>('POST', '/modules', input),
    createField: (moduleId: string, field: Record<string, unknown>) =>
      this.request('POST', `/modules/${moduleId}/fields`, field),
  };

  records = {
    query: (moduleId: string, spec: { filters?: Filter[]; sorts?: unknown[]; limit?: number; cursor?: string } = {}) =>
      this.request<Page<Record<string, unknown>>>('POST', `/modules/${moduleId}/records/query`, spec),
    get: (moduleId: string, recordId: string) => this.request<Record<string, unknown>>('GET', `/modules/${moduleId}/records/${recordId}`),
    create: (moduleId: string, data: Record<string, unknown>, idempotencyKey?: string) =>
      this.request<Record<string, unknown>>('POST', `/modules/${moduleId}/records`, { data }, idempotencyKey),
    update: (moduleId: string, recordId: string, patch: Record<string, unknown>) =>
      this.request('PATCH', `/modules/${moduleId}/records/${recordId}`, { patch }),
    remove: (moduleId: string, recordId: string) => this.request('DELETE', `/modules/${moduleId}/records/${recordId}?confirm=true`),
    sync: (moduleId: string, since?: string) => this.request<{ changed: unknown[]; deleted: unknown[]; nextSince: string; hasMore: boolean }>('GET', `/modules/${moduleId}/sync${since ? `?since=${encodeURIComponent(since)}` : ''}`),
  };

  ai = {
    generate: (prompt: string, provider = 'openai', credentialKey?: string) =>
      this.request<{ planId: string; plan: unknown }>('POST', '/ai/generate', { prompt, provider, credentialKey }),
    approvePlan: (planId: string) => this.request('POST', `/ai/plans/${planId}/approve`),
    executePlan: (planId: string) => this.request<{ executionId: string }>('POST', `/ai/plans/${planId}/execute`),
  };

  credentials = {
    list: () => this.request<Array<Record<string, unknown>>>('GET', '/credentials'),
    create: (input: Record<string, unknown>) => this.request<Record<string, unknown>>('POST', '/credentials', input),
  };
}

export default CrmsClient;
