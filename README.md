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
  auth                Sessions, scrypt + Google OAuth, API keys, impersonation (§32)

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

**Everything runs on Railway** — web + api + worker + Postgres + Redis — from one
multi-purpose `Dockerfile` (`--build-arg APP=api|worker|web|migrate`). Vercel is
optional (frontend-only). One command provisions the DB: the `migrate` service
applies schema + RLS **and creates the least-privilege `crms_app` role** so RLS
is enforced.

- Step-by-step Railway guide: [`deploy/DEPLOY.md`](deploy/DEPLOY.md)
- Full stack locally (same topology): `cd deploy && cp .env.prod.example .env && docker compose -f docker-compose.prod.yml up --build`

The whole platform is portable via Docker + environment variables (PRD §35.4).

## Authentication

- **Email + password** (scrypt) and **Google OAuth 2.0** (set `GOOGLE_CLIENT_ID`
  / `GOOGLE_CLIENT_SECRET`; the login page hides the Google button when unset).
- **API keys** bound to service accounts (`crms_<prefix>_<secret>`, hash-stored,
  scoped, revocable) authenticate machine callers on the same Bearer header.
- **Impersonation** is platform-admin only, time-boxed, fully audited, and shows
  a permanent red banner + countdown in the UI.
- **MFA is intentionally not used.**

## Implemented depth (completed since the core)

- Record operations: create/read/update/archive/**restore/duplicate/assign/
  transfer/approve/reject/lock/unlock** + **computed fields** (formula, rollup,
  count, autonumber) — covered by tests.
- **Webhook delivery** worker (HMAC signing, retries + backoff, dead-letter,
  replay endpoint) fed by the outbox — webhooks never fire in the write txn.
- **Credential OAuth refresh** worker: refreshes before expiry, and on failure
  marks the credential invalid + pauses dependent automations (never falls back
  to another credential).
- **Tenant tier routing**: Tier-3 dedicated pools + Tier-2 schema `search_path`,
  O(1) on the shared hot path.
- **AI application generation**: natural-language → validated AIPlan → review →
  approve → execute (BYO provider).
- Automations: **resumable executor** with real waits (scheduled resume),
  approvals (pause → human decision → branch), edge/branch traversal, and
  notify/record/integration/AI actions; official connector templates
  (Slack/Stripe/WhatsApp/Gmail/Mercado Pago/Telegram).
- **Field-level permissions**: restricted fields are masked on read and rejected
  on write for subjects lacking the role (owners bypass) — covered by tests.
- **Mobile delta sync** (`/modules/:id/sync`): changes + tombstones since a
  cursor, ordered by `updated_at`, with field masking — covered by tests.
- **AI conversation persistence**: generation records AIConversation + AISession
  (messages + provider usage) linked to the resulting AIPlan.

## Ready — just plug credentials / enable

These are implemented and wired behind auto-registering seams; they activate the
moment their credential or flag is present, with nothing else to change:

| Capability | Enable by |
|---|---|
| **Google login** | `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` |
| **Generic OIDC SSO** (Okta/Auth0/Entra/Keycloak) | `OIDC_ISSUER` + client id/secret (endpoints auto-discovered) |
| **Stripe SaaS billing** | `STRIPE_SECRET_KEY` + `STRIPE_PRICES` (auto-registers the provider) |
| **PDF documents** | on by default (pure-JS pdfkit renderer) |
| **Realtime SSE** (`GET /v1/realtime`) | Redis running (worker publishes per-tenant, API streams) |
| **Federated MySQL** (read-only) | a `federated_connections` row with `driver:"mysql"` + BYO credential |
| **Custom scripts** | `SANDBOX_RUNNER=worker` (opt-in worker-thread+vm isolate) |

For hostile multi-tenant script isolation, register an isolated-vm/Deno/
Firecracker runner via the same `registerRunner` seam; for pixel-perfect PDFs,
register a headless-Chrome renderer via `registerPdfRenderer`.

## Completed depth (engine layer)

All previously-partial engine items are now fully implemented + typechecked, and
the deterministic ones are covered by tests:

- **Tenant migration** — real Postgres copy: schema-tier replicates tables + RLS,
  dedicated-tier streams rows to a separate DB; checksums, delta, cutover,
  cleanup. (test)
- **Config lifecycle** — version diff, application clone (remapped ids),
  rollback-to-version. (test: clone)
- **Documents** — QR codes embedded in HTML + PDF; e-signature request + public
  token sign flow. (test: QR)
- **Notifications delivery** — worker dispatches email (SMTP), Slack, WhatsApp,
  SMS (Twilio), webhook via the tenant's BYO credentials, with retries.
- **White-label runtime** — host → tenant/portal branding resolution; the web app
  themes itself from it.
- **Compliance (DSAR)** — subject data export to storage + erasure/anonymization,
  legal-hold aware. (test)
- **SDK + UI** — `@crms/sdk` typed API client; `@crms/ui` tokens + components.
- **Deploy** — Dockerfile (api/worker/web), `railway.json`, `vercel.json`.

## Product surface (engines + API)

The tenant-facing product engines are implemented, wired to the API, and tested:

- **Views** (`builder-engine`) — definitions + `runView`; kanban groups by stage,
  others return a scoped page. (test)
- **Forms** — internal + public forms; public submission creates/updates a record
  (dedup-aware), the form being the anonymous-intake authorization boundary. (test)
- **Pipelines** — stage machine with valid-transition + required-field + role
  enforcement. (test)
- **Dashboards** — widget aggregation (count/sum/avg, group-by reserved or dynamic
  fields) over the records tables. (test)
- **Search** (`search-engine`) — tenant-scoped lexical search over titles + field
  values, permission-filtered. (test)
- **Import** (`import-engine`) — CSV/JSON → map → validate → dedup/update, async via
  a worker job. (test)
- **Portals** (`portal-engine`) — external user register/login; data access scoped
  to the portal's exposed modules and the user's own records.
- **Agents** (`agent-engine`) — tool-use loop bound to the agent's service-account
  identity, so every tool call passes the same permission checks; budget + module
  limits enforced.

## Scope note

The platform is feature-complete against the PRD's engine + product surface. What
remains is polish that doesn't change capability: richer visual builder UIs in the
web app (the API + engines back them today), pixel-perfect PDF/QR layout, and
semantic search (a BYO-embeddings layer over the same result shape).
