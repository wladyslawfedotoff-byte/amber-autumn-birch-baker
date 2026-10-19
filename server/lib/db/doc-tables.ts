/**
 * The sync document (StoredDoc) ↔ tables of pora.db.
 *
 * - readStoredDoc: compose the document exactly as it was written (entity
 *   order, child order, every field and stamp).
 * - DocTables.save: incremental write of the next document inside the
 *   caller's transaction — only entities whose content changed are rewritten
 *   (with their child rows), order changes update `pos`, removed entities are
 *   deleted (children follow via ON DELETE CASCADE).
 * - replaceStoredDoc: full rewrite (first import, restore from a backup).
 *
 * All SQL uses bound parameters; table names come from schema.ts constants.
 */
import { COLLECTIONS, stableStringify, type Collection, type SyncData, type SyncEntity, type SyncSettings, type Tombstones } from "../../../src/lib/sync/merge.ts";
import type { UserState } from "../../../src/lib/sync/world.ts";
import type { Db } from "./database.ts";
import { metaGet, metaSet, stmt } from "./database.ts";
import { CHILD_FIELDS, childTable } from "./schema.ts";

export type StoredDoc = { revision: number; updatedAt: number; data: SyncData; users?: Record<string, UserState> };

export class StaleDbError extends Error {
  constructor(expected: number | null, found: number | null) {
    super(`pora.db changed by another process (expected revision ${expected}, found ${found})`);
    this.name = "StaleDbError";
  }
}

const K_REVISION = "doc.revision";
const K_UPDATED = "doc.updated_at";
const K_SETTINGS = "doc.settings";
const K_HAS_USERS = "doc.has_users";

function json(value: unknown): string {
  // Array holes / undefined elements become null, exactly like JSON.stringify of the whole document.
  return JSON.stringify(value === undefined ? null : value);
}

export function storedRevision(db: Db): number | null {
  const raw = metaGet(db, K_REVISION);
  return raw === null ? null : (JSON.parse(raw) as number);
}

type Split = { doc: string; kids: string[]; children: [string, unknown[]][] };

function splitEntity(collection: Collection, entity: SyncEntity): Split {
  const childFields = CHILD_FIELDS[collection];
  const own: Record<string, unknown> = {};
  const kids: string[] = [];
  const children: [string, unknown[]][] = [];
  for (const key of Object.keys(entity)) {
    const value = entity[key];
    if (childFields.includes(key) && Array.isArray(value)) {
      kids.push(key);
      children.push([key, value]);
    } else {
      own[key] = value;
    }
  }
  return { doc: JSON.stringify(own), kids, children };
}

/** Read the whole document; null when the database holds none yet. */
export function readStoredDoc(db: Db): StoredDoc | null {
  const revision = storedRevision(db);
  if (revision === null) return null;
  const updatedAt = JSON.parse(metaGet(db, K_UPDATED) ?? "0") as number;
  const settings = JSON.parse(metaGet(db, K_SETTINGS) ?? "null") as SyncSettings;
  const data = { v: 1, settings } as SyncData;
  for (const collection of COLLECTIONS) {
    const rows = stmt(db, `SELECT id, doc, kids FROM ${collection} ORDER BY pos`).all() as { id: string; doc: string; kids: string }[];
    const items: SyncEntity[] = [];
    const byId = new Map<string, { entity: SyncEntity; kids: string[] }>();
    for (const row of rows) {
      const entity = JSON.parse(row.doc) as SyncEntity;
      const kids = JSON.parse(row.kids) as string[];
      for (const field of kids) entity[field] = [];
      items.push(entity);
      byId.set(row.id, { entity, kids });
    }
    for (const field of CHILD_FIELDS[collection]) {
      const childRows = stmt(db, `SELECT parent_id, value FROM ${childTable(collection, field)} ORDER BY parent_id, pos`).all() as { parent_id: string; value: string }[];
      for (const row of childRows) {
        const parent = byId.get(row.parent_id);
        if (!parent || !parent.kids.includes(field)) throw new Error(`pora.db: orphan row in ${childTable(collection, field)} (${row.parent_id})`);
        (parent.entity[field] as unknown[]).push(JSON.parse(row.value));
      }
    }
    (data as unknown as Record<Collection, SyncEntity[]>)[collection] = items;
  }
  data.tombstones = readTombs(db, "");
  const doc: StoredDoc = { revision, updatedAt, data };
  if (metaGet(db, K_HAS_USERS) === "1") {
    const users: Record<string, UserState> = {};
    const rows = stmt(db, "SELECT login, revision, settings, extra FROM user_states ORDER BY pos").all() as { login: string; revision: number; settings: string; extra: string | null }[];
    for (const row of rows) {
      const extra = row.extra ? (JSON.parse(row.extra) as Record<string, unknown>) : {};
      users[row.login] = { ...extra, revision: row.revision, settings: JSON.parse(row.settings) as SyncSettings, tombs: readTombs(db, row.login) } as UserState;
    }
    doc.users = users;
  }
  // Key order like the JSON backend (revision, updatedAt, data, users).
  const ordered = { v: data.v, lists: data.lists, tasks: data.tasks, habits: data.habits, milestones: data.milestones, projects: data.projects, assets: data.assets, settings: data.settings, tombstones: data.tombstones };
  doc.data = ordered as SyncData;
  return doc;
}

