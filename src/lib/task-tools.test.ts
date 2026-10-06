import assert from "node:assert/strict";
import test from "node:test";
import type { Task } from "./planner-types.ts";
import { mergeData, emptyData, stampCollection, type SyncEntity } from "./sync/merge.ts";
import { duplicateTask, listInNotes, notesPreview, progressLabel, splitLines, subtaskProgress } from "./task-tools.ts";

const base: Task = {
  id: "t1",
  title: "Отчёт",
  notes: "Квартальный",
  listId: "work",
  done: true,
  priority: 2,
  due: "2026-10-06",
  tags: ["работа"],
  subtasks: [
    { id: "s1", title: "Собрать цифры", done: true },
    { id: "s2", title: "Графики", done: false },
  ],
  createdAt: 1,
  completedAt: 5,
  important: true,
  repeat: "week",
  members: ["user2"],
  assignee: "user2",
  owner: "user1",
  completedBy: "user1",
  updatedAt: 100,
} as Task;

test("duplicateTask: new id, same content, subtasks unticked with new ids, private, not done", () => {
  let n = 0;
  const copy = duplicateTask(base, { id: "t2", newSubId: () => `n${++n}`, now: 500 });
  assert.equal(copy.id, "t2");
  assert.equal(copy.title, "Отчёт");
  assert.equal(copy.notes, "Квартальный");
  assert.equal(copy.listId, "work");
  assert.equal(copy.priority, 2);
  assert.equal(copy.important, true);
  assert.deepEqual(copy.tags, ["работа"]);
  assert.notEqual(copy.tags, base.tags, "a fresh array");
  assert.deepEqual(copy.subtasks, [
    { id: "n1", title: "Собрать цифры", done: false },
    { id: "n2", title: "Графики", done: false },
  ]);
  assert.equal(copy.done, false);
  assert.equal(copy.completedAt, null);
  assert.equal(copy.due, "2026-10-06");
  assert.equal(copy.createdAt, 500);
  for (const key of ["repeat", "members", "assignee", "owner", "completedBy", "updatedAt"]) {
    assert.equal(key in copy, false, `${key} is not copied`);
  }
  assert.equal(duplicateTask(base, { id: "t3", newSubId: () => "x", now: 1, due: "2026-12-31" }).due, "2026-12-31");
  assert.equal(duplicateTask(base, { id: "t4", newSubId: () => "y", now: 1, due: null }).due, null);
});

test("duplicateTask is merge-safe: the copy gets fresh stamps and survives a merge with an older server copy", () => {
  const original = { ...base, _b: 100, _f: { title: 100 } } as unknown as SyncEntity;
  const before = [original];
  const copy = duplicateTask(base, { id: "t2", newSubId: () => "c1", now: 0 });
  const stamped = stampCollection(before, [original, copy as unknown as SyncEntity], {}, 9000, "tasks");
  const fresh = stamped.items.find((t) => t.id === "t2")!;
  assert.equal(fresh.updatedAt, 9000, "stamped as a brand-new entity");
  assert.equal("_b" in fresh, false);
  const server = { ...emptyData(), tasks: [original] };
  const local = { ...emptyData(), tasks: stamped.items };
  const merged = mergeData(server, local);
  assert.deepEqual(merged.tasks.map((t) => t.id).sort(), ["t1", "t2"]);
  assert.equal((merged.tasks.find((t) => t.id === "t1")!.subtasks as SyncEntity[]).length, 2, "the original is untouched");
});

test("subtask progress and labels", () => {
  assert.deepEqual(subtaskProgress(base), { done: 1, total: 2 });
  assert.equal(progressLabel(subtaskProgress(base)), "1/2");
  assert.equal(progressLabel(subtaskProgress({ subtasks: [] })), "");
});

test("lists typed into notes become subtasks; plain lines stay notes", () => {
  const notes = "Что взять:\n- паспорт\n• зарядка\n1. билеты\n[ ] страховка\n[x] наличные\n- [ ] крем\n\nСпросить про трансфер";
  assert.deepEqual(listInNotes(notes), {
    items: ["паспорт", "зарядка", "билеты", "страховка", "наличные", "крем"],
    rest: "Что взять:\n\nСпросить про трансфер",
  });
  assert.deepEqual(listInNotes("Просто заметка\nбез списка"), { items: [], rest: "Просто заметка\nбез списка" });
  assert.deepEqual(splitLines("- молоко\nхлеб\n\n  2) сыр "), ["молоко", "хлеб", "сыр"]);
  assert.equal(notesPreview("\n  Первая строка  \nвторая"), "Первая строка");
  assert.equal(notesPreview("x".repeat(100), 10), "xxxxxxxxx…");
});
