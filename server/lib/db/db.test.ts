/**
 * 1.12.0 storage: SQLite backend, one-time import of the 1.11 JSON files,
 * crash safety, rollback (export-json), snapshots, equivalence with the JSON
 * backend, concurrency and a performance sanity check.
 */
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync, renameSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { COLLECTIONS, emptyData, stableStringify, type SyncData } from "../../../src/lib/sync/merge.ts";
import { normalizeUsersFile } from "../../../scripts/users-file.mjs";
import { AttachStore } from "../attachments/store.ts";
import { AssistantStore } from "../ai/conversations.ts";
import { UsageBook } from "../ai/provider.ts";
import { PushStore } from "../push/store.ts";
import { SyncStore } from "../sync-store.ts";
import { loadUsersFile } from "../user-store.ts";
import { openDb, quickCheck, schemaVersion } from "./database.ts";
import { DocTables, readStoredDoc } from "./doc-tables.ts";
import { exportJson } from "./export.ts";
import { findLegacySources, importLegacy, importRecords } from "./import.ts";
import { parseAttachMeta, parsePushFile, parseStoredDoc } from "./legacy.ts";
import { KV_USAGE, allAssistant, readAttachments, readKv, readPush, readUsers } from "./records.ts";
import { SCHEMA_VERSION } from "./schema.ts";
import { dailySnapshot, pruneSnapshots } from "./snapshot.ts";
import { StorageFatalError, closeStorage, storageFor, forceJsonStorage } from "./storage.ts";
import { ACL, T0, buildLegacyFixture, edit, task } from "./test-fixture.ts";

const LEGACY_FILES = ["pora.json", "users.json", "push.json", "attachments/meta.json", "assistant/user1.json", "assistant/user2.json", "assistant-usage.json"];

function tmp(prefix = "pora-db-"): string {
  return mkdtempSync(join(tmpdir(), prefix));
}

function cleanup(...dirs: string[]): void {
  for (const dir of dirs) {
    closeStorage(dir);
    rmSync(dir, { recursive: true, force: true });
  }
}

/** Raw bytes of every legacy file (to prove nothing was changed or lost). */
function snapshotFiles(dir: string): Record<string, string> {
  return Object.fromEntries(LEGACY_FILES.filter((rel) => existsSync(join(dir, rel))).map((rel) => [rel, readFileSync(join(dir, rel), "utf8")]));
}

/** Everything a 1.11 server would have served from these files, normalized. */
function expectedFrom(files: Record<string, string>) {
  return {
    doc: parseStoredDoc(files["pora.json"]!),
    users: normalizeUsersFile(JSON.parse(files["users.json"]!)),
    push: parsePushFile(files["push.json"]!),
    attachments: parseAttachMeta(files["attachments/meta.json"]!, true),
    assistant: { user1: JSON.parse(files["assistant/user1.json"]!), user2: JSON.parse(files["assistant/user2.json"]!) },
    usage: JSON.parse(files["assistant-usage.json"]!),
  };
}

function legacyDirs(dir: string): string[] {
  return readdirSync(dir).filter((name) => name.startsWith("legacy-json-"));
}

function dbOf(dir: string) {
  const storage = storageFor(dir);
  assert.equal(storage.mode, "sqlite", storage.mode === "json" ? storage.reason : "");
  return storage.mode === "sqlite" ? storage.db : (null as never);
}

function eq(a: unknown, b: unknown, message?: string): void {
  assert.equal(stableStringify(a), stableStringify(b), message);
}

