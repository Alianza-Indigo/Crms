# ============================================================================
# Multi-purpose image for the CRMS monorepo (PRD §35.4 — portable via Docker).
# Build a specific service with:  --build-arg APP=api|worker|web|migrate
#   api      -> Fastify HTTP API (persistent)
#   worker   -> background workers (outbox, automations, webhooks, imports, ...)
#   web      -> Next.js production server (needs API_BASE_URL at build time)
#   migrate  -> one-shot: apply migrations + RLS + create the app DB role
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
RUN pnpm install --frozen-lockfile

ARG APP=api
ENV APP=${APP}

# The web bundle inlines NEXT_PUBLIC_API_BASE_URL at build; pass the API URL.
ARG API_BASE_URL=http://localhost:4000
ENV API_BASE_URL=${API_BASE_URL}
RUN if [ "$APP" = "web" ]; then pnpm --filter @crms/web build; fi

EXPOSE 3000 4000
# Start the selected service.
CMD ["sh", "-c", "\
  if [ \"$APP\" = \"web\" ]; then pnpm --filter @crms/web start; \
  elif [ \"$APP\" = \"worker\" ]; then pnpm --filter @crms/worker serve; \
  elif [ \"$APP\" = \"migrate\" ]; then pnpm --filter @crms/database db:migrate; \
  else pnpm --filter @crms/api serve; fi"]
