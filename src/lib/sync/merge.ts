/**
 * Pure, dependency-free sync document model shared by the browser (src/lib/server-sync.ts)
 * and the Nitro server (server/lib/sync-store.ts).
 *
 * Every entity carries `updatedAt` (ms, missing = 0). Deletions are tombstones
 * (`tombstones[collection][id] = deletedAt`) instead of hard deletes, so a delete
 * on one device is not undone by an older copy on another device.
 *
 * Merge rules (per entity, by id):
 * - fields are merged one by one (see "Field-level metadata" below): concurrent
 *   edits of different fields both survive, the same field → newest stamp
 *   wins, equal stamps → deterministic pick (stable JSON compare) so every
 *   device converges on the same result; habit checks / tags merge as sets and
 *   subtasks by id, each element with its own stamp;
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

/* ------------------------------------------------------------------------- *
 * Field-level metadata
 *
 * An entity edited by this version carries, next to its normal fields:
 *   _b  base stamp: the stamp of every field that has no entry in `_f`
 *   _f  { field: stamp } for fields edited after `_b`
 *   _s  { setField: { element: ±stamp } } for set-like arrays (habit checks,
 *       task tags): positive = present since, negative = removed at
 *   _d  { keyedField: { childId: deletedAt } } for child lists with ids (subtasks)
 * Children of a keyed list (subtasks) carry their own `updatedAt` (and `_b`/
 * `_f` once edited); a child without a stamp has the parent field's stamp.
 * Elements/children a copy does not mention have the field's stamp: present
 * if listed in the array, absent otherwise.
 *
 * A "legacy" entity (no `_b`, or an `updatedAt` newer than all of its
 * metadata because an older app version edited it) is read as if every field,
 * element and child had the stamp `updatedAt`, i.e. exactly the old
 * whole-entity last-writer-wins rule. That keeps old data and old clients
 * working: they still converge, only with coarser conflict resolution.
 * ------------------------------------------------------------------------- */

const META_KEYS = new Set(["id", "updatedAt", "_b", "_f", "_s", "_d"]);

export type EntitySpecial = { sets: readonly string[]; keyed: readonly string[] };
export const NO_SPECIAL: EntitySpecial = { sets: [], keyed: [] };
/**
 * Set-like fields merge per element. `members` (who an item is shared with)
 * exists on every collection; `repeatDates` is the «Выбранные даты» repeat.
 */
export const ENTITY_SPECIAL: Record<Collection, EntitySpecial> = {
  lists: { sets: ["members"], keyed: [] },
  tasks: { sets: ["tags", "repeatDates", "members"], keyed: ["subtasks"] },
  habits: { sets: ["checks", "members"], keyed: [] },
  milestones: { sets: ["members"], keyed: [] },
  projects: { sets: ["members"], keyed: [] },
};

function specialFor(special: EntitySpecial | Collection | undefined): EntitySpecial {
  if (!special) return NO_SPECIAL;
  return typeof special === "string" ? ENTITY_SPECIAL[special] : special;
}

type StampMap = Record<string, number>;
type View = {
  legacy: boolean;
  base: number;
  f: StampMap;
  s: Record<string, StampMap>;
  d: Record<string, StampMap>;
};

function dict<T>(): Record<string, T> {
  return Object.create(null) as Record<string, T>;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function stampMap(value: unknown, signed: boolean): StampMap {
  const out = dict<number>();
  const record = asRecord(value);
  if (!record) return out;
  for (const [key, raw] of Object.entries(record)) {
    if (typeof raw !== "number" || !Number.isFinite(raw) || raw === 0) continue;
    if (!signed && raw < 0) continue;
    out[key] = raw;
  }
  return out;
}

function nestedMaps(value: unknown, signed: boolean): Record<string, StampMap> {
  const out = dict<StampMap>();
  const record = asRecord(value);
  if (!record) return out;
  for (const [key, raw] of Object.entries(record)) out[key] = stampMap(raw, signed);
  return out;
}

function children(value: unknown): SyncEntity[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const out: SyncEntity[] = [];
  for (const item of value) {
    const record = asRecord(item);
    if (!record || typeof record.id !== "string" || seen.has(record.id)) continue;
    seen.add(record.id);
    out.push(record as SyncEntity);
  }
  return out;
}

function elements(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    if (typeof item !== "string" || seen.has(item)) continue;
    seen.add(item);
    out.push(item);
  }
  return out;
}

