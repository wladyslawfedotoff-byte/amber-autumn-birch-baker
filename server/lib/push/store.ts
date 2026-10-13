/**
 * Push subscriptions and sent reminders: one small JSON file,
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
import type { PushKeys } from "./webpush.ts";

export type StoredSub = { endpoint: string; keys: PushKeys; tz: string; createdAt: number };
export type PushFile = { v: 1; subs: Record<string, StoredSub[]>; sent: Record<string, number> };

export const MAX_SUBS_PER_USER = 10;
const SENT_KEEP_MS = 3 * 24 * 60 * 60 * 1000;

export function emptyPushFile(): PushFile {
  return { v: 1, subs: {}, sent: {} };
}

function parse(raw: string): PushFile {
  const value = JSON.parse(raw) as Partial<PushFile>;
  const out = emptyPushFile();
  if (value && typeof value.subs === "object" && value.subs) {
    for (const [login, list] of Object.entries(value.subs)) {
      if (!Array.isArray(list)) continue;
      out.subs[login] = list.filter(
        (s) => s && typeof s.endpoint === "string" && s.keys && typeof s.keys.p256dh === "string" && typeof s.keys.auth === "string",
      );
    }
  }
  if (value && typeof value.sent === "object" && value.sent) {
    for (const [key, at] of Object.entries(value.sent)) if (typeof at === "number") out.sent[key] = at;
  }
  return out;
}

export class PushStore {
  private cache: PushFile | null = null;
  private chain: Promise<unknown> = Promise.resolve();

  readonly file: string;

  constructor(file: string) {
    this.file = file;
  }

  static inDir(dir: string): PushStore {
    return new PushStore(join(dir, "push.json"));
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
    return this.exclusive(async () => structuredClone(await this.load()));
  }

  update<T>(fn: (file: PushFile) => T): Promise<T> {
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
