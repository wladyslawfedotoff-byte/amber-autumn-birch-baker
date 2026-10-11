/**
 * Habit planning and statistics that respect the frequency:
 * a day that is not planned (Saturday of a «пн–пт» habit, a day inside an
 * «раз в 3 дня» window, a week that already has its 3 check-ins) never breaks
 * a streak, and «Пропуск» is excused. Pure, unit-tested in habit-plan.test.ts.
 */
import { daysBetween, shiftIso, weekDays } from "./dates.ts";
import type { Habit, HabitEntry, HabitFreq, HabitSection } from "./planner-types.ts";

const ISO = /^\d{4}-\d{2}-\d{2}$/;

export const SECTIONS: readonly { id: HabitSection; label: string; hint: string }[] = [
  { id: "morning", label: "Утро", hint: "до 12:00" },
  { id: "afternoon", label: "День", hint: "12:00–18:00" },
  { id: "evening", label: "Вечер", hint: "после 18:00" },
  { id: "other", label: "Другое", hint: "в любое время" },
];

export const WEEKDAY_SHORT = ["пн", "вт", "ср", "чт", "пт", "сб", "вс"] as const;

/** 1 = Monday … 7 = Sunday. */
export function isoWeekday(day: string): number {
  const [y, m, d] = day.split("-").map(Number);
  return ((new Date(y ?? 1970, (m ?? 1) - 1, d ?? 1).getDay() + 6) % 7) + 1;
}

export function normalizeFreq(freq: unknown): HabitFreq {
  const f = freq as Partial<Record<string, unknown>> | null | undefined;
  if (f && f.kind === "weekdays" && Array.isArray(f.days)) {
    const days = [...new Set(f.days.filter((n): n is number => Number.isInteger(n) && (n as number) >= 1 && (n as number) <= 7))].sort();
    if (days.length && days.length < 7) return { kind: "weekdays", days };
  }
  if (f && f.kind === "weekly" && Number.isInteger(f.times)) {
    const times = Math.min(6, Math.max(1, f.times as number));
    return { kind: "weekly", times };
  }
  if (f && f.kind === "interval" && Number.isInteger(f.every)) {
    const every = Math.min(60, Math.max(2, f.every as number));
    return { kind: "interval", every };
  }
  return { kind: "daily" };
}

export function freqLabel(freq: unknown): string {
  const f = normalizeFreq(freq);
  if (f.kind === "weekdays") {
    const key = f.days.join(",");
    if (key === "1,2,3,4,5") return "по будням";
    if (key === "6,7") return "по выходным";
    return f.days.map((n) => WEEKDAY_SHORT[n - 1]).join(", ");
  }
  if (f.kind === "weekly") return `${f.times} ${f.times >= 2 && f.times <= 4 ? "раза" : "раз"} в неделю`;
  if (f.kind === "interval") return `раз в ${f.every} ${f.every >= 2 && f.every <= 4 ? "дня" : "дней"}`;
  return "каждый день";
}

export function goalOf(habit: Pick<Habit, "goal">): number {
  return typeof habit.goal === "number" && habit.goal > 1 ? Math.min(100_000, habit.goal) : 1;
}

export function stepOf(habit: Pick<Habit, "step">): number {
  return typeof habit.step === "number" && habit.step > 0 ? habit.step : 1;
}

export function entryOf(habit: Pick<Habit, "log">, day: string): HabitEntry | undefined {
  return (habit.log ?? []).find((entry) => entry.id === day);
}

/** Reminder times: the list plus the legacy single `remindAt`, valid, unique, sorted. */
export function reminderTimes(habit: Pick<Habit, "reminders" | "remindAt">): string[] {
  const all = [...(habit.reminders ?? []), ...(habit.remindAt ? [habit.remindAt] : [])];
  return [...new Set(all.filter((t) => typeof t === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(t)))].sort();
}

export type DayState = "done" | "partial" | "skip" | "fail" | "open" | "off" | "before" | "future";

function startOf(habit: Pick<Habit, "startDate">): string | null {
  return typeof habit.startDate === "string" && ISO.test(habit.startDate) ? habit.startDate : null;
}

/** Is the day planned by a weekday-type frequency? (weekly/interval: any day may be used.) */
export function plannedWeekday(freq: HabitFreq, day: string): boolean {
  return freq.kind !== "weekdays" || freq.days.includes(isoWeekday(day));
}

/** State of one day for calendars and the week strip. */
export function dayState(habit: Habit, day: string, today: string): DayState {
  const checks = new Set(habit.checks);
  if (checks.has(day)) return "done";
  if (day > today) return "future";
  const entry = entryOf(habit, day);
  if (entry?.status === "skip") return "skip";
  if (entry?.status === "fail") return "fail";
  if (goalOf(habit) > 1 && (entry?.amount ?? 0) > 0) return "partial";
  const start = startOf(habit);
  if (start && day < start) return "before";
  return plannedWeekday(normalizeFreq(habit.freq), day) ? "open" : "off";
}