test("import: every section, user and field arrives exactly; the files move to legacy-json-<date>/; sync goes on with the same revisions", async () => {
  const dir = tmp();
  try {
    await buildLegacyFixture(dir);
    const files = snapshotFiles(dir);
    assert.equal(Object.keys(files).length, LEGACY_FILES.length);
    const expected = expectedFrom(files);
    // What 1.11 served to each profile.
    forceJsonStorage(dir);
    const jsonStore = new SyncStore(dir);
    const view1 = await jsonStore.getFor("user1", ACL);
    const view2 = await jsonStore.getFor("user2", ACL);
    closeStorage(dir);
    assert.ok(expected.doc.users?.user1 && expected.doc.users.user2, "fixture has two profiles");
    assert.ok(expected.doc.data.tasks.some((t) => t._f || t._b), "fixture has per-field stamps");
    assert.ok(Object.keys(expected.doc.data.tombstones.tasks).length >= 2, "fixture has tombstones");

    const db = dbOf(dir);
    // Database content == source, section by section.
    eq(readStoredDoc(db), expected.doc, "sync document");
    eq(readUsers(db), expected.users, "users");
    eq(readPush(db), expected.push, "push");
    eq(readAttachments(db), expected.attachments, "attachment metadata");
    eq(allAssistant(db), expected.assistant, "assistant");
    eq(readKv(db, KV_USAGE), expected.usage, "assistant usage");
    // Real tables, not a blob: child rows are queryable.
    const fuel = db.prepare("SELECT parent_id, liters, km FROM asset_fuel ORDER BY parent_id, pos").all() as { parent_id: string; liters: number }[];
    assert.ok(fuel.length >= 5 && fuel.some((row) => row.liters === 40.25));
    const subtasks = db.prepare("SELECT COUNT(*) AS n FROM task_subtasks").get() as { n: number };
    assert.ok(subtasks.n > 10);
    const tags = db.prepare("SELECT DISTINCT item FROM task_tags ORDER BY item").all() as { item: string }[];
    assert.ok(tags.some((row) => row.item === "дом"));
    const due = db.prepare("SELECT COUNT(*) AS n FROM tasks WHERE due IS NOT NULL").get() as { n: number };
    assert.equal(due.n, expected.doc.data.tasks.filter((t) => t.due !== null && t.due !== undefined).length);
    const shared = db.prepare("SELECT COUNT(DISTINCT parent_id) AS n FROM task_members WHERE item = 'user2'").get() as { n: number };
    assert.ok(shared.n >= 3, "shared items are queryable");

    // The stores serve the same as 1.11 did.
    const store = new SyncStore(dir);
    eq(await store.getFor("user1", ACL), view1, "user1 view unchanged");
    eq(await store.getFor("user2", ACL), view2, "user2 view unchanged");
    eq(loadUsersFile(dir), expected.users);
    eq(Object.values((await PushStore.inDir(dir).read()).subs).flat().length, 3);
    eq((await AttachStore.inDataDir(dir).all()).length, 4);
    eq((await new AssistantStore(join(dir, "assistant"), { dataDir: dir }).queuedLogins()), ["user2"]);
    assert.equal(new UsageBook(null, () => Date.UTC(2026, 9, 15), { dataDir: dir }).used("cloud-model"), 1234);

    // Files moved, byte for byte, nothing left behind, nothing deleted.
    for (const rel of LEGACY_FILES) assert.equal(existsSync(join(dir, rel)), false, `${rel} moved away`);
    const [legacy] = legacyDirs(dir);
    assert.ok(legacy && /^legacy-json-\d{4}-\d{2}-\d{2}$/.test(legacy));
    for (const rel of LEGACY_FILES) assert.equal(readFileSync(join(dir, legacy!, rel), "utf8"), files[rel], `${rel} kept intact`);
    assert.equal(readdirSync(join(dir, "attachments", "files")).length, 4, "attachment files stay where they are");

    // Import record with per-section / per-user counts and hashes.
    const [record] = importRecords(db);
    assert.ok(record && record.movedAt);
    const summary = JSON.parse((db.prepare("SELECT summary FROM legacy_imports").get() as { summary: string }).summary);
    assert.equal(summary.sections["doc.tasks"].count, expected.doc.data.tasks.length);
    assert.ok(summary.sections["doc.user.user1"] && summary.sections["doc.user.user2"]);
    assert.ok(summary.sections["doc.owner.user2"].count >= 2);
    assert.equal(summary.revision, expected.doc.revision);

    // Devices keep syncing with their base revision (no spurious 409).
    const r = await store.putFor("user2", ACL, view2.revision, edit(view2.data, { tasks: (items) => [...items, task("after", 1)] }, T0 + 99_000));
    assert.equal(r.status, "ok");
    assert.equal(r.doc.revision, view2.revision + 1);
    assert.equal(schemaVersion(db), SCHEMA_VERSION);
    assert.equal(db.pragma("journal_mode", { simple: true }), "wal");
    assert.equal(db.pragma("foreign_keys", { simple: true }), 1);
  } finally {
    cleanup(dir);
  }
});

