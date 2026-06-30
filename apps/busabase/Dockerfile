FROM node:22-bookworm AS base
ENV PNPM_HOME=/root/.local/share/pnpm \
    PATH=/root/.local/share/pnpm:$PATH \
    NEXT_TELEMETRY_DISABLED=1
RUN corepack enable
WORKDIR /app

FROM base AS deps
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
RUN pnpm fetch

COPY apps/busabase/package.json apps/busabase/
COPY packages/busabase-contract/package.json packages/busabase-contract/
COPY packages/busabase-core/package.json packages/busabase-core/
COPY packages/open-domains/package.json packages/open-domains/
COPY packages/openlib/package.json packages/openlib/
COPY packages/kui/package.json packages/kui/
RUN pnpm install --offline --frozen-lockfile --ignore-scripts

COPY apps/busabase apps/busabase
COPY packages/busabase-contract packages/busabase-contract
COPY packages/busabase-core packages/busabase-core
COPY packages/open-domains packages/open-domains
COPY packages/openlib packages/openlib
COPY packages/kui packages/kui

FROM deps AS build
ARG BUILD_NUMBER=0
ARG BUILD_SHA=local
ARG BUILD_TIME=local
ENV BUILD_NUMBER=${BUILD_NUMBER}
ENV BUILD_SHA=${BUILD_SHA}
ENV BUILD_TIME=${BUILD_TIME}
WORKDIR /app/apps/busabase
RUN NODE_OPTIONS=--max-old-space-size=3072 pnpm build

# ---- drizzle minimal stage (for migrations only) ----
# Next standalone never traces drizzle-kit (a CLI/dev tool), so build a tiny
# prod node_modules with just the migration toolchain to copy into the runner.
FROM base AS drizzle
WORKDIR /drizzle-only
COPY pnpm-workspace.yaml ./
COPY apps/busabase/package.json /tmp/app-package.json
RUN set -e; \
    APP_JSON=/tmp/app-package.json; \
    DRIZZLE_VERSION=$(node -pe "const p=require('$APP_JSON'); (p.devDependencies?.['drizzle-kit'] || p.dependencies?.['drizzle-kit'] || '').replace(/^[^0-9]*/, '')"); \
    DRIZZLE_ORM_VERSION=$(node -pe "const p=require('$APP_JSON'); (p.devDependencies?.['drizzle-orm'] || p.dependencies?.['drizzle-orm'] || '').replace(/^[^0-9]*/, '')"); \
    POSTGRES_VERSION=$(node -pe "const p=require('$APP_JSON'); (p.devDependencies?.postgres || p.dependencies?.postgres || '').replace(/^[^0-9]*/, '')"); \
    pnpm add -w drizzle-kit@${DRIZZLE_VERSION} drizzle-orm@${DRIZZLE_ORM_VERSION} postgres@${POSTGRES_VERSION} --prod

FROM node:22-bookworm-slim AS runner
ENV NODE_ENV=production \
    PORT=15419 \
    HOSTNAME=0.0.0.0 \
    NEXT_TELEMETRY_DISABLED=1 \
    # Canonical data root, identical in layout to `npx busabase server` and
    # busabase-desktop: <root>/pgdata = pglite database, <root>/storage =
    # attachments. Bind-mount the host's ~/.busabase/data here to share one
    # database across all three launchers:
    #   docker run -v ~/.busabase/data:/data busabase/busabase
    # Override either URL (e.g. point at external Postgres / S3) at run time.
    BUSABASE_DATA_DIR=/data \
    PG_DATABASE_URL=pglite:///data/pgdata \
    STORAGE_URL=local:/data/storage?base_url=/api/dev/attachment
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends curl ca-certificates && rm -rf /var/lib/apt/lists/*

COPY --from=build /app/apps/busabase/.next/standalone ./
COPY --from=build /app/apps/busabase/.next/static ./apps/busabase/.next/static
COPY --from=build /app/apps/busabase/public ./apps/busabase/public
# Migration tooling: drizzle.config.ts + migrations + drizzle-kit node_modules.
# Enables `pnpm db:migrate:deploy` (drizzle-kit migrate) against an external
# Postgres from an init container/job. Not needed for the pglite default.
COPY --from=build /app/apps/busabase/drizzle.config.ts ./apps/busabase/drizzle.config.ts
COPY --from=build /app/apps/busabase/src/db/migrations ./apps/busabase/src/db/migrations
COPY --from=drizzle /drizzle-only/node_modules ./apps/busabase/node_modules
# openlib source is needed at migrate time: drizzle.config.ts imports
# "openlib/db" and the schema graph imports "openlib/nanoid".
COPY --from=build /app/packages/openlib ./packages/openlib
RUN ln -s ../../../packages/openlib apps/busabase/node_modules/openlib

RUN mkdir -p /data/pgdata /data/storage && useradd -r -u 1001 nextjs && chown -R nextjs:nextjs /app /data
USER nextjs

# Persist the database + attachments. Mount the host's ~/.busabase/data here to
# share one local database with `npx busabase server` / busabase-desktop.
VOLUME /data

EXPOSE 15419
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 CMD curl -f http://localhost:15419/api/health || exit 1

CMD ["node", "apps/busabase/server.js"]