function readTombs(db: Db, scope: string): Tombstones {
  const out = Object.fromEntries(COLLECTIONS.map((c) => [c, {} as Record<string, number>])) as Tombstones;
  const rows = stmt(db, "SELECT collection, id, deleted_at FROM tombstones WHERE scope = ? ORDER BY collection, pos").all(scope) as { collection: string; id: string; deleted_at: number }[];
  for (const row of rows) {
    const map = (out as Record<string, Record<string, number>>)[row.collection];
    if (!map) throw new Error(`pora.db: unknown tombstone collection ${row.collection}`);
    map[row.id] = row.deleted_at;
  }
  return out;
}

type EntitySig = { pos: number; sig: string };

/** Incremental writer; one instance per open database connection. */
export class DocTables {
  private entities = new Map<Collection, Map<string, EntitySig>>();
  private tombs = new Map<string, string>();
  private users = new Map<string, string>();
  private settingsSig = "";
  private primed = false;

  /** Remember what is stored (after a read or a full write). */
  prime(doc: StoredDoc | null): void {
    this.entities.clear();
    this.tombs.clear();
    this.users.clear();
    this.settingsSig = "";
    this.primed = Boolean(doc);
    if (!doc) return;
    for (const collection of COLLECTIONS) {
      const map = new Map<string, EntitySig>();
      doc.data[collection].forEach((entity, pos) => map.set(entity.id, { pos, sig: stableStringify(entity) }));
      this.entities.set(collection, map);
      this.tombs.set(`\u0000|${collection}`, stableStringify(doc.data.tombstones[collection]));
    }
    this.settingsSig = stableStringify(doc.data.settings);
    for (const [login, state] of Object.entries(doc.users ?? {})) {
      this.users.set(login, stableStringify(state));
      for (const collection of COLLECTIONS) this.tombs.set(`${login}|${collection}`, stableStringify(state.tombs[collection]));
    }
  }

  /**
   * Write `next` (call inside a transaction). `expected` is the revision this
   * process believes is stored (null = none); anything else means another
   * process wrote in between → StaleDbError, the transaction rolls back.
   */
  save(db: Db, next: StoredDoc, expected: number | null): void {
    const found = storedRevision(db);
    if (found !== expected) throw new StaleDbError(expected, found);
    if (!this.primed) {
      writeAll(db, next);
      this.prime(next);
      return;
    }
    for (const collection of COLLECTIONS) {
      const known = this.entities.get(collection) ?? new Map<string, EntitySig>();
      const fresh = new Map<string, EntitySig>();
      const upsert = stmt(db, `INSERT INTO ${collection} (id, pos, doc, kids) VALUES (?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET pos = excluded.pos, doc = excluded.doc, kids = excluded.kids`);
      const setPos = stmt(db, `UPDATE ${collection} SET pos = ? WHERE id = ?`);
      next.data[collection].forEach((entity, pos) => {
        const sig = stableStringify(entity);
        const prev = known.get(entity.id);
        if (!prev || prev.sig !== sig) {
          const split = splitEntity(collection, entity);
          upsert.run(entity.id, pos, split.doc, JSON.stringify(split.kids));
          writeChildren(db, collection, entity.id, split, Boolean(prev));
        } else if (prev.pos !== pos) {
          setPos.run(pos, entity.id);
        }
        fresh.set(entity.id, { pos, sig });
      });
      const del = stmt(db, `DELETE FROM ${collection} WHERE id = ?`);
      for (const id of known.keys()) if (!fresh.has(id)) del.run(id);
      this.entities.set(collection, fresh);
      this.saveTombs(db, "", collection, next.data.tombstones[collection]);
    }
    const settingsSig = stableStringify(next.data.settings);
    if (settingsSig !== this.settingsSig) {
      metaSet(db, K_SETTINGS, JSON.stringify(next.data.settings));
      this.settingsSig = settingsSig;
    }
    metaSet(db, K_HAS_USERS, next.users ? "1" : "0");
    const users = next.users ?? {};
    const logins = Object.keys(users);
    logins.forEach((login, pos) => {
      const state = users[login]!;
      const sig = stableStringify(state);
      if (this.users.get(login) !== sig) {
        writeUserState(db, login, state, pos);
        this.users.set(login, sig);
      } else {
        stmt(db, "UPDATE user_states SET pos = ? WHERE login = ? AND pos <> ?").run(pos, login, pos);
      }
      for (const collection of COLLECTIONS) this.saveTombs(db, login, collection, state.tombs[collection]);
    });
    for (const login of [...this.users.keys()]) {
      if (users[login]) continue;
      stmt(db, "DELETE FROM user_states WHERE login = ?").run(login);
      stmt(db, "DELETE FROM tombstones WHERE scope = ?").run(login);
      this.users.delete(login);
      for (const collection of COLLECTIONS) this.tombs.delete(`${login}|${collection}`);
    }
    metaSet(db, K_REVISION, JSON.stringify(next.revision));
    metaSet(db, K_UPDATED, JSON.stringify(next.updatedAt));
  }

