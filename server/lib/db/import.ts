/**
 * One-time import of the 1.11 JSON files into pora.db, with verification.
 *
 *   1. Every source file is read and parsed strictly (exactly the normalization
 *      the 1.11 server applied when it read the file).
 *   2. In ONE transaction: the sections are written, read back through the
 *      same code the server uses at runtime, and compared with the source —
 *      per section and per user: entity counts and a SHA-256 of the canonical
 *      JSON (and the full canonical text itself). The import record (file
 *      hashes, counts, legacy folder) is written in the same transaction.
 *   3. Any error or difference throws → the transaction is rolled back, the
 *      database stays without data, the server keeps running on the files.
 *   4. Only after the commit are the files moved (never deleted) to
 *      DATA_DIR/legacy-json-<date>/. A crash between commit and move is
 *      harmless: on the next start the files still match the recorded hashes
 *      and are just moved.
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { COLLECTIONS, stableStringify, type SyncEntity } from "../../../src/lib/sync/merge.ts";
import { normalizeUsersFile } from "../../../scripts/users-file.mjs";
import type { Db } from "./database.ts";
import { metaSet, stmt } from "./database.ts";
import { readStoredDoc, writeAll, type DocTables, type StoredDoc } from "./doc-tables.ts";
import {
  LEGACY_ASSISTANT_DIR,
  LEGACY_ATTACH_META,
  LEGACY_DOC,
  LEGACY_PUSH,
  LEGACY_USAGE,
  LEGACY_USERS,
  assistantKey,
  parseAttachMeta,
  parseJsonObject,
  parsePushFile,
  parseStoredDoc,
} from "./legacy.ts";
import { KV_USAGE, allAssistant, readAttachments, readKv, readPush, readUsers, writeAssistant, writeAttachments, writeKv, writePush, writeUsers, type UsersFile } from "./records.ts";
import { localDate } from "./snapshot.ts";

export const META_INITIALIZED = "storage.initialized";

export type LegacySource = { rel: string; path: string; sha: string; text: string; size: number };

export function sha256(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

function readSource(dir: string, rel: string): LegacySource | null {
  const path = join(dir, rel);
  let text: string;
  try {
    if (!statSync(path).isFile()) return null;
    text = readFileSync(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
  return { rel, path, sha: sha256(text), text, size: Buffer.byteLength(text) };
}

/** The 1.11 JSON files present in DATA_DIR. Unreadable files throw (never treated as absent). */
export function findLegacySources(dir: string): LegacySource[] {
  const out: LegacySource[] = [];
  for (const rel of [LEGACY_DOC, LEGACY_USERS, LEGACY_PUSH, LEGACY_ATTACH_META, LEGACY_USAGE]) {
    const source = readSource(dir, rel);
    if (source) out.push(source);
  }
  let names: string[] = [];
  try {
    names = readdirSync(join(dir, LEGACY_ASSISTANT_DIR));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  for (const name of names.sort()) {
    if (!assistantKey(name)) continue;
    const source = readSource(dir, `${LEGACY_ASSISTANT_DIR}/${name}`);
    if (source) out.push(source);
  }
  return out;
}

export type SectionCheck = { count: number; sha: string };
export type ImportSummary = {
  sections: Record<string, SectionCheck>;
  perUser: Record<string, Record<string, number>>;
  revision: number | null;
};

type Parsed =
  | { kind: "doc"; value: StoredDoc }
  | { kind: "users"; value: UsersFile }
  | { kind: "push"; value: ReturnType<typeof parsePushFile> }
  | { kind: "attachments"; value: ReturnType<typeof parseAttachMeta> }
  | { kind: "usage"; value: Record<string, unknown> }
  | { kind: "assistant"; key: string; value: Record<string, unknown> };

function parseSource(source: LegacySource): Parsed {
  const where = source.rel;
  try {
    if (source.rel === LEGACY_DOC) return { kind: "doc", value: parseStoredDoc(source.text) };
    if (source.rel === LEGACY_USERS) return { kind: "users", value: normalizeUsersFile(JSON.parse(source.text)) as UsersFile };
    if (source.rel === LEGACY_PUSH) return { kind: "push", value: parsePushFile(source.text) };
    if (source.rel === LEGACY_ATTACH_META) return { kind: "attachments", value: parseAttachMeta(source.text, true) };
    if (source.rel === LEGACY_USAGE) return { kind: "usage", value: parseJsonObject(source.text, where) };
    const key = assistantKey(source.rel.slice(LEGACY_ASSISTANT_DIR.length + 1));
    if (key) return { kind: "assistant", key, value: parseJsonObject(source.text, where) };
  } catch (error) {
    throw new Error(`${where}: ${error instanceof Error ? error.message : String(error)}`);
  }
  throw new Error(`${where}: unknown legacy file`);
}

function check(value: unknown, count: number): SectionCheck {
  return { count, sha: sha256(stableStringify(value)) };
}

function ownerLabel(entity: SyncEntity): string {
  return typeof entity.owner === "string" && entity.owner ? entity.owner : "(владелец)";
}

/** Counts and hashes per section, per collection and per user (for the comparison and the log). */
export function docChecks(doc: StoredDoc): { sections: Record<string, SectionCheck>; perUser: Record<string, Record<string, number>> } {
  const sections: Record<string, SectionCheck> = {};
  const perUser: Record<string, Record<string, number>> = {};
  for (const collection of COLLECTIONS) {
    sections[`doc.${collection}`] = check(doc.data[collection], doc.data[collection].length);
    sections[`doc.tombstones.${collection}`] = check(doc.data.tombstones[collection], Object.keys(doc.data.tombstones[collection]).length);
    for (const entity of doc.data[collection]) {
      const row = (perUser[ownerLabel(entity)] ??= {});
      row[collection] = (row[collection] ?? 0) + 1;
    }
  }
  sections["doc.settings"] = check(doc.data.settings, 1);
  sections["doc.head"] = check({ revision: doc.revision, updatedAt: doc.updatedAt, hasUsers: Boolean(doc.users) }, 1);
  for (const [login, state] of Object.entries(doc.users ?? {})) {
    sections[`doc.user.${login}`] = check(state, 1);
    const tombs = COLLECTIONS.reduce((sum, c) => sum + Object.keys(state.tombs[c]).length, 0);
    (perUser[login] ??= {}).tombs = tombs;
  }
  for (const login of Object.keys(perUser)) {
    const own = COLLECTIONS.flatMap((c) => doc.data[c].filter((e) => ownerLabel(e) === login));
    sections[`doc.owner.${login}`] = check(own, own.length);
  }
  return { sections, perUser };
}

function compare(label: string, expected: unknown, actual: unknown, count: number, sections: Record<string, SectionCheck>): void {
  const a = stableStringify(expected);
  const b = stableStringify(actual);
  if (a !== b) throw new Error(`verification failed: ${label} differs after writing (source ${sha256(a).slice(0, 12)}, database ${sha256(b).slice(0, 12)})`);
  sections[label] = { count, sha: sha256(a) };
}

export type ImportOptions = {
  now?: number;
  /** Re-import after a rollback period: bump revisions past what 1.12 clients may hold. */
  bumpFrom?: { revision: number; users: Record<string, number> } | null;
  /** Tests: throw after writing, before the commit (simulated crash mid-import). */
  failBeforeCommit?: boolean;
};

export type ImportResult = { summary: ImportSummary; legacyDir: string; files: Record<string, string>; importId: number };

function pickLegacyDir(dir: string, now: number): string {
  const base = `legacy-json-${localDate(now)}`;
  for (let i = 1; i < 1000; i++) {
    const name = i === 1 ? base : `${base}-${i}`;
    if (!existsSync(join(dir, name))) return name;
  }
  throw new Error("no free legacy-json-* folder name");
}

/**
 * Import `sources` (all present 1.11 files, or the changed ones on a
 * re-import) in one verified transaction. Throws on any problem (nothing is
 * written then).
 */
export function importLegacy(db: Db, docs: DocTables, dir: string, sources: LegacySource[], options: ImportOptions = {}): ImportResult {
  const now = options.now ?? Date.now();
  const parsed = sources.map((source) => ({ source, parsed: parseSource(source) }));
  const legacyDir = pickLegacyDir(dir, now);
  const files = Object.fromEntries(sources.map((s) => [s.rel, s.sha]));
  const run = db.transaction((): ImportResult => {
    const sections: Record<string, SectionCheck> = {};
    let perUser: Record<string, Record<string, number>> = {};
    let revision: number | null = null;
    for (const { parsed: item } of parsed) {
      switch (item.kind) {
        case "doc": {
          let doc = item.value;
          if (options.bumpFrom) {
            const users = doc.users
              ? Object.fromEntries(
                  Object.entries(doc.users).map(([login, state]) => [login, { ...state, revision: Math.max(state.revision, options.bumpFrom!.users[login] ?? 0) + 1000 }]),
                )
              : undefined;
            doc = { ...doc, revision: Math.max(doc.revision, options.bumpFrom.revision) + 1000, updatedAt: Math.max(now, doc.updatedAt + 1), ...(users ? { users } : {}) };
          }
          writeAll(db, doc);
          const back = readStoredDoc(db);
          const expected = docChecks(doc);
          const actual = back ? docChecks(back) : null;
          if (!actual) throw new Error("verification failed: document missing after writing");
          for (const [name, value] of Object.entries(expected.sections)) {
            const got = actual.sections[name];
            if (!got || got.count !== value.count || got.sha !== value.sha) throw new Error(`verification failed: ${name} (source ${value.count}/${value.sha.slice(0, 12)}, database ${got?.count}/${got?.sha.slice(0, 12)})`);
          }
          if (Object.keys(actual.sections).length !== Object.keys(expected.sections).length) throw new Error("verification failed: extra sections in the database");
          compare("doc", doc, back, COLLECTIONS.reduce((n, c) => n + doc.data[c].length, 0), sections);
          Object.assign(sections, expected.sections);
          perUser = expected.perUser;
          revision = doc.revision;
          break;
        }
        case "users":
          writeUsers(db, item.value);
          compare("users", item.value, readUsers(db), Object.keys(item.value.users).length, sections);
          break;
        case "push":
          writePush(db, item.value);
          compare("push", item.value, readPush(db), Object.values(item.value.subs).reduce((n, l) => n + l.length, 0), sections);
          break;
        case "attachments":
          writeAttachments(db, item.value);
          compare("attachments", item.value, readAttachments(db), Object.keys(item.value.items).length, sections);
          break;
        case "usage":
          writeKv(db, KV_USAGE, item.value);
          compare("assistant-usage", item.value, readKv(db, KV_USAGE), 1, sections);
          break;
        case "assistant":
          writeAssistant(db, item.key, item.value);
          compare(`assistant.${item.key}`, item.value, allAssistant(db)[item.key], Array.isArray(item.value.conversations) ? item.value.conversations.length : 0, sections);
          break;
      }
    }
    const summary: ImportSummary = { sections, perUser, revision };
    const info = stmt(db, "INSERT INTO legacy_imports (at, files, summary, legacy_dir) VALUES (?, ?, ?, ?)").run(now, JSON.stringify(files), JSON.stringify(summary), legacyDir);
    metaSet(db, META_INITIALIZED, JSON.stringify({ at: now, source: "legacy-json" }));
    if (options.failBeforeCommit) throw new Error("simulated crash before commit");
    return { summary, legacyDir, files, importId: Number(info.lastInsertRowid) };
  });
  try {
    const result = run.immediate();
    docs.prime(readStoredDoc(db));
    return result;
  } catch (error) {
    // The in-memory picture of the tables may be stale after the rollback.
    docs.prime(readStoredDoc(db));
    throw error;
  }
}

/** Move imported files to DATA_DIR/<legacyDir>/ (same relative paths). Never deletes; returns the moved paths. */
export function moveLegacyFiles(dir: string, legacyDir: string, sources: LegacySource[], now = Date.now()): { moved: string[]; failed: { rel: string; error: string }[] } {
  const moved: string[] = [];
  const failed: { rel: string; error: string }[] = [];
  for (const source of sources) {
    let dest = join(dir, legacyDir, source.rel);
    try {
      mkdirSync(dirname(dest), { recursive: true, mode: 0o700 });
      if (existsSync(dest)) dest = `${dest}.${now}`;
      renameSync(source.path, dest);
      moved.push(source.rel);
    } catch (error) {
      failed.push({ rel: source.rel, error: error instanceof Error ? error.message : String(error) });
    }
  }
  return { moved, failed };
}

export type ImportRecord = { id: number; at: number; files: Record<string, string>; legacyDir: string; movedAt: number | null };

export function importRecords(db: Db): ImportRecord[] {
  const rows = stmt(db, "SELECT id, at, files, legacy_dir, moved_at FROM legacy_imports ORDER BY id").all() as { id: number; at: number; files: string; legacy_dir: string; moved_at: number | null }[];
  return rows.map((row) => ({ id: row.id, at: row.at, files: JSON.parse(row.files) as Record<string, string>, legacyDir: row.legacy_dir, movedAt: row.moved_at }));
}

export function markMoved(db: Db, id: number, now = Date.now()): void {
  stmt(db, "UPDATE legacy_imports SET moved_at = ? WHERE id = ?").run(now, id);
}

/** The newest import that recorded `rel` with hash `sha` (the file was imported and is unchanged since). */
export function importedAs(records: ImportRecord[], rel: string, sha: string): ImportRecord | null {
  for (let i = records.length - 1; i >= 0; i--) {
    const record = records[i]!;
    if (record.files[rel] === undefined) continue;
    return record.files[rel] === sha ? record : null;
  }
  return null;
}
