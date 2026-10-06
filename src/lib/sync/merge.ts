/**
 * Pure, dependency-free sync document model shared by the browser (src/lib/server-sync.ts)
 * and the Nitro server (server/lib/sync-store.ts).
 *
 * Every entity carries `updatedAt` (ms, missing = 0). Deletions are tombstones
 * (`tombstones[collection][id] = deletedAt`) instead of hard deletes, so a delete
 * on one device is not undone by an older copy on another device.
 *
 * Merge rules (per entity, by id):
 * - the copy with the larger `updatedAt` wins; equal stamps → deterministic pick
 *   (stable JSON compare) so every device converges on the same result;
 * - a tombstone beats any edit with `updatedAt <= deletedAt`; an edit made after
 *   the delete brings the entity back and drops the tombstone;
 * - tombstones older than the cutoff (server time − 30 days) are pruned.
 *
 * Keep this file free of `@/` aliases and runtime imports: node --test loads it
 * directly with --experimental-strip-types.
 */

export const COLLECTIONS = ["lists", "tasks", "habits", "milestones", "projects"] as const;
export type Collection = (typeof COLLECTIONS)[number];

export type SyncEntity = { id: string; updatedAt?: number } & Record<string, unknown>;
export type TombstoneMap = Record<string, number>;
export type Tombstones = Record<Collection, TombstoneMap>;
export type SyncSettings = { workStart: string; workEnd: string; updatedAt: number };

export type SyncData = {
  v: 1;
  lists: SyncEntity[];
  tasks: SyncEntity[];
  habits: SyncEntity[];
  milestones: SyncEntity[];
  projects: SyncEntity[];
  settings: SyncSettings;
  tombstones: Tombstones;
};

export const TOMBSTONE_TTL_MS = 30 * 24 * 60 * 60 * 1000;
export const MAX_ITEMS_PER_COLLECTION = 50_000;
export const MAX_ID_LENGTH = 200;

export function emptyTombstones(): Tombstones {
  return { lists: {}, tasks: {}, habits: {}, milestones: {}, projects: {} };
}

export function emptyData(): SyncData {
  return {
    v: 1,
    lists: [],
    tasks: [],
    habits: [],
    milestones: [],
    projects: [],
    settings: { workStart: "09:00", workEnd: "18:00", updatedAt: 0 },
    tombstones: emptyTombstones(),
  };
}

function stampOf(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : 0;
}