function legacyView(updatedAt: number): View {
  return { legacy: true, base: updatedAt, f: dict(), s: dict(), d: dict() };
}

function viewOf(entity: SyncEntity, special: EntitySpecial): View {
  const updatedAt = stampOf(entity.updatedAt);
  if (typeof entity._b !== "number" || !asRecord(entity._f)) return legacyView(updatedAt);
  const base = stampOf(entity._b);
  const f = stampMap(entity._f, false);
  const s = nestedMaps(entity._s, true);
  const d = nestedMaps(entity._d, false);
  let max = base;
  for (const stamp of Object.values(f)) max = Math.max(max, stamp);
  for (const map of Object.values(s)) for (const stamp of Object.values(map)) max = Math.max(max, Math.abs(stamp));
  for (const map of Object.values(d)) for (const stamp of Object.values(map)) max = Math.max(max, stamp);
  for (const field of special.keyed) {
    for (const child of children(entity[field])) max = Math.max(max, stampOf(child.updatedAt));
  }
  // An older app version edited the entity: fall back to whole-entity stamps.
  if (updatedAt > max) return legacyView(updatedAt);
  return { legacy: false, base, f, s, d };
}

function fieldStamp(view: View, field: string): number {
  return view.f[field] ?? view.base;
}

/** Copy without sync metadata (also inside array members such as subtasks). */
function stripMeta(entity: SyncEntity, deep = true): SyncEntity {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(entity)) {
    if (key !== "id" && META_KEYS.has(key)) continue;
    if (deep && Array.isArray(value)) {
      out[key] = value.map((item) => {
        const record = asRecord(item);
        return record && typeof record.id === "string" ? stripMeta(record as SyncEntity, false) : item;
      });
    } else {
      out[key] = value;
    }
  }
  return out as SyncEntity;
}

/** Same entity ignoring every sync stamp (`updatedAt`, `_b`, `_f`, `_s`, `_d`, child stamps). */
export function sameIgnoringStamp(a: SyncEntity, b: SyncEntity): boolean {
  return stableStringify(stripMeta(a)) === stableStringify(stripMeta(b));
}

function dataKeys(...records: (Record<string, unknown> | null | undefined)[]): string[] {
  const keys = new Set<string>();
  for (const record of records) {
    if (!record) continue;
    for (const key of Object.keys(record)) if (!META_KEYS.has(key) && key !== "__proto__") keys.add(key);
  }
  return [...keys].sort();
}

function tieValue(a: unknown, b: unknown): unknown {
  // Same stamp, one side lacks the field: the value wins (a field the server
  // filled in, e.g. `owner`, must not be dropped again by a copy without it).
  if (a === undefined || a === null) {
    if (b !== undefined && b !== null) return b;
  } else if (b === undefined || b === null) {
    return a;
  }
  const ja = stableStringify(a);
  const jb = stableStringify(b);
  if (ja !== jb) return ja > jb ? a : b;
  return a === undefined ? b : a;
}

