/**
 * Canonical error taxonomy. Every layer throws these so the API can map a
 * thrown error to a stable HTTP status + machine-readable code without leaking
 * internals (PRD §32.3 — sanitize error output; never expose secrets).
 */

export type ErrorCode =
  | 'VALIDATION'
  | 'UNAUTHENTICATED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'IDEMPOTENCY_CONFLICT'
  | 'RATE_LIMITED'
  | 'CREDENTIAL_INVALID'
  | 'CREDENTIAL_MISSING'
  | 'DESTRUCTIVE_UNCONFIRMED'
  | 'TENANT_CONTEXT_MISSING'
  | 'NO_ACTIVE_TENANT'
  | 'CROSS_TENANT'
  | 'CROSS_APPLICATION'
  | 'DEPENDENCY_FAILED'
  | 'NOT_IMPLEMENTED'
  | 'INTERNAL';

const STATUS: Record<ErrorCode, number> = {
  VALIDATION: 400,
  UNAUTHENTICATED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  IDEMPOTENCY_CONFLICT: 409,
  RATE_LIMITED: 429,
  CREDENTIAL_INVALID: 422,
  CREDENTIAL_MISSING: 422,
  DESTRUCTIVE_UNCONFIRMED: 428,
  TENANT_CONTEXT_MISSING: 500,
  NO_ACTIVE_TENANT: 403,
  CROSS_TENANT: 403,
  CROSS_APPLICATION: 403,
  DEPENDENCY_FAILED: 502,
  NOT_IMPLEMENTED: 501,
  INTERNAL: 500,
};

export class AppError extends Error {
  readonly code: ErrorCode;
  readonly httpStatus: number;
  /** Safe, structured detail returned to clients. Never put secrets here. */
  readonly details?: Record<string, unknown>;
  /** When true the message/details are safe to expose to end users. */
  readonly expose: boolean;

  constructor(
    code: ErrorCode,
    message: string,
    options: { details?: Record<string, unknown>; expose?: boolean; cause?: unknown } = {},
  ) {
    super(message, { cause: options.cause });
    this.name = 'AppError';
    this.code = code;
    this.httpStatus = STATUS[code];
    this.details = options.details;
    this.expose = options.expose ?? code !== 'INTERNAL';
  }

  toJSON(): { code: ErrorCode; message: string; details?: Record<string, unknown> } {
    return {
      code: this.code,
      message: this.expose ? this.message : 'An internal error occurred',
      ...(this.expose && this.details ? { details: this.details } : {}),
    };
  }
}

export const ValidationError = (message: string, details?: Record<string, unknown>) =>
  new AppError('VALIDATION', message, { details });
export const Unauthenticated = (message = 'Authentication required') =>
  new AppError('UNAUTHENTICATED', message);
export const Forbidden = (message = 'You do not have permission to perform this action', details?: Record<string, unknown>) =>
  new AppError('FORBIDDEN', message, { details });
export const NotFound = (resource: string, id?: string) =>
  new AppError('NOT_FOUND', `${resource}${id ? ` '${id}'` : ''} not found`, { details: { resource, id } });
export const Conflict = (message: string, details?: Record<string, unknown>) =>
  new AppError('CONFLICT', message, { details });
export const TenantContextMissing = () =>
  new AppError('TENANT_CONTEXT_MISSING', 'Operation attempted without an active tenant context', { expose: false });
/** The session is authenticated but no tenant is selected yet (needs onboarding). */
export const NoActiveTenant = (message = 'No active tenant selected') =>
  new AppError('NO_ACTIVE_TENANT', message);
export const CrossTenant = (message = 'Cross-tenant access is not allowed') =>
  new AppError('CROSS_TENANT', message);
export const CrossApplication = (message = 'Applications cannot access each other directly; use API/Webhook/Automation/Integration') =>
  new AppError('CROSS_APPLICATION', message);
export const DestructiveUnconfirmed = (operation: string, details?: Record<string, unknown>) =>
  new AppError('DESTRUCTIVE_UNCONFIRMED', `Destructive operation '${operation}' requires explicit confirmation`, { details });
export const NotImplemented = (what: string) => new AppError('NOT_IMPLEMENTED', `${what} is not implemented`);

export function isAppError(e: unknown): e is AppError {
  return e instanceof AppError;
}

/** Normalize any thrown value into an AppError for uniform handling. */
export function toAppError(e: unknown): AppError {
  if (isAppError(e)) return e;
  if (e instanceof Error) return new AppError('INTERNAL', e.message, { expose: false, cause: e });
  return new AppError('INTERNAL', 'Unknown error', { expose: false, cause: e });
}
