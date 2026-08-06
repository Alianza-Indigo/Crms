# ============================================================================
# Multi-purpose image for the CRMS monorepo (PRD §35.4 — portable via Docker).
# Build a specific service with:  --build-arg APP=api|worker|web|migrate|all
#   api      -> Fastify HTTP API (persistent)
#   worker   -> background workers (outbox, automations, webhooks, imports, ...)
#   web      -> Next.js production server (needs API_BASE_URL at build time)
#   migrate  -> one-shot: apply migrations + RLS + create the app DB role
#   all      -> single-service: api + worker + web + migrate-on-boot in ONE
#               container (Next.js public on $PORT, proxies /v1 to the API).
# api/worker/migrate run from source via tsx; web is `next build` + `next start`.
# ============================================================================
FROM node:22-slim AS base
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable
WORKDIR /app

# Install dependencies (cached on lockfile).
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json .npmrc tsconfig.base.json ./
COPY packages ./packages
COPY apps ./apps
COPY tests ./tests
COPY deploy ./deploy
RUN pnpm install --frozen-lockfile

ARG APP=api
ENV APP=${APP}

# The web bundle inlines NEXT_PUBLIC_API_BASE_URL at build. For "web" pass the
# API's public URL; for "all" the browser calls this same origin, so build with
# an empty base (relative /v1 URLs) which Next then proxies to the internal API.
ARG API_BASE_URL=http://localhost:4000
ENV API_BASE_URL=${API_BASE_URL}
# Next bakes rewrites() at BUILD time, so the all-in-one build must set
# INTERNAL_API_URL now (pinned to the internal API port 4000 that the entrypoint
# also uses). Empty API_BASE_URL => same-origin /v1 calls that these rewrites
# then proxy to the in-container API.
RUN if [ "$APP" = "web" ]; then \
      pnpm --filter @crms/web build; \
    elif [ "$APP" = "all" ]; then \
      INTERNAL_API_URL=http://127.0.0.1:4000 API_BASE_URL= pnpm --filter @crms/web build; \
    fi

EXPOSE 3000 4000
# Dispatch on $APP (see deploy/entrypoint.sh).
CMD ["bash", "deploy/entrypoint.sh"]