test("round trip: edits through the API survive restarts exactly; JSON and SQLite backends answer identically", async () => {
  const jsonDir = tmp();
  const sqlDir = tmp();
  try {
    await buildLegacyFixture(jsonDir);
    await buildLegacyFixture(sqlDir);
    forceJsonStorage(jsonDir);
    // Same server clock for both (stamps must match exactly).
    const clock = () => {
      let t = T0 + 50_000_000;
      return () => (t += 7);
    };
    const stores = [new SyncStore(jsonDir, { now: clock() }), new SyncStore(sqlDir, { now: clock() })];
    assert.equal(stores[0]!.backend(), "json");
    assert.equal(stores[1]!.backend(), "sqlite");
    let now = T0 + 100_000;
    const results: string[][] = [[], []];
    for (let step = 0; step < 30; step++) {
      const login = step % 3 === 0 ? "user2" : "user1";
      for (const [k, store] of stores.entries()) {
        const view = await store.getFor(login, ACL);
        const next = edit(
          view.data,
          {
            tasks: (items) => {
              const out = items.map((t, i) => (i % 7 === step % 7 ? { ...t, title: `${t.title}·${step}`, tags: [...((t.tags as string[]) ?? []), `s${step}`].slice(-3) } : t));
              if (step % 4 === 0) out.unshift(task(`n${step}`, step, step % 8 === 0 ? { members: ["user1", "user2"] } : {}));
              if (step % 5 === 0) out.splice(3, 1);
              return out;
            },
            assets: (items) => items.map((a) => (a.id === "car1" ? { ...a, km: Number(a.km ?? 0) + 10, readings: [...((a.readings as object[]) ?? []), { id: `rd${step}`, date: "2026-10-12", km: 121000 + step }] } : a)),
          },
          now,
        );
        const settings = step === 10 ? { ...next.settings, workStart: "07:00", updatedAt: now } : next.settings;
        const res = await store.putFor(login, ACL, view.revision, { ...next, settings });
        results[k]!.push(`${res.status}:${res.doc.revision}:${stableStringify(res.doc.data)}`);
      }
      now += 1000;
    }
    for (let i = 0; i < results[0]!.length; i++) {
      if (results[1]![i] !== results[0]![i]) {
        const a = results[0]![i]!, b = results[1]![i]!;
        let k = 0;
        while (a[k] === b[k]) k++;
        assert.fail(`step ${i}: json …${a.slice(Math.max(0, k - 200), k + 100)}\n sqlite …${b.slice(Math.max(0, k - 200), k + 100)}`);
      }
    }
    const before = await stores[1]!.get();
    closeStorage(sqlDir);
    const after = await new SyncStore(sqlDir).get();
    eq(after, before, "restart: identical document");
    eq(after.data, (await stores[0]!.get()).data, "same data as the JSON backend");
  } finally {
    cleanup(jsonDir, sqlDir);
  }
});

test("interrupted import (crash before commit): nothing written, files untouched, JSON keeps serving; next start imports", async () => {
  const dir = tmp();
  try {
    await buildLegacyFixture(dir);
    const files = snapshotFiles(dir);
    const storage = storageFor(dir, { importOptions: { failBeforeCommit: true } });
    assert.equal(storage.mode, "json");
    assert.deepEqual(snapshotFiles(dir), files, "legacy files untouched");
    assert.deepEqual(legacyDirs(dir), []);
    const raw = openDb(join(dir, "pora.db"), { readonly: true });
    assert.equal(readStoredDoc(raw), null, "no partial data");
    assert.equal((raw.prepare("SELECT COUNT(*) AS n FROM meta").get() as { n: number }).n, 0, "no import marker");
    assert.equal((raw.prepare("SELECT COUNT(*) AS n FROM users").get() as { n: number }).n, 0);
    raw.close();
    // The JSON backend serves the same data meanwhile.
    const doc = await new SyncStore(dir).get();
    eq(doc, parseStoredDoc(files["pora.json"]!));
    // Next start.
    closeStorage(dir);
    const db = dbOf(dir);
    eq(readStoredDoc(db), parseStoredDoc(files["pora.json"]!));
    assert.equal(legacyDirs(dir).length, 1);
  } finally {
    cleanup(dir);
  }
});

