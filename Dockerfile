# syntax=docker/dockerfile:1.7
# One Dockerfile, one target per service: migrate, api, worker, web.
#   docker build --target api -t wow-roster-api .

ARG NODE_VERSION=24-alpine

FROM node:${NODE_VERSION} AS base
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH
RUN npm install -g pnpm@10.34.6
WORKDIR /repo

# ---- dependencies (cached on the lockfile) ----
FROM base AS deps
COPY pnpm-lock.yaml pnpm-workspace.yaml ./
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm fetch --frozen-lockfile
COPY . .
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --frozen-lockfile --offline

# ---- build every app ----
FROM deps AS build
# Baked into the Next.js rewrites; Caddy routes /api directly in production anyway.
ARG API_INTERNAL_URL=http://api:4000
ENV API_INTERNAL_URL=${API_INTERNAL_URL} NEXT_TELEMETRY_DISABLED=1
RUN pnpm --filter @wow/api --filter @wow/worker build \
 && pnpm --filter @wow/web build
# Self-contained production installs for the Node services (bundles + their npm deps).
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm --filter @wow/api deploy --legacy --prod /out/api \
 && pnpm --filter @wow/worker deploy --legacy --prod /out/worker \
 && cp -r apps/api/dist /out/api/dist \
 && cp -r apps/worker/dist /out/worker/dist

# ---- database migrations (one-shot job) ----
FROM deps AS migrate
WORKDIR /repo/packages/db
CMD ["pnpm", "exec", "prisma", "migrate", "deploy"]

# ---- runtime images ----
FROM node:${NODE_VERSION} AS runtime
ENV NODE_ENV=production
WORKDIR /app
USER node

FROM runtime AS api
COPY --from=build --chown=node:node /out/api ./
EXPOSE 4000
CMD ["node", "dist/index.js"]

FROM runtime AS worker
COPY --from=build --chown=node:node /out/worker ./
CMD ["node", "dist/index.js"]

FROM runtime AS web
ENV HOSTNAME=0.0.0.0 PORT=3000 NEXT_TELEMETRY_DISABLED=1
COPY --from=build --chown=node:node /repo/apps/web/.next/standalone ./
COPY --from=build --chown=node:node /repo/apps/web/.next/static ./apps/web/.next/static
EXPOSE 3000
CMD ["node", "apps/web/server.js"]
