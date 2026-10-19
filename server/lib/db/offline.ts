/**
 * Database access for scripts that run next to the server
 * (`docker exec pora-app node scripts/…`): never imports, never migrates —
 * the server does that at startup. Returns "json" when the data folder is
 * still served from the 1.11 files (no pora.db yet, or its import has not
 * succeeded), so the scripts keep their 1.11 behaviour there.
 */
import { existsSync, statSync } from "node:fs";
import { join } from "node:path";
import { DB_FILE, metaGet, openDb, schemaVersion, type Db } from "./database.ts";
import { META_INITIALIZED } from "./import.ts";
import { SCHEMA_VERSION } from "./schema.ts";

export type ScriptStorage = { mode: "sqlite"; db: Db; file: string } | { mode: "json" };

export function openForScript(dir: string): ScriptStorage {
  const file = join(dir, DB_FILE);
  if (!existsSync(file) || statSync(file).size === 0) return { mode: "json" };
  const db = openDb(file);
  try {
    const version = schemaVersion(db);
    if (version === 0) {
      db.close();
      return { mode: "json" };
    }
    if (version !== SCHEMA_VERSION) {
      throw new Error(`pora.db: схема v${version}, скрипт знает v${SCHEMA_VERSION} — запустите контейнер этой версии (сервер обновит базу сам)`);
    }
    if (metaGet(db, META_INITIALIZED) === null) {
      db.close();
      return { mode: "json" };
    }
    return { mode: "sqlite", db, file };
  } catch (error) {
    try {
      db.close();
    } catch {
      /* already closed */
    }
    throw error;
  }
}
