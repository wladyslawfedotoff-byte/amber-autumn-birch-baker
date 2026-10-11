import assert from "node:assert/strict";
import test from "node:test";
import type { Habit } from "./planner-types";
import {
  dayState,
  freqLabel,
  goalProgress,
  habitsForDay,
  isDue,
  isoWeekday,
  normalizeFreq,
  rate,
  reminderTimes,
  streaks,
  tapDay,
  totalChecks,
  withEntry,
} from "./habit-plan.ts";
import { collectReminders, localStamp } from "./reminders.ts";
import { emptyData, mergeData, stampCollection, type SyncData, type SyncEntity } from "./sync/merge.ts";
import { applyPut, viewFor, type AclConfig, type WorldDoc } from "./sync/world.ts";

// 2026-10-11 is a Sunday.
const TODAY = "2026-10-11";
const T0 = 1_791_700_000_000;

function habit(fields: Partial<Habit> = {}): Habit {
  return { id: "h1", name: "Зарядка", checks: [], ...fields };
}

const days = (...list: string[]) => list.map((d) => `2026-10-${d}`);

test("weekday helpers and labels", () => {
  assert.equal(isoWeekday(TODAY), 7);
  assert.equal(isoWeekday("2026-10-12"), 1);
  assert.equal(freqLabel({ kind: "weekdays", days: [1, 2, 3, 4, 5] }), "по будням");
  assert.equal(freqLabel({ kind: "weekly", times: 3 }), "3 раза в неделю");
  assert.equal(freqLabel({ kind: "interval", every: 2 }), "раз в 2 дня");
  assert.equal(freqLabel(null), "каждый день");
  assert.deepEqual(normalizeFreq({ kind: "weekdays", days: [9, 0] }), { kind: "daily" }, "garbage → daily");
  assert.deepEqual(normalizeFreq({ kind: "weekly", times: 40 }), { kind: "weekly", times: 6 });
});

test("daily streak: today not done yet does not break it; a missed day does; «Пропуск» is excused", () => {
  const h = habit({ checks: days("08", "09", "10") });
  assert.deepEqual(streaks(h, TODAY), { current: 3, best: 3, unit: "day" });
  const gap = habit({ checks: days("05", "06", "07", "09", "10") });
  assert.equal(streaks(gap, TODAY).current, 2);
  assert.equal(streaks(gap, TODAY).best, 3);
  const skipped = withEntry(gap, "2026-10-08", { status: "skip" });
  assert.equal(streaks(skipped, TODAY).current, 5, "skip joins both runs");
});

test("weekdays: weekends never break the streak and are not planned", () => {
  // Mon 5 … Fri 9 done, Sat/Sun not planned, today is Sunday.
  const h = habit({ freq: { kind: "weekdays", days: [1, 2, 3, 4, 5] }, checks: days("01", "02", "05", "06", "07", "08", "09") });
  assert.equal(streaks(h, TODAY).current, 7);
  assert.equal(isDue(h, TODAY), false);
  assert.equal(dayState(h, "2026-10-10", TODAY), "off");
  assert.equal(isDue(h, "2026-10-12"), true);
  const r = rate(h, "2026-10-05", TODAY, TODAY);
  assert.deepEqual([r.done, r.planned, r.percent], [5, 5, 100]);
  // A missed Wednesday does break it.
  const missed = habit({ ...h, checks: days("05", "06", "08", "09") });
  assert.equal(streaks(missed, TODAY).current, 2);
});

test("N times a week: streak in weeks, the running week is neutral, due until the quota is met", () => {
  const h = habit({ freq: { kind: "weekly", times: 3 }, checks: [...days("01", "02", "03"), ...days("06", "08", "10")] });
  // Weeks: 28.09–04.10 has 3 (incl. 1–3 Oct), 05–11 Oct has 3.
  assert.deepEqual(streaks(h, TODAY), { current: 2, best: 2, unit: "week" });
  assert.equal(isDue(h, TODAY), false, "quota reached this week");
  const two = habit({ ...h, checks: [...days("01", "02", "03"), ...days("06")] });
  assert.equal(streaks(two, TODAY).current, 1, "this week not reached yet but still running");
  assert.equal(isDue(two, TODAY), true);
  const broken = habit({ ...h, checks: [...days("01", "02", "03"), "2026-10-13"] });
  assert.equal(streaks(broken, "2026-10-19").current, 0, "a past week below the quota breaks it");
});

