import { AsyncLocalStorage } from 'node:async_hooks';
import type { Environment } from '@crms/config';
import { TenantContextMissing, newCorrelationId } from '@crms/kernel';

/**
 * The mandatory operating context (PRD §6.2). Every request, job, automation
 * step, and AI execution runs inside one of these. There is deliberately no way
 * to read tenant-scoped data without it — the database layer and query engine
 * both demand it, and isolation tests assert its absence is fatal.
 */
export interface ImpersonationContext {
  originalUserId: string;
  impersonatedUserId: string;
  impersonatedBy: string;
  expiresAt: Date;
}

export interface TenantContext {
  tenantId: string;
  /** Either a human user or a service account is always present. */
  userId: string | null;
  serviceAccountId: string | null;
  applicationId: string | null;
  environment: Environment;
  /** Effective role ids after resolution (RBAC). */
  roleIds: string[];
  teamIds: string[];
  branchId: string | null;
  /** Where the operation originated: api | web | worker | automation | portal | agent. */
  origin: string;
  correlationId: string;
  impersonation: ImpersonationContext | null;
  /**
   * Platform superadmin flag. Only ever true for platform-administration
   * operations, and even then RLS is bypassed solely via an explicit, audited
   * elevated transaction — never implicitly.
   */
  isPlatformAdmin: boolean;
}

const storage = new AsyncLocalStorage<TenantContext>();

export interface RunContextInput {
  tenantId: string;
  userId?: string | null;
  serviceAccountId?: string | null;
  applicationId?: string | null;
  environment?: Environment;
  roleIds?: string[];
  teamIds?: string[];
  branchId?: string | null;
  origin?: string;
  correlationId?: string;
  impersonation?: ImpersonationContext | null;
  isPlatformAdmin?: boolean;
}

export function buildContext(input: RunContextInput): TenantContext {
  if (!input.tenantId) throw TenantContextMissing();
  return {
    tenantId: input.tenantId,
    userId: input.userId ?? null,
    serviceAccountId: input.serviceAccountId ?? null,
    applicationId: input.applicationId ?? null,
    environment: input.environment ?? 'production',
    roleIds: input.roleIds ?? [],
    teamIds: input.teamIds ?? [],
    branchId: input.branchId ?? null,
    origin: input.origin ?? 'api',
    correlationId: input.correlationId ?? newCorrelationId(),
    impersonation: input.impersonation ?? null,
    isPlatformAdmin: input.isPlatformAdmin ?? false,
  };
}

/** Run `fn` with the given context bound to the async execution scope. */
export function runWithContext<T>(input: RunContextInput, fn: () => Promise<T> | T): Promise<T> | T {
  return storage.run(buildContext(input), fn);
}

/** Like runWithContext but takes an already-built context (used by workers). */
export function runWithBuiltContext<T>(ctx: TenantContext, fn: () => Promise<T> | T): Promise<T> | T {
  return storage.run(ctx, fn);
}

/** Get the current context or throw. This is the guard the whole platform relies on. */
export function getContext(): TenantContext {
  const ctx = storage.getStore();
  if (!ctx) throw TenantContextMissing();
  return ctx;
}

/** Get the current context or null (for code paths that may run outside a tenant). */
export function tryGetContext(): TenantContext | null {
  return storage.getStore() ?? null;
}

/** Derive a child context (e.g. scoping into a specific application/environment). */
export function withApplication<T>(
  applicationId: string,
  environment: Environment,
  fn: () => Promise<T> | T,
): Promise<T> | T {
  const parent = getContext();
  return storage.run({ ...parent, applicationId, environment }, fn);
}
