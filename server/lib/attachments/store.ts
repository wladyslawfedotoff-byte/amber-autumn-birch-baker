/**
 * Attachment files on the NAS: `${DATA_DIR}/attachments/files/<id>` plus
 * `${DATA_DIR}/attachments/meta.json` (owner, parent, name, mime, size).
 *
 * Metadata also lives on the synced task/project (`attachments[]`); the
 * server index is the source of truth for ACL and disk cleanup.
 */
import { promises as fs } from "node:fs";
import { randomBytes } from "node:crypto";
import { dirname, join } from "node:path";
import { dataDir } from "../sync-store.ts";
import { resolveInside, safeDisplayName, validAttachId } from "./names.ts";

export type AttachParent = { kind: "task" | "project"; id: string };

export type AttachMeta = {
  id: string;
  owner: string;
  parent: AttachParent;
  name: string;
  mime: string;
  size: number;
  createdAt: number;
};

type MetaFile = { v: 1; items: Record<string, AttachMeta> };

export function emptyMeta(): MetaFile {
  return { v: 1, items: {} };
}

function parse(raw: string): MetaFile {
  try {
    const value = JSON.parse(raw) as Partial<MetaFile>;
    const out = emptyMeta();
    if (!value || typeof value.items !== "object" || !value.items) return out;
    for (const [id, item] of Object.entries(value.items)) {
      if (!validAttachId(id) || !item || typeof item !== "object") continue;
      if (typeof item.owner !== "string" || !item.owner) continue;
      if (!item.parent || (item.parent.kind !== "task" && item.parent.kind !== "project")) continue;
      if (typeof item.parent.id !== "string" || !item.parent.id) continue;
      if (typeof item.mime !== "string" || typeof item.size !== "number") continue;
      out.items[id] = {
        id,
        owner: item.owner,
        parent: { kind: item.parent.kind, id: item.parent.id },
        name: safeDisplayName(item.name),
        mime: item.mime,
        size: item.size,
        createdAt: typeof item.createdAt === "number" ? item.createdAt : 0,
      };
    }
    return out;
  } catch {
    return emptyMeta();
  }
}

export class AttachStore {
  readonly root: string;
  readonly filesDir: string;
  readonly metaPath: string;
  private cache: MetaFile | null = null;
  private chain: Promise<unknown> = Promise.resolve();

  constructor(root: string) {
    this.root = root;
    this.filesDir = join(root, "files");
    this.metaPath = join(root, "meta.json");
  }

  static inDataDir(dir = dataDir()): AttachStore {
    return new AttachStore(join(dir, "attachments"));
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
    return (await this.exclusive(() => this.load())).items[id] ?? null;
  }

  async listFor(parent: AttachParent): Promise<AttachMeta[]> {
    const file = await this.exclusive(() => this.load());
    return Object.values(file.items).filter((item) => item.parent.kind === parent.kind && item.parent.id === parent.id);
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
      };
      const file = structuredClone(await this.load());
      file.items[id] = meta;
      await this.save(file);
      return meta;
    });
  }

  remove(id: string): Promise<AttachMeta | null> {
    return this.exclusive(async () => {
      if (!validAttachId(id)) return null;
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
