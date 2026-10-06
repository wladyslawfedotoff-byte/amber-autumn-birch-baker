import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { TOMBSTONE_TTL_MS, emptyData, mergeData, pruneTombstones, sameData, stampCollection, type SyncData, type SyncEntity } from "../../src/lib/sync/merge.ts";
import { SyncStore, backupFileName, backupsToDelete } from "./sync-store.ts";

function tmp(): string {
  return mkdtempSync(join(tmpdir(), "pora-store-"));
}

/**
 * Minimal model of a device running src/lib/server-sync.ts: local document,
 * dirty flag, base revision; pull merges, push uses If-Match and retries on 409.
 */
class Device {
  data: SyncData;
  base: number | null = null;
  dirty = false;
  clock: number;
  readonly name: string;
  constructor(name: string, seed: SyncData, clockSkewMs = 0) {
    this.name = name;
    this.data = structuredClone(seed);
    this.clock = Date.now() + clockSkewMs;
  }
  now(): number {
    this.clock += 1000;
    return this.clock;
  }
  addTask(id: string, title: string) {
    const next = [{ id, title }, ...(this.data.tasks as SyncEntity[])];
    const stamped = stampCollection(this.data.tasks, next, this.data.tombstones.tasks, this.now());
    this.data = { ...this.data, tasks: stamped.items, tombstones: { ...this.data.tombstones, tasks: stamped.tombs } };
    this.dirty = true;
  }
  deleteTask(id: string) {
    const next = this.data.tasks.filter((t) => t.id !== id);
    const stamped = stampCollection(this.data.tasks, next, this.data.tombstones.tasks, this.now());
    this.data = { ...this.data, tasks: stamped.items, tombstones: { ...this.data.tombstones, tasks: stamped.tombs } };
    this.dirty = true;
  }
  integrate(remote: { revision: number; data: SyncData }) {
    // Same as the browser: the server sends cutoff = serverNow − 30 days.
    const cutoff = Date.now() - TOMBSTONE_TTL_MS;
    const merged = mergeData(this.data, remote.data, { cutoff });
    this.data = merged;
    this.base = remote.revision;
    this.dirty = !sameData(pruneTombstones(merged, cutoff), pruneTombstones(remote.data, cutoff));
  }
  async sync(store: SyncStore) {
    for (let attempt = 0; attempt < 5; attempt++) {
      if (this.base === null || !this.dirty) {
        this.integrate(await store.get());
        if (!this.dirty) return;
      }
      const result = await store.put(this.base ?? 0, this.data);
      this.integrate(result.doc);
      if (result.status === "ok" && !this.dirty) return;
    }
    throw new Error(`${this.name} did not settle`);
  }
  titles(): string[] {
    return this.data.tasks.map((t) => String(t.title)).sort();
  }
}

