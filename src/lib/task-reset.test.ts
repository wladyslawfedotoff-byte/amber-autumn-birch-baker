import assert from "node:assert/strict";
import test from "node:test";
import type { Task } from "./planner-types";
import { clearDate, clearTime } from "./task-tools.ts";
import { emptyData, mergeData, stampCollection, type SyncData, type SyncEntity } from "./sync/merge.ts";
import { applyPut, viewFor, type AclConfig, type WorldDoc } from "./sync/world.ts";

const T0 = 1_791_700_000_000;

function timed(fields: Partial<Task> = {}): Task {
  return {
    id: "t1", title: "Созвон", notes: "", listId: null, done: false, priority: 0, due: "2026-10-12", tags: [], subtasks: [],
    createdAt: T0, completedAt: null, remindAt: "10:00", startAt: "10:00", endAt: "11:00", ...fields,
  };
}

const e = (t: Task) => t as unknown as SyncEntity;

function edit(data: SyncData, change: (t: Task) => Task, now: number): SyncData {
  const next = data.tasks.map((t) => e(change({ ...(t as unknown as Task) })));
  const stamped = stampCollection(data.tasks, next, data.tombstones.tasks, now, "tasks");
  return { ...data, tasks: stamped.items, tombstones: { ...data.tombstones, tasks: stamped.tombs } };
}

test("«Без времени» keeps the date, drops start/end/alarm (null, not undefined)", () => {
  const t = clearTime(timed());
  assert.equal(t.due, "2026-10-12");
  assert.equal(t.startAt, null);
  assert.equal(t.endAt, null);
  assert.equal(t.remindAt, null);
  assert.ok("startAt" in t && "endAt" in t && "remindAt" in t, "fields kept as null so the sync stamps them");
});

test("«Без даты» drops date, time and the repeat", () => {
  const t = clearDate(timed({ repeat: "dates", repeatDates: ["2026-10-12", "2026-10-20"] }));
  assert.equal(t.due, null);
  assert.equal(t.startAt, null);
  assert.equal(t.repeat, null);
  assert.deepEqual(t.repeatDates, []);
});

test("sync: a cleared time / date wins over the older timed copy on the other device, both merge orders", () => {
  const base: SyncData = { ...emptyData(), tasks: [e({ ...timed(), updatedAt: T0 } as Task)] };
  const phone = edit(base, clearTime, T0 + 100);
  for (const merged of [mergeData(phone, base), mergeData(base, phone)]) {
    const t = merged.tasks[0]!;
    assert.equal(t.startAt, null);
    assert.equal(t.endAt, null);
    assert.equal(t.remindAt, null);
    assert.equal(t.due, "2026-10-12");
  }
  // Concurrent edit of another field on the computer survives; the clear does too.
  const computer = edit(base, (t) => ({ ...t, title: "Созвон с командой" }), T0 + 200);
  const both = mergeData(computer, phone).tasks[0]!;
  assert.equal(both.title, "Созвон с командой");
  assert.equal(both.startAt, null);
  // Clearing the date later: also propagates.
  const undated = edit(phone, clearDate, T0 + 300);
  assert.equal(mergeData(computer, undated).tasks[0]!.due, null);
  // Even a field that was deleted (undefined) instead of nulled is recorded as a change.
  const dropped = edit(base, (t) => {
    const copy = { ...t };
    delete copy.startAt;
    return copy;
  }, T0 + 400);
  assert.equal(mergeData(base, dropped).tasks[0]!.startAt, undefined);
});

test("sync with profiles: user2 clears the time of a shared task → user1 sees it all-day", () => {
  const cfg: AclConfig = { owner: "user1", users: ["user1", "user2"] };
  const shared = e({ ...timed({ owner: "user1", members: ["user2"] }), updatedAt: T0 } as Task);
  let doc: WorldDoc = { revision: 1, updatedAt: T0, data: { ...emptyData(), tasks: [shared] }, users: {} };
  const mine = viewFor(doc, "user2", cfg, T0).data;
  doc = applyPut(doc, "user2", edit(mine, clearTime, T0 + 50), cfg, T0 + 60).doc;
  const seen = viewFor(doc, "user1", cfg, T0 + 70).data;
  assert.equal(seen.tasks[0]!.startAt, null);
  // user1's device with the old timed copy: merging keeps it cleared.
  const device = mergeData({ ...emptyData(), tasks: [shared] }, seen);
  assert.equal(device.tasks[0]!.startAt, null);
  assert.equal(device.tasks[0]!.due, "2026-10-12");
});
