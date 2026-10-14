/**
 * This device's copy of the planner, kept per user in IndexedDB:
 *   database «pora-local», store «kv», keys «<user>:<name>».
 * Two profiles on one phone never see each other's copy: the key is chosen
 * from the signed-in user (cookie `pora_user`, set at sign-in) before
 * anything is read, and «Выйти» deletes that user's keys.
 *
 * Without IndexedDB (very old browsers, some private modes) everything falls
 * back to localStorage under the same per-user keys.
 */
export interface Kv {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  del(key: string): Promise<void>;
  keys(): Promise<string[]>;
}

const DB_NAME = "pora-local";
const STORE = "kv";

function request<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

const DB_VERSION = 2;
const BLOBS = "blobs";

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
      if (!db.objectStoreNames.contains(BLOBS)) db.createObjectStore(BLOBS);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
    req.onblocked = () => reject(new Error("blocked"));
  });
}

export function idbKv(): Kv {
  let db: Promise<IDBDatabase> | null = null;
  const conn = () => {
    db ??= openDb().then((handle) => {
      // iOS may close the connection while the app is in the background.
      handle.onclose = () => {
        db = null;
      };
      return handle;
    });
    db.catch(() => {
      db = null;
    });
    return db;
  };
  const run = async <T>(mode: IDBTransactionMode, fn: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> => {
    const handle = await conn();
    const tx = handle.transaction(STORE, mode);
    const result = request(fn(tx.objectStore(STORE)));
    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error ?? new Error("aborted"));
    });
    return result;
  };
  return {
    get: async (key) => ((await run("readonly", (s) => s.get(key))) as string | undefined) ?? null,
    set: async (key, value) => void (await run("readwrite", (s) => s.put(value, key))),
    del: async (key) => void (await run("readwrite", (s) => s.delete(key))),
    keys: async () => ((await run("readonly", (s) => s.getAllKeys())) as IDBValidKey[]).map(String),
  };
}

export function localStorageKv(store: Storage): Kv {
  const PREFIX = "pora-local:";
  return {
    get: async (key) => store.getItem(PREFIX + key),
    set: async (key, value) => store.setItem(PREFIX + key, value),
    del: async (key) => store.removeItem(PREFIX + key),
    keys: async () => Object.keys(store).filter((k) => k.startsWith(PREFIX)).map((k) => k.slice(PREFIX.length)),
  };
}

export function memoryKv(): Kv {
  const map = new Map<string, string>();
  return {
    get: async (key) => map.get(key) ?? null,
    set: async (key, value) => void map.set(key, value),
    del: async (key) => void map.delete(key),
    keys: async () => [...map.keys()],
  };
}

/** Partition name of a user: the login, or «_» before anyone is known (one-profile setups). */
export function scopeOf(user: string | null | undefined): string {
  return user && /^[a-z0-9_-]{1,32}$/.test(user) ? user : "_";
}

export function scopedKey(scope: string, name: string): string {
  return `${scope}:${name}`;
}

/** Remove everything of one user. */
export async function wipeScope(kv: Kv, scope: string): Promise<void> {
  const prefix = `${scope}:`;
  for (const key of await kv.keys()) if (key.startsWith(prefix)) await kv.del(key);
}

/** Serialises writes per key and coalesces bursts: only the newest value is written. */
export function writeQueue(kv: Kv): { write: (key: string, value: string | null) => Promise<void>; idle: () => Promise<void> } {
  const pending = new Map<string, string | null>();
  let chain: Promise<void> = Promise.resolve();
  const flush = async () => {
    while (pending.size) {
      const [key, value] = pending.entries().next().value as [string, string | null];
      pending.delete(key);
      try {
        if (value === null) await kv.del(key);
        else await kv.set(key, value);
      } catch {
        // storage full or closed: the next write tries again
      }
    }
  };
  return {
    write(key, value) {
      const fresh = !pending.size;
      pending.set(key, value);
      if (fresh) chain = chain.then(flush);
      return chain;
    },
    idle: () => chain,
  };
}
