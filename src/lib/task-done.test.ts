import assert from "node:assert/strict";
import test from "node:test";
import type { Task } from "./planner-types";
import {
  archivedTasks,
  isArchived,
  normalizeArchiveDays,
  recentDone,
  repeatTickedOn,
  restoreFromArchive,
  toggleTaskDone,
  undoRepeatTick,
  DAY_MS,
} from "./task-done.ts";
import { emptyData, mergeData, normalizeData, pickSettings, stampCollection, type SyncData, type SyncEntity } from "./sync/merge.ts";
import { applyPut, viewFor, type AclConfig, type WorldDoc } from "./sync/world.ts";

const T0 = 1_791_700_000_000; // 2026-10-11
const TODAY = "2026-10-11";

function task(fields: Partial<Task> = {}): Task {
  return { id: "t1", title: "Задача", notes: "", listId: null, done: false, priority: 0, due: TODAY, tags: [], subtasks: [], createdAt: T0 - 1000, completedAt: null, ...fields };
}

test("«Выполнить»: a plain task becomes done with completedAt/completedBy; again → back in work", () => {
  const done = toggleTaskDone(task(), { me: "user1", today: TODAY, now: T0 });
  assert.equal(done.done, true);
  assert.equal(done.completedAt, T0);
  assert.equal(done.completedBy, "user1");
  const back = toggleTaskDone(done, { me: "user1", today: TODAY, now: T0 + 5 });
  assert.equal(back.done, false);
  assert.equal(back.completedAt, null);
  assert.equal(back.completedBy, null);
});

test("repeating task: the tick is remembered (shown in «Готово» today) and «Отменить» restores the date", () => {
  const ticked = toggleTaskDone(task({ repeat: "day" }), { me: null, today: TODAY, now: T0 });
  assert.equal(ticked.done, false);
  assert.equal(ticked.due, "2026-10-12");
  assert.equal(ticked.lastDue, TODAY);
  assert.equal(ticked.completedAt, T0);
  assert.equal(repeatTickedOn(ticked, TODAY), true);
  assert.equal(repeatTickedOn(ticked, "2026-10-12"), false, "gone from «Готово» the next day");
  const undone = undoRepeatTick(ticked);
  assert.equal(undone.due, TODAY);
  assert.equal(undone.completedAt, null);
  assert.equal(repeatTickedOn(undone, TODAY), false);
});

test("«Выбранные даты»: the last date ticked → done", () => {
  const last = toggleTaskDone(task({ repeat: "dates", repeatDates: [TODAY] }), { me: null, today: TODAY, now: T0 });
  assert.equal(last.done, true);
  assert.equal(last.completedAt, T0);
});

test("auto-archive: done tasks older than N days; 0 = never; restore reopens", () => {
  const fresh = task({ id: "a", done: true, completedAt: T0 - 2 * DAY_MS });
  const old = task({ id: "b", done: true, completedAt: T0 - 8 * DAY_MS });
  const open = task({ id: "c" });
  assert.equal(isArchived(fresh, T0, 7), false);
  assert.equal(isArchived(old, T0, 7), true);
  assert.equal(isArchived(fresh, T0, 1), true);
  assert.equal(isArchived(old, T0, 0), false, "never");
  assert.deepEqual(recentDone([open, old, fresh], T0, 7).map((t) => t.id), ["a"]);
  assert.deepEqual(archivedTasks([open, old, fresh], T0, 7).map((t) => t.id), ["b"]);
  assert.deepEqual(archivedTasks([open, old, fresh], T0, 30), []);
  const restored = restoreFromArchive(old);
  assert.equal(restored.done, false);
  assert.equal(restored.completedAt, null);
  assert.equal(normalizeArchiveDays(5), 5);
  assert.equal(normalizeArchiveDays(4), 7);
  assert.equal(normalizeArchiveDays(undefined), 7);
});

