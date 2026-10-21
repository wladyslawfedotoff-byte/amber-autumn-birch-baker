/**
 * Which backend serves DATA_DIR: SQLite (pora.db, 1.12.0+) or the 1.11 JSON
 * files. Decided once per process and data folder, synchronously, before the
 * first read:
 *
 *   pora.db exists          → open + migrate + quick_check; any failure is
 *                             FATAL (StorageFatalError): never fall back to
 *                             files that may be stale or already moved away.
 *   pora.db missing         → create it. If that fails (native module, disk)
 *                             → JSON backend, ERROR in the log.
 *   no import done yet      → import the JSON files (import.ts). Verified and
 *                             all-or-nothing; on failure the DB stays empty,
 *                             the JSON backend serves this run and the import
 *                             is retried on the next start.
 *   import done, files left → unchanged since the import (crash before the
 *                             move) → just move them; changed (a rollback to
 *                             1.11 was used meanwhile) → consistent copy of
 *                             the DB to backup/, then re-import them.
 */
import { existsSync, readdirSync, statSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { log } from "../log.ts";
import { DB_FILE, metaGet, metaSet, migrate, openDb, quickCheck, type Db } from "./database.ts";
import { DocTables, readStoredDoc } from "./doc-tables.ts";
import {
  META_INITIALIZED,
  findLegacySources,
  importLegacy,
  importRecords,
  importedAs,
  markMoved,
  moveLegacyFiles,
  type ImportOptions,
  type ImportSummary,
  type LegacySource,
} from "./import.ts";
import { writeSnapshot, snapshotName } from "./snapshot.ts";

export type SqliteStorage = { mode: "sqlite"; dir: string; db: Db; docs: DocTables };
export type JsonStorage = { mode: "json"; dir: string; reason: string };
export type Storage = SqliteStorage | JsonStorage;

export class StorageFatalError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "StorageFatalError";
  }
}

const cache = new Map<string, Storage>();
const forced = new Map<string, "json">();

export type ResolveOptions = { now?: number; importOptions?: ImportOptions };

function fileHasData(path: string): boolean {
  try {
    return statSync(path).size > 0;
  } catch {
    return false;
  }
}

/**
 * Traces of earlier data in a folder that has neither a usable pora.db nor
 * JSON files: moved legacy files, database copies, JSON backups. Starting an
 * empty database there would look like «all tasks gone» — refuse instead.
 */
function earlierData(dir: string): string[] {
  let names: string[] = [];
  try {
    names = readdirSync(dir);
  } catch {
    return [];
  }
  const found = names.filter((name) => name.startsWith("legacy-json-") || name.startsWith("export-json-"));
  for (const [sub, pattern] of [
    ["backup", /^pora-.*\.db$/],
    ["backups", /^pora-.*\.json$/],
  ] as const) {
    try {
      if (readdirSync(join(dir, sub)).some((name) => pattern.test(name))) found.push(`${sub}/`);
    } catch {
      /* no such folder */
    }
  }
  return found;
}

