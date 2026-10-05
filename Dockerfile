# Multi-stage production image for Synology Container Manager / Docker Compose.
# Builds with Nitro node-server (long-running Node), not the Vercel preset.
FROM node:22-bookworm-slim AS build
WORKDIR /app

# Build-time flags (auth stays off unless overridden). Never bake secrets here.
ARG VITE_AUTH_ENABLED=false
ARG NITRO_PRESET=node-server
ENV VITE_AUTH_ENABLED=${VITE_AUTH_ENABLED}
ENV NITRO_PRESET=${NITRO_PRESET}
# Skip migrate during image build — DATABASE_URL is runtime-only on the NAS.
ENV DATABASE_URL=

COPY package.json package-lock.json* ./
# Lock may be missing/out-of-sync; npm install resolves. Prefer npm ci once lock is committed.
RUN npm install

COPY . .
# Ensure Nitro preset is env-overridable (keeps default vercel when unset).
RUN node -e "const fs=require('fs');const p='vite.config.ts';let t=fs.readFileSync(p,'utf8');const n=t.replace(/preset:\s*\"vercel\"/, 'preset: process.env.NITRO_PRESET || \"vercel\"'); if(n===t){console.log('[docker] vite preset already env-driven');}else{fs.writeFileSync(p,n);console.log('[docker] patched vite nitro preset for NITRO_PRESET');}"
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

# Production deps for migrate.mjs (pg). Nitro server bundle lives in .output.
COPY package.json package-lock.json* ./
RUN npm install --omit=dev && npm cache clean --force

COPY --from=build /app/.output ./.output
COPY --from=build /app/scripts ./scripts
COPY --from=build /app/migrations ./migrations

COPY docker/entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

EXPOSE 8080
ENTRYPOINT ["/entrypoint.sh"]
CMD ["node", ".output/server/index.mjs"]