test("interrupted move (crash after commit): the next start only moves the leftovers, no second import, no data change", async () => {
  const dir = tmp();
  try {
    await buildLegacyFixture(dir);
    const files = snapshotFiles(dir);
    // Commit the import by hand, "crash" before moving anything.
    forceJsonStorage(dir);
    closeStorage(dir);
    {
      const db = openDb(join(dir, "pora.db"));
      const { migrate } = await import("./database.ts");
      migrate(db);
      importLegacy(db, new DocTables(), dir, findLegacySources(dir), { now: T0 });
      db.close();
    }
    // A partial move happened too: one file already gone.
    mkdirSync(join(dir, "legacy-json-manual"), { recursive: true });
    renameSync(join(dir, "push.json"), join(dir, "legacy-json-manual", "push.json"));
    const db = dbOf(dir);
    assert.equal(importRecords(db).length, 1, "not imported twice");
    for (const rel of LEGACY_FILES) assert.equal(existsSync(join(dir, rel)), false);
    eq(readStoredDoc(db), parseStoredDoc(files["pora.json"]!));
    eq(readPush(db), parsePushFile(files["push.json"]!));
    assert.ok(importRecords(db)[0]!.movedAt);
  } finally {
    cleanup(dir);
  }
});

test("corrupt or unreadable JSON: the import is rolled back, the files stay, the server keeps the 1.11 behaviour", async () => {
  for (const [rel, bad] of [
    ["pora.json", "{ not json"],
    ["users.json", "{"],
    ["push.json", "[broken"],
    ["attachments/meta.json", "{\"v\":1,"],
    ["assistant/user1.json", "nope"],
  ] as const) {
    const dir = tmp();
    try {
      await buildLegacyFixture(dir, { tasks: 5 });
      writeFileSync(join(dir, rel), bad);
      const files = snapshotFiles(dir);
      const storage = storageFor(dir);
      assert.equal(storage.mode, "json", rel);
      assert.match(storage.mode === "json" ? storage.reason : "", new RegExp(rel.replace(/[./]/g, "\\$&")));
      assert.deepEqual(snapshotFiles(dir), files, `${rel}: files untouched`);
      assert.deepEqual(legacyDirs(dir), []);
    } finally {
      cleanup(dir);
    }
  }
});

test("restart idempotency and rollback period: unchanged restarts change nothing; JSON edited by 1.11 meanwhile is re-imported after a DB copy", async () => {
  const dir = tmp();
  try {
    await buildLegacyFixture(dir);
    let db = dbOf(dir);
    const first = readStoredDoc(db)!;
    for (let i = 0; i < 3; i++) {
      closeStorage(dir);
      db = dbOf(dir);
      eq(readStoredDoc(db), first);
      assert.equal(importRecords(db).length, 1);
    }
    // 1.12 edit (revision +1).
    const store = new SyncStore(dir);
    const v1 = await store.getFor("user1", ACL);
    await store.putFor("user1", ACL, v1.revision, edit(v1.data, { tasks: (items) => [task("only-in-db", 1), ...items] }, T0 + 500_000));
    const dbDoc = await store.get();
    // Rollback to 1.11: legacy files restored and edited there.
    closeStorage(dir);
    const legacy = join(dir, legacyDirs(dir)[0]!);
    for (const rel of LEGACY_FILES) {
      mkdirSync(join(dir, rel, ".."), { recursive: true });
      renameSync(join(legacy, rel), join(dir, rel));
    }
    forceJsonStorage(dir);
    const old = new SyncStore(dir);
    const ov = await old.getFor("user2", ACL);
    await old.putFor("user2", ACL, ov.revision, edit(ov.data, { tasks: (items) => [task("made-in-1.11", 2), ...items] }, T0 + 600_000));
    const jsonDoc = await old.get();
    closeStorage(dir);
    // Upgrade again.
    db = dbOf(dir);
    const now = readStoredDoc(db)!;
    assert.ok(now.data.tasks.some((t) => t.id === "made-in-1.11"), "1.11 edits are in");
    assert.ok(now.revision > Math.max(dbDoc.revision, jsonDoc.revision), "revision moved past every client's base");
    for (const login of ["user1", "user2"]) assert.ok(now.users![login]!.revision > Math.max(dbDoc.users![login]!.revision, jsonDoc.users![login]!.revision));
    eq(now.data, jsonDoc.data, "data = what 1.11 had");
    const copies = readdirSync(join(dir, "backup")).filter((name) => name.includes("before-reimport"));
    assert.equal(copies.length, 1, "the previous database is kept as a consistent copy");
    const copy = openDb(join(dir, "backup", copies[0]!), { readonly: true });
    assert.ok(readStoredDoc(copy)!.data.tasks.some((t) => t.id === "only-in-db"), "1.12 edits preserved in the copy");
    copy.close();
    assert.equal(importRecords(db).length, 2);
    for (const rel of LEGACY_FILES) assert.equal(existsSync(join(dir, rel)), false);
  } finally {
    cleanup(dir);
  }
});

