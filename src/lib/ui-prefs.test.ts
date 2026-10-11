import test from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_TABS, MAX_TABS, moveTab, normalizeCalendarMode, normalizeTabs, toggleTab, modeDays, drawerItems, placeTab, canBoard } from "./ui-prefs.ts";
import { keyboardFrame, revealDelta } from "./viewport.ts";
import { dotsFor, isoWeek, layoutDay, minutesOf, mondayOf, rangeStart, timeRange } from "./calendar-layout.ts";

test("tab bar: saved value is normalised", () => {
  assert.deepEqual(normalizeTabs(undefined), DEFAULT_TABS);
  assert.deepEqual(normalizeTabs(["today"]), DEFAULT_TABS, "too few tabs fall back to default");
  assert.deepEqual(normalizeTabs(["today", "dates", "dates", "nope", "settings"]), ["today", "dates", "settings"]);
  assert.equal(normalizeTabs(["today", "calendar", "schedule", "habits", "focus", "matrix", "dates"]).length, MAX_TABS);
});

test("tab bar: toggle keeps 2…5 tabs, move swaps neighbours", () => {
  assert.deepEqual(toggleTab(["today", "calendar"], "today"), ["today", "calendar"], "cannot go below 2");
  assert.deepEqual(toggleTab(DEFAULT_TABS, "dates"), DEFAULT_TABS, "cannot go above 5");
  assert.deepEqual(toggleTab(["today", "calendar", "habits"], "habits"), ["today", "calendar"]);
  assert.deepEqual(toggleTab(["today", "calendar"], "dates"), ["today", "calendar", "dates"]);
  assert.deepEqual(moveTab(["today", "calendar", "dates"], "dates", -1), ["today", "dates", "calendar"]);
  assert.deepEqual(moveTab(["today", "calendar"], "today", -1), ["today", "calendar"]);
});

test("calendar mode is normalised", () => {
  assert.equal(normalizeCalendarMode("week"), "week");
  assert.equal(normalizeCalendarMode("year"), "month");
  assert.equal(modeDays("three"), 3);
});

test("ISO week numbers and week start", () => {
  assert.equal(isoWeek("2026-10-11"), 41, "as in the TickTick screenshot (Н41)");
  assert.equal(isoWeek("2026-01-01"), 1);
  assert.equal(isoWeek("2027-01-01"), 53);
  assert.equal(mondayOf("2026-10-11"), "2026-10-05");
  assert.equal(rangeStart("week", "2026-10-07"), "2026-10-05");
  assert.equal(rangeStart("three", "2026-10-07"), "2026-10-07");
});

test("month cell shows dots, never counts", () => {
  assert.deepEqual(dotsFor(["#f00", null, "#0f0", "#00f"]), ["#f00", "", "#0f0"]);
  assert.deepEqual(dotsFor([]), []);
});

test("hour grid: timed blocks, lanes for overlaps, all-day rest", () => {
  assert.equal(minutesOf("09:30"), 570);
  assert.equal(minutesOf("25:00"), null);
  const { timed, allDay } = layoutDay([
    { id: "a", startAt: "09:00", endAt: "10:00" },
    { id: "b", startAt: "09:30", endAt: null },
    { id: "c", remindAt: "12:00" },
    { id: "d" },
    { id: "e", startAt: "10:00", endAt: "09:00" },
  ]);
  assert.deepEqual(allDay, ["d"]);
  const byId = Object.fromEntries(timed.map((item) => [item.id, item]));
  assert.deepEqual([byId.a?.lane, byId.a?.lanes], [0, 2]);
  assert.deepEqual([byId.b?.lane, byId.b?.start, byId.b?.end], [1, 570, 600]);
  assert.deepEqual([byId.c?.lane, byId.c?.lanes], [0, 1]);
  assert.equal(byId.e?.end, 630, "end before start → default length");
  assert.equal(timeRange({ id: "x", startAt: "09:00", endAt: "10:00" }), "09:00–10:00");
  assert.equal(timeRange({ id: "x" }), "");
});