test("revision increases, stale If-Match gets 409 with the current doc", async () => {
  const dir = tmp();
  try {
    const store = new SyncStore(dir);
    assert.equal((await store.get()).revision, 0);
    const d1 = { ...emptyData(), tasks: [{ id: "a", title: "A", updatedAt: 1 }] };
    const r1 = await store.put(0, d1);
    assert.equal(r1.status, "ok");
    assert.equal(r1.doc.revision, 1);
    const stale = await store.put(0, { ...emptyData(), tasks: [{ id: "b", title: "B", updatedAt: 2 }] });
    assert.equal(stale.status, "conflict");
    assert.equal(stale.doc.revision, 1);
    assert.equal(stale.doc.data.tasks.length, 1);
    // unchanged push does not bump the revision
    const same = await store.put(1, d1);
    assert.equal(same.status, "ok");
    assert.equal(same.doc.revision, 1);
    // persisted and reloaded by a fresh instance (simulated restart)
    const reopened = new SyncStore(dir);
    const doc = await reopened.get();
    assert.equal(doc.revision, 1);
    assert.equal(doc.data.tasks[0]!.title, "A");
    assert.deepEqual(readdirSync(dir).filter((n) => n.includes(".tmp-")), []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("server merges even on a matching revision, so a sloppy client cannot drop entities", async () => {
  const dir = tmp();
  try {
    const store = new SyncStore(dir);
    await store.put(0, { ...emptyData(), tasks: [{ id: "a", title: "A", updatedAt: 1 }] });
    const r = await store.put(1, { ...emptyData(), tasks: [{ id: "b", title: "B", updatedAt: 2 }] });
    assert.deepEqual(r.doc.data.tasks.map((t) => t.id).sort(), ["a", "b"]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("backups rotate and corrupt files are set aside and restored from the newest backup", async () => {
  const dir = tmp();
  try {
    let clock = 1_000_000;
    const hour = 3600_000;
    // backups 2 h apart, keep 3 hourly / 0 daily → 3 left
    const store = new SyncStore(dir, { backupHourly: 3, backupDaily: 0, backupIntervalMs: 0, now: () => (clock += 2 * hour) });
    for (let i = 0; i < 6; i++) {
      await store.put(i, { ...emptyData(), tasks: [{ id: `t${i}`, title: `T${i}`, updatedAt: i + 1 }] });
    }
    const backups = readdirSync(join(dir, "backups"));
    assert.equal(backups.length, 3);
    writeFileSync(join(dir, "pora.json"), "{ not json");
    const reopened = new SyncStore(dir, { now: () => (clock += 1000) });
    let corrupt = false;
    reopened.onCorrupt = () => {
      corrupt = true;
    };
    const doc = await reopened.get();
    assert.equal(corrupt, true);
    assert.ok(doc.data.tasks.length >= 4, "restored from newest backup");
    assert.ok(doc.revision > 6, "revision bumped past any client's base");
    assert.ok(readdirSync(dir).some((n) => n.startsWith("pora.json.corrupt-")));
    assert.doesNotThrow(() => JSON.parse(readFileSync(join(dir, "pora.json"), "utf8")));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("BUG SCENARIO: task saved on the phone must not vanish and must reach the computer", async () => {
  const dir = tmp();
  try {
    const store = new SyncStore(dir);
    const seed = { ...emptyData(), tasks: [{ id: "old", title: "Old" }], lists: [{ id: "work", name: "Работа" }] };
    // Computer clock 10 minutes AHEAD (the old WebDAV sync trusted device clocks).
    const computer = new Device("computer", seed, 10 * 60 * 1000);
    const phone = new Device("phone", seed);
    await computer.sync(store);
    await phone.sync(store);

    // Phone saves a task; before its debounced push runs, a periodic pull
    // happens after the computer pushed an unrelated edit.
    phone.addTask("p1", "Купить хлеб (телефон)");
    computer.addTask("c1", "Позвонить (компьютер)");
    await computer.sync(store);
    await phone.sync(store); // pull sees a newer server revision: must MERGE, not overwrite
    assert.ok(phone.titles().includes("Купить хлеб (телефон)"), "phone keeps its unsent task");
    assert.ok(phone.titles().includes("Позвонить (компьютер)"));

    await computer.sync(store);
    assert.ok(computer.titles().includes("Купить хлеб (телефон)"), "phone task reached the computer");
    assert.deepEqual(computer.titles(), phone.titles());
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("concurrent pushes with the same base: second gets 409, merges, retries; nothing lost", async () => {
  const dir = tmp();
  try {
    const store = new SyncStore(dir);
    const phone = new Device("phone", emptyData());
    const computer = new Device("computer", emptyData());
    await phone.sync(store);
    await computer.sync(store);
    phone.addTask("p", "Phone");
    computer.addTask("c", "Computer");
    await Promise.all([phone.sync(store), computer.sync(store)]);
    await phone.sync(store);
    await computer.sync(store);
    assert.deepEqual(phone.titles(), ["Computer", "Phone"]);
    assert.deepEqual(computer.titles(), ["Computer", "Phone"]);
    const disk = JSON.parse(readFileSync(join(dir, "pora.json"), "utf8"));
    assert.equal(disk.data.tasks.length, 2);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("delete on one device propagates and is not undone by the other device's stale copy", async () => {
  const dir = tmp();
  try {
    const store = new SyncStore(dir);
    const seed = { ...emptyData(), tasks: [{ id: "x", title: "X", updatedAt: 1 }] };
    const phone = new Device("phone", seed);
    const computer = new Device("computer", seed);
    await phone.sync(store);
    await computer.sync(store);
    computer.deleteTask("x");
    await computer.sync(store);
    // The phone edits its stale copy?  No — it never saw the delete yet; its
    // old copy (updatedAt 1) must lose against the newer tombstone.
    await phone.sync(store);
    assert.deepEqual(phone.titles(), []);
    assert.deepEqual(computer.titles(), []);
    const disk = JSON.parse(readFileSync(join(dir, "pora.json"), "utf8"));
    assert.ok(disk.data.tombstones.tasks.x > 0, "tombstone stored on the server");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("first connection of a device merges its local data with the server (never wipes either side)", async () => {
  const dir = tmp();
  try {
    const store = new SyncStore(dir);
    const computer = new Device("computer", { ...emptyData(), tasks: [{ id: "c", title: "C" }] });
    await computer.sync(store);
    const phone = new Device("phone", { ...emptyData(), tasks: [{ id: "p", title: "P" }] });
    await phone.sync(store);
    await computer.sync(store);
    assert.deepEqual(phone.titles(), ["C", "P"]);
    assert.deepEqual(computer.titles(), ["C", "P"]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("tiered backup retention keeps newest per hour and per day", () => {
  const hour = 3600_000;
  const day = 24 * hour;
  const start = Date.UTC(2026, 0, 1);
  const names: string[] = [];
  // every 20 minutes for 40 days
  for (let t = start, rev = 1; t < start + 40 * day; t += 20 * 60_000, rev++) names.push(backupFileName(t, rev));
  names.push("notes.txt");
  const doomed = new Set(backupsToDelete(names, 24, 30));
  const kept = names.filter((name) => !doomed.has(name) && name !== "notes.txt");
  assert.ok(!doomed.has("notes.txt"), "foreign files are never deleted");
  assert.ok(kept.includes(names[names.length - 2]!), "newest kept");
  // 24 hourly (one of them also the newest of its day) + 30 daily, overlapping on the last day
  assert.ok(kept.length >= 30 && kept.length <= 54, `kept ${kept.length}`);
  const days = new Set(kept.map((name) => name.slice(5, 15)));
  assert.equal(days.size, 30);
  assert.deepEqual(backupsToDelete([backupFileName(start, 1)], 0, 0), [], "the newest backup always stays");
});

test("leftover temp files are removed at startup and health does not create files", async () => {
  const dir = tmp();
  try {
    writeFileSync(join(dir, "pora.json.tmp-123-abcd"), "half");
    writeFileSync(join(dir, ".health-99"), "");
    const store = new SyncStore(dir);
    await store.get();
    assert.deepEqual(readdirSync(dir).filter((n) => n.includes("tmp") || n.startsWith(".health")), []);
    const before = readdirSync(dir).sort();
    for (let i = 0; i < 5; i++) assert.equal(await store.isWritable(), true);
    assert.deepEqual(readdirSync(dir).sort(), before);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("an external rewrite of pora.json (restore script) is picked up", async () => {
  const dir = tmp();
  try {
    const store = new SyncStore(dir);
    await store.put(0, { ...emptyData(), tasks: [{ id: "a", title: "A", updatedAt: 1 }] });
    const disk = JSON.parse(readFileSync(join(dir, "pora.json"), "utf8"));
    disk.revision = 7;
    disk.data.tasks[0].title = "restored";
    writeFileSync(join(dir, "pora.json.new"), JSON.stringify(disk));
    // rename like the script does (new inode)
    const { renameSync } = await import("node:fs");
    renameSync(join(dir, "pora.json.new"), join(dir, "pora.json"));
    const doc = await store.get();
    assert.equal(doc.revision, 7);
    assert.equal(doc.data.tasks[0]!.title, "restored");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("profiles: a single-user pora.json on disk is migrated to APP_OWNER without losing anything", async () => {
  const dir = tmp();
  try {
    const now = Date.now();
    const data = emptyData();
    data.tasks = [
      { id: "t1", title: "Старое дело", updatedAt: now - 5000 },
      { id: "t2", title: "Ещё одно", updatedAt: now - 4000 },
    ];
    data.lists = [{ id: "l1", name: "Дом", updatedAt: now - 6000 }];
    data.tombstones.tasks.deleted = now - 3000;
    writeFileSync(join(dir, "pora.json"), JSON.stringify({ revision: 42, updatedAt: now - 1000, data }));
    const acl = { owner: "user1", users: ["user1", "user2"] };
    const store = new SyncStore(dir, { backupIntervalMs: 0 });
    const user1 = await store.getFor("user1", acl);
    assert.equal(user1.revision, 42, "owner's devices keep syncing with the same revision");
    assert.deepEqual(user1.data.tasks.map((t) => t.id), ["t1", "t2"]);
    assert.equal(user1.data.tombstones.tasks.deleted, now - 3000);
    const user2 = await store.getFor("user2", acl);
    assert.equal(user2.revision, 1);
    assert.equal(user2.data.tasks.length, 0, "the other profile starts empty");
    // Nothing is written by reading.
    assert.equal(JSON.parse(readFileSync(join(dir, "pora.json"), "utf8")).revision, 42);
    // user2 adds her first task: the file becomes v2 with per-user states, user1's data untouched.
    writeFileSync(join(dir, "users.json"), JSON.stringify({ v: 1, users: { user2: { epoch: 1 } } }));
    const incoming = emptyData();
    incoming.tasks = [{ id: "z1", title: "Её задача", updatedAt: now }];
    const res = await store.putFor("user2", acl, 1, incoming);
    assert.equal(res.status, "ok");
    const file = JSON.parse(readFileSync(join(dir, "pora.json"), "utf8"));
    assert.equal(file.v, 2);
    assert.deepEqual(Object.keys(file.users).sort(), ["user1", "user2"]);
    assert.equal(file.users.user1.revision, 42, "user1's view did not change");
    assert.equal(file.users.user2.revision, 2);
    assert.deepEqual(file.data.tasks.map((t: SyncEntity) => t.id).sort(), ["t1", "t2", "z1"]);
    assert.equal(file.data.tasks.find((t: SyncEntity) => t.id === "z1").owner, "user2");
    assert.equal(file.data.tasks.find((t: SyncEntity) => t.id === "t1").owner, undefined, "old entities untouched (owner = APP_OWNER)");
    // Stale If-Match → 409 with user2's own view.
    const conflict = await store.putFor("user2", acl, 1, incoming);
    assert.equal(conflict.status, "conflict");
    assert.deepEqual(conflict.doc.data.tasks.map((t) => t.id), ["z1"]);
    // Backups: pora.json and users.json of the same moment.
    const backups = readdirSync(join(dir, "backups"));
    assert.equal(backups.filter((n) => n.startsWith("pora-")).length, 1);
    assert.equal(backups.filter((n) => n.startsWith("users-")).length, 1);
    // Switching back to one profile serves the whole document again (users kept in the file).
    const single = await new SyncStore(dir).get();
    assert.deepEqual(single.data.tasks.map((t) => t.id).sort(), ["t1", "t2", "z1"]);
    assert.ok(single.users?.user2);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("backups: users-….json follows its pora-….json in the retention", async () => {
  const dir = tmp();
  try {
    const store = new SyncStore(dir, { backupHourly: 0, backupDaily: 0 });
    const backups = join(dir, "backups");
    await import("node:fs/promises").then((fs) => fs.mkdir(backups, { recursive: true }));
    const old = backupFileName(Date.UTC(2026, 0, 1), 1);
    const fresh = backupFileName(Date.UTC(2026, 5, 1), 2);
    for (const name of [old, fresh]) {
      writeFileSync(join(backups, name), "{}");
      writeFileSync(join(backups, `users-${name.slice(5)}`), "{}");
    }
    const removed = await store.pruneBackups();
    assert.deepEqual(removed.sort(), [old, `users-${old.slice(5)}`].sort());
    assert.deepEqual(readdirSync(backups).sort(), [fresh, `users-${fresh.slice(5)}`].sort());
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
