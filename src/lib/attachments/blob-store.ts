/**
 * Binary payloads for the offline upload queue. Same IndexedDB as the
 * planner copy (`pora-local` v2), object store «blobs», keys «<user>:<id>».
 *
 * WebKit on iPhone rejects some Blob/File values in IndexedDB («Error
 * preparing Blob/File data…»), so we store an ArrayBuffer + mime instead
 * and rebuild a Blob when reading.
 */
import { scopeOf } from "../offline/local-db";

const DB_NAME = "pora-local";
const STORE = "blobs";
const VERSION = 2;

type Stored = { bytes: ArrayBuffer; mime: string; name?: string };

function request<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains("kv")) db.createObjectStore("kv");
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export type BlobKv = {
  get(key: string): Promise<Blob | null>;
  set(key: string, value: Blob): Promise<void>;
  del(key: string): Promise<void>;
  keys(): Promise<string[]>;
};

let dbPromise: Promise<IDBDatabase> | null = null;

function conn(): Promise<IDBDatabase> {
  dbPromise ??= openDb().then((handle) => {
    handle.onclose = () => {
      dbPromise = null;
    };
    return handle;
  });
  dbPromise.catch(() => {
    dbPromise = null;
  });
  return dbPromise;
}

async function toStored(value: Blob): Promise<Stored> {
  const bytes = await value.arrayBuffer();
  return { bytes, mime: value.type || "application/octet-stream" };
}

function fromStored(value: unknown): Blob | null {
  if (!value) return null;
  if (value instanceof Blob) return value;
  const record = value as Partial<Stored>;
  if (record.bytes instanceof ArrayBuffer) return new Blob([record.bytes], { type: record.mime || "application/octet-stream" });
  return null;
}

export function idbBlobs(): BlobKv {
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
    get: async (key) => fromStored(await run("readonly", (s) => s.get(key))),
    set: async (key, value) => {
      const stored = await toStored(value);
      await run("readwrite", (s) => s.put(stored, key));
    },
    del: async (key) => void (await run("readwrite", (s) => s.delete(key))),
    keys: async () => ((await run("readonly", (s) => s.getAllKeys())) as IDBValidKey[]).map(String),
  };
}

export function memoryBlobs(): BlobKv {
  const map = new Map<string, Blob>();
  return {
    get: async (key) => map.get(key) ?? null,
    set: async (key, value) => void map.set(key, value),
    del: async (key) => void map.delete(key),
    keys: async () => [...map.keys()],
  };
}

export function blobKey(user: string | null | undefined, id: string): string {
  return `${scopeOf(user)}:${id}`;
}

export async function wipeBlobScope(kv: BlobKv, scope: string): Promise<void> {
  const prefix = `${scope}:`;
  for (const key of await kv.keys()) if (key.startsWith(prefix)) await kv.del(key);
}