function removeDbFiles(file: string): void {
  for (const suffix of ["", "-wal", "-shm"]) {
    try {
      unlinkSync(file + suffix);
    } catch {
      /* not created */
    }
  }
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function openExisting(file: string): Db {
  const db = openDb(file);
  try {
    const applied = migrate(db);
    if (applied.length) log("info", "storage.migrated", { file, schema: applied.join(",") });
    const check = quickCheck(db);
    if (check !== "ok") throw new Error(`integrity check failed: ${check}`);
    return db;
  } catch (error) {
    db.close();
    throw error;
  }
}

/** Resolve the backend for `dir` (cached). Throws StorageFatalError when it is unsafe to start. */
export function storageFor(dir: string, options: ResolveOptions = {}): Storage {
  const cached = cache.get(dir);
  if (cached) return cached;
  const resolved = resolve(dir, options);
  cache.set(dir, resolved);
  return resolved;
}

function resolve(dir: string, options: ResolveOptions): Storage {
  if (forced.get(dir) === "json") return { mode: "json", dir, reason: "forced (tests)" };
  const now = options.now ?? Date.now();
  const file = join(dir, DB_FILE);
  // A WAL file without a main file is still data: never treat it as «new».
  const existed = fileHasData(file) || existsSync(`${file}-wal`);
  let db: Db;
  if (existed) {
    try {
      db = openExisting(file);
    } catch (error) {
      throw new StorageFatalError(
        `pora.db не открывается: ${errorText(error)}. Сервер не запущен, чтобы не работать с устаревшими данными. Восстановите pora.db из backup/pora-<дата>.db (docs/SYNOLOGY.md, «Откат и восстановление»).`,
        { cause: error },
      );
    }
  } else {
    try {
      db = openExisting(file);
    } catch (error) {
      // Leave no half-created database behind: the next start tries again.
      removeDbFiles(file);
      log("error", "storage.sqlite_unavailable", { file, action: "работаю на JSON-файлах, как 1.11; повторю при следующем запуске" }, error);
      return { mode: "json", dir, reason: `sqlite unavailable: ${errorText(error)}` };
    }
  }
  const docs = new DocTables();
  docs.prime(readStoredDoc(db));
  const storage: SqliteStorage = { mode: "sqlite", dir, db, docs };
  const initialized = metaGet(db, META_INITIALIZED) !== null;
  let sources: LegacySource[];
  try {
    sources = findLegacySources(dir);
  } catch (error) {
    if (!initialized) {
      db.close();
      log("error", "storage.import_failed", { reason: `cannot read legacy files: ${errorText(error)}`, action: "работаю на JSON-файлах; импорт повторится при следующем запуске" }, error);
      return { mode: "json", dir, reason: `legacy files unreadable: ${errorText(error)}` };
    }
    log("error", "storage.legacy_unreadable", { reason: errorText(error), action: "данные из pora.db, старые файлы не тронуты" }, error);
    return storage;
  }
  if (!initialized) {
    if (!sources.length) {
      const traces = earlierData(dir);
      if (traces.length && process.env.PORA_START_EMPTY !== "true") {
        db.close();
        if (!existed) removeDbFiles(file);
        throw new StorageFatalError(
          `в ${dir} нет ни pora.db с данными, ни pora.json, но есть следы прежних данных (${traces.join(", ")}). Сервер не запущен, чтобы не начать с пустой базы. Восстановите pora.db из backup/pora-<дата>.db или верните JSON-файлы из legacy-json-<дата>/ (docs/SYNOLOGY.md, п. 6.2 и 8.4). Начать с пустой базы намеренно: PORA_START_EMPTY=true в .env на один запуск.`,
        );
      }
      metaSet(db, META_INITIALIZED, JSON.stringify({ at: now, source: "fresh" }));
      log("info", "storage.ready", { backend: "sqlite", file, note: "новая база (JSON-файлов не было)" });
      return storage;
    }
    try {
      const result = importLegacy(db, docs, dir, sources, { now, ...options.importOptions });
      logImport("storage.import_ok", file, result);
      finishMove(db, dir, result.importId, result.legacyDir, sources, now);
    } catch (error) {
      db.close();
      log("error", "storage.import_failed", { reason: errorText(error), action: "откат импорта; работаю на JSON-файлах, как 1.11; импорт повторится при следующем запуске" }, error);
      return { mode: "json", dir, reason: `import failed: ${errorText(error)}` };
    }
    log("info", "storage.ready", { backend: "sqlite", file });
    return storage;
  }
  if (sources.length) reconcile(storage, sources, now, options.importOptions);
  log("info", "storage.ready", { backend: "sqlite", file });
  return storage;
}

/** Short lines for Container Manager → «Журнал»: totals, then one line per user. */
function logImport(event: string, file: string, result: { summary: ImportSummary; files: Record<string, string> }): void {
  const count = (name: string) => result.summary.sections[name]?.count;
  log("info", event, {
    file,
    revision: result.summary.revision ?? undefined,
    files: Object.keys(result.files).length,
    lists: count("doc.lists"),
    tasks: count("doc.tasks"),
    habits: count("doc.habits"),
    dates: count("doc.milestones"),
    projects: count("doc.projects"),
    tech: count("doc.assets"),
    profiles: Object.keys(result.summary.sections).filter((k) => k.startsWith("doc.user.")).length || undefined,
    logins: count("users"),
    pushDevices: count("push"),
    attachments: count("attachments"),
    assistant: Object.keys(result.summary.sections).filter((k) => k.startsWith("assistant.")).length || undefined,
    check: "ok",
  });
  for (const [user, counts] of Object.entries(result.summary.perUser)) {
    log("info", "storage.import_user", { user, ...counts });
  }
}

function finishMove(db: Db, dir: string, importId: number, legacyDir: string, sources: LegacySource[], now: number): void {
  const { moved, failed } = moveLegacyFiles(dir, legacyDir, sources, now);
  if (!failed.length) markMoved(db, importId, now);
  if (moved.length) log("info", "storage.legacy_moved", { to: join(dir, legacyDir), files: moved.join(",") });
  for (const item of failed) log("warn", "storage.legacy_move_failed", { file: item.rel, error: item.error, note: "файл уже в pora.db; перенос повторится при следующем запуске" });
}

/** Files left in DATA_DIR after an import (interrupted move, or a rollback to 1.11 in between). */
function reconcile(storage: SqliteStorage, sources: LegacySource[], now: number, importOptions?: ImportOptions): void {
  const { db, dir, docs } = storage;
  const records = importRecords(db);
  const unchanged = new Map<number, LegacySource[]>();
  const changed: LegacySource[] = [];
  for (const source of sources) {
    const record = importedAs(records, source.rel, source.sha);
    if (record) unchanged.set(record.id, [...(unchanged.get(record.id) ?? []), source]);
    else changed.push(source);
  }
  for (const [id, list] of unchanged) {
    const record = records.find((r) => r.id === id)!;
    log("info", "storage.legacy_leftover", { files: list.map((s) => s.rel).join(","), note: "уже импортированы (перенос был прерван) — переношу" });
    finishMove(db, dir, id, record.legacyDir, list, now);
  }
  if (!changed.length) return;
  // JSON files that differ from what was imported: most likely 1.11 ran on
  // restored files for a while. Keep a consistent copy of the current DB first.
  let snapshot: string;
  try {
    snapshot = writeSnapshot(db, dir, snapshotName(now, `before-reimport-${now}`));
  } catch (error) {
    log("error", "storage.reimport_skipped", { files: changed.map((s) => s.rel).join(","), reason: `snapshot failed: ${errorText(error)}`, note: "данные из pora.db, файлы не тронуты" }, error);
    return;
  }
  const current = readStoredDoc(db);
  const bumpFrom = current ? { revision: current.revision, users: Object.fromEntries(Object.entries(current.users ?? {}).map(([l, s]) => [l, s.revision])) } : null;
  try {
    const result = importLegacy(db, docs, dir, changed, { now, bumpFrom, ...importOptions });
    log("warn", "storage.reimported", {
      files: changed.map((s) => s.rel).join(","),
      previousDb: snapshot,
      note: "JSON-файлы изменились после импорта (был откат на 1.11?) — они загружены в pora.db; прежнее содержимое базы сохранено",
    });
    logImport("storage.import_ok", join(dir, "pora.db"), result);
    finishMove(db, dir, result.importId, result.legacyDir, changed, now);
  } catch (error) {
    log("error", "storage.reimport_failed", { files: changed.map((s) => s.rel).join(","), reason: errorText(error), note: "данные из pora.db, файлы не тронуты" }, error);
  }
}

/** Tests: serve `dir` from the JSON files (as 1.11 / the fallback). */
export function forceJsonStorage(dir: string): void {
  forced.set(dir, "json");
}

/** Tests and scripts: close and forget (all dirs when omitted). */
export function closeStorage(dir?: string): void {
  for (const [key, storage] of cache) {
    if (dir && key !== dir) continue;
    if (storage.mode === "sqlite") {
      try {
        storage.db.close();
      } catch {
        /* already closed */
      }
    }
    cache.delete(key);
  }
  if (dir) forced.delete(dir);
}

export function sqliteOf(dir: string): SqliteStorage | null {
  const storage = storageFor(dir);
  return storage.mode === "sqlite" ? storage : null;
}

export function dbFileExists(dir: string): boolean {
  return existsSync(join(dir, DB_FILE));
}
