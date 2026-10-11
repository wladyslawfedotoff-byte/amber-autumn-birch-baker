import assert from "node:assert/strict";
import test from "node:test";
import type { Milestone } from "./planner-types";
import { ageLabel, daysLeftLabel, inYear, nextOccurrence, occursOnDay, upcoming, yearsAt } from "./special-dates.ts";
import { plural } from "./plural.ts";

function item(fields: Partial<Milestone>): Milestone {
  return { id: "m", title: "Дата", date: "1991-10-23", yearly: true, kind: "birthday", ...fields };
}

test("Russian plurals", () => {
  const f = ["день", "дня", "дней"] as const;
  assert.deepEqual([1, 2, 5, 11, 12, 14, 21, 22, 25, 101, 111].map((n) => plural(n, f)), [
    "день", "дня", "дней", "дней", "дней", "дней", "день", "дня", "дней", "день", "дней",
  ]);
  assert.equal(daysLeftLabel(12), "через 12 дней");
  assert.equal(daysLeftLabel(21), "через 21 день");
  assert.equal(daysLeftLabel(3), "через 3 дня");
  assert.equal(daysLeftLabel(0), "сегодня");
  assert.equal(daysLeftLabel(1), "завтра");
});

test("next occurrence from the original date, age and anniversary", () => {
  const today = "2026-10-11";
  assert.equal(nextOccurrence("1991-10-23", true, today), "2026-10-23");
  assert.equal(nextOccurrence("1991-10-01", true, today), "2027-10-01");
  assert.equal(nextOccurrence("1991-10-11", true, today), today, "today counts");
  assert.equal(ageLabel(item({}), "2026-10-23", today), "исполнится 35");
  assert.equal(ageLabel(item({ date: "1991-10-11" }), today, today), "исполняется 35");
  assert.equal(ageLabel(item({ kind: "anniversary", date: "2016-10-23" }), "2026-10-23", today), "10 лет свадьбе");
  assert.equal(ageLabel(item({ kind: "anniversary", date: "2025-10-23" }), "2026-10-23", today), "1 год свадьбе");
  assert.equal(ageLabel(item({ kind: "other", date: "2024-10-23" }), "2026-10-23", today), "2 года");
  assert.equal(ageLabel(item({ noYear: true }), "2026-10-23", today), "", "year unknown → no age");
  assert.equal(yearsAt(item({ date: "2026-10-23" }), "2026-10-23"), null, "not after the original");
  const list = upcoming([item({ id: "late", date: "2000-12-01" }), item({ id: "soon", date: "2000-10-12" })], today);
  assert.deepEqual(list.map((row) => [row.item.id, row.days]), [["soon", 1], ["late", 51]]);
});

test("29 February: celebrated on 28 February in other years", () => {
  assert.equal(inYear("2000-02-29", 2027), "2027-02-28");
  assert.equal(inYear("2000-02-29", 2028), "2028-02-29");
  assert.equal(nextOccurrence("2000-02-29", true, "2026-10-11"), "2027-02-28");
  assert.equal(nextOccurrence("2000-02-29", true, "2027-03-01"), "2028-02-29");
  assert.ok(occursOnDay({ date: "2000-02-29", yearly: true }, "2027-02-28"));
  assert.ok(!occursOnDay({ date: "2000-02-29", yearly: true }, "2028-02-28"));
  assert.equal(ageLabel(item({ date: "2000-02-29" }), "2027-02-28", "2026-10-11"), "исполнится 27");
});
