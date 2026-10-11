import assert from "node:assert/strict";
import test from "node:test";
import { bestStreak, completion, currentStreak, monthGrid, shiftMonth } from "./habit-stats.ts";

const TODAY = "2026-10-11";

test("streaks: current (today or up to yesterday) and best ever", () => {
  const checks = ["2026-10-11", "2026-10-10", "2026-10-09", "2026-09-01", "2026-09-02", "2026-09-03", "2026-09-04", "2026-09-05"];
  assert.equal(currentStreak(checks, TODAY), 3);
  assert.equal(currentStreak(["2026-10-10", "2026-10-09"], TODAY), 2, "today not ticked yet still counts the run");
  assert.equal(currentStreak(["2026-10-08"], TODAY), 0);
  assert.equal(bestStreak(checks, TODAY), 5);
  assert.equal(bestStreak([], TODAY), 0);
  assert.equal(bestStreak(["2026-12-31", "2027-01-01"], "2027-01-01"), 2, "across years");
  assert.equal(bestStreak(["2026-10-12", "2026-10-13"], TODAY), 0, "future ignored");
});

test("completion over the last 30 days", () => {
  const checks = Array.from({ length: 15 }, (_, i) => `2026-10-${String(11 - i).padStart(2, "0")}`).filter((d) => d >= "2026-10-01");
  const result = completion(checks, TODAY, 30);
  assert.equal(result.done, checks.length);
  assert.equal(result.percent, Math.round((checks.length / 30) * 100));
  assert.equal(completion([], TODAY).percent, 0);
});

test("month heatmap: Monday-first weeks with padding", () => {
  const weeks = monthGrid("2026-10", ["2026-10-01", "2026-10-11"], TODAY);
  // 1 October 2026 is a Thursday → three empty cells first.
  assert.equal(weeks[0]![0], null);
  assert.equal(weeks[0]![3]!.day, "2026-10-01");
  assert.equal(weeks[0]![3]!.on, true);
  assert.ok(weeks.every((week) => week.length === 7));
  const cells = weeks.flat().filter(Boolean);
  assert.equal(cells.length, 31);
  assert.equal(cells.find((c) => c!.day === "2026-10-12")!.future, true);
  assert.equal(shiftMonth("2026-01", -1), "2025-12");
  assert.equal(shiftMonth("2026-12", 1), "2027-01");
});