function mergeSet(a: SyncEntity, va: View, b: SyncEntity, vb: View, field: string, fallback: number) {
  const listA = elements(a[field]);
  const listB = elements(b[field]);
  const inA = new Set(listA);
  const inB = new Set(listB);
  const sa = va.s[field] ?? dict<number>();
  const sb = vb.s[field] ?? dict<number>();
  const fa = fieldStamp(va, field);
  const fb = fieldStamp(vb, field);
  // Order must not depend on which side is primary (otherwise two devices
  // would keep pushing their own order): the side with the newest element
  // change leads, the other side's extras follow.
  const rankA = Math.max(fa, ...Object.values(sa).map(Math.abs));
  const rankB = Math.max(fb, ...Object.values(sb).map(Math.abs));
  const aLeads = rankA !== rankB ? rankA > rankB : stableStringify(listA) >= stableStringify(listB);
  const [first, second] = aLeads ? [listA, listB] : [listB, listA];
  const order: string[] = [];
  const seen = new Set<string>();
  for (const el of [...first, ...second, ...[...Object.keys(sa), ...Object.keys(sb)].sort()]) {
    if (seen.has(el)) continue;
    seen.add(el);
    order.push(el);
  }
  const present: string[] = [];
  const stamps = dict<number>();
  for (const el of order) {
    const ta = Math.abs(sa[el] ?? fa);
    const tb = Math.abs(sb[el] ?? fb);
    const pa = inA.has(el);
    const pb = inB.has(el);
    const on = ta > tb ? pa : tb > ta ? pb : pa || pb;
    const stamp = Math.max(ta, tb);
    if (on) present.push(el);
    if (stamp !== fallback && stamp > 0) stamps[el] = on ? stamp : -stamp;
  }
  return { value: present, stamps };
}

function liftChild(child: SyncEntity, view: View, field: string): SyncEntity {
  if (view.legacy) return { ...stripMeta(child, false), updatedAt: view.base };
  return child.updatedAt === undefined ? { ...child, updatedAt: fieldStamp(view, field) } : child;
}

function orderIds(primary: string[], secondary: string[]): string[] {
  const order = [...primary];
  const seen = new Set(primary);
  for (let index = secondary.length - 1; index >= 0; index--) {
    const id = secondary[index]!;
    if (seen.has(id)) continue;
    seen.add(id);
    let at = order.length;
    for (let next = index + 1; next < secondary.length; next++) {
      const pos = order.indexOf(secondary[next]!);
      if (pos >= 0) {
        at = pos;
        break;
      }
    }
    order.splice(at, 0, id);
  }
  return order;
}

function compactChild(child: SyncEntity, fallback: number): { child: SyncEntity; explicit: boolean } {
  if (typeof child._b !== "number" && stampOf(child.updatedAt) === fallback) {
    const { updatedAt: _drop, ...rest } = child;
    return { child: rest as SyncEntity, explicit: false };
  }
  return { child, explicit: true };
}

function mergeKeyed(a: SyncEntity, va: View, b: SyncEntity, vb: View, field: string, fallback: number) {
  const listA = children(a[field]);
  const listB = children(b[field]);
  const byA = new Map(listA.map((child) => [child.id, liftChild(child, va, field)]));
  const byB = new Map(listB.map((child) => [child.id, liftChild(child, vb, field)]));
  const da = va.d[field] ?? dict<number>();
  const db = vb.d[field] ?? dict<number>();
  const fa = fieldStamp(va, field);
  const fb = fieldStamp(vb, field);
  const idsA = listA.map((child) => child.id);
  const idsB = listB.map((child) => child.id);
  const rank = (list: SyncEntity[], view: View, field: string) =>
    Math.max(fieldStamp(view, field), ...Object.values(view.d[field] ?? {}), ...list.map((child) => (view.legacy ? 0 : stampOf(child.updatedAt))));
  const rankA = rank(listA, va, field);
  const rankB = rank(listB, vb, field);
  const aLeads = rankA !== rankB ? rankA > rankB : stableStringify(idsA) >= stableStringify(idsB);
  const ids = aLeads ? orderIds(idsA, idsB) : orderIds(idsB, idsA);
  for (const id of [...Object.keys(da), ...Object.keys(db)].sort()) if (!ids.includes(id)) ids.push(id);
  const value: SyncEntity[] = [];
  const tombs = dict<number>();
  let explicit = false;
  for (const id of ids) {
    const ca = byA.get(id);
    const cb = byB.get(id);
    const delA = da[id] ?? (ca ? 0 : fa);
    const delB = db[id] ?? (cb ? 0 : fb);
    const deletedAt = Math.max(delA, delB);
    const merged = ca && cb ? mergeEntity(ca, cb, NO_SPECIAL) : (ca ?? cb);
    if (merged && stampOf(merged.updatedAt) > deletedAt) {
      const compact = compactChild(merged, fallback);
      explicit ||= compact.explicit;
      value.push(compact.child);
    } else if (deletedAt > 0 && deletedAt !== fallback) {
      tombs[id] = deletedAt;
    }
  }
  return { value, tombs, explicit };
}