test("archive setting survives sync normalization and the newer setting wins", () => {
  const parsed = normalizeData({ tasks: [], settings: { workStart: "09:00", workEnd: "18:00", archiveDays: 30, updatedAt: 5 } });
  assert.ok(parsed.ok);
  if (!parsed.ok) return;
  assert.equal(parsed.data.settings.archiveDays, 30);
  const bad = normalizeData({ tasks: [], settings: { archiveDays: 4, updatedAt: 5 } });
  assert.ok(bad.ok && bad.data.settings.archiveDays === undefined);
  const a = { workStart: "09:00", workEnd: "18:00", archiveDays: 1, updatedAt: 10 };
  const b = { workStart: "09:00", workEnd: "18:00", updatedAt: 5 };
  assert.equal(pickSettings(a, b).archiveDays, 1);
});

// ---- sync round-trip: a completion is never lost -----------------------------

function asEntity(t: Task): SyncEntity {
  return t as unknown as SyncEntity;
}

function edit(data: SyncData, change: (t: SyncEntity) => SyncEntity, now: number): SyncData {
  const next = data.tasks.map((t) => change({ ...t }));
  const stamped = stampCollection(data.tasks, next, data.tombstones.tasks, now, "tasks");
  return { ...data, tasks: stamped.items, tombstones: { ...data.tombstones, tasks: stamped.tombs } };
}

test("sync: ticking on the phone survives a stale copy on the computer, and a concurrent edit of another field", () => {
  const base = { ...emptyData(), tasks: [asEntity(task({ updatedAt: T0 } as Partial<Task>))] };
  const phone = edit(base, (t) => asEntity(toggleTaskDone(t as unknown as Task, { me: null, today: TODAY, now: T0 + 100 })), T0 + 100);
  // The computer renamed the task a bit later, without knowing about the tick.
  const computer = edit(base, (t) => ({ ...t, title: "Задача (переименована)" }), T0 + 200);
  for (const merged of [mergeData(phone, computer), mergeData(computer, phone)]) {
    const t = merged.tasks[0]!;
    assert.equal(t.done, true, "done kept");
    assert.equal(t.completedAt, T0 + 100);
    assert.equal(t.title, "Задача (переименована)");
  }
  // An untouched old copy (e.g. a device that was offline) does not undo it either.
  const back = mergeData(base, phone);
  assert.equal(back.tasks[0]!.done, true);
});

test("sync with profiles: a shared task ticked by user2 shows as done for user1 (completedBy set by the server)", () => {
  const cfg: AclConfig = { owner: "user1", users: ["user1", "user2"] };
  const shared = asEntity(task({ owner: "user1", members: ["user2"], updatedAt: T0 } as Partial<Task>));
  let doc: WorldDoc = { revision: 1, updatedAt: T0, data: { ...emptyData(), tasks: [shared] }, users: {} };
  const user2 = viewFor(doc, "user2", cfg, T0).data;
  const ticked = edit(user2, (t) => asEntity(toggleTaskDone(t as unknown as Task, { me: "user2", today: TODAY, now: T0 + 50 })), T0 + 50);
  doc = applyPut(doc, "user2", ticked, cfg, T0 + 60).doc;
  const user1 = viewFor(doc, "user1", cfg, T0 + 70).data.tasks[0]!;
  assert.equal(user1.done, true);
  assert.equal(user1.completedBy, "user2");
  assert.equal(user1.completedAt, T0 + 50);
  // user1's device still holds the old copy: merging keeps it done.
  const device = mergeData({ ...emptyData(), tasks: [shared] }, viewFor(doc, "user1", cfg, T0 + 70).data);
  assert.equal(device.tasks[0]!.done, true);
  // Private tasks of user1 stay invisible to user2 — completion included.
  const priv = asEntity(task({ id: "p", owner: "user1", done: true, completedAt: T0, updatedAt: T0 } as Partial<Task>));
  const doc2: WorldDoc = { revision: 1, updatedAt: T0, data: { ...emptyData(), tasks: [priv] }, users: {} };
  assert.deepEqual(viewFor(doc2, "user2", cfg, T0).data.tasks, []);
});
