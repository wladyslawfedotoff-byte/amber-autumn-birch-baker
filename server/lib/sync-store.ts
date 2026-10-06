/**
 * Server-side document store for sync: one JSON file `${DATA_DIR}/pora.json`.
 *
 * - Writes are serialized through a promise queue (one Node process) and are
 *   atomic: write temp file + fsync + rename.
 * - Every successful change bumps a monotonically increasing `revision` and the
 *   server-clock `updatedAt`.
 * - Optimistic concurrency: `put(baseRevision, data)` returns `conflict` with
 *   the current document when `baseRevision` is stale; the client merges and
 *   retries. On a matching revision the incoming document is still merged into
 *   the stored one (idempotent per-entity merge) so nothing can be lost.
 * - Before replacing the file, a copy is kept in `${DATA_DIR}/backups/`
 *   (at most one per BACKUP_INTERVAL_MINUTES) with tiered retention: the newest
 *   copy of each of the last BACKUP_HOURLY hours and of each of the last
 *   BACKUP_DAILY days (defaults 24 / 30).
 * - Leftover `pora.json.tmp-*` files (a crash or a full disk mid-write) are
 *   removed on startup and after a failed write.
 * - An external change of pora.json (scripts/restore-backup.mjs) is noticed by
 *   its size/mtime/inode and the file is re-read.
 */
import { constants, promises as fs } from "node:fs";
import { randomBytes } from "node:crypto";
import { join } from "node:path";
import {
  TOMBSTONE_TTL_MS,
  emptyData,
  mergeData,
  normalizeData,
  pruneTombstones,
  sameData,
  type SyncData,
} from "../../src/lib/sync/merge.ts";
import { log } from "./log.ts";

export type StoredDoc = { revision: number; updatedAt: number; data: SyncData };
export type PutResult = { status: "ok"; doc: StoredDoc; changed: boolean } | { status: "conflict"; doc: StoredDoc };

export function dataDir(): string {
  return (process.env.DATA_DIR ?? "").trim() || "/data";
}

function envInt(name: string, fallback: number, min: number): number {
  const value = Number.parseInt(process.env[name] ?? "", 10);
  return Number.isFinite(value) && value >= min ? value : fallback;
}

export type StoreOptions = {
  backupHourly?: number;
  backupDaily?: number;
  backupIntervalMs?: number;
  now?: () => number;
};

const BACKUP_NAME = /^pora-(\d{4})-(\d{2})-(\d{2})T(\d{2})-(\d{2})-(\d{2})-(\d{3})Z-r\d+(?:-[a-z-]+)?\.json$/;
const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
const WRITABLE_CACHE_MS = 60_000;

export function backupFileName(time: number, revision: number, suffix = ""): string {
  const stamp = new Date(time).toISOString().replace(/[:.]/g, "-");
  return `pora-${stamp}-r${revision}${suffix ? `-${suffix}` : ""}.json`;
}

/** Backup time from its file name, or null for foreign files. */
export function backupTime(name: string): number | null {
  const match = BACKUP_NAME.exec(name);
  if (!match) return null;
  const [, y, mo, d, h, mi, sec, ms] = match;
  const time = Date.UTC(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi), Number(sec), Number(ms));
  return Number.isFinite(time) ? time : null;
}

/**
 * Tiered retention: keep the newest backup overall, the newest backup of each
 * of the `hourly` most recent hours that have one, and the newest backup of
 * each of the `daily` most recent days (UTC) that have one. Returns the names
 * to delete. Files that are not backups are never touched.
 */
export function backupsToDelete(names: string[], hourly: number, daily: number): string[] {
  const dated = names
    .map((name) => ({ name, time: backupTime(name) }))
    .filter((entry): entry is { name: string; time: number } => entry.time !== null)
    .sort((a, b) => b.time - a.time || (a.name < b.name ? 1 : -1));
  const keep = new Set<string>();
  if (dated[0]) keep.add(dated[0].name);
  const hours = new Set<number>();
  const days = new Set<number>();
  for (const entry of dated) {
    const hour = Math.floor(entry.time / HOUR_MS);
    if (!hours.has(hour) && hours.size < hourly) {
      hours.add(hour);
      keep.add(entry.name);
    }
    const day = Math.floor(entry.time / DAY_MS);
    if (!days.has(day) && days.size < daily) {
      days.add(day);
      keep.add(entry.name);
    }
  }
  return dated.filter((entry) => !keep.has(entry.name)).map((entry) => entry.name);
}

type FileSig = { size: number; mtimeMs: number; ino: number };

function sameSig(a: FileSig | null, b: FileSig | null): boolean {
  return Boolean(a && b && a.size === b.size && a.mtimeMs === b.mtimeMs && a.ino === b.ino);
}

