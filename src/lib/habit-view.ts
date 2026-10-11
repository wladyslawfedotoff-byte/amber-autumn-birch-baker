/**
 * View helpers for the TickTick-like habit screens (list row, detail page,
 * check-in sheet, editor). Pure, unit-tested in habit-view.test.ts; the
 * planning rules themselves live in habit-plan.ts.
 */
import { dayState, entryOf, goalOf, rate, reminderTimes, sectionOf, sortHabits, streaks, totalChecks, type DayState } from "./habit-plan.ts";
import type { Habit, HabitSection } from "./planner-types.ts";

const ISO = /^\d{4}-\d{2}-\d{2}$/;

/** Amount done on a day: the logged amount, or the goal (1 for simple habits) when checked. */
export function amountOn(habit: Habit, day: string): number {
  const goal = goalOf(habit);
  const done = habit.checks.includes(day);
  if (goal <= 1) return done ? 1 : 0;
  const logged = entryOf(habit, day)?.amount ?? 0;
  return done ? Math.max(goal, logged) : logged;
}

/** 0…1 for the progress ring (done = 1). */
export function dayProgress(habit: Habit, day: string): number {
  if (habit.checks.includes(day)) return 1;
  const goal = goalOf(habit);
  return goal > 1 ? Math.min(1, amountOn(habit, day) / goal) : 0;
}

/** Days of a month «YYYY-MM». */
export function monthDays(month: string): string[] {
  const [y, m] = month.split("-").map(Number);
  const count = new Date(y ?? 1970, m ?? 1, 0).getDate();
  return Array.from({ length: count }, (_, i) => `${month}-${String(i + 1).padStart(2, "0")}`);
}

export type MonthStats = {
  /** Done days in the month. */
  monthChecks: number;
  totalChecks: number;
  /** Completion vs plan in the month, %. */
  percent: number;
  current: number;
  best: number;
  unit: "day" | "week";
  /** Sum of amounts (goal habits) in the month / ever. */
  monthVolume: number;
  totalVolume: number;
};

export function monthStats(habit: Habit, month: string, today: string): MonthStats {
  const days = monthDays(month);
  const inMonth = days.filter((d) => d <= today);
  const s = streaks(habit, today);
  const r = inMonth.length ? rate(habit, days[0]!, days[days.length - 1]!, today) : { percent: 0 };
  const volumeDays = new Set([...habit.checks, ...(habit.log ?? []).map((e) => e.id)].filter((d) => ISO.test(d) && d <= today));
  let totalVolume = 0;
  for (const d of volumeDays) totalVolume += amountOn(habit, d);
  return {
    monthChecks: inMonth.filter((d) => habit.checks.includes(d)).length,
    totalChecks: totalChecks(habit, today),
    percent: r.percent,
    current: s.current,
    best: s.best,
    unit: s.unit,
    monthVolume: inMonth.reduce((sum, d) => sum + amountOn(habit, d), 0),
    totalVolume,
  };
}

/** Bars for the «Цель на день» chart: amount per day of the month (future days → null). */
export function monthBars(habit: Habit, month: string, today: string): { day: string; amount: number | null }[] {
  return monthDays(month).map((day) => ({ day, amount: day > today ? null : amountOn(habit, day) }));
}

/** Calendar cell for the detail page: ring progress plus the state. */
export function calendarCell(habit: Habit, day: string, today: string): { state: DayState; progress: number } {
  return { state: dayState(habit, day, today), progress: dayProgress(habit, day) };
}

/** «8 напоминаний, 08:30–22:00», «10:00 и 18:00», «09:00», «Нет». */
export function reminderSummary(habit: Pick<Habit, "reminders" | "remindAt">): string {
  const times = reminderTimes(habit);
  if (times.length === 0) return "Нет";
  if (times.length === 1) return times[0]!;
  if (times.length === 2) return `${times[0]} и ${times[1]}`;
  const n = times.length;
  const word = n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 12 || n % 100 > 14) ? "напоминания" : "напоминаний";
  return `${n} ${word}, ${times[0]}–${times[n - 1]}`;
}

/** Row subline: «5/8 стаканов · 🔥 3», «каждый день · 🔥 2 нед.». */
export function habitSubline(habit: Habit, today: string, freq: string): string {
  const goal = goalOf(habit);
  const parts: string[] = [];
  if (goal > 1) parts.push(`${Math.min(amountOn(habit, today), goal)}/${goal}${habit.unit ? ` ${habit.unit}` : ""}`);
  else parts.push(freq);
  const s = streaks(habit, today);
  if (s.current > 0) parts.push(`🔥 ${s.current}${s.unit === "week" ? " нед." : ""}`);
  return parts.join(" · ");
}

/**
 * Drag-to-reorder inside a section: the new order of the section's ids after
 * moving `id` to `to`. Archived habits keep their own order.
 */
export function reorderSection(habits: readonly Habit[], id: string, to: number): string[] {
  const habit = habits.find((h) => h.id === id);
  if (!habit) return [];
  const section: HabitSection = sectionOf(habit);
  const peers = sortHabits(habits.filter((h) => !h.archived === !habit.archived && sectionOf(h) === section)).map((h) => h.id);
  const from = peers.indexOf(id);
  const index = Math.max(0, Math.min(peers.length - 1, to));
  if (from < 0 || from === index) return peers;
  peers.splice(from, 1);
  peers.splice(index, 0, id);
  return peers;
}

/** Day the check-in sheet starts with: done / fail / skip, prefilled amount. */
export function checkinDraft(habit: Habit, day: string): { status: "done" | "fail" | "skip"; amount: number; mood: number | null; note: string } {
  const entry = entryOf(habit, day);
  const goal = goalOf(habit);
  const status = entry?.status === "fail" ? "fail" : entry?.status === "skip" ? "skip" : "done";
  const logged = amountOn(habit, day);
  return { status, amount: goal > 1 ? (logged > 0 ? logged : goal) : 1, mood: entry?.mood ?? null, note: entry?.note ?? "" };
}

/** Patch for setHabitDay from the check-in sheet. */
export function checkinPatch(
  habit: Habit,
  draft: { status: "done" | "fail" | "skip"; amount: number; mood: number | null; note: string },
): { done?: boolean; status?: "skip" | "fail" | null; amount?: number | null; mood: number | null; note: string } {
  const base = { mood: draft.mood, note: draft.note.trim() };
  if (draft.status === "skip") return { ...base, status: "skip" };
  if (draft.status === "fail") return { ...base, status: "fail" };
  if (goalOf(habit) > 1) return { ...base, status: null, amount: Math.max(0, draft.amount) };
  return { ...base, status: null, done: true };
}