/** JSON.stringify with sorted keys; `undefined` members are skipped like JSON does. */
export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value) ?? "null";
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => (item === undefined ? "null" : stableStringify(item))).join(",")}]`;
  }
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record)
    .filter((key) => record[key] !== undefined)
    .sort();
  return `{${keys.map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`).join(",")}}`;
}

export function sameData(a: SyncData, b: SyncData): boolean {
  return stableStringify(a) === stableStringify(b);
}

/** Same entity ignoring its `updatedAt` stamp. */
export function sameIgnoringStamp(a: SyncEntity, b: SyncEntity): boolean {
  return stableStringify({ ...a, updatedAt: undefined }) === stableStringify({ ...b, updatedAt: undefined });
}

function pickEntity(a: SyncEntity, b: SyncEntity): SyncEntity {
  const ta = stampOf(a.updatedAt);
  const tb = stampOf(b.updatedAt);
  if (ta !== tb) return ta > tb ? a : b;
  if (a === b) return a;
  return stableStringify(a) >= stableStringify(b) ? a : b;
}

function mergeTombs(a: TombstoneMap, b: TombstoneMap): TombstoneMap {
  const out: TombstoneMap = { ...a };
  for (const [id, at] of Object.entries(b)) {
    const stamp = stampOf(at);
    if (stamp > stampOf(out[id])) out[id] = stamp;
  }
  return out;
}

/**
 * Union of two ordered lists. Order follows `primary`; items that exist only in
 * `secondary` are inserted right before the item that follows them in
 * `secondary` (so a task added at the top on the phone also lands at the top on
 * the computer), or appended when nothing follows.
 */
function mergeOrdered(primary: SyncEntity[], secondary: SyncEntity[]): SyncEntity[] {
  const winners = new Map<string, SyncEntity>();
  for (const item of secondary) winners.set(item.id, item);
  const order: string[] = [];
  const seen = new Set<string>();
  for (const item of primary) {
    if (seen.has(item.id)) continue;
    seen.add(item.id);
    order.push(item.id);
    const other = winners.get(item.id);
    winners.set(item.id, other ? pickEntity(item, other) : item);
  }
  for (let index = secondary.length - 1; index >= 0; index--) {
    const item = secondary[index]!;
    if (seen.has(item.id)) continue;
    seen.add(item.id);
    let at = order.length;
    for (let next = index + 1; next < secondary.length; next++) {
      const pos = order.indexOf(secondary[next]!.id);
      if (pos >= 0) {
        at = pos;
        break;
      }
    }
    order.splice(at, 0, item.id);
  }
  return order.map((id) => winners.get(id)!);
}

export function mergeCollection(
  primary: SyncEntity[],
  secondary: SyncEntity[],
  primaryTombs: TombstoneMap,
  secondaryTombs: TombstoneMap,
  cutoff = 0,
): { items: SyncEntity[]; tombs: TombstoneMap } {
  const tombs = mergeTombs(primaryTombs, secondaryTombs);
  const items: SyncEntity[] = [];
  for (const item of mergeOrdered(primary, secondary)) {
    const deletedAt = tombs[item.id];
    if (deletedAt !== undefined) {
      if (stampOf(item.updatedAt) <= deletedAt) continue;
      delete tombs[item.id];
    }
    items.push(item);
  }
  if (cutoff > 0) {
    for (const [id, at] of Object.entries(tombs)) {
      if (at < cutoff) delete tombs[id];
    }
  }
  return { items, tombs };
}

function pickSettings(a: SyncSettings, b: SyncSettings): SyncSettings {
  const ta = stampOf(a.updatedAt);
  const tb = stampOf(b.updatedAt);
  if (ta !== tb) return ta > tb ? a : b;
  return stableStringify(a) >= stableStringify(b) ? a : b;
}

export type MergeOptions = {
  /** Tombstones with deletedAt below this are dropped (server time − TTL). 0 = keep all. */
  cutoff?: number;
};

/** Merge two documents. `primary` decides the ordering of shared items. Commutative in content. */
export function mergeData(primary: SyncData, secondary: SyncData, options: MergeOptions = {}): SyncData {
  const cutoff = options.cutoff ?? 0;
  const out = emptyData();
  for (const key of COLLECTIONS) {
    const merged = mergeCollection(primary[key], secondary[key], primary.tombstones[key], secondary.tombstones[key], cutoff);
    out[key] = merged.items;
    out.tombstones[key] = merged.tombs;
  }
  out.settings = pickSettings(primary.settings, secondary.settings);
  return out;
}

export function pruneTombstones(data: SyncData, cutoff: number): SyncData {
  if (cutoff <= 0) return data;
  const tombstones = emptyTombstones();
  for (const key of COLLECTIONS) {
    for (const [id, at] of Object.entries(data.tombstones[key])) {
      if (at >= cutoff) tombstones[key][id] = at;
    }
  }
  return { ...data, tombstones };
}

/**
 * Record local changes: entities whose object changed (or are new) get
 * `updatedAt = now`; ids that disappeared become tombstones. `now` is bumped
 * past the entity's previous stamp so a local edit always beats the version it
 * was made on, even if the device clock went backwards.
 */
export function stampCollection<T extends { id: string; updatedAt?: number }>(
  prevItems: readonly T[],
  nextItems: readonly T[],
  prevTombs: TombstoneMap,
  now: number,
): { items: T[]; tombs: TombstoneMap } {
  const prevById = new Map(prevItems.map((item) => [item.id, item]));
  const nextIds = new Set<string>();
  let tombsChanged = false;
  const tombs: TombstoneMap = { ...prevTombs };
  const items = nextItems.map((item) => {
    nextIds.add(item.id);
    const prev = prevById.get(item.id);
    if (prev === item) return item;
    if (tombs[item.id] !== undefined) {
      delete tombs[item.id];
      tombsChanged = true;
    }
    if (prev && sameIgnoringStamp(prev as SyncEntity, item as SyncEntity)) {
      return item.updatedAt === prev.updatedAt ? item : { ...item, updatedAt: prev.updatedAt };
    }
    const stamp = Math.max(now, stampOf(prev?.updatedAt) + 1);
    return { ...item, updatedAt: stamp };
  });
  for (const prev of prevItems) {
    if (nextIds.has(prev.id)) continue;
    tombs[prev.id] = Math.max(now, stampOf(prev.updatedAt) + 1);
    tombsChanged = true;
  }
  return { items, tombs: tombsChanged ? tombs : prevTombs };
}

type NormalizeResult = { ok: true; data: SyncData } | { ok: false; error: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isTime(value: unknown): value is string {
  return typeof value === "string" && /^\d{2}:\d{2}$/.test(value);
}

/**
 * Validate a document from the network or a backup file. Accepts the current
 * format and the legacy backup/WebDAV format (`workStart` on the top level, no
 * tombstones). Never throws.
 */
export function normalizeData(raw: unknown): NormalizeResult {
  if (!isRecord(raw)) return { ok: false, error: "document must be an object" };
  const out = emptyData();
  for (const key of COLLECTIONS) {
    const list = raw[key];
    if (list === undefined) continue;
    if (!Array.isArray(list)) return { ok: false, error: `${key} must be an array` };
    if (list.length > MAX_ITEMS_PER_COLLECTION) return { ok: false, error: `${key} has too many items` };
    const seen = new Set<string>();
    for (const item of list) {
      if (!isRecord(item)) return { ok: false, error: `${key} item must be an object` };
      const id = item.id;
      if (typeof id !== "string" || !id || id.length > MAX_ID_LENGTH) {
        return { ok: false, error: `${key} item has an invalid id` };
      }
      if (seen.has(id)) continue;
      seen.add(id);
      if (item.updatedAt !== undefined && typeof item.updatedAt !== "number") {
        return { ok: false, error: `${key} item has an invalid updatedAt` };
      }
      out[key].push(item as SyncEntity);
    }
  }
  if (raw.tasks === undefined && raw.lists === undefined) {
    return { ok: false, error: "document has no tasks or lists" };
  }
  const settings = isRecord(raw.settings) ? raw.settings : raw;
  out.settings = {
    workStart: isTime(settings.workStart) ? settings.workStart : "09:00",
    workEnd: isTime(settings.workEnd) ? settings.workEnd : "18:00",
    updatedAt: isRecord(raw.settings) ? stampOf(raw.settings.updatedAt) : 0,
  };
  if (raw.tombstones !== undefined) {
    if (!isRecord(raw.tombstones)) return { ok: false, error: "tombstones must be an object" };
    for (const key of COLLECTIONS) {
      const map = raw.tombstones[key];
      if (map === undefined) continue;
      if (!isRecord(map)) return { ok: false, error: `tombstones.${key} must be an object` };
      for (const [id, at] of Object.entries(map)) {
        if (!id || id.length > MAX_ID_LENGTH) continue;
        const stamp = stampOf(at);
        if (stamp > 0) out.tombstones[key][id] = stamp;
      }
    }
  }
  return { ok: true, data: out };
}