test("every N days: due only when the window is over; the streak counts check-ins", () => {
  const h = habit({ freq: { kind: "interval", every: 3 }, checks: days("02", "05", "08") });
  assert.equal(isDue(h, "2026-10-09"), false);
  assert.equal(isDue(h, "2026-10-10"), false);
  assert.equal(isDue(h, TODAY), true);
  assert.equal(streaks(h, TODAY).current, 3);
  assert.equal(streaks(h, "2026-10-12").current, 0, "a full 3-day window without a check-in breaks it");
});

test("start date: nothing before it is missed; challenge progress counts from it", () => {
  const h = habit({ startDate: "2026-10-09", goalDays: 21, checks: days("01", "09", "10", "11") });
  assert.equal(dayState(h, "2026-10-05", TODAY), "before");
  assert.deepEqual(goalProgress(h, TODAY), { done: 3, target: 21, reached: false });
  assert.equal(totalChecks(h, TODAY), 4);
  assert.equal(isDue(h, "2026-10-08"), false);
  assert.equal(goalProgress(habit(), TODAY), null);
});

test("amount habit: taps add steps, the goal marks the day done, partial stays partial", () => {
  let h = habit({ name: "Вода", goal: 3, unit: "стакана" });
  h = tapDay(h, TODAY);
  assert.equal(dayState(h, TODAY, TODAY), "partial");
  assert.equal(h.log?.[0]?.amount, 1);
  h = tapDay(tapDay(h, TODAY), TODAY);
  assert.deepEqual(h.checks, [TODAY]);
  h = tapDay(h, TODAY);
  assert.deepEqual(h.checks, [], "tapping a done day resets it");
  assert.deepEqual(h.log, [], "empty entries are removed");
  h = withEntry(h, TODAY, { amount: 5 });
  assert.deepEqual(h.checks, [TODAY], "more than the goal still counts");
});

test("day log: skip / fail / note / mood; done clears skip; editing past days", () => {
  let h = habit({ checks: ["2026-10-09"] });
  h = withEntry(h, "2026-10-09", { status: "fail" });
  assert.deepEqual(h.checks, [], "«Не сделано» removes the check-in");
  assert.equal(dayState(h, "2026-10-09", TODAY), "fail");
  h = withEntry(h, "2026-10-09", { done: true, note: "сделал вечером", mood: 4 });
  assert.deepEqual(h.checks, ["2026-10-09"]);
  assert.deepEqual(h.log?.[0], { id: "2026-10-09", status: null, note: "сделал вечером", mood: 4 });
  h = withEntry(h, "2026-10-09", { mood: 9 });
  assert.equal(h.log?.[0]?.mood, null, "mood outside 1–5 is dropped");
});

test("archived habits are hidden from the day; order is respected", () => {
  const list = [habit({ id: "b", name: "Б", order: 2 }), habit({ id: "a", name: "А", order: 1 }), habit({ id: "z", name: "Я", archived: true })];
  assert.deepEqual(habitsForDay(list, TODAY).map((h) => h.id), ["a", "b"]);
});

test("reminders: several times a day, only while planned and not done", () => {
  const h = habit({ reminders: ["18:00", "09:00", "bad"], remindAt: "09:00" });
  assert.deepEqual(reminderTimes(h), ["09:00", "18:00"]);
  const now = localStamp(TODAY, "12:00");
  const hits = collectReminders({ tasks: [], milestones: [], habits: [h], remindAck: {}, now });
  assert.deepEqual(hits.map((hit) => [hit.key, hit.status]), [["habit:h1:09:00", "due"], ["habit:h1:18:00", "later"]]);
  assert.equal(collectReminders({ tasks: [], milestones: [], habits: [{ ...h, checks: [TODAY] }], remindAck: {}, now }).length, 0);
  const weekdays = { ...h, freq: { kind: "weekdays" as const, days: [1] } };
  assert.equal(collectReminders({ tasks: [], milestones: [], habits: [weekdays], remindAck: {}, now }).length, 0, "Sunday is not planned");
  const acked = collectReminders({ tasks: [], milestones: [], habits: [h], remindAck: { "habit:h1:09:00": `${TODAY}T09:00` }, now });
  assert.deepEqual(acked.map((hit) => hit.key), ["habit:h1:18:00"]);
});

