#!/usr/bin/env node
/**
 * Consistent copy of data/pora.db right now (the server also makes one every
 * night): `VACUUM INTO data/backup/pora-<дата>.db`, the newest 7 are kept.
 *
 *   docker exec pora-app node scripts/db-snapshot.mjs
 *
 * Safe while the server runs. Use it before risky steps and before a Hyper
 * Backup run if you want today's state in the copy.
 *
 * Needs Node ≥ 22.18 (imports server/lib/db/*.ts directly), like the image has.
 */
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { runAsDataOwner } from "./data-owner.mjs";

const here = fileURLToPath(new URL(".", import.meta.url));
const dir = (process.env.DATA_DIR ?? "").trim() || "/data";

try {
  runAsDataOwner(dir);
  const { openForScript } = await import(join(here, "../server/lib/db/offline.ts"));
  const { dailySnapshot } = await import(join(here, "../server/lib/db/snapshot.ts"));
  const storage = openForScript(dir);
  if (storage.mode !== "sqlite") throw new Error(`в ${dir} нет рабочей pora.db (данные в JSON-файлах — их копирует Hyper Backup как есть)`);
  try {
    const keep = Number.parseInt(process.env.DB_SNAPSHOT_KEEP ?? "", 10);
    const result = dailySnapshot(storage.db, dir, Date.now(), Number.isFinite(keep) && keep >= 1 ? keep : 7);
    console.log(`Готово: ${result.path}`);
    if (result.removed.length) console.log(`Удалены старые копии: ${result.removed.join(", ")}`);
  } finally {
    storage.db.close();
  }
} catch (error) {
  console.error(`Ошибка: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}