test("concurrency: many devices of two users push at once (and a script writes in between) — nothing is lost", async () => {
  const dir = tmp();
  try {
    await buildLegacyFixture(dir, { tasks: 10 });
    const store = new SyncStore(dir);
    type Dev = { login: string; data: SyncData; base: number; name: string };
    const devices: Dev[] = [];
    for (const login of ["user1", "user1", "user2", "user2", "user1"]) {
      const view = await store.getFor(login, ACL);
      devices.push({ login, data: view.data, base: view.revision, name: `${login}-${devices.length}` });
    }
    const { mergeData, pruneTombstones, sameData, TOMBSTONE_TTL_MS } = await import("../../../src/lib/sync/merge.ts");
    let clock = T0 + 1_000_000;
    const syncDevice = async (dev: Dev) => {
      for (let attempt = 0; attempt < 20; attempt++) {
        const res = await store.putFor(dev.login, ACL, dev.base, dev.data);
        const cutoff = Date.now() - TOMBSTONE_TTL_MS;
        dev.data = mergeData(dev.data, res.doc.data, { cutoff });
        dev.base = res.doc.revision;
        if (res.status === "ok" && sameData(pruneTombstones(dev.data, cutoff), pruneTombstones(res.doc.data, cutoff))) return;
      }
      throw new Error(`${dev.name} did not settle`);
    };
    const created: string[] = [];
    const rounds = 8;
    for (let round = 0; round < rounds; round++) {
      for (const dev of devices) {
        const id = `${dev.name}-r${round}`;
        created.push(id);
        dev.data = edit(dev.data, { tasks: (items) => [task(id, round), ...items] }, (clock += 10));
      }
      if (round === 3) {
        // scripts/restore-backup.mjs-like writer in another connection
        const other = openDb(join(dir, "pora.db"));
        const docs = new DocTables();
        const cur = readStoredDoc(other)!;
        docs.prime(cur);
        other.transaction(() => docs.save(other, { ...cur, revision: cur.revision + 1, updatedAt: Date.now() }, cur.revision)).immediate();
        other.close();
      }
      await Promise.all(devices.map(syncDevice));
    }
    for (const dev of devices) await syncDevice(dev);
    const final = await store.get();
    const ids = new Set(final.data.tasks.map((t) => t.id));
    for (const id of created) assert.ok(ids.has(id), `${id} kept`);
    const disk = openDb(join(dir, "pora.db"), { readonly: true });
    eq(readStoredDoc(disk), final, "memory == disk");
    assert.equal(quickCheck(disk), "ok");
    disk.close();
  } finally {
    cleanup(dir);
  }
});

