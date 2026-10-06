/**
 * Several profiles on one server: the "world" document and per-user views.
 *
 * pora.json (v2) keeps ONE set of entities for everybody (`data`) plus a small
 * state per login (`users[login] = { revision, settings, tombs }`):
 *
 * - every entity has an `owner` (login). Entities without one (everything
 *   created before profiles existed) belong to APP_OWNER — that is the whole
 *   migration, nothing is rewritten;
 * - `members: string[]` shares an entity («Совместная»), `assignee` assigns a
 *   task («Назначить»); a task in a shared list is visible to the list's
 *   members (only if the task's owner can see that list, so nobody can push
 *   tasks into somebody's private list);
 * - a user's view = the entities they may see + their own tombstones and
 *   settings, with their own revision (ETag). The revision only moves when
 *   that view changes;
 * - the server never trusts the client: entities a user may not see are
 *   ignored (and tombstoned in that user's view), `owner` cannot be changed,
 *   new entities belong to the sender, `completedBy`/`updatedBy` are set here;
 * - losing access (unshared, list unshared, removed from members) tombstones
 *   the entity in that user's view; regaining it touches the entity (`aclAt`)
 *   so it beats that tombstone on the user's devices;
 * - deleting: the owner deletes for everyone; a participant leaves (is
 *   removed from members/assignee) — unless they still see the entity through
 *   a shared list, then it is deleted for everyone (shared-list semantics).
 *
 * Pure functions (no I/O) — used by server/lib/sync-store.ts, the restore
 * script and the tests.
 */
import {
  COLLECTIONS,
  TOMBSTONE_TTL_MS,
  editEntity,
  emptyData,
  emptyTombstones,
  mergeEntity,
  pickSettings,
  stableStringify,
  type Collection,
  type SyncData,
  type SyncEntity,
  type SyncSettings,
  type TombstoneMap,
  type Tombstones,
} from "./merge.ts";

export type AclConfig = {
  /** APP_OWNER: owner of entities without `owner`. */
  owner: string;
  /** Configured logins. */
  users: readonly string[];
};

export type UserState = { revision: number; settings: SyncSettings; tombs: Tombstones };

export type WorldDoc = {
  revision: number;
  updatedAt: number;
  data: SyncData;
  users: Record<string, UserState>;
};

export type ViewDoc = { revision: number; updatedAt: number; data: SyncData };

function stampOf(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : 0;
}

function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

export function ownerOf(entity: SyncEntity, cfg: AclConfig): string {
  return typeof entity.owner === "string" && entity.owner ? entity.owner : cfg.owner;
}

export function membersOf(entity: SyncEntity): string[] {
  return strings(entity.members);
}

function assigneeOf(entity: SyncEntity): string | null {
  return typeof entity.assignee === "string" && entity.assignee ? entity.assignee : null;
}

type ListIndex = Map<string, SyncEntity>;

function seesDirectly(entity: SyncEntity, login: string, cfg: AclConfig): boolean {
  return ownerOf(entity, cfg) === login || membersOf(entity).includes(login) || assigneeOf(entity) === login;
}

/** May `login` see this entity? */
export function canSee(collection: Collection, entity: SyncEntity, login: string, cfg: AclConfig, lists: ListIndex): boolean {
  if (seesDirectly(entity, login, cfg)) return true;
  if (collection === "tasks" && typeof entity.listId === "string") {
    const list = lists.get(entity.listId);
    if (list && seesDirectly(list, login, cfg) && seesDirectly(list, ownerOf(entity, cfg), cfg)) return true;
  }
  return false;
}

/** Shared with somebody else than the owner (directly or through its list)? */
export function isShared(collection: Collection, entity: SyncEntity, cfg: AclConfig, lists: ListIndex): boolean {
  const owner = ownerOf(entity, cfg);
  return cfg.users.some((login) => login !== owner && canSee(collection, entity, login, cfg, lists));
}

function listIndex(data: SyncData): ListIndex {
  return new Map(data.lists.map((list) => [list.id, list]));
}

