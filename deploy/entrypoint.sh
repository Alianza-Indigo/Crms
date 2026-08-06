#!/usr/bin/env bash
# ============================================================================
# CRMS container entrypoint. Dispatches on $APP:
#   api      -> Fastify HTTP API only
#   worker   -> background loops only
#   web      -> Next.js server only
#   migrate  -> one-shot: migrations + RLS + app role, then exit
#   all      -> single-service: migrate-on-boot + api + worker + web in ONE
#               container. Next.js is public on $PORT and proxies /v1 & /webhooks
#               to the internal API (see apps/web/next.config.mjs rewrites).
# ============================================================================
set -euo pipefail

APP="${APP:-api}"
# The web bundle's /v1 rewrite is baked to http://127.0.0.1:4000 at build time
# (see Dockerfile), so the internal API port is pinned to 4000 for APP=all.
INTERNAL_API_PORT=4000

# Run migrations. Prefer the admin URL when provided (migrations create roles and
# run DDL that the least-privilege app role is not allowed to do).
run_migrate() {
  if [ -n "${CRMS_ADMIN_DATABASE_URL:-}" ]; then
    env DATABASE_URL="$CRMS_ADMIN_DATABASE_URL" pnpm --filter @crms/database db:migrate
  else
    pnpm --filter @crms/database db:migrate
  fi
}

case "$APP" in
  migrate)
    run_migrate
    ;;
  api)
    exec pnpm --filter @crms/api serve
    ;;
  worker)
    exec pnpm --filter @crms/worker serve
    ;;
  web)
    exec pnpm --filter @crms/web start
    ;;
  all)
    # Apply schema first (idempotent) so the app role exists before api connects.
    if [ "${RUN_MIGRATIONS_ON_BOOT:-true}" = "true" ]; then
      run_migrate
    fi

    # API on an internal port. `env -u PORT` so it ignores the platform PORT
    # (that belongs to Next) and binds INTERNAL_API_PORT instead.
    env -u PORT API_PORT="$INTERNAL_API_PORT" pnpm --filter @crms/api serve &
    api_pid=$!

    pnpm --filter @crms/worker serve &
    worker_pid=$!

    # Next.js is the public server on $PORT and proxies API paths internally.
    INTERNAL_API_URL="http://127.0.0.1:${INTERNAL_API_PORT}" pnpm --filter @crms/web start &
    web_pid=$!

    # If ANY of the three exits, tear the whole service down so the platform
    # restarts a clean container (no silent half-dead services).
    wait -n
    echo "entrypoint(all): a child process exited; shutting down the container" >&2
    kill "$api_pid" "$worker_pid" "$web_pid" 2>/dev/null || true
    exit 1
    ;;
  *)
    echo "Unknown APP=$APP (expected api|worker|web|migrate|all)" >&2
    exit 1
    ;;
esac
