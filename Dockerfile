# ═══════════════════════════════════════════════════════════════
# VeggaAI — Multi-stage Dockerfile
#
# Stages:
#   1. base      — shared Node 22 + pnpm setup
#   2. deps      — install all workspace dependencies
#   3. runtime   — build & run the @vai/runtime server
#   4. desktop   — build the @vai/desktop static frontend
#   5. nginx     — serve desktop via nginx (production)
# ═══════════════════════════════════════════════════════════════

# ── Stage 1: Base ──
FROM node:22-alpine AS base
RUN corepack enable && corepack prepare pnpm@latest --activate
WORKDIR /app

# ── Stage 2: Dependencies ──
FROM base AS deps
# Copy workspace config first for better layer caching
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/core/package.json packages/core/
COPY packages/runtime/package.json packages/runtime/
COPY packages/ui/package.json packages/ui/
COPY apps/desktop/package.json apps/desktop/
# Install all deps
RUN pnpm install --frozen-lockfile

# ── Stage 3: Runtime ──
FROM deps AS runtime-build
COPY packages/core/ packages/core/
COPY packages/runtime/ packages/runtime/
COPY packages/ui/ packages/ui/
COPY tsconfig.base.json ./
RUN pnpm --filter @vai/core build 2>/dev/null || true
RUN pnpm --filter @vai/runtime build:bundle

FROM node:22-alpine AS runtime
WORKDIR /app
RUN apk add --no-cache tini
COPY --from=runtime-build /app/packages/runtime/dist/bundle.cjs ./runtime.cjs
# SQLite needs native binary
COPY --from=runtime-build /app/node_modules/better-sqlite3 ./node_modules/better-sqlite3
COPY --from=runtime-build /app/node_modules/bindings ./node_modules/bindings 2>/dev/null || true
COPY --from=runtime-build /app/node_modules/file-uri-to-path ./node_modules/file-uri-to-path 2>/dev/null || true

# Data volume for SQLite DB + sandbox projects
VOLUME /app/data
ENV VAI_DB_PATH=/app/data/vai.db
ENV VAI_PORT=3006
ENV NODE_ENV=production

EXPOSE 3006
ENTRYPOINT ["tini", "--"]
CMD ["node", "runtime.cjs"]

# ── Stage 4: Desktop build ──
FROM deps AS desktop-build
COPY packages/core/ packages/core/
COPY packages/ui/ packages/ui/
COPY apps/desktop/ apps/desktop/
COPY tsconfig.base.json ./
RUN pnpm --filter @vai/desktop build

# ── Stage 5: Nginx for desktop ──
FROM nginx:alpine AS desktop
COPY --from=desktop-build /app/apps/desktop/dist /usr/share/nginx/html
COPY docker/nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
