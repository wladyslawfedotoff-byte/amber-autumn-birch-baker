#!/bin/sh
set -eu
# Apply SQL migrations when a real Postgres URL is configured.
# Without DATABASE_URL the app uses in-memory PGLite (fine: planner data is localStorage).
if [ -n "${DATABASE_URL:-}" ]; then
  echo "[entrypoint] DATABASE_URL set — running migrations…"
  node scripts/migrate.mjs
else
  echo "[entrypoint] DATABASE_URL unset — skipping migrations (PGLite / no server DB)."
fi
exec "$@"
