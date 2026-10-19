/**
 * Push subscriptions and sent reminders: tables push_subscriptions / push_sent
 * of pora.db (1.12.0+), or — JSON fallback and 1.11 — one small JSON file
 * `${DATA_DIR}/push.json`, written atomically (temp file + rename).
 *
 *   { v: 1, subs: { <login>: [{ endpoint, keys, tz, createdAt }] }, sent: { "<login>|<key>": at } }
 *
 * Subscriptions belong to the signed-in user only; a device that is
 * subscribed again under another login is moved to that login.
 */
import { promises as fs } from "node:fs";
import { randomBytes } from "node:crypto";
import { dirname, join } from "node:path";
import { emptyPushFile, parsePushFile, type PushFile, type StoredSub } from "../db/legacy.ts";
import { readPush, writePush } from "../db/records.ts";
import { storageFor, type SqliteStorage } from "../db/storage.ts";

export type { PushFile, StoredSub } from "../db/legacy.ts";
export { emptyPushFile } from "../db/legacy.ts";

export const MAX_SUBS_PER_USER = 10;
const SENT_KEEP_MS = 3 * 24 * 60 * 60 * 1000;

const parse = parsePushFile;

export class PushStore {
  private cache: PushFile | null = null;
  private chain: Promise<unknown> = Promise.resolve();

  readonly file: string;
  private readonly dataDir: string | null;
  private sql: SqliteStorage | null | undefined = undefined;

  /** `dataDir`: serve from that folder's storage (pora.db when active); without it, the JSON file only. */
  constructor(file: string, options: { dataDir?: string } = {}) {
    this.file = file;
    this.dataDir = options.dataDir ?? null;
  }

  static inDir(dir: string): PushStore {
    return new PushStore(join(dir, "push.json"), { dataDir: dir });
  }

  private sqlite(): SqliteStorage | null {
    if (this.sql === undefined) {
      const storage = this.dataDir ? storageFor(this.dataDir) : null;
      this.sql = storage?.mode === "sqlite" ? storage : null;
    }
    return this.sql;
  }

  private async load(): Promise<PushFile> {
    if (this.cache) return this.cache;
    try {
      this.cache = parse(await fs.readFile(this.file, "utf8"));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      this.cache = emptyPushFile();
    }
    return this.cache;
  }

  private async save(file: PushFile): Promise<void> {
    await fs.mkdir(dirname(this.file), { recursive: true });
    const tmp = `${this.file}.${randomBytes(4).toString("hex")}.tmp`;
    await fs.writeFile(tmp, JSON.stringify(file), { mode: 0o600 });
    await fs.rename(tmp, this.file);
    this.cache = file;
  }

  /** Run `fn` alone (no interleaved read-modify-write). */
  private exclusive<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.chain.then(fn, fn);
    this.chain = run.catch(() => undefined);
    return run;
  }

  read(): Promise<PushFile> {
    const sql = this.sqlite();
    if (sql) return this.exclusive(async () => readPush(sql.db));
    return this.exclusive(async () => structuredClone(await this.load()));
  }

  update<T>(fn: (file: PushFile) => T): Promise<T> {
    const sql = this.sqlite();
    if (sql) {
      // Read-modify-write in one transaction.
      return this.exclusive(async () =>
        sql.db
          .transaction(() => {
            const next = readPush(sql.db);
            const result = fn(next);
            writePush(sql.db, next);
            return result;
          })
          .immediate(),
      );
    }
    return this.exclusive(async () => {
      const next = structuredClone(await this.load());
      const result = fn(next);
      await this.save(next);
      return result;
    });
  }

  subscribe(login: string, sub: StoredSub): Promise<void> {
    return this.update((file) => {
      for (const key of Object.keys(file.subs)) {
        file.subs[key] = file.subs[key]!.filter((item) => item.endpoint !== sub.endpoint);
        if (!file.subs[key]!.length) delete file.subs[key];
      }
      const list = [...(file.subs[login] ?? []), sub];
      file.subs[login] = list.slice(-MAX_SUBS_PER_USER);
    });
  }

  unsubscribe(login: string, endpoint: string): Promise<boolean> {
    return this.update((file) => {
      const list = file.subs[login] ?? [];
      const next = list.filter((item) => item.endpoint !== endpoint);
      if (next.length) file.subs[login] = next;
      else delete file.subs[login];
      return next.length !== list.length;
    });
  }

  async subsOf(login: string): Promise<StoredSub[]> {
    return (await this.read()).subs[login] ?? [];
  }

  /** Mark reminders as sent; returns those that were not sent before. */
  claim(login: string, keys: string[], now: number): Promise<string[]> {
    return this.update((file) => {
      const fresh = keys.filter((key) => file.sent[`${login}|${key}`] === undefined);
      for (const key of fresh) file.sent[`${login}|${key}`] = now;
      for (const [key, at] of Object.entries(file.sent)) if (now - at > SENT_KEEP_MS) delete file.sent[key];
      return fresh;
    });
  }

  /** Give a claimed reminder back (delivery failed for a reason worth retrying). */
  release(login: string, key: string): Promise<void> {
    return this.update((file) => {
      delete file.sent[`${login}|${key}`];
    });
  }
}