  private saveTombs(db: Db, scope: string, collection: Collection, map: Record<string, number>): void {
    const key = `${scope || "\u0000"}|${collection}`;
    const sig = stableStringify(map);
    if (this.tombs.get(key) === sig) return;
    writeTombs(db, scope, collection, map);
    this.tombs.set(key, sig);
  }
}

function writeChildren(db: Db, collection: Collection, parentId: string, split: Split, existed: boolean): void {
  for (const field of CHILD_FIELDS[collection]) {
    const table = childTable(collection, field);
    if (existed) stmt(db, `DELETE FROM ${table} WHERE parent_id = ?`).run(parentId);
    const values = split.children.find(([name]) => name === field)?.[1];
    if (!values?.length) continue;
    const insert = stmt(db, `INSERT INTO ${table} (parent_id, pos, value) VALUES (?, ?, ?)`);
    values.forEach((value, pos) => insert.run(parentId, pos, json(value)));
  }
}

function writeTombs(db: Db, scope: string, collection: Collection, map: Record<string, number>): void {
  stmt(db, "DELETE FROM tombstones WHERE scope = ? AND collection = ?").run(scope, collection);
  const insert = stmt(db, "INSERT INTO tombstones (scope, collection, id, deleted_at, pos) VALUES (?, ?, ?, ?, ?)");
  Object.entries(map ?? {}).forEach(([id, at], pos) => insert.run(scope, collection, id, at, pos));
}

function writeUserState(db: Db, login: string, state: UserState, pos: number): void {
  const { revision, settings, tombs: _tombs, ...rest } = state as UserState & Record<string, unknown>;
  const extra = Object.keys(rest).length ? JSON.stringify(rest) : null;
  stmt(db, 
    "INSERT INTO user_states (login, revision, settings, extra, pos) VALUES (?, ?, ?, ?, ?) ON CONFLICT(login) DO UPDATE SET revision = excluded.revision, settings = excluded.settings, extra = excluded.extra, pos = excluded.pos",
  ).run(login, revision, JSON.stringify(settings), extra, pos);
}

/** Replace everything (inside the caller's transaction). */
export function writeAll(db: Db, doc: StoredDoc): void {
  for (const collection of COLLECTIONS) {
    for (const field of CHILD_FIELDS[collection]) stmt(db, `DELETE FROM ${childTable(collection, field)}`).run();
    stmt(db, `DELETE FROM ${collection}`).run();
  }
  stmt(db, "DELETE FROM tombstones").run();
  stmt(db, "DELETE FROM user_states").run();
  for (const collection of COLLECTIONS) {
    const insert = stmt(db, `INSERT INTO ${collection} (id, pos, doc, kids) VALUES (?, ?, ?, ?)`);
    doc.data[collection].forEach((entity, pos) => {
      const split = splitEntity(collection, entity);
      insert.run(entity.id, pos, split.doc, JSON.stringify(split.kids));
      writeChildren(db, collection, entity.id, split, false);
    });
    writeTombs(db, "", collection, doc.data.tombstones[collection]);
  }
  metaSet(db, K_SETTINGS, JSON.stringify(doc.data.settings));
  metaSet(db, K_HAS_USERS, doc.users ? "1" : "0");
  Object.entries(doc.users ?? {}).forEach(([login, state], pos) => {
    writeUserState(db, login, state, pos);
    for (const collection of COLLECTIONS) writeTombs(db, login, collection, state.tombs[collection]);
  });
  metaSet(db, K_REVISION, JSON.stringify(doc.revision));
  metaSet(db, K_UPDATED, JSON.stringify(doc.updatedAt));
}

/** Full rewrite with the revision guard (restore from a backup, re-import). */
export function replaceStoredDoc(db: Db, doc: StoredDoc): void {
  writeAll(db, doc);
}