// --- sync ---------------------------------------------------------------

const asEntity = (h: Habit) => h as unknown as SyncEntity;

function edit(data: SyncData, change: (h: Habit) => Habit, now: number): SyncData {
  const next = data.habits.map((h) => asEntity(change({ ...(h as unknown as Habit) })));
  const stamped = stampCollection(data.habits, next, data.tombstones.habits, now, "habits");
  return { ...data, habits: stamped.items, tombstones: { ...data.tombstones, habits: stamped.tombs } };
}

test("sync: two devices edit different days and settings at once — everything survives, both orders", () => {
  const base: SyncData = { ...emptyData(), habits: [asEntity({ ...habit({ goal: 8, unit: "стаканов" }), updatedAt: T0 })] };
  const phone = edit(base, (h) => withEntry(tapDay(h, TODAY), "2026-10-10", { note: "в поездке", status: "skip" }), T0 + 100);
  const laptop = edit(base, (h) => ({ ...withEntry(h, "2026-10-09", { amount: 8, mood: 5 }), freq: { kind: "weekly", times: 5 }, reminders: ["09:00"] }), T0 + 200);
  for (const merged of [mergeData(phone, laptop), mergeData(laptop, phone)]) {
    const h = merged.habits[0] as unknown as Habit;
    assert.deepEqual(h.checks, ["2026-10-09"]);
    assert.deepEqual(h.freq, { kind: "weekly", times: 5 });
    assert.deepEqual(h.reminders, ["09:00"]);
    const log = Object.fromEntries((h.log ?? []).map((e) => [e.id, e]));
    assert.equal(log["2026-10-11"]?.amount, 1);
    assert.equal(log["2026-10-10"]?.status, "skip");
    assert.equal(log["2026-10-10"]?.note, "в поездке");
    assert.equal(log["2026-10-09"]?.mood, 5);
  }
  // Same day on both devices: the later edit of each field wins, other fields stay.
  const a = edit(base, (h) => withEntry(h, TODAY, { note: "утро" }), T0 + 300);
  const b = edit(base, (h) => withEntry(h, TODAY, { mood: 3 }), T0 + 400);
  const day = ((mergeData(a, b).habits[0] as unknown as Habit).log ?? []).find((e) => e.id === TODAY);
  assert.equal(day?.mood, 3);
  // Cleared fields (null) and a removed day propagate instead of coming back.
  const archived = edit(phone, (h) => ({ ...withEntry(h, "2026-10-10", { status: null, note: "" }), archived: true, goal: null }), T0 + 500);
  const back = mergeData(phone, archived).habits[0] as unknown as Habit;
  assert.equal(back.archived, true);
  assert.equal(back.goal, null);
  assert.equal((back.log ?? []).some((e) => e.id === "2026-10-10"), false);
});

test("access: a private habit is invisible to user2 and their pushes cannot change it", () => {
  const cfg: AclConfig = { owner: "user1", users: ["user1", "user2"] };
  const own = asEntity({ ...habit({ owner: "user1", checks: ["2026-10-10"] }), updatedAt: T0 });
  let doc: WorldDoc = { revision: 1, updatedAt: T0, data: { ...emptyData(), habits: [own] }, users: {} };
  assert.equal(viewFor(doc, "user2", cfg, T0).data.habits.length, 0);
  const forged: SyncData = { ...emptyData(), habits: [asEntity({ ...habit({ owner: "user2", checks: [], archived: true }), updatedAt: T0 + 10 })] };
  doc = applyPut(doc, "user2", forged, cfg, T0 + 20).doc;
  const mine = viewFor(doc, "user1", cfg, T0 + 30).data.habits[0] as unknown as Habit;
  assert.deepEqual(mine.checks, ["2026-10-10"]);
  assert.notEqual(mine.archived, true);
  // user1's own edits of the log go through.
  const view = viewFor(doc, "user1", cfg, T0 + 40).data;
  doc = applyPut(doc, "user1", edit(view, (h) => withEntry(h, TODAY, { done: true, mood: 4 }), T0 + 50), cfg, T0 + 60).doc;
  const after = viewFor(doc, "user1", cfg, T0 + 70).data.habits[0] as unknown as Habit;
  assert.deepEqual(after.checks.sort(), ["2026-10-10", TODAY]);
  assert.equal(after.log?.[0]?.mood, 4);
});
