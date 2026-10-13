/**
 * Browser glue for the per-user local copy (see local-db.ts): which user's
 * partition is active, the storage behind the planner store, small JSON
 * values (outbox, questions for the assistant), cross-tab notifications and
 * the wipe on «Выйти».
 */
import type { StateStorage } from "zustand/middleware";
import { idbKv, localStorageKv, memoryKv, scopeOf, scopedKey, wipeScope, writeQueue, type Kv } from "./local-db";

const ACTIVE_KEY = "pora-active-user";
const LEGACY_META_KEY = "pora-server-sync";
const CHANNEL = "pora-local";

let kv: Kv | null = null;
let queue: ReturnType<typeof writeQueue> | null = null;
let scope = "_";
let channel: BroadcastChannel | null = null;
/** No writes before the saved copy was read: an early write would replace it with the demo seed. */
let loaded = false;
const tabId = Math.random().toString(36).slice(2);

function ls(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

/** The login of this browser's session, written at sign-in (not a secret). */
export function cookieUser(): string | null {
  if (typeof document === "undefined") return null;
  const match = /(?:^|;\s*)pora_user=([^;]*)/.exec(document.cookie);
  if (!match) return null;
  try {
    return decodeURIComponent(match[1]!) || null;
  } catch {
    return null;
  }
}

function backend(): Kv {
  if (kv) return kv;
  if (typeof window === "undefined") kv = memoryKv();
  else if (typeof indexedDB !== "undefined") kv = idbKv();
  else kv = ls() ? localStorageKv(ls()!) : memoryKv();
  queue = writeQueue(kv);
  return kv;
}

function writer(): ReturnType<typeof writeQueue> {
  backend();
  return queue!;
}

export function activeScope(): string {
  return scope;
}

/**
 * Pick the partition before anything is read: the session's user if known,
 * else the last active one. Returns true when it differs from the last
 * active user (another person signed in on this device).
 */
export function initScope(): boolean {
  const last = ls()?.getItem(ACTIVE_KEY) ?? null;
  const user = cookieUser();
  scope = scopeOf(user ?? last);
  ls()?.setItem(ACTIVE_KEY, scope);
  if (typeof BroadcastChannel !== "undefined" && !channel) channel = new BroadcastChannel(CHANNEL);
  return last !== null && last !== scope;
}

/** Switch to another user's partition (the server said who is signed in). */
export function setScope(user: string | null): boolean {
  const next = scopeOf(user);
  if (next === scope) return false;
  scope = next;
  ls()?.setItem(ACTIVE_KEY, scope);
  return true;
}

async function migrateLegacy(name: string): Promise<string | null> {
  const store = ls();
  const legacy = store?.getItem(name) ?? null;
  if (legacy === null) return null;
  // Whose copy is it? The sync meta remembers the login it was synced with.
  let owner: string | null = null;
  try {
    owner = (JSON.parse(store!.getItem(LEGACY_META_KEY) ?? "null") as { login?: string | null } | null)?.login ?? null;
  } catch {
    owner = null;
  }
  const target = owner ? scopeOf(owner) : scope;
  try {
    await backend().set(scopedKey(target, name), legacy);
    store!.removeItem(name);
  } catch {
    return target === scope ? legacy : null;
  }
  return target === scope ? legacy : null;
}

/** zustand persist storage: the active user's partition. */
export const plannerStorage: StateStorage = {
  async getItem(name) {
    try {
      const value = await backend().get(scopedKey(scope, name));
      if (value !== null) return value;
    } catch {
      // fall through to the old copy
    }
    return migrateLegacy(name);
  },
  async setItem(name, value) {
    if (!loaded) return;
    const from = scope;
    await writer().write(scopedKey(from, name), value);
    channel?.postMessage({ type: "saved", name, scope: from, from: tabId });
  },
  async removeItem(name) {
    if (!loaded) return;
    await writer().write(scopedKey(scope, name), null);
    channel?.postMessage({ type: "saved", name, scope, from: tabId });
  },
};

/** Call after the planner was rehydrated from the active partition. */
export function markLoaded(): void {
  loaded = true;
}

/** Is there a saved planner for the active user (else the app shows the demo seed)? */
export async function hasSavedPlanner(name: string): Promise<boolean> {
  try {
    if ((await backend().get(scopedKey(scope, name))) !== null) return true;
  } catch {
    // ignore
  }
  return ls()?.getItem(name) != null;
}

export async function readJson<T>(name: string): Promise<T | null> {
  try {
    const raw = await backend().get(scopedKey(scope, name));
    return raw === null ? null : (JSON.parse(raw) as T);
  } catch {
    return null;
  }
}

export function writeJson(name: string, value: unknown): Promise<void> {
  const target = scopedKey(scope, name);
  const from = scope;
  return writer()
    .write(target, value === null ? null : JSON.stringify(value))
    .then(() => channel?.postMessage({ type: "saved", name, scope: from, from: tabId }));
}

/** Another tab of this user saved `name`. */
export function onOtherTabSaved(listener: (name: string) => void): () => void {
  if (!channel) return () => undefined;
  const handler = (event: MessageEvent) => {
    const data = event.data as { type?: string; name?: string; scope?: string; from?: string };
    if (data?.type === "saved" && data.scope === scope && data.from !== tabId && typeof data.name === "string") listener(data.name);
  };
  channel.addEventListener("message", handler);
  return () => channel?.removeEventListener("message", handler);
}

/** Wait until queued writes reached the disk (before a reload or sign-out). */
export function flushWrites(): Promise<void> {
  return queue?.idle() ?? Promise.resolve();
}

/** Delete a partition that is not the active one (an old copy moved elsewhere). */
export async function dropScope(name: string): Promise<void> {
  if (name === scope) return;
  await flushWrites();
  try {
    await wipeScope(backend(), name);
  } catch {
    // ignore
  }
}

/** «Выйти»: delete this user's copy from the device. */
export async function wipeActiveScope(): Promise<void> {
  // Nothing may be written back after the wipe (the page is about to leave).
  loaded = false;
  await flushWrites();
  try {
    await wipeScope(backend(), scope);
  } catch {
    // ignore
  }
  ls()?.removeItem(ACTIVE_KEY);
}
