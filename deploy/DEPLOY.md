# Deploying CRMS on Railway

Everything runs on Railway — **web + api + worker + Postgres + Redis**. Vercel is
optional (frontend-only) and not required.

The whole platform is a single repo built from one multi-purpose `Dockerfile`
(`--build-arg APP=api|worker|web|migrate`), so each Railway service points at the
same repo with a different build arg.

## 1. Provision data services
In your Railway project, add:
- **PostgreSQL** plugin → gives `DATABASE_URL` (this user is a superuser).
- **Redis** plugin → gives `REDIS_URL`.

## 2. Shared variables (set on the project, referenced by services)
```
PLATFORM_MASTER_KEY   # node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
JWT_SECRET            # node -e "console.log(require('crypto').randomBytes(48).toString('base64'))"
APP_DB_PASSWORD       # password for the least-privilege app role
```

Derive two DB URLs from the Railway Postgres:
- **Admin URL** = the plugin's `DATABASE_URL` (superuser) → used by `migrate` and
  by tenant-migration DDL (`CRMS_ADMIN_DATABASE_URL`).
- **App URL** = same host/db but user `crms_app` and `APP_DB_PASSWORD` → used by
  `api` and `worker` so **RLS is enforced** (superusers bypass RLS).

## 3. Service: `migrate` (run once per schema change)
- Deploy from repo, Dockerfile build arg `APP=migrate`.
- Variables:
  ```
  DATABASE_URL=<Admin URL>
  PLATFORM_MASTER_KEY, JWT_SECRET   (referenced)
  CRMS_APP_ROLE=crms_app
  CRMS_APP_ROLE_PASSWORD=${APP_DB_PASSWORD}
  ```
- It applies migrations + RLS **and creates the `crms_app` NOSUPERUSER
  NOBYPASSRLS role with grants** — one command, DB is deploy-ready.
- Set it as a one-off / pre-deploy job (no restart).

## 4. Service: `api`
- Build arg `APP=api`. Variables:
  ```
  DATABASE_URL=<App URL>                 # crms_app — RLS enforced
  CRMS_ADMIN_DATABASE_URL=<Admin URL>    # for tenant tier-2/3 migrations
  REDIS_URL=<from plugin>
  PLATFORM_MASTER_KEY, JWT_SECRET
  APP_BASE_URL=https://<web-domain>
  API_BASE_URL=https://<api-domain>
  # optional: GOOGLE_*, OIDC_*, STRIPE_*, S3_*, SANDBOX_RUNNER
  ```
- Railway injects `PORT`; the API binds it automatically. Healthcheck: `/health`.

## 5. Service: `worker`
- Build arg `APP=worker`. Same DB/Redis/secret variables as `api`
  (no HTTP port; it runs the background loops). No healthcheck.

## 6. Service: `web`
- Build arg `APP=web` **plus a build arg** `API_BASE_URL=https://<api-domain>`
  (the API URL is inlined into the browser bundle at build time).
- Railway injects `PORT`; `next start` binds it. Expose the public domain.

## Order
`migrate` → then `api` + `worker` + `web`. Re-run `migrate` after any schema
change (it's idempotent).

## Self-host / local prod check
The identical topology runs locally:
```
cd deploy && cp .env.prod.example .env   # fill in secrets
docker compose -f docker-compose.prod.yml up --build
# web → http://localhost:3000   api → http://localhost:4000/health
```

## Notes
- **RLS depends on connecting as `crms_app`** (NOBYPASSRLS). Never point the app
  services at the superuser URL.
- Files/documents/DSAR exports need an S3-compatible bucket (`S3_*`). Add a
  Railway volume + MinIO service, or use Cloudflare R2 / AWS S3.
- Feature flags for Stripe/OIDC/Google/SMTP activate as soon as their credentials
  are present — nothing else to change.
