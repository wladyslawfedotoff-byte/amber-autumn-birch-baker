/**
 * Daily consistent copy of pora.db for backups: `VACUUM INTO
 * DATA_DIR/backup/pora-<date>.db`, the newest DB_SNAPSHOT_KEEP (default 7)
 * kept. Checked every hour; made once a day after DB_SNAPSHOT_HOUR (local
 * time of the container, default 3). On demand:
 * `docker exec pora-app node scripts/db-snapshot.mjs`.
 */
import { dailySnapshot, hasSnapshotFor } from "../lib/db/snapshot.ts";
import { storageFor } from "../lib/db/storage.ts";
import { log } from "../lib/log.ts";
import { dataDir } from "../lib/sync-store.ts";

const FLAG = "__poraDbSnapshots";
const EVERY_MS = 60 * 60 * 1000;

function envInt(name: string, fallback: number, min: number, max: number): number {
  const value = Number.parseInt(process.env[name] ?? "", 10);
  return Number.isFinite(value) && value >= min && value <= max ? value : fallback;
}

export default function dbSnapshots(): void {
  const g = globalThis as Record<string, unknown>;
  if (g[FLAG]) return;
  g[FLAG] = true;
  const keep = envInt("DB_SNAPSHOT_KEEP", 7, 1, 365);
  const hour = envInt("DB_SNAPSHOT_HOUR", 3, 0, 23);
  const tick = () => {
    try {
      const dir = dataDir();
      const storage = storageFor(dir);
      if (storage.mode !== "sqlite") return;
      const now = Date.now();
      if (new Date(now).getHours() < hour || hasSnapshotFor(dir, now)) return;
      const started = Date.now();
      const result = dailySnapshot(storage.db, dir, now, keep);
      log("info", "db.snapshot", { file: result.path, ms: Date.now() - started, removed: result.removed.length ? result.removed.join(",") : undefined });
    } catch (error) {
      log("error", "db.snapshot_failed", { hint: "проверьте место на диске и права на папку data/backup" }, error);
    }
  };
  setTimeout(tick, 2 * 60_000).unref?.();
  setInterval(tick, EVERY_MS).unref?.();
}