/** Is the habit still to do on `day` (shown as «по плану»)? */
export function isDue(habit: Habit, day: string): boolean {
  if (habit.archived) return false;
  const start = startOf(habit);
  if (start && day < start) return false;
  const freq = normalizeFreq(habit.freq);
  if (freq.kind === "weekdays") return freq.days.includes(isoWeekday(day));
  if (freq.kind === "weekly") {
    const week = weekDays(day);
    const done = week.filter((d) => d !== day && habit.checks.includes(d)).length;
    return habit.checks.includes(day) || done < freq.times;
  }
  if (freq.kind === "interval") {
    for (let i = 1; i < freq.every; i++) if (habit.checks.includes(shiftIso(day, -i))) return false;
    return true;
  }
  return true;
}

type Slot = "done" | "miss" | "neutral";

/** First day the statistics look at: the earliest check-in or log entry. */
function firstDay(habit: Habit, today: string): string | null {
  let first: string | null = null;
  for (const d of habit.checks) if (ISO.test(d) && d <= today && (!first || d < first)) first = d;
  for (const e of habit.log ?? []) if (ISO.test(e.id) && e.id <= today && (e.status || (e.amount ?? 0) > 0) && (!first || e.id < first)) first = e.id;
  return first;
}

const MAX_SPAN = 3660;

/** Per-slot outcome from the first check-in to today; weeks for «N раз в неделю», else days. */
function slots(habit: Habit, today: string): { unit: "day" | "week"; list: { slot: Slot; count: number }[] } {
  const freq = normalizeFreq(habit.freq);
  const first = firstDay(habit, today);
  if (!first) return { unit: freq.kind === "weekly" ? "week" : "day", list: [] };
  const span = Math.min(MAX_SPAN, daysBetween(first, today));
  const checks = new Set(habit.checks);
  const skip = new Set((habit.log ?? []).filter((e) => e.status === "skip").map((e) => e.id));
  const start = startOf(habit);
  const list: { slot: Slot; count: number }[] = [];
  if (freq.kind === "weekly") {
    let monday = weekDays(shiftIso(today, -span))[0]!;
    const thisMonday = weekDays(today)[0]!;
    while (monday <= thisMonday) {
      const days = weekDays(monday).filter((d) => d <= today);
      const done = days.filter((d) => checks.has(d)).length;
      const excused = days.filter((d) => skip.has(d)).length;
      const ok = done + excused >= freq.times;
      const slot: Slot = ok && done > 0 ? "done" : ok || monday === thisMonday ? "neutral" : "miss";
      list.push({ slot, count: done });
      monday = shiftIso(monday, 7);
    }
    return { unit: "week", list };
  }
  for (let i = span; i >= 0; i--) {
    const day = shiftIso(today, -i);
    if (checks.has(day)) {
      list.push({ slot: "done", count: 1 });
      continue;
    }
    let slot: Slot = "neutral";
    if (day !== today && !skip.has(day) && !(start && day < start)) {
      if (freq.kind === "interval") {
        // Missed when a whole window of `every` days ends here without a check-in or a skip.
        let covered = false;
        for (let k = 0; k < freq.every && !covered; k++) {
          const d = shiftIso(day, -k);
          if (d < first || checks.has(d) || skip.has(d)) covered = true;
        }
        slot = covered ? "neutral" : "miss";
      } else if (plannedWeekday(freq, day)) {
        slot = "miss";
      }
    }
    list.push({ slot, count: 0 });
  }
  return { unit: "day", list };
}

export type Streaks = { current: number; best: number; unit: "day" | "week" };

/**
 * Current and best streak. Days: done days in a row, where unplanned days,
 * «Пропуск» and today (not done yet) are neutral. Weeks («N раз в неделю»):
 * weeks in a row that reached N check-ins; the running week is neutral until it does.
 */
export function streaks(habit: Habit, today: string): Streaks {
  const { unit, list } = slots(habit, today);
  let run = 0;
  let best = 0;
  for (const item of list) {
    if (item.slot === "miss") run = 0;
    else if (item.slot === "done") {
      run += 1;
      best = Math.max(best, run);
    }
  }
  return { current: run, best, unit };
}

export type Rate = { done: number; planned: number; percent: number };

/**
 * Completion over [from, to] (inclusive, capped at today): check-ins vs planned
 * check-ins. Planned: weekday days for daily/weekdays, N per week, one per
 * `every` days. Days before the start date / creation / first check-in and
 * «Пропуск» days are not planned.
 */
