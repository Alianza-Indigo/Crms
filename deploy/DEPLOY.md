# Deploying CRMS on Railway

Everything runs on Railway. There are two topologies — pick one:

- **Option A — single service (simplest, fewest to manage).** One service runs
  api + worker + web + on-boot migrations in one container. **1 service + Postgres + Redis.**
- **Option B — split services (scale each independently).** Separate `api`,
  `worker`, `web`, and a one-shot `migrate`. **4 services + Postgres + Redis.**

Both build from the same repo and the same multi-purpose `Dockerfile`
(`--build-arg APP=all|api|worker|web|migrate`); only the build arg differs.

**The repo ships a root `railway.json`** (Dockerfile builder + `/health` check)
and the Dockerfile **defaults to `APP=all`**, so deploying the repo to Railway
creates **one all-in-one service automatically** — no Root Directory, Builder,
or `APP` variable to set. Option A just adds the databases + secrets below.

---

## Data services (both options)
In your Railway project, add:
- **PostgreSQL** plugin → gives `DATABASE_URL` (this user is a superuser / admin).
- **Redis** plugin → gives `REDIS_URL`.

Generate two secrets once and set them as shared project variables:
```
PLATFORM_MASTER_KEY   # node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
JWT_SECRET            # node -e "console.log(require('crypto').randomBytes(48).toString('base64'))"
APP_DB_PASSWORD       # any strong password for the least-privilege app role
```

Two DB URLs are derived from the Railway Postgres — **the split matters because
superusers bypass RLS, so the app must never connect as the admin:**
- **Admin URL** = the plugin's `DATABASE_URL` (superuser) → migrations + tenant DDL.
- **App URL** = same host/db but user `crms_app` and `APP_DB_PASSWORD` → api/worker.

---

## Option A — single service ⭐ (recommended to start)

Because of the root `railway.json` + Dockerfile `APP=all` default, this is mostly
automatic. Click order:

1. **New Project → Deploy from GitHub repo →** this repo. Railway reads
   `railway.json`, builds the Dockerfile as **one** service. (If a monorepo split
   ever created `@crms/api` / `@crms/web` / `@crms/worker`, delete the extras and
   keep one — or delete all and re-add; with `railway.json` present it comes up as
   a single service.)
2. **+ New → Database → PostgreSQL**, then **+ New → Database → Redis**.
3. On the app service → **Variables** → paste the block below.
4. App service → **Settings → Networking → Generate Domain**, then set
   `APP_BASE_URL` to that domain.

Variables:
```
DATABASE_URL=postgres://crms_app:${APP_DB_PASSWORD}@${{Postgres.PGHOST}}:${{Postgres.PGPORT}}/${{Postgres.PGDATABASE}}
CRMS_ADMIN_DATABASE_URL=${{Postgres.DATABASE_URL}}
REDIS_URL=${{Redis.REDIS_URL}}
PLATFORM_MASTER_KEY=<generated>
JWT_SECRET=<generated>
APP_DB_PASSWORD=<your strong password>
CRMS_APP_ROLE_PASSWORD=${APP_DB_PASSWORD}
APP_BASE_URL=https://<this-service-domain>
# optional: GOOGLE_*, OIDC_*, STRIPE_*, S3_*, SANDBOX_RUNNER
```
Defaults baked in (no need to set): `APP=all`, `RUN_MIGRATIONS_ON_BOOT=true`,
`CRMS_APP_ROLE=crms_app`, internal API port `4000`.

- Railway injects `PORT`; **Next.js** binds it and serves the UI, proxying
  `/v1/*`, `/webhooks/*` and `/health` in-container to the **API** on 4000. The
  **worker** runs in the same container.
- On boot it applies migrations + RLS **and creates the `crms_app`
  NOBYPASSRLS role** (idempotent), so the DB is deploy-ready with no extra step.
- The browser calls this same origin — no `API_BASE_URL` to set.
- Healthcheck `/health` (300s grace for the on-boot migration).

That's it. One service, one domain, RLS enforced.

---

## Option B — split services (scale each part independently)

### 1. Service `migrate` (run once per schema change)
Build arg `APP=migrate`. Variables:
```
DATABASE_URL=<Admin URL>
CRMS_APP_ROLE=crms_app
CRMS_APP_ROLE_PASSWORD=${APP_DB_PASSWORD}
PLATFORM_MASTER_KEY, JWT_SECRET
```
Applies migrations + RLS and creates the `crms_app` role. Set as a one-off /
pre-deploy job (no restart). Idempotent — re-run after any schema change.

### 2. Service `api`
Build arg `APP=api`. Variables:
```
DATABASE_URL=<App URL>                 # crms_app — RLS enforced
CRMS_ADMIN_DATABASE_URL=<Admin URL>    # tenant tier-2/3 migrations
REDIS_URL=<from plugin>
PLATFORM_MASTER_KEY, JWT_SECRET
APP_BASE_URL=https://<web-domain>
API_BASE_URL=https://<api-domain>
# optional: GOOGLE_*, OIDC_*, STRIPE_*, S3_*, SANDBOX_RUNNER
```
Railway injects `PORT`; the API binds it. Healthcheck: `/health`.

### 3. Service `worker`
Build arg `APP=worker`. Same DB/Redis/secret variables as `api` (no HTTP port).

### 4. Service `web`
Build arg `APP=web` **plus a build arg** `API_BASE_URL=https://<api-domain>`
(the API URL is inlined into the browser bundle at build time). Railway injects
`PORT`; `next start` binds it. Expose the public domain.

**Order:** `migrate` → then `api` + `worker` + `web`.

---

## Self-host / local prod check
The identical topologies run locally with Docker Compose:
```
cd deploy && cp .env.prod.example .env   # fill in secrets

# Option A (single service):
docker compose -f docker-compose.allinone.yml up --build
# everything -> http://localhost:8080   health -> http://localhost:8080/health

# Option B (split services):
docker compose -f docker-compose.prod.yml up --build
# web -> http://localhost:3000   api -> http://localhost:4000/health
```

## Notes
- **RLS depends on connecting as `crms_app`** (NOBYPASSRLS). Never point the app
  at the superuser URL.
- Files/documents/DSAR exports need an S3-compatible bucket (`S3_*`). Add a
  Railway volume + MinIO service, or use Cloudflare R2 / AWS S3.
- Feature flags for Stripe/OIDC/Google/SMTP activate as soon as their credentials
  are present — nothing else to change.