export class SyncStore {
  readonly dir: string;
  readonly file: string;
  readonly backupDir: string;
  private doc: StoredDoc | null = null;
  private queue: Promise<unknown> = Promise.resolve();
  private lastBackupAt = 0;
  private readonly backupHourly: number;
  private readonly backupDaily: number;
  private readonly backupIntervalMs: number;
  private readonly now: () => number;
  private fileSig: FileSig | null = null;
  private cleaned = false;
  private lastWriteFailed = false;
  private writable: { at: number; ok: boolean } | null = null;
  onCorrupt?: (info: { aside: string; backup: string | null; error: unknown }) => void;
  onWarn?: (event: string, fields: Record<string, unknown>, error?: unknown) => void;

  constructor(dir: string, options: StoreOptions = {}) {
    this.dir = dir;
    this.file = join(dir, "pora.json");
    this.backupDir = join(dir, "backups");
    this.backupHourly = options.backupHourly ?? 24;
    this.backupDaily = options.backupDaily ?? 30;
    this.backupIntervalMs = options.backupIntervalMs ?? 30 * 60 * 1000;
    this.now = options.now ?? Date.now;
  }

  private warn(event: string, fields: Record<string, unknown>, error?: unknown): void {
    if (this.onWarn) this.onWarn(event, fields, error);
    else log("warn", event, fields, error);
  }

  private async stat(file: string): Promise<FileSig | null> {
    try {
      const st = await fs.stat(file);
      return { size: st.size, mtimeMs: st.mtimeMs, ino: st.ino };
    } catch {
      return null;
    }
  }

  /** Remove temp files left by an interrupted write (and probes of older versions). */
  async cleanupTempFiles(): Promise<string[]> {
    let names: string[];
    try {
      names = await fs.readdir(this.dir);
    } catch {
      return [];
    }
    const stale = names.filter((name) => name.startsWith("pora.json.tmp-") || name.startsWith(".health-"));
    for (const name of stale) await fs.unlink(join(this.dir, name)).catch(() => undefined);
    if (stale.length) this.warn("data.temp_removed", { count: stale.length });
    return stale;
  }

  private exclusive<T>(task: () => Promise<T>): Promise<T> {
    const run = this.queue.then(task, task);
    this.queue = run.catch(() => undefined);
    return run;
  }

  private async readDoc(file: string): Promise<StoredDoc> {
    const text = await fs.readFile(file, "utf8");
    const parsed = JSON.parse(text) as Partial<StoredDoc>;
    const normalized = normalizeData(parsed?.data);
    if (!normalized.ok || typeof parsed.revision !== "number") {
      throw new SyntaxError(`malformed document: ${normalized.ok ? "missing revision" : normalized.error}`);
    }
    return { revision: parsed.revision, updatedAt: Number(parsed.updatedAt) || 0, data: normalized.data };
  }

