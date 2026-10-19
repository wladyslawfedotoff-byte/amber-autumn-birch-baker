/**
 * Attachment files on the NAS: `${DATA_DIR}/attachments/files/<id>` plus their
 * metadata (owner, parent, name, mime, size): table `attachments` of pora.db
 * (1.12.0+), or — JSON fallback and 1.11 — `${DATA_DIR}/attachments/meta.json`.
 *
 * Metadata also lives on the synced task/project (`attachments[]`); the
 * server index is the source of truth for ACL and disk cleanup.
 */
import { promises as fs } from "node:fs";
import { randomBytes } from "node:crypto";
import { join } from "node:path";
import { dataDir } from "../sync-store.ts";
import { emptyMeta, parseAttachMeta, type AttachMeta, type AttachParent, type MetaFile } from "../db/legacy.ts";
import { attachmentsOf, deleteAttachment, getAttachment, putAttachment, readAttachments } from "../db/records.ts";
import { storageFor, type SqliteStorage } from "../db/storage.ts";
import { resolveInside, safeDisplayName, validAttachId } from "./names.ts";

export type { AttachMeta, AttachParent } from "../db/legacy.ts";
export { emptyMeta } from "../db/legacy.ts";

function parse(raw: string): MetaFile {
  return parseAttachMeta(raw, false);
}

export class AttachStore {
  readonly root: string;
  readonly filesDir: string;
  readonly metaPath: string;
  private cache: MetaFile | null = null;
  private chain: Promise<unknown> = Promise.resolve();
  private readonly dataDir: string | null;
  private sql: SqliteStorage | null | undefined = undefined;

  /** `dataDir`: metadata from that folder's storage (pora.db when active); without it, meta.json only. */
  constructor(root: string, options: { dataDir?: string } = {}) {
    this.root = root;
    this.filesDir = join(root, "files");
    this.metaPath = join(root, "meta.json");
    this.dataDir = options.dataDir ?? null;
  }

  static inDataDir(dir = dataDir()): AttachStore {
    return new AttachStore(join(dir, "attachments"), { dataDir: dir });
  }

  private sqlite(): SqliteStorage | null {
    if (this.sql === undefined) {
      const storage = this.dataDir ? storageFor(this.dataDir) : null;
      this.sql = storage?.mode === "sqlite" ? storage : null;
    }
    return this.sql;
  }

  private exclusive<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.chain.then(fn, fn);
    this.chain = run.catch(() => undefined);
    return run;
  }

  private async ensure(): Promise<void> {
    await fs.mkdir(this.filesDir, { recursive: true, mode: 0o700 });
  }

  private async load(): Promise<MetaFile> {
    if (this.cache) return this.cache;
    await this.ensure();
    try {
      this.cache = parse(await fs.readFile(this.metaPath, "utf8"));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      this.cache = emptyMeta();
    }
    return this.cache;
  }

  private async save(file: MetaFile): Promise<void> {
    await this.ensure();
    const tmp = `${this.metaPath}.${randomBytes(6).toString("hex")}.tmp`;
    await fs.writeFile(tmp, JSON.stringify(file), { mode: 0o600 });
    await fs.rename(tmp, this.metaPath);
    this.cache = file;
  }

  async get(id: string): Promise<AttachMeta | null> {
    if (!validAttachId(id)) return null;
    const sql = this.sqlite();
    if (sql) return this.exclusive(async () => getAttachment(sql.db, id));
    return (await this.exclusive(() => this.load())).items[id] ?? null;
  }

  async listFor(parent: AttachParent): Promise<AttachMeta[]> {
    const sql = this.sqlite();
    if (sql) return this.exclusive(async () => attachmentsOf(sql.db, parent.kind, parent.id));
    const file = await this.exclusive(() => this.load());
    return Object.values(file.items).filter((item) => item.parent.kind === parent.kind && item.parent.id === parent.id);
  }

  async all(): Promise<AttachMeta[]> {
    const sql = this.sqlite();
    if (sql) return this.exclusive(async () => Object.values(readAttachments(sql.db).items));
    return Object.values((await this.exclusive(() => this.load())).items);
  }

  setOrphanSince(id: string, at: number | null): Promise<void> {
    const sql = this.sqlite();
    if (sql) {
      return this.exclusive(async () => {
        sql.db
          .transaction(() => {
            const meta = getAttachment(sql.db, id);
            if (!meta) return;
            if (at === null) delete meta.orphanSince;
            else meta.orphanSince = at;
            putAttachment(sql.db, meta);
          })
          .immediate();
      });
    }
    return this.exclusive(async () => {
      const file = structuredClone(await this.load());
      const meta = file.items[id];
      if (!meta) return;
      if (at === null) delete meta.orphanSince;
      else meta.orphanSince = at;
      await this.save(file);
    });
  }

  filePath(id: string): string | null {
    return resolveInside(this.filesDir, id);
  }

  /**
   * Write bytes under a new id. Caller must have already checked size/mime
   * and ACL on the parent. Returns the stored meta.
   */
  put(input: {
    owner: string;
    parent: AttachParent;
    name: string;
    mime: string;
    bytes: Uint8Array;
    id?: string;
    now?: number;
    takenAt?: number;
  }): Promise<AttachMeta> {
    return this.exclusive(async () => {
      await this.ensure();
      const id = input.id && validAttachId(input.id) ? input.id : randomBytes(16).toString("hex");
      const path = this.filePath(id);
      if (!path) throw new Error("bad_id");
      const tmp = `${path}.${randomBytes(4).toString("hex")}.tmp`;
      await fs.writeFile(tmp, input.bytes, { mode: 0o600 });
      await fs.rename(tmp, path);
      const meta: AttachMeta = {
        id,
        owner: input.owner,
        parent: input.parent,
        name: safeDisplayName(input.name),
        mime: input.mime,
        size: input.bytes.byteLength,
        createdAt: input.now ?? Date.now(),
        ...(typeof input.takenAt === "number" && Number.isFinite(input.takenAt) ? { takenAt: input.takenAt } : {}),
      };
      const sql = this.sqlite();
      if (sql) {
        putAttachment(sql.db, meta);
        return meta;
      }
      const file = structuredClone(await this.load());
      file.items[id] = meta;
      await this.save(file);
      return meta;
    });
  }

  remove(id: string): Promise<AttachMeta | null> {
    return this.exclusive(async () => {
      if (!validAttachId(id)) return null;
      const sql = this.sqlite();
      if (sql) {
        const meta = getAttachment(sql.db, id);
        if (!meta) return null;
        deleteAttachment(sql.db, id);
        const path = this.filePath(id);
        if (path) await fs.unlink(path).catch(() => undefined);
        return meta;
      }
      const file = structuredClone(await this.load());
      const meta = file.items[id] ?? null;
      if (!meta) return null;
      delete file.items[id];
      await this.save(file);
      const path = this.filePath(id);
      if (path) await fs.unlink(path).catch(() => undefined);
      return meta;
    });
  }

  async readBytes(id: string): Promise<Uint8Array | null> {
    const path = this.filePath(id);
    if (!path) return null;
    try {
      return new Uint8Array(await fs.readFile(path));
    } catch {
      return null;
    }
  }
}

let singleton: AttachStore | null = null;

export function attachStore(): AttachStore {
  singleton ??= AttachStore.inDataDir();
  return singleton;
}

/** Tests only. */
export function setAttachStore(store: AttachStore | null): void {
  singleton = store;
}
