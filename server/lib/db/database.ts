/**
 * Opening DATA_DIR/pora.db: WAL journal, foreign keys, busy timeout, full
 * fsync, schema migrations (each in its own transaction, recorded in
 * `schema_migrations`).
 *
 * better-sqlite3 is loaded lazily (createRequire) so a missing or broken native
 * module is reported as a clear startup error instead of a crash on import;
 * storage.ts decides what to do then.
 */
import { chmodSync, closeSync, existsSync, openSync } from "node:fs";
import { createRequire } from "node:module";
import type BetterSqlite3 from "better-sqlite3";
import { MIGRATIONS, SCHEMA_VERSION } from "./schema.ts";

export type Db = BetterSqlite3.Database;

export const DB_FILE = "pora.db";

let ctor: typeof BetterSqlite3 | null = null;

export function loadDriver(): typeof BetterSqlite3 {
  if (!ctor) {
    const require = createRequire(import.meta.url);
    ctor = require("better-sqlite3") as typeof BetterSqlite3;
  }
  return ctor;
}

export function openDb(file: string, options: { readonly?: boolean } = {}): Db {
  const Database = loadDriver();
  if (!options.readonly) restrictMode(file);
  const db = new Database(file, { readonly: options.readonly ?? false, fileMustExist: options.readonly ?? false, timeout: 10_000 });
  try {
    if (!options.readonly) {
      const mode = db.pragma("journal_mode = WAL", { simple: true });
      if (String(mode).toLowerCase() !== "wal") throw new Error(`journal_mode=WAL not accepted (got ${String(mode)})`);
      // Durability over speed: every commit is fsynced (the data set is small).
      db.pragma("synchronous = FULL");
    }
    db.pragma("foreign_keys = ON");
    db.pragma("busy_timeout = 10000");
    db.pragma("trusted_schema = OFF");
  } catch (error) {
    db.close();
    throw error;
  }
  return db;
}

/**
 * The database holds password hashes and push endpoints: owner-only like the
 * 1.11 files (0600). A new file is created with that mode; SQLite gives the
 * -wal/-shm files the mode of the main file.
 */
function restrictMode(file: string): void {
  if (!existsSync(file)) closeSync(openSync(file, "a", 0o600));
  for (const suffix of ["", "-wal", "-shm"]) {
    try {
      chmodSync(file + suffix, 0o600);
    } catch {
      /* missing, or owned by someone else (read by a script) — keep as is */
    }
  }
}

export function schemaVersion(db: Db): number {
  const has = db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'schema_migrations'").get();
  if (!has) return 0;
  const row = db.prepare("SELECT MAX(version) AS v FROM schema_migrations").get() as { v: number | null };
  return row.v ?? 0;
}

/** Apply pending migrations; returns the versions applied now. Refuses a DB from a newer version. */
export function migrate(db: Db, now = Date.now()): number[] {
  db.exec("CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY NOT NULL, name TEXT NOT NULL, applied_at INTEGER NOT NULL)");
  const current = schemaVersion(db);
  if (current > SCHEMA_VERSION) {
    throw new Error(`pora.db has schema v${current}, this version knows v${SCHEMA_VERSION}: start the newer image (a downgrade needs scripts/export-json.mjs, see docs/SYNOLOGY.md)`);
  }
  const applied: number[] = [];
  for (const migration of MIGRATIONS) {
    if (migration.version <= current) continue;
    db.transaction(() => {
      for (const statement of migration.up) db.exec(statement);
      db.prepare("INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)").run(migration.version, migration.name, now);
    }).immediate();
    applied.push(migration.version);
  }
  return applied;
}

export function quickCheck(db: Db): string {
  const rows = db.pragma("quick_check") as { quick_check: string }[];
  return rows.map((row) => row.quick_check).join("; ");
}

export function metaGet(db: Db, key: string): string | null {
  const row = stmt(db, "SELECT value FROM meta WHERE key = ?").get(key) as { value: string } | undefined;
  return row ? row.value : null;
}

export function metaSet(db: Db, key: string, value: string): void {
  stmt(db, "INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(key, value);
}

const statements = new WeakMap<Db, Map<string, BetterSqlite3.Statement>>();

/** Prepared statement cache per connection (SQL text is always a constant; values are bound). */
export function stmt(db: Db, sql: string): BetterSqlite3.Statement {
  let map = statements.get(db);
  if (!map) {
    map = new Map();
    statements.set(db, map);
  }
  let statement = map.get(sql);
  if (!statement) {
    statement = db.prepare(sql);
    map.set(sql, statement);
  }
  return statement;
}