  private async load(): Promise<StoredDoc> {
    if (!this.cleaned) {
      this.cleaned = true;
      await this.cleanupTempFiles();
    }
    if (this.doc) {
      const sig = await this.stat(this.file);
      if (!sig || sameSig(sig, this.fileSig)) return this.doc;
      // Changed behind our back (restore script): re-read it.
      try {
        const fresh = await this.readDoc(this.file);
        log("info", "data.reloaded", { revision: fresh.revision, previous: this.doc.revision });
        this.doc = fresh;
        this.fileSig = sig;
        return this.doc;
      } catch (error) {
        this.warn("data.reload_failed", { file: this.file }, error);
        return this.doc;
      }
    }
    try {
      const sig = await this.stat(this.file);
      this.doc = await this.readDoc(this.file);
      this.fileSig = sig;
      return this.doc;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        this.doc = { revision: 0, updatedAt: 0, data: emptyData() };
        return this.doc;
      }
      if (!(error instanceof SyntaxError)) throw error;
      // Broken file: keep it for inspection, fall back to the newest backup.
      const aside = `${this.file}.corrupt-${this.now()}`;
      await fs.rename(this.file, aside).catch(() => undefined);
      const backup = await this.newestBackup();
      let restored: StoredDoc | null = null;
      if (backup) restored = await this.readDoc(backup).catch(() => null);
      this.onCorrupt?.({ aside, backup: restored ? backup : null, error });
      this.doc = restored ?? { revision: 0, updatedAt: 0, data: emptyData() };
      // Bump past anything a client may still hold as its base revision.
      this.doc = { ...this.doc, revision: this.doc.revision + 1000, updatedAt: this.now() };
      await this.write(this.doc, false);
      return this.doc;
    }
  }

  private async newestBackup(): Promise<string | null> {
    try {
      const names = (await fs.readdir(this.backupDir)).filter((name) => name.startsWith("pora-") && name.endsWith(".json"));
      names.sort();
      return names.length ? join(this.backupDir, names[names.length - 1]!) : null;
    } catch {
      return null;
    }
  }

  async get(): Promise<StoredDoc> {
    return this.exclusive(() => this.load());
  }

  async put(baseRevision: number, incoming: SyncData): Promise<PutResult> {
    return this.exclusive(async () => {
      const current = await this.load();
      if (baseRevision !== current.revision) return { status: "conflict", doc: current };
      const now = this.now();
      const cutoff = now - TOMBSTONE_TTL_MS;
      const merged = mergeData(incoming, current.data, { cutoff });
      if (sameData(merged, pruneTombstones(current.data, cutoff))) {
        return { status: "ok", doc: current, changed: false };
      }
      const next: StoredDoc = {
        revision: current.revision + 1,
        updatedAt: Math.max(now, current.updatedAt + 1),
        data: merged,
      };
      await this.write(next, current.revision > 0);
      this.doc = next;
      return { status: "ok", doc: next, changed: true };
    });
  }

  private async write(doc: StoredDoc, hadPrevious: boolean): Promise<void> {
    try {
      await this.writeFile(doc, hadPrevious);
      this.lastWriteFailed = false;
    } catch (error) {
      this.lastWriteFailed = true;
      this.writable = { at: this.now(), ok: false };
      throw error;
    }
  }

  private async writeFile(doc: StoredDoc, hadPrevious: boolean): Promise<void> {
    await fs.mkdir(this.dir, { recursive: true });
    if (hadPrevious) {
      await this.backup().catch((error) => {
        this.warn("backup.failed", { dir: this.backupDir }, error);
      });
    }
    const tmp = `${this.file}.tmp-${process.pid}-${randomBytes(4).toString("hex")}`;
    try {
      const handle = await fs.open(tmp, "w", 0o600);
      try {
        await handle.writeFile(JSON.stringify(doc));
        await handle.sync();
      } finally {
        await handle.close();
      }
      await fs.rename(tmp, this.file);
    } catch (error) {
      // Full disk / permissions: never leave a half-written temp file behind.
      await fs.unlink(tmp).catch(() => undefined);
      throw error;
    }
    this.fileSig = await this.stat(this.file);
    try {
      const dirHandle = await fs.open(this.dir, "r");
      await dirHandle.sync().catch(() => undefined);
      await dirHandle.close();
    } catch {
      // directory fsync is best effort (not supported everywhere)
    }
  }

  private async backup(): Promise<void> {
    const now = this.now();
    if (now - this.lastBackupAt < this.backupIntervalMs) return;
    await fs.mkdir(this.backupDir, { recursive: true });
    const rev = this.doc?.revision ?? 0;
    await fs.copyFile(this.file, join(this.backupDir, backupFileName(now, rev)));
    this.lastBackupAt = now;
    await this.pruneBackups();
  }

  /** Apply the tiered retention to the backups folder. */
  async pruneBackups(): Promise<string[]> {
    const names = await fs.readdir(this.backupDir);
    const doomed = backupsToDelete(names, this.backupHourly, this.backupDaily);
    for (const name of doomed) await fs.unlink(join(this.backupDir, name)).catch(() => undefined);
    return doomed;
  }

  /**
   * True when the data directory accepts writes (used by /api/health). Cheap:
   * no file is created; the answer is cached for a minute and a failed save
   * keeps it false until the next successful one.
   */
  async isWritable(): Promise<boolean> {
    const now = this.now();
    if (this.writable && now - this.writable.at < WRITABLE_CACHE_MS) return this.writable.ok;
    let ok: boolean;
    try {
      await fs.access(this.dir, constants.W_OK);
      ok = !this.lastWriteFailed;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        ok = await fs.mkdir(this.dir, { recursive: true }).then(
          () => true,
          () => false,
        );
      } else {
        ok = false;
      }
    }
    this.writable = { at: now, ok };
    return ok;
  }
}

let store: SyncStore | null = null;

export function getStore(): SyncStore {
  if (!store) {
    store = new SyncStore(dataDir(), {
      backupHourly: envInt("BACKUP_HOURLY", 24, 0),
      backupDaily: envInt("BACKUP_DAILY", 30, 0),
      backupIntervalMs: envInt("BACKUP_INTERVAL_MINUTES", 30, 0) * 60 * 1000,
    });
    store.onCorrupt = ({ aside, backup, error }) => {
      log("error", "data.corrupt", { movedTo: aside, restoredFrom: backup ?? "none (empty document)" }, error);
    };
  }
  return store;
}
