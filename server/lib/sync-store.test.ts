import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { TOMBSTONE_TTL_MS, emptyData, mergeData, pruneTombstones, sameData, stampCollection, type SyncData, type SyncEntity } from "../../src/lib/sync/merge.ts";
import { SyncStore } from "./sync-store.ts";

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
    const store = new SyncStore(dir, { backupKeep: 3, backupIntervalMs: 0, now: () => (clock += 1000) });
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
