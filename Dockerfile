# Multi-stage production image for Synology Container Manager / Docker Compose.
# Builds with the Nitro node-server preset (long-running Node).
# The image is PUBLIC on GHCR: never bake secrets into it (no ARG/ENV with
# passwords or keys) — APP_PASSWORD etc. are set at runtime in compose.
FROM node:22-bookworm-slim AS build
WORKDIR /app

# Build-time flags only. Never bake secrets here.
ARG NITRO_PRESET=node-server
ENV NITRO_PRESET=${NITRO_PRESET}
ENV PATH=/app/node_modules/.bin:$PATH

COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

COPY . .
RUN vite build

FROM node:22-bookworm-slim AS runner
WORKDIR /app
RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates \
  && rm -rf /var/lib/apt/lists/*

ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=8080
ENV NITRO_HOST=0.0.0.0
ENV NITRO_PORT=8080
# Data (pora.db, backup/, backups/, attachments/, .session-secret) — mount a volume here.
ENV DATA_DIR=/data

# Production deps: better-sqlite3 (pora.db, loaded by the server bundle and the
# maintenance scripts from /app/node_modules; prebuilt binary for linux x64/arm64
# glibc, no compiler needed).
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund && npm cache clean --force

COPY --from=build /app/.output ./.output
COPY --from=build /app/scripts ./scripts
# The maintenance scripts (restore-backup, reset-password, export-json,
# db-snapshot) import the shared sync model and the storage code directly.
COPY --from=build /app/src/lib/sync ./src/lib/sync
COPY --from=build /app/server/lib ./server/lib

COPY docker/entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh && mkdir -p /data && chown node:node /data

EXPOSE 8080

# node:22-slim has no curl — probe with Node's fetch. /api/health is public and
# answers 503 when the data folder is not writable.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:'+(process.env.PORT||8080)+'/api/health').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"]

# The entrypoint starts as root only to prepare /data, then drops to the
# unprivileged `node` user (or PUID/PGID) with setpriv.
ENTRYPOINT ["/entrypoint.sh"]
CMD ["node", ".output/server/index.mjs"]