test("export-json round trip: DB → 1.11 files → fresh import gives the same database; the files are what 1.11 reads", async () => {
  const dir = tmp();
  const again = tmp();
  try {
    await buildLegacyFixture(dir);
    const store = new SyncStore(dir);
    const v = await store.getFor("user1", ACL);
    await store.putFor("user1", ACL, v.revision, edit(v.data, { tasks: (items) => [task("after-upgrade", 3), ...items] }, T0 + 700_000));
    await PushStore.inDir(dir).subscribe("user2", { endpoint: "https://push.example.net/new", keys: { p256dh: "x", auth: "y" }, tz: "UTC", createdAt: T0 + 5 });
    const db = dbOf(dir);
    const target = join(again, "export");
    const result = exportJson(db, target);
    assert.deepEqual(result.files.sort(), [...LEGACY_FILES].sort());
    // 1.11 reads them as the database content.
    eq(parseStoredDoc(readFileSync(join(target, "pora.json"), "utf8")), readStoredDoc(db));
    // A fresh folder with these files imports to an identical database.
    const fresh = join(again, "data");
    renameSync(target, fresh);
    const db2 = dbOf(fresh);
    eq(readStoredDoc(db2), readStoredDoc(db));
    eq(readUsers(db2), readUsers(db));
    eq(readPush(db2), readPush(db));
    eq(readAttachments(db2), readAttachments(db));
    eq(allAssistant(db2), allAssistant(db));
    eq(readKv(db2, KV_USAGE), readKv(db, KV_USAGE));
    assert.ok(readStoredDoc(db2)!.data.tasks.some((t) => t.id === "after-upgrade"));
  } finally {
    cleanup(dir, again, join(again, "data"));
  }
});

test("unsafe states refuse to start: unreadable pora.db, a database from a newer version", async () => {
  const dir = tmp();
  try {
    writeFileSync(join(dir, "pora.db"), "this is not a database, but somebody's data might be");
    writeFileSync(join(dir, "pora.json"), JSON.stringify({ revision: 1, updatedAt: 1, data: emptyData() }));
    assert.throws(() => storageFor(dir), StorageFatalError);
    assert.equal(readFileSync(join(dir, "pora.db"), "utf8").startsWith("this is not"), true, "left as it was");
  } finally {
    cleanup(dir);
  }
  const newer = tmp();
  try {
    dbOf(newer);
    closeStorage(newer);
    const db = openDb(join(newer, "pora.db"));
    db.prepare("INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)").run(SCHEMA_VERSION + 1, "future", 1);
    db.close();
    assert.throws(() => storageFor(newer), (error: unknown) => error instanceof StorageFatalError && /схем|schema/i.test(String((error as Error).message) + String((error as Error).cause)));
  } finally {
    cleanup(newer);
  }
});

test("fresh install: empty folder → empty database, no import, revision 0", async () => {
  const dir = tmp();
  try {
    const store = new SyncStore(dir);
    const doc = await store.get();
    assert.equal(doc.revision, 0);
    assert.equal(store.backend(), "sqlite");
    assert.deepEqual(importRecords(dbOf(dir)), []);
    assert.deepEqual(legacyDirs(dir), []);
  } finally {
    cleanup(dir);
  }
});

test("no empty start over earlier data: legacy-json-*, database copies or JSON backups without pora.db/pora.json refuse to start", async () => {
  for (const make of [
    (dir: string) => mkdirSync(join(dir, "legacy-json-2026-10-19")),
    (dir: string) => {
      mkdirSync(join(dir, "backup"));
      writeFileSync(join(dir, "backup", "pora-2026-10-18.db"), "x");
    },
    (dir: string) => {
      mkdirSync(join(dir, "backups"));
      writeFileSync(join(dir, "backups", "pora-2026-10-18T00-00-00-000Z-r4.json"), "{}");
    },
  ]) {
    const dir = tmp();
    try {
      make(dir);
      assert.throws(() => storageFor(dir), StorageFatalError);
      assert.equal(existsSync(join(dir, "pora.db")), false, "no empty pora.db is left behind");
      closeStorage(dir);
      process.env.PORA_START_EMPTY = "true";
      try {
        assert.equal(storageFor(dir).mode, "sqlite", "explicit opt-in starts empty");
      } finally {
        delete process.env.PORA_START_EMPTY;
      }
    } finally {
      cleanup(dir);
    }
  }
});