/**
 * Merge two copies of the same entity field by field. Commutative (also the
 * order of set elements and children does not depend on the argument order).
 */
export function mergeEntity(a: SyncEntity, b: SyncEntity, specialArg?: EntitySpecial | Collection): SyncEntity {
  if (a === b) return a;
  if (stableStringify(a) === stableStringify(b)) return a;
  const special = specialFor(specialArg);
  const va = viewOf(a, special);
  const vb = viewOf(b, special);
  const base = Math.max(va.base, vb.base);
  const out: Record<string, unknown> = { id: a.id };
  const f = dict<number>();
  const s = dict<StampMap>();
  const d = dict<StampMap>();
  let explicitChildren = false;
  for (const key of dataKeys(a, b, va.f, vb.f)) {
    const ta = fieldStamp(va, key);
    const tb = fieldStamp(vb, key);
    const stamp = Math.max(ta, tb);
    if (special.sets.includes(key)) {
      const merged = mergeSet(a, va, b, vb, key, stamp);
      out[key] = merged.value;
      if (Object.keys(merged.stamps).length) s[key] = merged.stamps;
    } else if (special.keyed.includes(key)) {
      const merged = mergeKeyed(a, va, b, vb, key, stamp);
      out[key] = merged.value;
      explicitChildren ||= merged.explicit;
      if (Object.keys(merged.tombs).length) d[key] = merged.tombs;
    } else {
      const value = ta > tb ? a[key] : tb > ta ? b[key] : tieValue(a[key], b[key]);
      if (value !== undefined) out[key] = value;
    }
    if (stamp !== base) f[key] = stamp;
  }
  const updatedAt = Math.max(stampOf(a.updatedAt), stampOf(b.updatedAt), base);
  const plain = !Object.keys(f).length && !Object.keys(s).length && !Object.keys(d).length && !explicitChildren;
  if (plain && base === updatedAt) {
    if (updatedAt > 0) out.updatedAt = updatedAt;
    return out as SyncEntity;
  }
  out.updatedAt = updatedAt;
  out._b = base;
  out._f = f;
  if (Object.keys(s).length) out._s = s;
  if (Object.keys(d).length) out._d = d;
  return out as SyncEntity;
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
function mergeOrdered(primary: SyncEntity[], secondary: SyncEntity[], special: EntitySpecial): SyncEntity[] {
  const winners = new Map<string, SyncEntity>();
  for (const item of secondary) winners.set(item.id, item);
  const order: string[] = [];
  const seen = new Set<string>();
  for (const item of primary) {
    if (seen.has(item.id)) continue;
    seen.add(item.id);
    order.push(item.id);
    const other = winners.get(item.id);
    winners.set(item.id, other ? mergeEntity(item, other, special) : item);
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
  special?: EntitySpecial | Collection,
): { items: SyncEntity[]; tombs: TombstoneMap } {
  const tombs = mergeTombs(primaryTombs, secondaryTombs);
  const items: SyncEntity[] = [];
  for (const item of mergeOrdered(primary, secondary, specialFor(special))) {
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

export function pickSettings(a: SyncSettings, b: SyncSettings): SyncSettings {
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
    const merged = mergeCollection(primary[key], secondary[key], primary.tombstones[key], secondary.tombstones[key], cutoff, key);
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
 * Long offline: a device that has not synced for longer than the tombstone TTL
 * may still hold entities that were deleted elsewhere and whose tombstones the
 * server has already pruned. Drop local entities the server does not know at
 * all (neither as item nor as tombstone) when they were last modified before
 * the server's cutoff AND before this device's last clean sync
 * (`syncedThrough`, server time) — i.e. the device had already delivered them,
 * so their absence on the server means "deleted". Entities created or edited
 * offline after the last sync are kept and pushed. Without `syncedThrough`
 * (first sync of a device) nothing is dropped.
 */
export function dropStaleItems(local: SyncData, remote: SyncData, cutoff: number, syncedThrough: number | null | undefined): SyncData {
  if (!syncedThrough || cutoff <= 0) return local;
  let changed = false;
  const out: SyncData = { ...local };
  for (const key of COLLECTIONS) {
    const known = new Set(remote[key].map((item) => item.id));
    const tombs = remote.tombstones[key];
    const kept = local[key].filter((item) => {
      if (known.has(item.id) || tombs[item.id] !== undefined) return true;
      const stamp = stampOf(item.updatedAt);
      return !(stamp < cutoff && stamp <= syncedThrough);
    });
    if (kept.length !== local[key].length) {
      out[key] = kept;
      changed = true;
    }
  }
  return changed ? out : local;
}

/** Give an entity (and its children) a single fresh stamp: it then beats every older copy everywhere. */
export function restampEntity(entity: SyncEntity, now: number): SyncEntity {
  return { ...stripMeta(entity), updatedAt: now };
}

/** Restamp a whole document (imported/restored data must win against what devices hold). */
export function restampData(data: SyncData, now: number): SyncData {
  const out: SyncData = { ...data, tombstones: emptyTombstones() };
  for (const key of COLLECTIONS) {
    out[key] = data[key].map((item) => restampEntity(item, now));
    out.tombstones[key] = { ...data.tombstones[key] };
  }
  out.settings = { ...data.settings, updatedAt: now };
  return out;
}

export type RestoreOptions = { now: number; replace?: boolean };

/**
 * Server-side restore of a backup into the current document. Every entity of
 * the backup is restamped with `now`, so it wins against the copies devices
 * hold (and anything the backup lacks inside it — a habit check, a subtask —
 * counts as removed at `now`). Tombstones of restored ids are cleared. With
 * `replace`, current entities missing from the backup are tombstoned at `now`
 * (devices then drop them too); otherwise they are kept.
 */
export function restoreDocument(current: SyncData, backup: SyncData, options: RestoreOptions): SyncData {
  const { now } = options;
  const out = emptyData();
  for (const key of COLLECTIONS) {
    const restored = backup[key].map((item) => restampEntity(item, now));
    const ids = new Set(restored.map((item) => item.id));
    const tombs: TombstoneMap = {};
    for (const [id, at] of Object.entries(current.tombstones[key])) if (!ids.has(id)) tombs[id] = at;
    const rest: SyncEntity[] = [];
    for (const item of current[key]) {
      if (ids.has(item.id)) continue;
      if (options.replace) tombs[item.id] = Math.max(now, stampOf(item.updatedAt) + 1);
      else rest.push(item);
    }
    out[key] = [...restored, ...rest];
    out.tombstones[key] = tombs;
  }
  out.settings = { ...backup.settings, updatedAt: Math.max(now, stampOf(current.settings.updatedAt) + 1) };
  return out;
}

function changedFields(prev: SyncEntity, next: SyncEntity): string[] {
  return dataKeys(prev, next).filter((key) => stableStringify(prev[key]) !== stableStringify(next[key]));
}

/** Record a local edit of one entity: only what changed gets the new stamp. */
function stampEntity(prev: SyncEntity, next: SyncEntity, stamp: number, special: EntitySpecial): SyncEntity {
  const view = viewOf(prev, special);
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(next)) if (!META_KEYS.has(key) || key === "id") out[key] = value;
  const f = dict<number>();
  for (const [key, value] of Object.entries(view.f)) f[key] = value;
  const s = dict<StampMap>();
  for (const [key, map] of Object.entries(view.s)) s[key] = Object.assign(dict<number>(), map);
  const d = dict<StampMap>();
  for (const [key, map] of Object.entries(view.d)) d[key] = Object.assign(dict<number>(), map);
  for (const key of changedFields(prev, next)) {
    if (special.sets.includes(key)) {
      const before = new Set(elements(prev[key]));
      const after = new Set(elements(next[key]));
      const map = (s[key] ??= dict<number>());
      for (const el of after) if (!before.has(el)) map[el] = stamp;
      for (const el of before) if (!after.has(el)) map[el] = -stamp;
    } else if (special.keyed.includes(key)) {
      const before = new Map(children(prev[key]).map((child) => [child.id, child]));
      const tombs = (d[key] ??= dict<number>());
      const list: SyncEntity[] = [];
      const seen = new Set<string>();
      const nextList = Array.isArray(next[key]) ? (next[key] as unknown[]) : [];
      for (const raw of nextList) {
        const child = asRecord(raw) as SyncEntity | null;
        if (!child || typeof child.id !== "string" || seen.has(child.id)) continue;
        seen.add(child.id);
        delete tombs[child.id];
        const old = before.get(child.id);
        if (!old) {
          list.push({ ...stripMeta(child, false), updatedAt: stamp });
        } else if (old === child || sameIgnoringStamp(old, child)) {
          list.push(view.legacy ? stripMeta(old, false) : old);
        } else {
          const lifted = liftChild(old, view, key);
          list.push(stampEntity(lifted, child, Math.max(stamp, stampOf(lifted.updatedAt) + 1), NO_SPECIAL));
        }
      }
      for (const id of before.keys()) if (!seen.has(id)) tombs[id] = stamp;
      out[key] = list;
    } else {
      f[key] = stamp;
    }
  }
  if (view.legacy) {
    // Child stamps of a legacy entity are not trusted (they all count as `updatedAt`).
    for (const key of special.keyed) {
      if (Array.isArray(out[key]) && !changedFields(prev, next).includes(key)) {
        out[key] = (out[key] as unknown[]).map((item) => {
          const record = asRecord(item);
          return record && typeof record.id === "string" ? stripMeta(record as SyncEntity, false) : item;
        });
      }
    }
  }
  for (const [key, value] of Object.entries(f)) if (value === view.base) delete f[key];
  for (const key of Object.keys(s)) if (!Object.keys(s[key]!).length) delete s[key];
  for (const key of Object.keys(d)) if (!Object.keys(d[key]!).length) delete d[key];
  out.updatedAt = stamp;
  out._b = view.base;
  out._f = f;
  if (Object.keys(s).length) out._s = s;
  if (Object.keys(d).length) out._d = d;
  return out as SyncEntity;
}

/**
 * A server-side edit (sharing bookkeeping, attribution): the changed fields of
 * `patch` get `stamp`, so they beat every copy the devices hold. Fields whose
 * value does not change are ignored; returns `entity` itself when nothing changes.
 */
export function editEntity(entity: SyncEntity, patch: Record<string, unknown>, stamp: number, specialArg?: EntitySpecial | Collection): SyncEntity {
  const changed = Object.keys(patch).filter((key) => !META_KEYS.has(key) && stableStringify(entity[key]) !== stableStringify(patch[key]));
  if (!changed.length) return entity;
  const next: SyncEntity = { ...entity };
  for (const key of changed) {
    if (patch[key] === undefined) delete next[key];
    else next[key] = patch[key];
  }
  return stampEntity(entity, next, Math.max(stamp, stampOf(entity.updatedAt) + 1), specialFor(specialArg));
}

/**
 * Record local changes: changed fields / set elements / subtasks of an entity
 * get the stamp `now` (new entities are stamped as a whole); ids that
 * disappeared become tombstones. `now` is bumped past the entity's previous
 * stamp so a local edit always beats the version it was made on, even if the
 * device clock went backwards.
 */
export function stampCollection<T extends { id: string; updatedAt?: number }>(
  prevItems: readonly T[],
  nextItems: readonly T[],
  prevTombs: TombstoneMap,
  now: number,
  specialArg?: EntitySpecial | Collection,
): { items: T[]; tombs: TombstoneMap } {
  const special = specialFor(specialArg);
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
    if (prev && sameIgnoringStamp(prev as SyncEntity, item as SyncEntity)) return prev;
    const stamp = Math.max(now, stampOf(prev?.updatedAt) + 1);
    if (!prev) return { ...stripMeta(item as unknown as SyncEntity), updatedAt: stamp } as unknown as T;
    return stampEntity(prev as unknown as SyncEntity, item as unknown as SyncEntity, stamp, special) as unknown as T;
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
