import { test } from "node:test";
import assert from "node:assert/strict";
import { addMonths, diffDays, ruleLine, ruleState, stateText, type MaintRule } from "./rules.ts";

const L = { soonDays: 14, soonKm: 500 };
const rule = (patch: Partial<MaintRule>): MaintRule => ({ id: "r", title: "Масло", since: "2026-01-10", ...patch });
const at = (r: MaintRule, today: string, km: number | null = null) => ruleState(r, { today, km }, L);

test("addMonths clamps the day and crosses years", () => {
  assert.equal(addMonths("2026-01-31", 1), "2026-02-28");
  assert.equal(addMonths("2028-01-31", 1), "2028-02-29");
  assert.equal(addMonths("2026-11-15", 3), "2027-02-15");
  assert.equal(addMonths("2026-03-31", -1), "2026-02-28");
});

test("by mileage: ok → soon at the threshold → overdue past it", () => {
  const r = rule({ everyKm: 10_000, lastDoneKm: 74_200 });
  assert.equal(at(r, "2026-10-14", 80_000).status, "ok");
  assert.equal(at(r, "2026-10-14", 83_700).status, "soon"); // exactly 500 left
  assert.equal(at(r, "2026-10-14", 84_200).status, "soon"); // exactly due: not yet overdue
  const late = at(r, "2026-10-14", 84_600);
  assert.equal(late.status, "overdue");
  assert.equal(late.kmLeft, -400);
  assert.equal(stateText(r, late), "просрочено на 400 км");
});

test("by mileage without a known mileage or base stays ok and asks for it", () => {
  assert.equal(at(rule({ everyKm: 5000, lastDoneKm: 1000 }), "2026-10-14", null).status, "ok");
  const noBase = rule({ everyKm: 5000 });
  assert.equal(at(noBase, "2026-10-14", 90_000).status, "ok");
  assert.equal(stateText(noBase, at(noBase, "2026-10-14", 90_000)), "нужен пробег");
  assert.equal(at({ ...noBase, sinceKm: 88_000 }, "2026-10-14", 90_000).kmLeft, 3000);
});

test("by interval counts from the last time, else from the day it was added", () => {
  const r = rule({ everyMonths: 12, lastDoneAt: "2025-10-20" });
  assert.equal(at(r, "2026-10-01").status, "ok"); // 19 days left: outside the 14-day window
  assert.equal(at(r, "2026-09-01").status, "ok");
  assert.equal(at(r, "2026-10-06").status, "soon"); // exactly 14 days left
  assert.equal(at(r, "2026-10-21").status, "overdue");
  const fresh = rule({ everyMonths: 6, since: "2026-10-14" });
  assert.equal(at(fresh, "2026-10-14").nextDate, "2027-04-14");
  assert.equal(at(fresh, "2026-10-14").status, "ok");
});

test("whichever first: the earlier component decides, both are shown", () => {
  const r = rule({ everyKm: 10_000, everyMonths: 12, lastDoneKm: 74_200, lastDoneAt: "2025-10-20" });
  const s = at(r, "2026-09-29", 83_000);
  assert.equal(s.status, "ok");
  assert.equal(stateText(r, s), "~1 200 км или 3 нед.");
  assert.equal(at(r, "2026-09-29", 83_800).status, "soon"); // km threshold alone
  assert.equal(at(r, "2026-12-01", 79_000).status, "overdue"); // date passed, km fine
  assert.equal(ruleLine(r), "каждые 10 000 км или каждые 12 мес. — что раньше");
});

test("fixed month without a day: soon from the 1st, due by the last day", () => {
  const r = rule({ fixedMonth: 12, since: "2026-10-14" });
  assert.equal(at(r, "2026-11-30").status, "ok");
  assert.equal(at(r, "2026-12-01").status, "soon");
  assert.equal(at(r, "2026-12-31").status, "soon");
  assert.equal(at(r, "2027-01-01").status, "overdue");
  assert.equal(stateText(r, at(r, "2026-10-14")), "в декабре 2026");
});

test("fixed date with a day uses the soon window before it", () => {
  const r = rule({ fixedMonth: 12, fixedDay: 20, since: "2026-10-14" });
  assert.equal(at(r, "2026-12-05").status, "ok");
  assert.equal(at(r, "2026-12-06").status, "soon");
  assert.equal(at(r, "2026-12-21").status, "overdue");
});

test("a yearly fixed date: done early covers it, the next year is the new deadline", () => {
  const r = rule({ fixedMonth: 12, since: "2026-10-14", lastDoneAt: "2026-11-20" });
  assert.equal(at(r, "2026-12-15").status, "ok"); // 11 days before the window opens: within the 60-day grace
  assert.equal(at(r, "2026-12-15").nextDate, "2027-12-31");
  const r2 = rule({ fixedMonth: 12, since: "2026-10-14", lastDoneAt: "2026-08-01" });
  assert.equal(at(r2, "2026-12-15").nextDate, "2026-12-31"); // too early to count
});

test("a deadline that already passed when the rule was added waits for next year", () => {
  const r = rule({ fixedMonth: 3, since: "2026-10-14" });
  assert.equal(at(r, "2026-10-14").nextDate, "2027-03-31");
});

test("a one-off fixed date: overdue after it, finished when done", () => {
  const r = rule({ fixedMonth: 11, fixedDay: 5, fixedYear: 2026, since: "2026-10-01" });
  assert.equal(at(r, "2026-11-06").status, "overdue");
  const done = { ...r, lastDoneAt: "2026-11-02" };
  const s = at(done, "2026-11-06");
  assert.equal(s.finished, true);
  assert.equal(s.status, "ok");
  assert.equal(stateText(done, s), "сделано");
});

test("30 Feb style fixed day is clamped to the month", () => {
  const r = rule({ fixedMonth: 2, fixedDay: 30, since: "2026-01-01" });
  assert.equal(at(r, "2026-01-01").nextDate, "2026-02-28");
});

test("urgency sorts overdue first", () => {
  const over = at(rule({ everyMonths: 1, lastDoneAt: "2026-01-01" }), "2026-10-14");
  const soon = at(rule({ everyMonths: 1, lastDoneAt: "2026-09-20" }), "2026-10-14");
  const ok = at(rule({ everyMonths: 12, lastDoneAt: "2026-09-20" }), "2026-10-14");
  assert.ok(over.urgency < soon.urgency && soon.urgency < ok.urgency);
  assert.equal(diffDays("2026-10-14", "2026-10-15"), 1);
});

test("a rule with no deadline is ok", () => {
  assert.equal(at(rule({}), "2026-10-14").status, "ok");
  assert.equal(stateText(rule({}), at(rule({}), "2026-10-14")), "без срока");
});