export function rate(habit: Habit, from: string, to: string, today: string): Rate {
  const end = to > today ? today : to;
  const created = typeof habit.createdAt === "number" && habit.createdAt > 0 ? isoFromStamp(habit.createdAt) : null;
  const begin = [from, startOf(habit), created ?? firstDay(habit, today)].filter((d): d is string => Boolean(d)).sort().at(-1)!;
  if (begin > end) return { done: 0, planned: 0, percent: 0 };
  const freq = normalizeFreq(habit.freq);
  const checks = new Set(habit.checks);
  const skip = new Set((habit.log ?? []).filter((e) => e.status === "skip").map((e) => e.id));
  const length = Math.min(MAX_SPAN, daysBetween(begin, end) + 1);
  let done = 0;
  let plannedDays = 0;
  for (let i = 0; i < length; i++) {
    const day = shiftIso(begin, i);
    if (checks.has(day)) done += 1;
    if (!skip.has(day) && plannedWeekday(freq, day)) plannedDays += 1;
  }
  let planned = plannedDays;
  if (freq.kind === "weekly") planned = Math.max(1, Math.round((plannedDays * freq.times) / 7));
  if (freq.kind === "interval") planned = Math.max(1, Math.ceil(plannedDays / freq.every));
  const percent = planned ? Math.min(100, Math.round((done / planned) * 100)) : 0;
  return { done, planned, percent };
}

function isoFromStamp(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** Total check-ins up to today. */
export function totalChecks(habit: Habit, today: string): number {
  return new Set(habit.checks.filter((d) => ISO.test(d) && d <= today)).size;
}

/** Challenge progress: done days since the start date (or ever) towards `goalDays`. */
export function goalProgress(habit: Habit, today: string): { done: number; target: number; reached: boolean } | null {
  const target = typeof habit.goalDays === "number" && habit.goalDays > 0 ? habit.goalDays : 0;
  if (!target) return null;
  const start = startOf(habit);
  const done = new Set(habit.checks.filter((d) => ISO.test(d) && d <= today && (!start || d >= start))).size;
  return { done: Math.min(done, target), target, reached: done >= target };
}

/** Mutations used by the store, kept pure for the tests. */
export function withEntry(habit: Habit, day: string, patch: Partial<Omit<HabitEntry, "id" | "updatedAt">> & { done?: boolean }): Habit {
  const goal = goalOf(habit);
  const log = [...(habit.log ?? [])];
  const index = log.findIndex((e) => e.id === day);
  const prev: HabitEntry = index >= 0 ? log[index]! : { id: day };
  const next: HabitEntry = { ...prev };
  if (patch.note !== undefined) next.note = patch.note.slice(0, 2000);
  if (patch.mood !== undefined) next.mood = patch.mood && patch.mood >= 1 && patch.mood <= 5 ? Math.round(patch.mood) : null;
  if (patch.status !== undefined) next.status = patch.status;
  let done = habit.checks.includes(day);
  if (patch.amount !== undefined) {
    const amount = patch.amount == null ? null : Math.max(0, Math.min(100_000, Math.round(patch.amount * 100) / 100));
    next.amount = amount;
    if (goal > 1) done = (amount ?? 0) >= goal;
  }
  if (patch.done !== undefined) {
    done = patch.done;
    if (goal > 1) next.amount = done ? Math.max(goal, prev.amount ?? 0) : patch.amount !== undefined ? next.amount : null;
  }
  if (done || patch.amount) {
    if (patch.status === undefined) next.status = null;
  }
  if (patch.status === "skip" || patch.status === "fail") done = false;
  const checks = done ? (habit.checks.includes(day) ? habit.checks : [...habit.checks, day]) : habit.checks.filter((d) => d !== day);
  const empty = !next.status && !next.note && !next.mood && !(next.amount && next.amount > 0);
  if (empty) {
    if (index >= 0) log.splice(index, 1);
  } else if (index >= 0) log[index] = next;
  else log.push(next);
  log.sort((a, b) => (a.id < b.id ? -1 : 1));
  return { ...habit, checks, log };
}

/** One tap on a day: simple habits toggle; amount habits add a step, and a done day resets. */
export function tapDay(habit: Habit, day: string): Habit {
  const goal = goalOf(habit);
  const done = habit.checks.includes(day);
  if (goal <= 1) return withEntry(habit, day, { done: !done });
  if (done) return withEntry(habit, day, { amount: 0, done: false });
  const amount = (entryOf(habit, day)?.amount ?? 0) + stepOf(habit);
  return withEntry(habit, day, { amount });
}

export function sortHabits(habits: readonly Habit[]): Habit[] {
  return [...habits].sort((a, b) => (a.order ?? 1e9) - (b.order ?? 1e9) || a.name.localeCompare(b.name, "ru"));
}

export function sectionOf(habit: Pick<Habit, "section">): HabitSection {
  return SECTIONS.some((s) => s.id === habit.section) ? (habit.section as HabitSection) : "other";
}

/** Habits to show for a day (today strip, schedule): active, planned that day or already done. */
export function habitsForDay(habits: readonly Habit[], day: string): Habit[] {
  return sortHabits(habits.filter((h) => !h.archived && (h.checks.includes(day) || isDue(h, day))));
}

/** Short chip label: «💧 Вода 3/8». */
export function habitChip(habit: Habit, day: string): string {
  const goal = goalOf(habit);
  const progress = goal > 1 ? ` ${Math.min(entryOf(habit, day)?.amount ?? (habit.checks.includes(day) ? goal : 0), goal)}/${goal}` : "";
  return `${habit.icon ? `${habit.icon} ` : ""}${habit.name}${progress}`;
}
