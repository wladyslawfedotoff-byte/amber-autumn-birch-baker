#!/bin/sh
# Container entrypoint for «Пора».
# 1. (root) prepare the data folder (${DATA_DIR:-/data}) and hand it to the app user;
# 2. (app user) optional DB migrations when DATABASE_URL is set;
# 3. exec the server as the unprivileged user (default: node 1000:1000,
#    override with PUID / PGID to match a Synology folder owner).
set -eu

DATA_DIR="${DATA_DIR:-/data}"
export DATA_DIR

log() {
  echo "$(date -u +%Y-%m-%dT%H:%M:%S.000Z) $*"
}

run_as_app() {
  "$@"
}

if [ "$(id -u)" = "0" ]; then
  APP_UID="${PUID:-$(id -u node)}"
  APP_GID="${PGID:-$(id -g node)}"

  if ! mkdir -p "$DATA_DIR" "$DATA_DIR/backups" 2>/dev/null; then
    log "WARN  entrypoint: cannot create $DATA_DIR — проверьте volume (./data:/data) / check the volume mount"
  fi
  # Only our own files; never recurse into anything else the user mounted.
  for path in "$DATA_DIR" "$DATA_DIR/backups" "$DATA_DIR/pora.json" "$DATA_DIR/.session-secret" "$DATA_DIR/.session-epoch"; do
    [ -e "$path" ] || continue
    if ! chown "$APP_UID:$APP_GID" "$path" 2>/dev/null; then
      log "WARN  entrypoint: chown $APP_UID:$APP_GID $path failed"
    fi
  done
  if [ -d "$DATA_DIR/backups" ]; then
    find "$DATA_DIR/backups" -maxdepth 1 -type f -name 'pora-*.json' -exec chown "$APP_UID:$APP_GID" {} + 2>/dev/null || true
  fi

  if ! setpriv --reuid="$APP_UID" --regid="$APP_GID" --clear-groups sh -c 'test -w "$1"' _ "$DATA_DIR"; then
    log "ERROR entrypoint: папка данных $DATA_DIR недоступна для записи пользователю $APP_UID:$APP_GID."
    log "ERROR entrypoint: Synology: File Station → docker/pora/data → Свойства → Разрешения — дайте «Чтение и запись» (например, группе Everyone),"
    log "ERROR entrypoint: или задайте PUID/PGID владельца папки (id пользователя DSM, обычно 1026 и 100) в файле .env."
    log "ERROR entrypoint: data folder $DATA_DIR is not writable for uid $APP_UID — fix permissions or set PUID/PGID. Starting anyway (health will report 503)."
  fi

  run_as_app() {
    setpriv --reuid="$APP_UID" --regid="$APP_GID" --clear-groups "$@"
  }
fi

if [ -n "${DATABASE_URL:-}" ]; then
  log "INFO  entrypoint: running database migrations"
  run_as_app node scripts/migrate.mjs
fi

if [ "$(id -u)" = "0" ]; then
  export HOME=/home/node
  exec setpriv --reuid="$APP_UID" --regid="$APP_GID" --clear-groups "$@"
fi
exec "$@"
