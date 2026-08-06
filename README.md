# CRMS — Multi-tenant AI Enterprise Application Platform

A SaaS platform for creating, configuring, operating and scaling **CRMs and
custom business applications** without building each system from scratch —
through **conversation with AI** and **no-code/low-code visual builders**.

The platform provides the engine, the builders, the security, the execution, the
administration and the infrastructure. **Each tenant brings its own credentials
(BYO)** for every external service. No operational credential is ever shared
between tenants.

> This repository implements the architecture and functional core described in
> the product PRD (v3.0). It is a real, running monorepo: the multi-tenant data
> plane, RLS isolation, BYO-credential encryption, the schema/records engines,
> permissions, the transactional outbox, idempotency, automations, the AI plan
> lifecycle, deployments, and the API/worker/web apps are all implemented and
> covered by isolation tests.

---

## Architecture at a glance

```
apps/
  web        Next.js App Router + PWA (builder shell, auth, landing)
  api        Fastify HTTP API (auth, builder, records, credentials, AI, ops)
  worker     Persistent workers: outbox dispatch, automations, audit archival

packages/
  config              Env validation + platform constants
  kernel              Errors, ids, logger (secret redaction), pagination
  tenant-context      AsyncLocalStorage mandatory operating context (§6.2)
  database            Drizzle schema (~50 tables), RLS policies, tenant client
  permissions         RBAC + ABAC evaluator with `explain` (§18)
  credential-engine   Envelope encryption (AES-256-GCM), BYO validation (§10)
  schema-engine       Modules/fields/relations + publish + destructive analysis
  records-engine      Records CRUD + the mandatory Query Engine (§11, §39)
  events / outbox     Domain events + Transactional Outbox (§16.5, §40)
  idempotency         Idempotency-Key store (§12.1)
  automation-engine   Visual flow executor (§16)
  ai-engine           BYO provider abstraction + AIPlan lifecycle (§9)
  integration-engine  Universal REST connector executor (§17)
  federated-query     Read-only, guarded external SQL (§17.1)
  deployment-engine   DeploymentManifest + env promotion (§8.3)
  tenant-migration    Tier elevation state machine (§6.3)
  sandbox-engine      Safe formula language + script isolation contract (§28)
  document-engine     Template render → PDF/HTML (§21)
  storage             S3-compatible, tenant-segmented, signed URLs (§34.6)
  audit               Append-only audit + lifecycle archival (§32.4, §32.6)
  feature-flags       Targeted flags + rollout (§44.1)
  usage-metering      Usage Metering Proxy — metrics only, no content (§29.1)
  billing             SaaS subscriptions, strictly separated from tenant pay (§26)
  auth                Sessions, scrypt, TOTP MFA, impersonation (§32)

tests/                Tenant-isolation, credential-secrecy, formula suites
```

See [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) for a PRD-section → code map
and [`docs/SECURITY.md`](docs/SECURITY.md) for the isolation model.

---

## The non-negotiable invariants

These are enforced in code and asserted by tests, not just documented:

1. **Every operation runs inside a tenant context** (`@crms/tenant-context`).
   Dynamic reads without one are rejected by the Query Engine.
2. **Row-Level Security** confines every tenant-scoped table. The app connects as
   a **non-superuser, `NOBYPASSRLS`** role, so even a raw query cannot cross a
   tenant boundary. (Superusers bypass RLS — never connect the app as one.)
3. **BYO credentials are envelope-encrypted** and stored apart from metadata. The
   plaintext is returned only on the authorized execution path — never to the
   API, frontend, AI, logs, or exports.
4. **Applications are isolated**: no shared modules/records/schemas/credentials.
   Cross-app communication is only via API/Webhook/Automation/Integration.
5. **Events go through the Transactional Outbox**; webhooks never fire inside the
   mutation transaction.
6. **Destructive changes require explicit confirmation / approval.**

---

## Quick start

Requirements: Node 22+, pnpm 10+, Docker (or a local Postgres 16 + Redis).

```bash
pnpm install
cp .env.example .env
# generate the crypto material:
node -e "console.log('PLATFORM_MASTER_KEY='+require('crypto').randomBytes(32).toString('base64'))" >> .env
node -e "console.log('JWT_SECRET='+require('crypto').randomBytes(48).toString('base64'))" >> .env

# infra
docker compose up -d postgres redis

# schema + RLS
pnpm db:generate     # (already committed; regenerate after schema changes)
pnpm db:migrate      # applies migrations + RLS policies
pnpm db:seed         # demo tenant + admin (admin@crms.local / ChangeMe123!)

# run everything
pnpm dev             # web:3000  api:4000  worker
```

### Production database role (important)

Migrations run as the **owner** role. The application services MUST connect as a
**non-superuser** role so RLS is enforced:

```sql
CREATE ROLE crms_app LOGIN PASSWORD '…' NOSUPERUSER NOBYPASSRLS;
GRANT USAGE ON SCHEMA public TO crms_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO crms_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO crms_app;
```

Point `DATABASE_URL` for `apps/api` and `apps/worker` at `crms_app`.

---

## Try the API

```bash
curl -XPOST localhost:4000/v1/auth/register -H content-type:application/json \
  -d '{"email":"you@acme.test","password":"Sup3rSecret!!"}'
TOKEN=$(curl -sXPOST localhost:4000/v1/auth/login -H content-type:application/json \
  -d '{"email":"you@acme.test","password":"Sup3rSecret!!"}' | jq -r .token)
curl -sXPOST localhost:4000/v1/onboarding/tenant -H "authorization: Bearer $TOKEN" \
  -H content-type:application/json -d '{"name":"Acme","slug":"acme","applicationName":"Clinic"}'
```

---

## Testing

```bash
pnpm test              # all suites (needs DATABASE_URL to a migrated DB)
pnpm test:isolation    # tenant isolation only
```

The isolation suite creates two tenants and proves that neither can read the
other's records — by API and by raw query — and that credential secrets never
leak.

---

## Deployment

Frontend + short web requests on **Vercel**; the persistent API, workers, queues,
Postgres and Redis on **Railway** (PRD §35). The whole platform is portable via
Docker + environment variables (`docker compose` here mirrors that).

## Scope note

This is the architectural core with every domain wired and the security-critical
paths fully implemented and tested. Areas intentionally left with a clean
extension point (documented inline) rather than a full build: the out-of-process
script isolate runner, the headless-PDF renderer, live OAuth dances for every
provider, and the realtime gateway. Each has a registered-provider seam so it
plugs in without re-architecture.
