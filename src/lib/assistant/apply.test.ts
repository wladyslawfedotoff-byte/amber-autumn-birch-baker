import assert from "node:assert/strict";
import test from "node:test";
import { applyItems, type ApplyApi } from "./apply.ts";
import type { ProposalItem } from "./types.ts";

function fakeApi() {
  const log: string[] = [];
  let n = 0;
  const api: ApplyApi = {
    lists: [{ id: "l1", name: "Работа" }],
    tasks: [
      { id: "t1", done: false },
      { id: "t2", done: true },
    ],
    addList: (name) => (log.push(`list ${name}`), `L${++n}`),
    addTask: (input) => (log.push(`task ${input.title} ${input.listId} ${input.due} ${input.startAt ?? "-"}`), `T${++n}`),
    updateTask: (id, patch) => log.push(`update ${id} ${JSON.stringify(patch)}`),
    toggleTask: (id) => log.push(`done ${id}`),
    addSubtask: (id, title) => log.push(`step ${id} ${title}`),
    addHabit: (name, extra) => (log.push(`habit ${name} ${extra?.goal ?? "-"}`), `H${++n}`),
  };
  return { api, log };
}

test("apply: creates, updates, completes through store actions", () => {
  const { api, log } = fakeApi();
  const items: ProposalItem[] = [
    { op: "create", key: "a", title: "Слайды", due: "2026-10-12", start: "10:00", end: "11:00", list: "работа", priority: 2, subtasks: ["План"], notes: "" },
    { op: "create", key: "b", title: "Хлеб", due: null, start: "09:00", end: null, list: "Дом", priority: 0, subtasks: [], notes: "" },
    { op: "create", key: "c", title: "Молоко", due: null, start: null, end: null, list: "Дом", priority: 0, subtasks: [], notes: "" },
    { op: "update", key: "d", taskId: "t1", taskTitle: "Отчёт", start: "12:00", due: "2026-10-12" },
    { op: "complete", key: "e", taskId: "t2", taskTitle: "Уже сделано" },
    { op: "complete", key: "f", taskId: "t1", taskTitle: "Отчёт" },
    { op: "subtasks", key: "g", taskId: "gone", taskTitle: "Удалена", steps: ["x"] },
    { op: "habit", key: "h", name: "Вода", goal: 8, unit: "стаканов", section: "morning", freq: { kind: "daily" } },
  ];
  assert.deepEqual(applyItems(items, api), { applied: 6, skipped: 2 });
  assert.deepEqual(log, [
    "task Слайды l1 2026-10-12 10:00",
    "step T1 План",
    "list Дом",
    "task Хлеб L2 null -",
    "task Молоко L2 null -",
    'update t1 {"due":"2026-10-12","startAt":"12:00"}',
    "done t1",
    "habit Вода 8",
  ]);
});
