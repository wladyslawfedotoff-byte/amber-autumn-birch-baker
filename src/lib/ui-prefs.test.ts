import test from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_TABS,
  DRAWER_SEARCH_FROM,
  MAX_TABS,
  NAV_ITEMS,
  TAB_OPTIONS,
  canBeTab,
  canBoard,
  canPlace,
  drawerItems,
  livePins,
  matchName,
  migrateNav,
  modeDays,
  moveTab,
  normalizeCalendarMode,
  normalizeDrawerTab,
  normalizeHidden,
  normalizeTabs,
  pickDrawerTab,
  placeTab,
  placementOf,
  setPlacement,
  toggleTab,
  togglePin,
  type NavId,
  type NavPrefs,
  type TabId,
} from "./ui-prefs.ts";
import { frameEndsAboveScreen, keyboardFrame, revealDelta } from "./viewport.ts";
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
  assert.equal(isoWeek("2026-10-11"), 41, "ISO week number (Н41)");
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
  const items = ["inbox", "today", "tomorrow", "week", "checklist", "calendar", "schedule", "projects", "focus", "lists"].map((id) => ({ id }));
  const ids = (list: { id: string }[]) => list.map((item) => item.id);
  const prefs = { tabBar: ["today", "calendar", "schedule", "habits", "focus"] as TabId[], drawerHidden: [] as NavId[] };
  assert.deepEqual(ids(drawerItems(items, prefs, true)), ["inbox", "tomorrow", "week", "checklist", "projects", "lists"]);
  // Smart lists in the bar leave the menu too: one place per item.
  assert.deepEqual(ids(drawerItems(items, { tabBar: ["inbox", "checklist", "projects"], drawerHidden: [] }, true)), [
    "today",
    "tomorrow",
    "week",
    "calendar",
    "schedule",
    "focus",
    "lists",
  ]);
  // Desktop has no bar: bar items stay in the sidebar, only «Скрыть» hides.
  assert.equal(drawerItems(items, prefs, false).length, items.length);
  assert.deepEqual(ids(drawerItems(items, { ...prefs, drawerHidden: ["lists", "week"] }, false)).includes("lists"), false);
});

test("navigation: placement of every item", () => {
  const prefs: NavPrefs = { tabBar: ["today", "calendar", "schedule", "habits", "assist"], drawerHidden: ["tags"] };
  assert.equal(placementOf("today", prefs), "bottom");
  assert.equal(placementOf("tags", prefs), "hidden");
  assert.equal(placementOf("matrix", prefs), "menu");
  assert.equal(placementOf("pinned", prefs), "menu", "new items land in the menu");
});

test("navigation: moves keep 2…5 tabs and one place per item", () => {
  const full: NavPrefs = { tabBar: ["today", "calendar", "schedule", "habits", "assist"], drawerHidden: ["matrix"] };
  assert.equal(setPlacement(full, "focus", "bottom"), full, "bar is full");
  assert.equal(canPlace(full, "focus", "bottom"), false);
  const freed = setPlacement(full, "assist", "menu");
  assert.deepEqual(freed, { tabBar: ["today", "calendar", "schedule", "habits"], drawerHidden: ["matrix"] });
  // Hidden → bottom: leaves the hidden set.
  const back = setPlacement(freed, "matrix", "bottom");
  assert.deepEqual(back, { tabBar: ["today", "calendar", "schedule", "habits", "matrix"], drawerHidden: [] });
  // Bottom → hidden: leaves the bar.
  assert.deepEqual(setPlacement(back, "habits", "hidden"), { tabBar: ["today", "calendar", "schedule", "matrix"], drawerHidden: ["habits"] });
  // Groups never go to the bar.
  assert.equal(setPlacement(freed, "lists", "bottom"), freed);
  assert.equal(canBeTab("pinned"), false);
  // Cannot drop below two tabs.
  const two: NavPrefs = { tabBar: ["today", "calendar"], drawerHidden: [] };
  assert.equal(setPlacement(two, "today", "hidden"), two);
  assert.equal(canPlace(two, "today", "bottom"), true, "staying put is always allowed");
  // Menu ↔ hidden.
  assert.deepEqual(setPlacement(two, "tags", "hidden").drawerHidden, ["tags"]);
  assert.deepEqual(setPlacement({ tabBar: two.tabBar, drawerHidden: ["tags"] }, "tags", "menu").drawerHidden, []);
});

