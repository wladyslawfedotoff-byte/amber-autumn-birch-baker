# Multi-stage production image for Synology Container Manager / Docker Compose.
# Builds with Nitro node-server (long-running Node), not the Vercel preset.
# The image is PUBLIC on GHCR: never bake secrets into it (no ARG/ENV with
# passwords or keys) — APP_PASSWORD etc. are set at runtime in compose.
FROM node:22-bookworm-slim AS build
WORKDIR /app

# Build-time flags (Grok broker auth stays off). Never bake secrets here.
ARG VITE_AUTH_ENABLED=false
ARG NITRO_PRESET=node-server
ENV VITE_AUTH_ENABLED=${VITE_AUTH_ENABLED}
ENV NITRO_PRESET=${NITRO_PRESET}
# Skip migrate during image build — DATABASE_URL is runtime-only on the NAS.
ENV DATABASE_URL=
# So `vite` resolves when with-app-env spawns it (same as npm scripts).
ENV PATH=/app/node_modules/.bin:$PATH

COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

COPY . .
# Build only (vite). Migrations run at container start when DATABASE_URL is set.
RUN node scripts/with-app-env.mjs vite build

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
# Sync data (pora.json, backups/, .session-secret) — mount a volume here.
ENV DATA_DIR=/data
# No third-party Grok banner script on the self-hosted app.
ENV VITE_GROK_EXTENSIONS=0

# Production deps for migrate.mjs (pg). The Nitro server bundle in .output is self-contained.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund && npm cache clean --force

COPY --from=build /app/.output ./.output
COPY --from=build /app/scripts ./scripts
COPY --from=build /app/migrations ./migrations
# scripts/restore-backup.mjs imports the shared sync model directly.
COPY --from=build /app/src/lib/sync ./src/lib/sync

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
