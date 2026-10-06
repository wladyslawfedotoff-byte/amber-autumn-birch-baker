import assert from "node:assert/strict";
import test from "node:test";
import { cleanDates, firstChosenDate, nextChosenDate, occursOn, repeatLabel, taskDates } from "./dates.ts";

const DATES = ["2026-12-24", "2026-10-07", "2026-11-03", "2026-10-07", "bad", "2027-01-15"];

test("«Выбранные даты»: dates are cleaned and sorted, across months and years", () => {
  assert.deepEqual(cleanDates(DATES), ["2026-10-07", "2026-11-03", "2026-12-24", "2027-01-15"]);
  assert.deepEqual(cleanDates(undefined), []);
  assert.equal(repeatLabel("dates", cleanDates(DATES)), "выбранные даты (4)");
});

test("«Выбранные даты»: ticking off moves to the next chosen date; none left → null (done)", () => {
  // on time
  assert.equal(nextChosenDate(DATES, "2026-10-07", "2026-10-07"), "2026-11-03");
  // done early (before the date)
  assert.equal(nextChosenDate(DATES, "2026-11-03", "2026-10-20"), "2026-12-24");
  // overdue: missed dates are skipped, today's date is still to do
  assert.equal(nextChosenDate(DATES, "2026-10-07", "2026-12-24"), "2026-12-24");
  assert.equal(nextChosenDate(DATES, "2026-10-07", "2026-12-25"), "2027-01-15");
  // last one
  assert.equal(nextChosenDate(DATES, "2027-01-15", "2027-01-15"), null);
});

test("«Выбранные даты»: after editing the set, due = first date from today on (else the last)", () => {
  assert.equal(firstChosenDate(DATES, "2026-10-08"), "2026-11-03");
  assert.equal(firstChosenDate(DATES, "2026-10-07"), "2026-10-07");
  assert.equal(firstChosenDate(DATES, "2027-02-01"), "2027-01-15");
  assert.equal(firstChosenDate([], "2027-02-01"), null);
});

test("«Выбранные даты»: the task shows exactly on the pending chosen dates", () => {
  const task = { due: "2026-11-03", repeat: "dates" as const, repeatDates: cleanDates(DATES), done: false };
  assert.deepEqual(taskDates(task), ["2026-11-03", "2026-12-24", "2027-01-15"]);
  assert.equal(occursOn(task, "2026-12-24"), true);
  assert.equal(occursOn(task, "2026-10-07"), false, "already done");
  assert.equal(occursOn(task, "2026-12-25"), false, "not chosen");
  assert.equal(occursOn({ ...task, done: true }, "2026-12-24"), false);
  const plain = { due: "2026-11-03", repeat: "week" as const, done: false };
  assert.equal(occursOn(plain, "2026-11-03"), true);
  assert.equal(occursOn(plain, "2026-11-10"), false, "other repeats show the current date only (as before)");
});