test("navigation: migration from 1.6 keeps the bar exactly", () => {
  const old = { tabBar: ["today", "calendar", "schedule", "habits", "assist"] };
  const next = migrateNav(old);
  assert.deepEqual(next.tabBar, ["today", "calendar", "schedule", "habits", "assist"]);
  assert.deepEqual(next.drawerHidden, []);
  assert.equal(next.drawerTab, "lists");
  assert.deepEqual(next.pins, []);
  // An old bar with «Настройки» stays valid (it is just not offered any more).
  assert.deepEqual(migrateNav({ tabBar: ["today", "settings"] }).tabBar, ["today", "settings"]);
  assert.equal(TAB_OPTIONS.some((tab) => tab.id === "settings"), true);
  assert.equal(NAV_ITEMS.some((item) => item.id === ("settings" as NavId)), false, "not addable from «Навигация»");
  // Nothing saved → defaults.
  assert.deepEqual(migrateNav({}).tabBar, DEFAULT_TABS);
  // Junk and conflicts are cleaned: a bar item is never also hidden.
  const messy = migrateNav({ tabBar: ["today", "calendar"], drawerHidden: ["today", "tags", "tags", "nope"], drawerTab: "x", pins: ["list:a", "list:a", "bad", 5] });
  assert.deepEqual(messy.drawerHidden, ["tags"]);
  assert.equal(messy.drawerTab, "lists");
  assert.deepEqual(messy.pins, ["list:a"]);
  assert.deepEqual(normalizeHidden("nope"), []);
});

test("side menu: remembered group, pins, search", () => {
  assert.equal(pickDrawerTab("projects", ["lists", "projects", "tags"]), "projects");
  assert.equal(pickDrawerTab("projects", ["lists", "tags"]), "lists", "hidden group → first visible");
  assert.equal(pickDrawerTab("tags", []), null);
  assert.equal(normalizeDrawerTab("tags"), "tags");
  assert.deepEqual(togglePin(["list:a"], "project:b"), ["list:a", "project:b"]);
  assert.deepEqual(togglePin(["list:a", "project:b"], "list:a"), ["project:b"]);
  assert.deepEqual(livePins(["list:a", "project:gone", "project:b"], [{ id: "a" }], [{ id: "b" }]), ["list:a", "project:b"]);
  assert.equal(matchName("Лиственная 9", "лист"), true);
  assert.equal(matchName("Продукты", "  "), true);
  assert.equal(matchName("Продукты", "дом"), false);
  assert.equal(DRAWER_SEARCH_FROM, 8);
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

test("bottom inset: a short Home Screen frame does not add it again", () => {
  const phone = { innerWidth: 393, screenWidth: 393, screenHeight: 852, keyboard: false };
  // Page starts under the status bar but is a status bar shorter than the screen → strip below the page.
  assert.equal(frameEndsAboveScreen({ ...phone, standalone: true, innerHeight: 793, safeTop: 59 }), true);
  // Full-screen frame: the inset is needed.
  assert.equal(frameEndsAboveScreen({ ...phone, standalone: true, innerHeight: 852, safeTop: 59 }), false);
  // Frame below an opaque status bar reaches the home indicator: the inset is needed.
  assert.equal(frameEndsAboveScreen({ ...phone, standalone: true, innerHeight: 793, safeTop: 0 }), false);
  // A Safari tab: toolbars are real, never touched.
  assert.equal(frameEndsAboveScreen({ ...phone, standalone: false, innerHeight: 660, safeTop: 59 }), false);
  // Keyboard open: not a short frame.
  assert.equal(frameEndsAboveScreen({ ...phone, standalone: true, innerHeight: 793, safeTop: 59, keyboard: true }), false);
  // Landscape compares with the short side of the screen.
  assert.equal(frameEndsAboveScreen({ standalone: true, innerWidth: 852, innerHeight: 393, screenWidth: 393, screenHeight: 852, safeTop: 0, keyboard: false }), false);
  assert.equal(frameEndsAboveScreen({ standalone: true, innerWidth: 852, innerHeight: 393, screenWidth: 393, screenHeight: 852, safeTop: 20, keyboard: false }), false);
});

test("«Обслуживание»: a new section in the menu by default; can sit in the bar or be hidden", () => {
  assert.ok(NAV_ITEMS.some((item) => item.id === "maintenance" && item.tab));
  const prefs = { tabBar: DEFAULT_TABS, drawerHidden: [] as NavId[] };
  assert.equal(placementOf("maintenance", prefs), "menu", "existing devices keep their bar; the item shows up in the menu");
  const full = { tabBar: ["today", "calendar", "schedule", "habits", "focus"] as TabId[], drawerHidden: [] as NavId[] };
  assert.equal(setPlacement(full, "maintenance", "bottom"), full, "bar is full");
  const swapped = setPlacement(setPlacement(full, "focus", "menu"), "maintenance", "bottom");
  assert.ok(swapped.tabBar.includes("maintenance"));
  assert.deepEqual(setPlacement(prefs, "maintenance", "hidden").drawerHidden, ["maintenance"]);
  assert.deepEqual(normalizeTabs(["today", "maintenance"]), ["today", "maintenance"]);
});