type Visible = Record<Collection, Set<string>>;

function visibleFor(data: SyncData, login: string, cfg: AclConfig, lists = listIndex(data)): Visible {
  const out = {} as Visible;
  for (const key of COLLECTIONS) {
    out[key] = new Set(data[key].filter((item) => canSee(key, item, login, cfg, lists)).map((item) => item.id));
  }
  return out;
}

function cloneTombs(tombs: Tombstones | undefined): Tombstones {
  const out = emptyTombstones();
  if (!tombs) return out;
  for (const key of COLLECTIONS) out[key] = { ...(tombs[key] ?? {}) };
  return out;
}

const DEFAULT_SETTINGS: SyncSettings = { workStart: "09:00", workEnd: "18:00", updatedAt: 0 };

/**
 * Missing user states are created: the owner continues the single-user
 * document (same revision, settings and tombstones, so his devices go on
 * syncing without a hiccup); everybody else starts at revision 1 with an empty
 * view (a fresh phone then takes the server copy instead of uploading demo tasks).
 */
export function ensureUsers(doc: WorldDoc, cfg: AclConfig): WorldDoc {
  const missing = cfg.users.filter((login) => !doc.users[login]);
  if (!missing.length) return doc;
  const users = { ...doc.users };
  for (const login of missing) {
    users[login] =
      login === cfg.owner
        ? { revision: Math.max(1, doc.revision), settings: { ...doc.data.settings }, tombs: cloneTombs(doc.data.tombstones) }
        : { revision: 1, settings: { ...DEFAULT_SETTINGS }, tombs: emptyTombstones() };
  }
  return { ...doc, users };
}

function pruneMap(map: TombstoneMap, cutoff: number): TombstoneMap {
  const out: TombstoneMap = {};
  for (const [id, at] of Object.entries(map)) if (at >= cutoff) out[id] = at;
  return out;
}

function viewData(data: SyncData, state: UserState, login: string, cfg: AclConfig, cutoff: number): SyncData {
  const lists = listIndex(data);
  const out = emptyData();
  for (const key of COLLECTIONS) {
    out[key] = data[key].filter((item) => canSee(key, item, login, cfg, lists));
    out.tombstones[key] = cutoff > 0 ? pruneMap(state.tombs[key] ?? {}, cutoff) : { ...(state.tombs[key] ?? {}) };
  }
  out.settings = state.settings;
  return out;
}

/** What `login` gets from GET /api/sync. */
export function viewFor(doc: WorldDoc, login: string, cfg: AclConfig, now = Date.now()): ViewDoc {
  const world = ensureUsers(doc, cfg);
  const state = world.users[login] ?? { revision: 0, settings: DEFAULT_SETTINGS, tombs: emptyTombstones() };
  return { revision: state.revision, updatedAt: world.updatedAt, data: viewData(world.data, state, login, cfg, now - TOMBSTONE_TTL_MS) };
}

/** New ids go before the item that follows them in the client's order (as in mergeData). */
function placeNew(order: string[], incoming: SyncEntity[], fresh: Set<string>): string[] {
  const out = order.filter((id) => !fresh.has(id));
  for (let index = incoming.length - 1; index >= 0; index--) {
    const id = incoming[index]!.id;
    if (!fresh.has(id) || out.includes(id)) continue;
    let at = out.length;
    for (let next = index + 1; next < incoming.length; next++) {
      const pos = out.indexOf(incoming[next]!.id);
      if (pos >= 0) {
        at = pos;
        break;
      }
    }
    out.splice(at, 0, id);
  }
  return out;
}

/**
 * The sender's order wins for the entities they see (as with one profile, where
 * the pushed order becomes the server order): their slots in the world order
 * are refilled in the client's order; everybody else's entities stay put.
 * Otherwise a device whose order differs would push forever.
 */
