#!/usr/bin/env node
/**
 * Before going back from 1.25 to the 1.24 image: removes schema v3 (helper
 * keys and their action log, tables helper_keys and helper_audit) so 1.24
 * opens pora.db. Tasks (including the ones bots created) stay as they are.
 * A snapshot backup/pora-<дата>.db is made first. Helper keys stop working
 * (make new ones after updating to 1.25 again).
 *
 *   docker exec pora-app node scripts/db-downgrade-1.24.mjs
 *   (then stop the project and start the 1.24 image right away)
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
  if (storage.mode !== "sqlite") throw new Error(`в ${dir} нет рабочей pora.db`);
  try {
    const snap = dailySnapshot(storage.db, dir, Date.now(), 7);
    console.log(`Копия: ${snap.path}`);
    storage.db
      .transaction(() => {
        storage.db.exec("DROP TABLE IF EXISTS helper_audit");
        storage.db.exec("DROP TABLE IF EXISTS helper_keys");
        storage.db.prepare("DELETE FROM schema_migrations WHERE version >= 3").run();
      })
      .immediate();
    console.log("Готово: база снова версии 1.24 (схема v2). Остановите проект и запустите образ 1.24.");
  } finally {
    storage.db.close();
  }
} catch (error) {
  console.error(`Ошибка: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}
