import assert from "node:assert/strict";
import test from "node:test";
import type { Task } from "./planner-types";
import { removeTask, restoreDeleted } from "./task-undo.ts";
import { emptyData, stampCollection, type SyncData, type SyncEntity } from "./sync/merge.ts";
import { applyPut, viewFor, type AclConfig, type WorldDoc } from "./sync/world.ts";

const T0 = 1_791_700_000_000;
function task(fields: Partial<Task> = {}): Task {
  return { id: "t1", title: "Задача", notes: "", listId: null, done: false, priority: 0, due: "2026-10-11", tags: [], subtasks: [], createdAt: T0 - 1000, completedAt: null, ...fields };
}
const rich = task({ id: "b", notes: "заметка", tags: ["дом"], remindAt: "09:00", subtasks: [{ id: "s1", title: "шаг", done: true }] } as Partial<Task>);

test("delete → restore: the same task, same place, dependents wait for it again", () => {
  const list = [task({ id: "a" }), rich, task({ id: "c", dependsOn: "b" } as Partial<Task>)];
  const { tasks, deleted } = removeTask(list, "b");
  assert.deepEqual(tasks.map((t) => t.id), ["a", "c"]);
  assert.equal(tasks[1]!.dependsOn, null);
  const back = restoreDeleted(tasks, deleted!);
  assert.deepEqual(back.map((t) => t.id), ["a", "b", "c"]);
  assert.deepEqual(back[1], rich);
  assert.equal(back[2]!.dependsOn, "b");
  assert.equal(restoreDeleted(back, deleted!).length, 3, "twice does not duplicate");
});

function stamp(data: SyncData, next: Task[], now: number): SyncData {
  const s = stampCollection(data.tasks, next as unknown as SyncEntity[], data.tombstones.tasks, now, "tasks");
  return { ...data, tasks: s.items, tombstones: { ...data.tombstones, tasks: s.tombs } };
}

test("sync: a delete that reached the server is undone by «Вернуть»", () => {
  const cfg: AclConfig = { owner: "user1", users: ["user1"] };
  let device = stamp(emptyData(), [rich], T0);
  let doc: WorldDoc = { revision: 1, updatedAt: T0, data: device, users: {} };
  const removed = removeTask(device.tasks as unknown as Task[], "b");
  device = stamp(device, removed.tasks, T0 + 10);
  assert.ok(device.tombstones.tasks.b);
  doc = applyPut(doc, "user1", device, cfg, T0 + 20).doc;
  assert.equal(viewFor(doc, "user1", cfg, T0 + 25).data.tasks.length, 0);
  device = stamp(device, restoreDeleted(device.tasks as unknown as Task[], removed.deleted!), T0 + 30);
  assert.equal(device.tombstones.tasks.b, undefined);
  doc = applyPut(doc, "user1", device, cfg, T0 + 40).doc;
  const back = viewFor(doc, "user1", cfg, T0 + 45).data.tasks;
  assert.equal(back.length, 1);
  assert.equal(back[0]!.notes, "заметка");
  assert.deepEqual((back[0]!.subtasks as unknown[]).length, 1);
});
