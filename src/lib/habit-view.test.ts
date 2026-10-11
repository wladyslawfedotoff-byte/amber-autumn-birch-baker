import assert from "node:assert/strict";
import test from "node:test";
import type { Habit } from "./planner-types";
import { withEntry } from "./habit-plan.ts";
import {
  amountOn,
  checkinDraft,
  checkinPatch,
  dayProgress,
  habitSubline,
  monthBars,
  monthDays,
  monthStats,
  reminderSummary,
  reorderSection,
} from "./habit-view.ts";

// 2026-10-11 is a Sunday.
const TODAY = "2026-10-11";

function habit(fields: Partial<Habit> = {}): Habit {
  return { id: "h1", name: "Вода", checks: [], createdAt: new Date(2026, 8, 1).getTime(), ...fields };
}

test("amount and ring progress: simple and goal habits", () => {
  const simple = habit({ checks: [TODAY] });
  assert.equal(amountOn(simple, TODAY), 1);
  assert.equal(dayProgress(simple, "2026-10-10"), 0);
  const water = habit({ goal: 8, unit: "стаканов", checks: ["2026-10-09"], log: [{ id: TODAY, amount: 2 }, { id: "2026-10-09", amount: 9 }] });
  assert.equal(amountOn(water, TODAY), 2);
  assert.equal(dayProgress(water, TODAY), 0.25);
  assert.equal(amountOn(water, "2026-10-09"), 9);
  assert.equal(dayProgress(water, "2026-10-09"), 1);
});

test("month stats: check-ins, volume, streaks; bars stop at today", () => {
  const water = habit({
    goal: 4,
    checks: ["2026-10-07", "2026-10-08", "2026-09-30"],
    log: [
      { id: "2026-10-07", amount: 4 },
      { id: "2026-10-08", amount: 5 },
      { id: TODAY, amount: 1 },
      { id: "2026-09-30", amount: 4 },
    ],
  });
  const s = monthStats(water, "2026-10", TODAY);
  assert.equal(s.monthChecks, 2);
  assert.equal(s.totalChecks, 3);
  assert.equal(s.monthVolume, 10);
  assert.equal(s.totalVolume, 14);
  assert.equal(s.best, 2);
  const bars = monthBars(water, "2026-10", TODAY);
  assert.equal(bars.length, 31);
  assert.equal(bars[7]!.amount, 5);
  assert.equal(bars[11]!.amount, null, "future day");
  assert.equal(monthDays("2026-02").length, 28);
});

test("reminder summary is short", () => {
  assert.equal(reminderSummary({ reminders: [] }), "Нет");
  assert.equal(reminderSummary({ reminders: ["10:00"] }), "10:00");
  assert.equal(reminderSummary({ reminders: ["18:00", "10:00"] }), "10:00 и 18:00");
  assert.equal(reminderSummary({ reminders: ["08:30", "10:00", "12:00", "14:00", "16:00", "18:00", "20:00", "22:00"] }), "8 напоминаний, 08:30–22:00");
  assert.equal(reminderSummary({ reminders: ["09:00", "13:00", "18:00"] }), "3 напоминания, 09:00–18:00");
});

test("row subline: amount of goal and streak", () => {
  const water = habit({ goal: 8, unit: "стаканов", checks: ["2026-10-10"], log: [{ id: TODAY, amount: 5 }] });
  assert.equal(habitSubline(water, TODAY, "каждый день"), "5/8 стаканов · 🔥 1");
  assert.equal(habitSubline(habit(), TODAY, "по будням"), "по будням");
});

test("drag reorder inside a section", () => {
  const list = [
    habit({ id: "a", name: "А", order: 1 }),
    habit({ id: "b", name: "Б", order: 2 }),
    habit({ id: "c", name: "В", order: 3 }),
    habit({ id: "m", name: "Утро", section: "morning", order: 1 }),
    habit({ id: "z", name: "Архив", order: 0, archived: true }),
  ];
  assert.deepEqual(reorderSection(list, "c", 0), ["c", "a", "b"]);
  assert.deepEqual(reorderSection(list, "a", 9), ["b", "c", "a"]);
  assert.deepEqual(reorderSection(list, "m", 0), ["m"]);
  assert.deepEqual(reorderSection(list, "nope", 0), []);
});

test("check-in sheet: draft from the day and the patch it saves", () => {
  const water = habit({ goal: 4, unit: "кружек" });
  assert.deepEqual(checkinDraft(water, TODAY), { status: "done", amount: 4, mood: null, note: "" });
  // Saving «Выполнено, 4 кружки, 😄, заметка» marks the day done.
  const saved = withEntry(water, TODAY, checkinPatch(water, { status: "done", amount: 4, mood: 5, note: " Легко " }));
  assert.ok(saved.checks.includes(TODAY));
  assert.deepEqual(saved.log, [{ id: TODAY, amount: 4, mood: 5, note: "Легко", status: null }]);
  // Less than the goal: partial, not done.
  const partial = withEntry(water, TODAY, checkinPatch(water, { status: "done", amount: 2, mood: null, note: "" }));
  assert.equal(partial.checks.includes(TODAY), false);
  assert.equal(checkinDraft(partial, TODAY).amount, 2);
  // «Пропуск» and «Не выполнено» clear the check.
  const skipped = withEntry(saved, TODAY, checkinPatch(water, { status: "skip", amount: 0, mood: null, note: "" }));
  assert.equal(skipped.checks.includes(TODAY), false);
  assert.equal(checkinDraft(skipped, TODAY).status, "skip");
  const simple = habit();
  const done = withEntry(simple, TODAY, checkinPatch(simple, { status: "done", amount: 1, mood: null, note: "" }));
  assert.deepEqual(done.checks, [TODAY]);
  const failed = withEntry(done, TODAY, checkinPatch(simple, { status: "fail", amount: 1, mood: 2, note: "" }));
  assert.deepEqual(failed.checks, []);
  assert.equal(checkinDraft(failed, TODAY).status, "fail");
});