function adoptOrder(order: string[], visible: Set<string>, incoming: SyncEntity[]): string[] {
  const slots: number[] = [];
  order.forEach((id, index) => {
    if (visible.has(id)) slots.push(index);
  });
  const seen = new Set<string>();
  const primary: string[] = [];
  for (const item of incoming) {
    if (visible.has(item.id) && !seen.has(item.id)) {
      seen.add(item.id);
      primary.push(item.id);
    }
  }
  const secondary = order.filter((id) => visible.has(id));
  const merged = [...primary];
  for (let index = secondary.length - 1; index >= 0; index--) {
    const id = secondary[index]!;
    if (seen.has(id)) continue;
    seen.add(id);
    let at = merged.length;
    for (let next = index + 1; next < secondary.length; next++) {
      const pos = merged.indexOf(secondary[next]!);
      if (pos >= 0) {
        at = pos;
        break;
      }
    }
    merged.splice(at, 0, id);
  }
  const out = [...order];
  slots.forEach((slot, index) => {
    out[slot] = merged[index]!;
  });
  return out;
}

export type ApplyResult = { doc: WorldDoc; changed: boolean; denied: number };

/**
 * PUT /api/sync from `login`: merge their view into the world under the ACL.
 * (The If-Match revision check happens in the store.)
 */