test("snapshots: VACUUM INTO backup/pora-<date>.db is a consistent, openable copy; 7 newest kept", async () => {
  const dir = tmp();
  try {
    await buildLegacyFixture(dir, { tasks: 5 });
    const db = dbOf(dir);
    const result = dailySnapshot(db, dir, Date.UTC(2026, 9, 19, 12));
    const copy = openDb(result.path, { readonly: true });
    eq(readStoredDoc(copy), readStoredDoc(db));
    eq(readUsers(copy), readUsers(db));
    assert.equal(quickCheck(copy), "ok");
    copy.close();
    for (let day = 1; day <= 10; day++) writeFileSync(join(dir, "backup", `pora-2026-09-${String(day).padStart(2, "0")}.db`), "x");
    writeFileSync(join(dir, "backup", "pora-2026-01-01-before-reimport-1.db"), "keep me");
    const removed = pruneSnapshots(dir, 7);
    assert.equal(removed.length, 4);
    const left = readdirSync(join(dir, "backup")).filter((name) => /^pora-\d{4}-\d{2}-\d{2}\.db$/.test(name));
    assert.equal(left.length, 7);
    assert.ok(existsSync(join(dir, "backup", "pora-2026-01-01-before-reimport-1.db")), "special copies are not rotated");
  } finally {
    cleanup(dir);
  }
});

test("performance sanity: 3000 tasks import, read and incremental write stay fast", async () => {
  const dir = tmp();
  try {
    await buildLegacyFixture(dir, { tasks: 3000 });
    const size = readFileSync(join(dir, "pora.json")).length;
    let t = performance.now();
    dbOf(dir);
    const importMs = performance.now() - t;
    const store = new SyncStore(dir);
    t = performance.now();
    const view = await store.getFor("user1", ACL);
    const readMs = performance.now() - t;
    const times: number[] = [];
    let base = view.revision;
    let data = view.data;
    for (let i = 0; i < 10; i++) {
      data = edit(data, { tasks: (items) => items.map((x, k) => (k === i ? { ...x, title: `edited ${i}` } : x)) }, T0 + 2_000_000 + i);
      t = performance.now();
      const res = await store.putFor("user1", ACL, base, data);
      times.push(performance.now() - t);
      assert.equal(res.status, "ok");
      base = res.doc.revision;
      data = res.doc.data;
    }
    const putMs = times.sort((a, b) => a - b)[Math.floor(times.length / 2)]!;
    console.log(`perf: pora.json ${(size / 1024).toFixed(0)} KB, import ${importMs.toFixed(0)} ms, first read ${readMs.toFixed(0)} ms, put (median) ${putMs.toFixed(1)} ms`);
    assert.ok(importMs < 20_000, `import ${importMs} ms`);
    assert.ok(putMs < 2_000, `put ${putMs} ms`);
  } finally {
    cleanup(dir);
  }
});

test("schema: every collection and list field has its table; all SQL in server/lib/db binds values", async () => {
  const dir = tmp();
  try {
    const db = dbOf(dir);
    const tables = new Set((db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as { name: string }[]).map((r) => r.name));
    for (const c of COLLECTIONS) assert.ok(tables.has(c), c);
    for (const name of ["task_subtasks", "task_tags", "task_attachments", "task_links", "task_contacts", "habit_log", "habit_checks", "milestone_items", "project_contacts", "asset_rules", "asset_log", "asset_fuel", "asset_parts", "users", "push_subscriptions", "push_sent", "attachments", "assistant_users", "schema_migrations", "legacy_imports", "tombstones", "user_states"]) {
      assert.ok(tables.has(name), name);
    }
    const fk = db.prepare("PRAGMA foreign_key_list(asset_fuel)").all() as { table: string; on_delete: string }[];
    assert.deepEqual(fk.map((r) => [r.table, r.on_delete]), [["assets", "CASCADE"]]);
  } finally {
    cleanup(dir);
  }
  // No string-built values in SQL: template literals inside SQL may only name tables/columns from schema constants.
  const { readdirSync: list } = await import("node:fs");
  const here = new URL(".", import.meta.url).pathname;
  for (const name of list(here).filter((n) => n.endsWith(".ts") && !n.endsWith(".test.ts"))) {
    const text = readFileSync(join(here, name), "utf8");
    for (const match of text.matchAll(/`[^`]*\b(SELECT|INSERT|UPDATE|DELETE)\b[^`]*`/g)) {
      const vars = [...match[0].matchAll(/\$\{([^}]+)\}/g)].map((m) => m[1]!.trim());
      for (const v of vars) assert.match(v, /^(collection|table|childTable\(collection, field\))$/, `${name}: ${v} inside SQL`);
    }
  }
});
