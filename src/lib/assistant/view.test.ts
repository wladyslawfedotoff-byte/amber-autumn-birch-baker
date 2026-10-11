import { test } from "node:test";
import assert from "node:assert/strict";
import { diffLines, dotColor, withoutPlanLines } from "./view.ts";

const TODAY = "2026-10-11";

test("«было → стало»: only changed fields, from the stored values", () => {
  const item = { op: "update" as const, key: "k", taskId: "a", taskTitle: "Позвонить в банк", due: "2026-10-12", start: "10:00", end: null, priority: 3 as const, was: { due: "2026-10-09", start: null, end: null, priority: 0 as const } };
  assert.deepEqual(diffLines(item, undefined, null, TODAY), [
    { label: "Срок", was: "9 окт.", now: "завтра" },
    { label: "Время", was: "без времени", now: "10:00" },
    { label: "Приоритет", was: "нет", now: "высокий" },
  ]);
  // Same value: nothing to show.
  assert.deepEqual(diffLines({ op: "update", key: "k", taskId: "a", taskTitle: "x", due: "2026-10-12", was: { due: "2026-10-12" } }, undefined, null, TODAY), []);
  // No stored «было» (older cards): the task as it is now.
  assert.deepEqual(diffLines({ op: "update", key: "k", taskId: "a", taskTitle: "x", list: "Работа" }, { due: null, startAt: null, endAt: null, priority: 0 }, null, TODAY), [{ label: "Список", was: "Входящие", now: "Работа" }]);
});

test("dot colour: own colour, else priority, else grey", () => {
  assert.equal(dotColor({ color: "tomato", priority: 0 }), "#c8483f");
  assert.equal(dotColor({ color: null, priority: 3 }), "var(--danger)");
  assert.equal(dotColor({ color: null, priority: 0 }), "var(--subtle)");
});

test("a reply over a timeline card drops its «HH:mm — задача» lines", () => {
  assert.equal(withoutPlanLines("09:00 — Письмо клиенту\n- **10:30–12:00** — Отчёт\n13:00 - Обед"), "");
  assert.equal(withoutPlanLines("Плотный день.\n09:00 — Письмо клиенту"), "Плотный день.");
});