export function applyPut(docIn: WorldDoc, login: string, incoming: SyncData, cfg: AclConfig, now: number): ApplyResult {
  const cutoff = now - TOMBSTONE_TTL_MS;
  const doc = ensureUsers(docIn, cfg);
  const oldData = doc.data;
  const oldLists = listIndex(oldData);
  const before = new Map(cfg.users.map((user) => [user, visibleFor(oldData, user, cfg, oldLists)]));
  const mine = before.get(login) ?? visibleFor(oldData, login, cfg, oldLists);
  const globalTombs = cloneTombs(oldData.tombstones);
  const users: Record<string, UserState> = {};
  for (const [user, state] of Object.entries(doc.users)) users[user] = { ...state, tombs: cloneTombs(state.tombs) };
  const me = (users[login] ??= { revision: 0, settings: { ...DEFAULT_SETTINGS }, tombs: emptyTombstones() });
  const items = {} as Record<Collection, Map<string, SyncEntity>>;
  const leaving: { key: Collection; id: string; at: number }[] = [];
  let denied = 0;
  const bump = (map: TombstoneMap, id: string, at: number) => {
    if (at > stampOf(map[id])) map[id] = at;
  };

  for (const key of COLLECTIONS) {
    const map = new Map(oldData[key].map((item) => [item.id, item]));
    items[key] = map;
    // 1. Deletions from the client.
    for (const [id, atRaw] of Object.entries(incoming.tombstones[key])) {
      const at = stampOf(atRaw);
      const cur = map.get(id);
      if (!cur) {
        // Already gone (or never known): only this user's view remembers it.
        bump(me.tombs[key], id, Math.max(at, stampOf(globalTombs[key][id])));
        continue;
      }
      if (!mine[key].has(id)) continue; // not theirs: ignore
      if (at < stampOf(cur.updatedAt)) continue; // edited after the deletion: keep
      if (ownerOf(cur, cfg) === login) {
        map.delete(id);
        bump(globalTombs[key], id, at);
      } else {
        // A participant leaves: off members/assignee.
        const patch: Record<string, unknown> = { members: membersOf(cur).filter((user) => user !== login) };
        if (assigneeOf(cur) === login) patch.assignee = null;
        map.set(id, editEntity(cur, patch, Math.max(now, at + 1), key));
        leaving.push({ key, id, at });
      }
    }
    // 2. Entities from the client.
    const fresh = new Set<string>();
    for (const raw of incoming[key]) {
      const deletedHere = incoming.tombstones[key][raw.id];
      if (deletedHere !== undefined && stampOf(raw.updatedAt) <= deletedHere) continue;
      const cur = map.get(raw.id);
      if (cur) {
        if (!mine[key].has(raw.id)) {
          denied++;
          bump(me.tombs[key], raw.id, Math.max(stampOf(raw.updatedAt), 1));
          continue;
        }
        if (leaving.some((entry) => entry.key === key && entry.id === raw.id)) continue;
        const sanitized: SyncEntity = { ...raw };
        if (cur.owner === undefined) delete sanitized.owner;
        else sanitized.owner = cur.owner;
        let merged = mergeEntity(cur, sanitized, key);
        if (stableStringify(merged) === stableStringify(cur)) continue;
        const patch: Record<string, unknown> = {};
        if (key === "tasks") {
          const nowDone = merged.done === true;
          const wasDone = cur.done === true;
          if (nowDone && !wasDone) patch.completedBy = login;
          else if (!nowDone && wasDone) patch.completedBy = null;
          else if (merged.completedBy !== cur.completedBy && merged.completedBy !== null && merged.completedBy !== undefined) {
            // A repeating task was ticked (date moved forward): the client says who; only "me" is accepted.
            patch.completedBy = login;
          }
        }
        if (isShared(key, merged, cfg, oldLists) || isShared(key, cur, cfg, oldLists)) patch.updatedBy = login;
        merged = editEntity(merged, patch, now, key);
        map.set(raw.id, merged);
        continue;
      }
      const deletedAt = globalTombs[key][raw.id];
      if (deletedAt !== undefined && stampOf(raw.updatedAt) <= deletedAt) {
        bump(me.tombs[key], raw.id, deletedAt);
        continue;
      }
      if (deletedAt !== undefined) delete globalTombs[key][raw.id];
      // New entity: it belongs to the sender. Claiming another owner = sharing with them.
      const patch: Record<string, unknown> = { owner: login };
      const claimed = typeof raw.owner === "string" ? raw.owner : "";
      if (claimed && claimed !== login && cfg.users.includes(claimed)) {
        patch.members = [...new Set([...membersOf(raw), claimed])];
      }
      if (key === "tasks" && raw.completedBy !== undefined && raw.completedBy !== null && raw.completedBy !== login) {
        patch.completedBy = raw.done === true ? login : null;
      }
      map.set(raw.id, editEntity(raw, patch, now, key));
      fresh.add(raw.id);
    }
    if (fresh.size) {
      const order = placeNew([...map.keys()], incoming[key], fresh);
      items[key] = new Map(order.map((id) => [id, map.get(id)!]));
    }
  }

  const build = (): SyncData => {
    const data = emptyData();
    for (const key of COLLECTIONS) {
      data[key] = [...items[key].values()];
      data.tombstones[key] = pruneMap(globalTombs[key], cutoff);
    }
    data.settings = oldData.settings;
    return data;
  };

  // A participant who left but still sees the entity through a shared list deletes it for everyone.
  if (leaving.length) {
    const draft = build();
    const lists = listIndex(draft);
    for (const { key, id, at } of leaving) {
      const item = items[key].get(id);
      if (item && canSee(key, item, login, cfg, lists)) {
        items[key].delete(id);
        bump(globalTombs[key], id, Math.max(at, stampOf(item.updatedAt)));
      }
    }
  }

  me.settings = pickSettings(me.settings, incoming.settings);

  // The sender's order for what they see.
  {
    const draft = build();
    const lists = listIndex(draft);
    for (const key of COLLECTIONS) {
      const ids = [...items[key].keys()];
      const visible = new Set(ids.filter((id) => canSee(key, items[key].get(id)!, login, cfg, lists)));
      const order = adoptOrder(ids, visible, incoming[key]);
      if (order.some((id, index) => id !== ids[index])) items[key] = new Map(order.map((id) => [id, items[key].get(id)!]));
    }
  }

  // 3. Access changes → tombstones in views / touch on regained access.
  let data = build();
  let lists = listIndex(data);
  let touched = false;
  for (const user of cfg.users) {
    const state = (users[user] ??= { revision: 1, settings: { ...DEFAULT_SETTINGS }, tombs: emptyTombstones() });
    const was = before.get(user)!;
    const now2 = visibleFor(data, user, cfg, lists);
    for (const key of COLLECTIONS) {
      for (const id of was[key]) {
        if (now2[key].has(id)) continue;
        const item = items[key].get(id);
        bump(state.tombs[key], id, item ? Math.max(now, stampOf(item.updatedAt)) : (globalTombs[key][id] ?? now));
      }
      for (const id of now2[key]) {
        const tomb = state.tombs[key][id];
        if (tomb === undefined) continue;
        delete state.tombs[key][id];
        const item = items[key].get(id)!;
        if (!was[key].has(id) && stampOf(item.updatedAt) <= tomb) {
          items[key].set(id, editEntity(item, { aclAt: Math.max(now, tomb + 1) }, Math.max(now, tomb + 1), key));
          touched = true;
        }
      }
    }
  }
  if (touched) {
    data = build();
    lists = listIndex(data);
  }
  for (const state of Object.values(users)) {
    for (const key of COLLECTIONS) state.tombs[key] = pruneMap(state.tombs[key], cutoff);
  }

  // 4. Revisions: a user's revision moves only when their view changed.
  const next: WorldDoc = { revision: doc.revision, updatedAt: doc.updatedAt, data, users };
  let changed = stableStringify(data) !== stableStringify(oldData);
  for (const user of new Set([...cfg.users, login])) {
    const oldState = doc.users[user];
    const newState = users[user]!;
    const oldView = oldState ? stableStringify(viewData(oldData, oldState, user, cfg, cutoff)) : "";
    const newView = stableStringify(viewData(data, newState, user, cfg, cutoff));
    if (oldView !== newView) {
      newState.revision = (oldState?.revision ?? 0) + 1;
      changed = true;
    }
  }
  if (!changed) return { doc: docIn === doc ? docIn : doc, changed: false, denied };
  next.revision = doc.revision + 1;
  next.updatedAt = Math.max(now, doc.updatedAt + 1);
  return { doc: next, changed: true, denied };
}

