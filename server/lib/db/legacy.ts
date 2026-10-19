/**
 * The JSON formats used up to 1.11 (and by the JSON fallback): parsers shared
 * by the stores, the one-time import and scripts/export-json.mjs.
 *
 * Parsers here are strict where the import needs it: a file that is not valid
 * JSON throws (the import is then rolled back and the server keeps using the
 * files) instead of being read as empty.
 */
import { normalizeData } from "../../../src/lib/sync/merge.ts";
import { normalizeUserStates } from "../../../src/lib/sync/world.ts";
import { safeDisplayName, validAttachId } from "../attachments/names.ts";
import type { StoredDoc } from "./doc-tables.ts";

export const LEGACY_DOC = "pora.json";
export const LEGACY_USERS = "users.json";
export const LEGACY_PUSH = "push.json";
export const LEGACY_ATTACH_META = "attachments/meta.json";
export const LEGACY_USAGE = "assistant-usage.json";
export const LEGACY_ASSISTANT_DIR = "assistant";

/** pora.json → StoredDoc (normalized exactly like the 1.11 server read it). Throws SyntaxError when malformed. */
export function parseStoredDoc(text: string): StoredDoc {
  const parsed = JSON.parse(text) as Partial<StoredDoc>;
  const normalized = normalizeData(parsed?.data);
  if (!normalized.ok || typeof parsed.revision !== "number") {
    throw new SyntaxError(`malformed document: ${normalized.ok ? "missing revision" : normalized.error}`);
  }
  const doc: StoredDoc = { revision: parsed.revision, updatedAt: Number(parsed.updatedAt) || 0, data: normalized.data };
  const users = normalizeUserStates(parsed.users);
  if (Object.keys(users).length) doc.users = users;
  return doc;
}

export function serializeStoredDoc(doc: StoredDoc): string {
  return JSON.stringify(doc.users ? { v: 2, ...doc } : doc);
}

/* ---------------------------------- push --------------------------------- */

export type PushKeysLike = { p256dh: string; auth: string };
export type StoredSub = { endpoint: string; keys: PushKeysLike; tz: string; createdAt: number };
export type PushFile = { v: 1; subs: Record<string, StoredSub[]>; sent: Record<string, number> };

export function emptyPushFile(): PushFile {
  return { v: 1, subs: {}, sent: {} };
}

/** Throws on invalid JSON (as 1.11 did). */
export function parsePushFile(raw: string): PushFile {
  const value = JSON.parse(raw) as Partial<PushFile>;
  const out = emptyPushFile();
  if (value && typeof value.subs === "object" && value.subs) {
    for (const [login, list] of Object.entries(value.subs)) {
      if (!Array.isArray(list)) continue;
      const valid = list.filter(
        (s) => s && typeof s.endpoint === "string" && s.keys && typeof s.keys.p256dh === "string" && typeof s.keys.auth === "string",
      );
      // An empty list means the same as no entry (and is what subscribe/unsubscribe leave behind).
      if (valid.length) out.subs[login] = valid;
    }
  }
  if (value && typeof value.sent === "object" && value.sent) {
    for (const [key, at] of Object.entries(value.sent)) if (typeof at === "number") out.sent[key] = at;
  }
  return out;
}

/* ------------------------------- attachments ------------------------------ */

export type AttachParent = { kind: "task" | "project" | "asset"; id: string };

export type AttachMeta = {
  id: string;
  owner: string;
  parent: AttachParent;
  name: string;
  mime: string;
  size: number;
  createdAt: number;
  /** Capture time (EXIF or upload), ms. */
  takenAt?: number;
  /** Cleanup: first seen without task/project (ms). */
  orphanSince?: number | null;
};

export type MetaFile = { v: 1; items: Record<string, AttachMeta> };

export function emptyMeta(): MetaFile {
  return { v: 1, items: {} };
}

/** attachments/meta.json. `strict`: throw on invalid JSON (import) instead of reading it as empty (1.11 runtime). */
export function parseAttachMeta(raw: string, strict = false): MetaFile {
  let value: Partial<MetaFile>;
  try {
    value = JSON.parse(raw) as Partial<MetaFile>;
  } catch (error) {
    if (strict) throw error;
    return emptyMeta();
  }
  const out = emptyMeta();
  if (!value || typeof value.items !== "object" || !value.items) return out;
  for (const [id, item] of Object.entries(value.items)) {
    if (!validAttachId(id) || !item || typeof item !== "object") continue;
    if (typeof item.owner !== "string" || !item.owner) continue;
    if (!item.parent || (item.parent.kind !== "task" && item.parent.kind !== "project" && item.parent.kind !== "asset")) continue;
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
      ...(typeof item.takenAt === "number" ? { takenAt: item.takenAt } : {}),
      ...(typeof item.orphanSince === "number" ? { orphanSince: item.orphanSince } : {}),
    };
  }
  return out;
}

/* -------------------------------- assistant ------------------------------- */

export type UsageFile = { month?: string; tokens?: Record<string, number> };

/** assistant/<key>.json and assistant-usage.json are kept as parsed JSON (the stores normalize on read). */
export function parseJsonObject(raw: string, what: string): Record<string, unknown> {
  const value = JSON.parse(raw) as unknown;
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new SyntaxError(`${what}: not a JSON object`);
  return value as Record<string, unknown>;
}

/** «user1.json» → «user1»; temp files and foreign names are skipped. */
export function assistantKey(fileName: string): string | null {
  if (!fileName.endsWith(".json") || fileName.startsWith(".")) return null;
  const key = fileName.slice(0, -".json".length);
  return /^[a-z0-9_.-]{1,64}$/i.test(key) && !key.includes(".tmp") ? key : null;
}