test("iOS keyboard: frame pinned to the visual viewport only while the keyboard is open", () => {
  assert.deepEqual(keyboardFrame({ innerHeight: 844, vvHeight: 844, vvTop: 0 }), { keyboard: false, top: 0, height: 844 });
  assert.deepEqual(keyboardFrame({ innerHeight: 844, vvHeight: 790, vvTop: 0 }), { keyboard: false, top: 0, height: 790 }, "toolbar, not a keyboard");
  assert.deepEqual(keyboardFrame({ innerHeight: 844, vvHeight: 508.4, vvTop: 212.2 }), { keyboard: true, top: 212, height: 508 });
});

test("focused field is revealed inside its scroll box", () => {
  const box = { top: 50, bottom: 450 };
  assert.equal(revealDelta({ top: 100, bottom: 144 }, box), 0);
  assert.equal(revealDelta({ top: 500, bottom: 544 }, box), 106);
  assert.equal(revealDelta({ top: 20, bottom: 64 }, box), -42);
  assert.equal(revealDelta({ top: 60, bottom: 900 }, box), 0, "tall field: keep its top in view");
});

test("schedule board: tap → half-hour slot, opens at «now»", async () => {
  const { slotAt, focusMinute } = await import("./day-board.ts");
  assert.deepEqual(slotAt(0.5, 7 * 60, 23 * 60), { start: 900, end: 960 }, "middle of 07–23 → 15:00");
  assert.deepEqual(slotAt(0.535, 7 * 60, 23 * 60), { start: 930, end: 990 });
  assert.deepEqual(slotAt(1, 7 * 60, 23 * 60), { start: 1350, end: 1380 }, "kept inside the board");
  assert.equal(focusMinute({ isToday: true, now: 14 * 60 + 10, spans: [], workStart: 540 }), 13 * 60 + 10);
  assert.equal(focusMinute({ isToday: false, now: 0, spans: [{ id: "a", title: "", start: 600, end: 660, done: false, assumed: false }], workStart: 540 }), 570);
  assert.equal(focusMinute({ isToday: false, now: 0, spans: [], workStart: 540 }), 510);
});

test("drawer does not repeat the tab bar (phone only)", () => {
  const items = ["inbox", "today", "tomorrow", "week", "checklist", "calendar", "schedule", "projects", "focus", "settings"].map((id) => ({ id }));
  const ids = (list: { id: string }[]) => list.map((item) => item.id);
  assert.deepEqual(ids(drawerItems(items, ["today", "calendar", "schedule", "habits", "focus"], true)), [
    "inbox",
    "tomorrow",
    "week",
    "checklist",
    "projects",
    "settings",
  ]);
  // Core smart lists stay even when pinned to the bar.
  assert.deepEqual(ids(drawerItems(items, ["inbox", "checklist", "projects"], true)), ["inbox", "today", "tomorrow", "week", "checklist", "calendar", "schedule", "focus", "settings"]);
  assert.equal(drawerItems(items, ["today"], false).length, items.length);
});

test("tab bar: drag to a new place", () => {
  const tabs = ["today", "calendar", "schedule", "habits", "focus"] as const;
  assert.deepEqual(placeTab([...tabs], "focus", 0), ["focus", "today", "calendar", "schedule", "habits"]);
  assert.deepEqual(placeTab([...tabs], "today", 2), ["calendar", "schedule", "today", "habits", "focus"]);
  assert.deepEqual(placeTab([...tabs], "today", 99), ["calendar", "schedule", "habits", "focus", "today"]);
  assert.deepEqual(placeTab([...tabs], "dates", 1), [...tabs], "unknown tab: unchanged");
});

test("board icon only on lists that can be a board", () => {
  for (const view of ["inbox", "tomorrow", "week", "list:abc", "tag:дом"]) assert.equal(canBoard(view), true, view);
  for (const view of ["today", "checklist", "schedule", "day:2026-10-11"]) assert.equal(canBoard(view), false, view);
});
