# syntax=docker/dockerfile:1
# ============================================================================
# Multi-purpose image for the CRMS monorepo (PRD §35.4 — portable via Docker).
# Build a specific service with:  --build-arg APP=api|worker|web
# The whole workspace is installed so workspace packages resolve; api/worker run
# via tsx (packages are consumed as source), web runs the Next.js production
# server.
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
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --frozen-lockfile

ARG APP=api
ENV APP=${APP}

# Build the web app ahead of time; api/worker run from source via tsx.
RUN if [ "$APP" = "web" ]; then pnpm --filter @crms/web build; fi

EXPOSE 3000 4000
# Start the selected service.
CMD ["sh", "-c", "\
  if [ \"$APP\" = \"web\" ]; then pnpm --filter @crms/web start; \
  elif [ \"$APP\" = \"worker\" ]; then pnpm --filter @crms/worker serve; \
  else pnpm --filter @crms/api serve; fi"]
