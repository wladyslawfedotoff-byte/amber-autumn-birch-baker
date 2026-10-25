import { test } from "node:test";
import assert from "node:assert/strict";
import { honestDue, shortDate } from "./honest-due.ts";
import type { Asset } from "../planner-types.ts";

const car = (rules: unknown[], km: number | null = 100_000) =>
  ({ id: "a1", name: "Машина", kind: "car", km, rules, log: [], notes: "", pains: [], readings: [] }) as unknown as Asset;

test("shortDate", () => assert.equal(shortDate("2026-11-05"), "5 нояб."));

test("km rule not yet due: «через N км», calm", () => {
  const r = honestDue({ maint: "a1/r1", due: "2026-10-24" }, [car([{ id: "r1", title: "Масло", everyKm: 10_000, since: "2026-01-01", lastDoneKm: 90_300 }])], "2026-10-25");
  assert.deepEqual(r, { text: "через 300 км", tone: "muted" });
});

test("date rule: «до 5 нояб.» even though the reminder day has passed", () => {
  const r = honestDue({ maint: "a1/r1", due: "2026-10-20" }, [car([{ id: "r1", title: "ОСАГО", everyMonths: 12, since: "2025-11-05" }])], "2026-10-25");
  assert.deepEqual(r, { text: "до 5 нояб.", tone: "muted" });
});

test("really overdue: red", () => {
  const r = honestDue({ maint: "a1/r1", due: "2026-10-01" }, [car([{ id: "r1", title: "Масло", everyKm: 10_000, since: "2026-01-01", lastDoneKm: 89_600 }])], "2026-10-25");
  assert.deepEqual(r, { text: "просрочено: 400 км", tone: "danger" });
});

test("unknown ref falls back to a calm «пора»", () => {
  assert.deepEqual(honestDue({ maint: "a1/km", due: "2026-10-24" }, [car([])], "2026-10-25"), { text: "пора", tone: "accent" });
});

import { isTaskOverdue } from "./honest-due.ts";

test("isTaskOverdue: plain tasks by date", () => {
  assert.equal(isTaskOverdue({ due: "2026-10-24", done: false }, [], "2026-10-25"), true);
  assert.equal(isTaskOverdue({ due: "2026-10-25", done: false }, [], "2026-10-25"), false);
  assert.equal(isTaskOverdue({ due: "2026-10-24", done: true }, [], "2026-10-25"), false);
});

test("isTaskOverdue: maintenance only when the rule is really late", () => {
  const notYet = [car([{ id: "r1", title: "Масло", everyKm: 10_000, since: "2026-01-01", lastDoneKm: 90_300 }])];
  assert.equal(isTaskOverdue({ maint: "a1/r1", due: "2026-10-20", done: false }, notYet, "2026-10-25"), false);
  const late = [car([{ id: "r1", title: "Масло", everyKm: 10_000, since: "2026-01-01", lastDoneKm: 89_600 }])];
  assert.equal(isTaskOverdue({ maint: "a1/r1", due: "2026-10-20", done: false }, late, "2026-10-25"), true);
  // mileage prompt whose day passed: calm, not late
  assert.equal(isTaskOverdue({ maint: "a1/km", due: "2026-10-20", done: false }, notYet, "2026-10-25"), false);
});
