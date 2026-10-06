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
 *   (at most one per BACKUP_INTERVAL_MINUTES, newest BACKUP_KEEP kept).
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

export type StoreOptions = { backupKeep?: number; backupIntervalMs?: number; now?: () => number };

export class SyncStore {
  readonly dir: string;
  readonly file: string;
  readonly backupDir: string;
  private doc: StoredDoc | null = null;
  private queue: Promise<unknown> = Promise.resolve();
  private lastBackupAt = 0;
  private readonly backupKeep: number;
  private readonly backupIntervalMs: number;
  private readonly now: () => number;
  onCorrupt?: (info: { aside: string; backup: string | null; error: unknown }) => void;

  constructor(dir: string, options: StoreOptions = {}) {
    this.dir = dir;
    this.file = join(dir, "pora.json");
    this.backupDir = join(dir, "backups");
    this.backupKeep = options.backupKeep ?? 10;
    this.backupIntervalMs = options.backupIntervalMs ?? 30 * 60 * 1000;
    this.now = options.now ?? Date.now;
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
    if (this.doc) return this.doc;
    try {
      this.doc = await this.readDoc(this.file);
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
    await fs.mkdir(this.dir, { recursive: true });
    if (hadPrevious) await this.backup().catch(() => undefined);
    const tmp = `${this.file}.tmp-${process.pid}-${randomBytes(4).toString("hex")}`;
    const handle = await fs.open(tmp, "w", 0o600);
    try {
      await handle.writeFile(JSON.stringify(doc));
      await handle.sync();
    } finally {
      await handle.close();
    }
    try {
      await fs.rename(tmp, this.file);
    } catch (error) {
      await fs.unlink(tmp).catch(() => undefined);
      throw error;
    }
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
    const stamp = new Date(now).toISOString().replace(/[:.]/g, "-");
    const rev = this.doc?.revision ?? 0;
    await fs.copyFile(this.file, join(this.backupDir, `pora-${stamp}-r${rev}.json`));
    this.lastBackupAt = now;
    const names = (await fs.readdir(this.backupDir)).filter((name) => name.startsWith("pora-") && name.endsWith(".json")).sort();
    for (const name of names.slice(0, Math.max(0, names.length - this.backupKeep))) {
      await fs.unlink(join(this.backupDir, name)).catch(() => undefined);
    }
  }

  /** True when the data directory accepts writes (used by /api/health). */
  async isWritable(): Promise<boolean> {
    const probe = join(this.dir, `.health-${process.pid}`);
    try {
      await fs.mkdir(this.dir, { recursive: true });
      await fs.access(this.dir, constants.W_OK);
      await fs.writeFile(probe, String(this.now()));
      await fs.unlink(probe);
      return true;
    } catch {
      return false;
    }
  }
}

let store: SyncStore | null = null;

export function getStore(): SyncStore {
  if (!store) {
    store = new SyncStore(dataDir(), {
      backupKeep: envInt("BACKUP_KEEP", 10, 1),
      backupIntervalMs: envInt("BACKUP_INTERVAL_MINUTES", 30, 0) * 60 * 1000,
    });
    store.onCorrupt = ({ aside, backup, error }) => {
      log("error", "data.corrupt", { movedTo: aside, restoredFrom: backup ?? "none (empty document)" }, error);
    };
  }
  return store;
}
