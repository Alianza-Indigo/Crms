# Architecture — PRD → code map

This document maps each PRD requirement to where it lives in the codebase, so a
reviewer can verify coverage.

## Multi-tenancy (§6, §47.1)
- Mandatory operating context: `packages/tenant-context/src/context.ts`
  (`AsyncLocalStorage`, carries tenant/user/app/env/roles/teams/branch/origin/
  correlation/impersonation).
- `tenant_id` on every business entity: `packages/database/src/schema/*`
  (`tenantColumn`, `applicationScope` mixins in `_shared.ts`).
- RLS for structural + dynamic tables: `packages/database/src/rls.sql`, applied
  by `migrate.ts`. Context pushed to Postgres GUCs by
  `withTenant`/`withElevated` in `client.ts`.
- Isolation tiers + routing: `tenants.isolation_tier`, `tenant_routing` table.
- Tenant Elevation / Migration Service: `packages/tenant-migration` (§6.3 phase
  machine with checksums, atomic routing cutover, rollback window).
- Leak-prevention tests: `tests/isolation/tenant-isolation.test.ts` (§6.4).

## Application builder (§8, §38, §39)
- Applications + versions + deployment manifests: `schema/applications.ts`.
- Independence between apps (§8.2, §4.9): every builder/records row is scoped by
  `application_id`; cross-app access only via API/Webhook/Automation/Integration
  (`integration-engine`). No shared-schema tables exist.
- Environments Draft→Production + `DeploymentManifest`: `deployment-engine`
  (credential *references* travel, values never do; prod destructive → double
  approval; atomic replace).
- Schema Engine (modules/fields/relations, publish, destructive analysis):
  `packages/schema-engine`.
- Records Engine + Query Engine (mandatory tenant/app/env injection):
  `packages/records-engine` (`query-engine.ts` `requireScope`, `engine.ts`).

## AI (§9)
- Provider abstraction (BYO, OpenAI/Anthropic/OpenAI-compatible):
  `packages/ai-engine/src/providers.ts` — every call uses the tenant credential,
  metered without capturing prompt content.
- AIPlan lifecycle (draft→pending→approved→executing→executed/…): `plan.ts`.
  Destructive ops require approval before `execute`.
- Trace entities `AIConversation/Session/Context/Plan/Execution`: `schema/ai.ts`.

## BYO Credentials (§10, §47.10)
- Envelope encryption AES-256-GCM: `credential-engine/src/crypto.ts`.
- Metadata/secret separation, inheritance (app>tenant), rotation, revoke,
  dependencies, assignment: `credential-engine/src/manager.ts`.
- Provider validation with non-destructive probe: `providers.ts`.
- Secrecy tests: `tests/isolation/credential-secrecy.test.ts`.

## Data model (§11)
- Hybrid relational + dynamic EAV: `schema/builder.ts` (definitions) +
  `schema/records.ts` (`records`, `record_values`, `record_relations`,
  `record_history`).

## Records, idempotency (§12)
- All mutation through `records-engine`. Idempotency-Key: `packages/idempotency`
  + `IdempotencyStore` table; applied in `apps/api/src/routes/records.ts`.

## Automations + Outbox (§16, §40)
- Definitions/runs: `schema/automation.ts`. Executor: `packages/automation-engine`
  (graph walk, filters/conditions/actions/integrations, retries, loop guard).
- Transactional Outbox: `packages/outbox` (`writeEvent` in-txn; `dispatchBatch`
  with `FOR UPDATE SKIP LOCKED`). Worker: `apps/worker`.

## Integrations + Federated Query (§17)
- Universal REST connector: `packages/integration-engine` (auth schemes,
  interpolation, metered fetch).
- Federated read-only SQL guard: `packages/federated-query` (single stmt, SELECT
  only, WHERE + LIMIT required, forbidden keywords, timeout, masking).

## Permissions (§18)
- RBAC+ABAC with scopes (own/team/branch/all) and `explain`:
  `packages/permissions`. Owner + platform-admin short-circuit.

## Portals, documents, dashboards (§19–22)
- `schema/automation.ts` (`portal_definitions`, `document_templates`,
  `generated_documents`), `schema/builder.ts` (`dashboard_definitions`).
- Document render: `packages/document-engine`.

## Security (§32)
- Auth (scrypt, sessions, TOTP MFA, impersonation with hard expiry + audit
  trail): `packages/auth`.
- Audit (append-only, secret redaction, lifecycle archival): `packages/audit`.
- Error sanitization: `kernel/errors.ts` + `apps/api/src/lib/errors.ts`.
- Secret redaction in logs: `kernel/logger.ts`.

## Extensibility (§28)
- Safe formula language (no eval/global access): `sandbox-engine/src/formula.ts`.
- Script isolation contract (fail-closed, AST gate, pluggable isolate runner):
  `sandbox-engine/src/script.ts`.

## Public API + Usage Metering (§29)
- API: `apps/api` (`/v1/*`, API keys/service accounts in schema, rate limiting).
- Usage Metering Proxy (metrics only): `packages/usage-metering`.

## Feature flags (§44.1)
- Targeted flags + rollout, never replacing permissions: `packages/feature-flags`.

## Billing (§26)
- SaaS subscriptions via platform credentials; tenant payments deliberately NOT
  here (they use tenant BYO creds via `integration-engine`): `packages/billing`.

## Tech stack (§34, §35)
- Next.js + React 19 (web), Fastify (api), Drizzle + postgres-js (db), Node
  workers, Redis-ready queues abstraction, S3-compatible storage, OTEL-ready
  logging. Docker + env for portability (Vercel + Railway split).
