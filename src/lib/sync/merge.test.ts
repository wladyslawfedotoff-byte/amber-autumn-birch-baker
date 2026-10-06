import assert from "node:assert/strict";
import test from "node:test";
import {
  emptyData,
  mergeData,
  normalizeData,
  pruneTombstones,
  sameData,
  stampCollection,
  TOMBSTONE_TTL_MS,
  type SyncData,
  type SyncEntity,
} from "./merge.ts";

function doc(patch: Partial<SyncData> = {}): SyncData {
  return { ...emptyData(), ...patch };
}

const task = (id: string, updatedAt?: number, title = id): SyncEntity => ({ id, title, ...(updatedAt === undefined ? {} : { updatedAt }) });

test("newer updatedAt wins per entity, both sides keep their own new entities", () => {
  const phone = doc({ tasks: [task("a", 200, "a-phone"), task("p", 150)] });
  const computer = doc({ tasks: [task("a", 100, "a-computer"), task("c", 120)] });
  const merged = mergeData(phone, computer);
  assert.deepEqual(
    merged.tasks.map((t) => [t.id, t.title]),
    [
      ["a", "a-phone"],
      ["p", "p"],
      ["c", "c"],
    ],
  );
});

test("merge is commutative in content and idempotent", () => {
  const a = doc({ tasks: [task("x", 5, "x-a"), task("y", 1)], tombstones: { ...emptyData().tombstones, tasks: { z: 9 } } });
  const b = doc({ tasks: [task("x", 5, "x-b"), task("z", 3)] });
  const ab = mergeData(a, b);
  const ba = mergeData(b, a);
  const byId = (d: SyncData) => [...d.tasks].sort((p, q) => p.id.localeCompare(q.id));
  assert.deepEqual(byId(ab), byId(ba));
  assert.deepEqual(ab.tombstones, ba.tombstones);
  assert.ok(sameData(mergeData(ab, ab), ab));
});

test("missing updatedAt (old data) counts as 0 and loses to any stamped edit", () => {
  const legacy = doc({ tasks: [task("t", undefined, "old")] });
  const edited = doc({ tasks: [task("t", 1, "new")] });
  assert.equal(mergeData(legacy, edited).tasks[0]!.title, "new");
});

test("tombstone beats older edits, a later edit resurrects", () => {
  const deleted = doc({ tombstones: { ...emptyData().tombstones, tasks: { t: 500 } } });
  const older = doc({ tasks: [task("t", 400)] });
  const newer = doc({ tasks: [task("t", 600, "edited after delete")] });
  const m1 = mergeData(older, deleted);
  assert.equal(m1.tasks.length, 0);
  assert.equal(m1.tombstones.tasks.t, 500);
  const m2 = mergeData(newer, deleted);
  assert.equal(m2.tasks[0]!.title, "edited after delete");
  assert.equal(m2.tombstones.tasks.t, undefined);
  // equal stamps: the delete wins
  assert.equal(mergeData(doc({ tasks: [task("t", 500)] }), deleted).tasks.length, 0);
});

test("tombstones older than the cutoff are pruned", () => {
  const now = 100 * 24 * 3600 * 1000;
  const d = doc({ tombstones: { ...emptyData().tombstones, lists: { old: now - TOMBSTONE_TTL_MS - 1, fresh: now - 1000 } } });
  const merged = mergeData(d, emptyData(), { cutoff: now - TOMBSTONE_TTL_MS });
  assert.deepEqual(Object.keys(merged.tombstones.lists), ["fresh"]);
  assert.deepEqual(Object.keys(pruneTombstones(d, now - TOMBSTONE_TTL_MS).tombstones.lists), ["fresh"]);
});

test("a task added on top on another device lands on top after merge", () => {
  const local = doc({ tasks: [task("b", 1), task("c", 1)] });
  const remote = doc({ tasks: [task("new", 5), task("b", 1), task("c", 1)] });
  assert.deepEqual(
    mergeData(local, remote).tasks.map((t) => t.id),
    ["new", "b", "c"],
  );
});

test("settings: last writer wins by updatedAt", () => {
  const a = doc({ settings: { workStart: "08:00", workEnd: "17:00", updatedAt: 10 } });
  const b = doc({ settings: { workStart: "10:00", workEnd: "19:00", updatedAt: 20 } });
  assert.equal(mergeData(a, b).settings.workStart, "10:00");
  assert.equal(mergeData(b, a).settings.workStart, "10:00");
});

test("stampCollection stamps changed/new entities and tombstones removed ones", () => {
  const a = { id: "a", title: "A", updatedAt: 10 };
  const b = { id: "b", title: "B", updatedAt: 10 };
  type Row = { id: string; title: string; updatedAt?: number };
  const prev: Row[] = [a, b];
  const next: Row[] = [{ ...a, title: "A2" }, { id: "c", title: "C" }];
  const { items, tombs } = stampCollection(prev, next, {}, 1000);
  assert.deepEqual(
    items.map((i) => [i.id, i.updatedAt]),
    [
      ["a", 1000],
      ["c", 1000],
    ],
  );
  assert.deepEqual(tombs, { b: 1000 });
});

test("stampCollection keeps the stamp for content-identical copies and survives a clock behind", () => {
  const a = { id: "a", title: "A", updatedAt: 5000 };
  const same = stampCollection([a], [{ ...a }], {}, 9000);
  assert.equal(same.items[0]!.updatedAt, 5000);
  const behind = stampCollection([a], [{ ...a, title: "B" }], {}, 10);
  assert.equal(behind.items[0]!.updatedAt, 5001, "local edit must beat the version it edited");
  const untouched = stampCollection([a], [a], { x: 1 }, 10);
  assert.equal(untouched.items[0], a);
});

test("normalizeData accepts the legacy WebDAV/backup format and rejects junk", () => {
  const legacy = normalizeData({ updatedAt: 1, lists: [{ id: "l", name: "L" }], tasks: [{ id: "t", title: "T" }], workStart: "08:30" });
  assert.equal(legacy.ok, true);
  if (legacy.ok) {
    assert.equal(legacy.data.settings.workStart, "08:30");
    assert.equal(legacy.data.settings.updatedAt, 0);
    assert.equal(legacy.data.tasks.length, 1);
  }
  assert.equal(normalizeData(null).ok, false);
  assert.equal(normalizeData({ tasks: "x" }).ok, false);
  assert.equal(normalizeData({ tasks: [{ title: "no id" }] }).ok, false);
  assert.equal(normalizeData({ foo: 1 }).ok, false);
});
