# Security & isolation model

## Defense in depth for tenant isolation

Three independent layers must all agree before any tenant data is touched:

1. **Application context** — `@crms/tenant-context` requires a tenant on every
   operation. The Query Engine additionally requires `application_id` +
   `environment` for dynamic records and throws otherwise.
2. **Row-Level Security** — every table with a `tenant_id` has a `FORCE`d RLS
   policy confining rows to `app.current_tenant_id`. `withTenant` sets that GUC
   per transaction via `set_config(..., is_local => true)`.
3. **Least-privilege DB role** — the app connects as a `NOSUPERUSER
   NOBYPASSRLS` role. This is essential: PostgreSQL superusers (and table
   owners under some settings) bypass RLS. Migrations run as the owner; the
   services run as `crms_app`.

The escape hatch `app.bypass_rls = 'on'` is used only by `withElevated` for
platform administration and system workers, and every such action is audited.

### What the isolation tests prove
`tests/isolation/tenant-isolation.test.ts`:
- A tenant lists only its own records.
- A raw `SELECT * FROM records` inside tenant A returns only A's rows.
- Reading another tenant's record by id fails (RLS hides it → NotFound).
- The Query Engine refuses to run with no tenant context.
- A query without an application context is rejected.
- An unscoped connection (no GUC, bypass off) sees zero rows.

## Credential secrecy

- Secrets are AES-256-GCM encrypted with a per-secret data key, itself wrapped
  by the platform master key (envelope encryption). Rotating the master key only
  re-wraps data keys.
- Metadata and ciphertext live in separate tables; only `credential-engine`
  reads the ciphertext, on the authorized execution path.
- Secrets never appear in API responses, logs (redaction list in
  `kernel/logger.ts`), audit metadata (redaction in `audit`), exports, AI
  context, or cloned applications.
- `tests/isolation/credential-secrecy.test.ts` asserts round-trip, tamper
  detection, and no-plaintext-in-storage / no-plaintext-in-public-object.

## Impersonation (§32.5)

Sessions carry `impersonatedUserId`, `impersonatedBy`, `impersonationExpiresAt`.
`resolveContext` enforces the hard expiry and records the full identity trail on
every audit event. The web layer renders the mandatory red banner and countdown
(the API always returns the impersonation block in `/auth/me`).

## Scripts (§28)

User scripts are validated by an AST gate (no `eval`/`new Function`/`require`/
`process`/…) and executed only by a registered out-of-process isolate runner.
With no runner registered the engine fails closed — it never runs untrusted code
in the API process.

## Federated queries (§17.1)

External SQL is parsed and rejected unless it is a single read-only `SELECT`
with an explicit `WHERE` and a bounded `LIMIT`, run on a separate pool with a
short timeout and column masking.