/** Normalize the `users` part of a stored document (unknown shapes are dropped). */
export function normalizeUserStates(raw: unknown): Record<string, UserState> {
  const out: Record<string, UserState> = {};
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return out;
  for (const [login, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!/^[a-z0-9_-]{1,32}$/.test(login) || !value || typeof value !== "object") continue;
    const v = value as Record<string, unknown>;
    const settingsRaw = (v.settings && typeof v.settings === "object" ? v.settings : {}) as Record<string, unknown>;
    const time = (x: unknown, d: string) => (typeof x === "string" && /^\d{2}:\d{2}$/.test(x) ? x : d);
    const tombs = emptyTombstones();
    const rawTombs = (v.tombs && typeof v.tombs === "object" ? v.tombs : {}) as Record<string, unknown>;
    for (const key of COLLECTIONS) {
      const map = rawTombs[key];
      if (!map || typeof map !== "object") continue;
      for (const [id, at] of Object.entries(map as Record<string, unknown>)) if (stampOf(at) > 0 && id.length <= 200) tombs[key][id] = stampOf(at);
    }
    out[login] = {
      revision: typeof v.revision === "number" && Number.isSafeInteger(v.revision) && v.revision >= 0 ? v.revision : 0,
      settings: { workStart: time(settingsRaw.workStart, "09:00"), workEnd: time(settingsRaw.workEnd, "18:00"), updatedAt: stampOf(settingsRaw.updatedAt) },
      tombs,
    };
  }
  return out;
}

/** After a server-side restore: restored ids must not stay tombstoned in any view, and every view moves on. */
export function afterRestore(users: Record<string, UserState>, data: SyncData): Record<string, UserState> {
  const out: Record<string, UserState> = {};
  for (const [login, state] of Object.entries(users)) {
    const tombs = cloneTombs(state.tombs);
    for (const key of COLLECTIONS) {
      // Entries removed by --replace: every view drops them too.
      for (const [id, at] of Object.entries(data.tombstones[key])) if (at > stampOf(tombs[key][id])) tombs[key][id] = at;
      for (const item of data[key]) delete tombs[key][item.id];
    }
    out[login] = { ...state, revision: state.revision + 1, tombs };
  }
  return out;
}
