/**
 * Habit statistics: current and best streak, completion over the last 30
 * days and a month heatmap. Pure, unit-tested in habit-stats.test.ts.
 */
import { shiftIso } from "./dates.ts";

/** Days in a row ending today (or yesterday, when today is not ticked yet). */
export function currentStreak(checks: readonly string[], today: string): number {
  const set = new Set(checks);
  let cursor = today;
  if (!set.has(today)) {
    cursor = shiftIso(today, -1);
    if (!set.has(cursor)) return 0;
  }
  let count = 0;
  while (set.has(cursor)) {
    count += 1;
    cursor = shiftIso(cursor, -1);
  }
  return count;
}

/** Longest run of consecutive days ever (future ticks ignored). */
export function bestStreak(checks: readonly string[], today: string): number {
  const days = [...new Set(checks)].filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d) && d <= today).sort();
  let best = 0;
  let run = 0;
  let prev = "";
  for (const day of days) {
    run = prev && shiftIso(prev, 1) === day ? run + 1 : 1;
    best = Math.max(best, run);
    prev = day;
  }
  return best;
}

/** Ticked days among the last `span` days including today, and the percentage. */
export function completion(checks: readonly string[], today: string, span = 30): { done: number; total: number; percent: number } {
  const set = new Set(checks);
  let done = 0;
  for (let i = 0; i < span; i++) if (set.has(shiftIso(today, -i))) done += 1;
  return { done, total: span, percent: Math.round((done / span) * 100) };
}

export type HeatCell = { day: string; on: boolean; future: boolean } | null;

/** Monday-first weeks of a month (`month` = "YYYY-MM"); null = padding. */
export function monthGrid(month: string, checks: readonly string[], today: string): HeatCell[][] {
  const set = new Set(checks);
  const [y, m] = month.split("-").map(Number);
  const first = new Date(y ?? 1970, (m ?? 1) - 1, 1);
  const length = new Date(y ?? 1970, m ?? 1, 0).getDate();
  const lead = (first.getDay() + 6) % 7;
  const cells: HeatCell[] = Array.from({ length: lead }, () => null);
  for (let d = 1; d <= length; d++) {
    const day = `${month}-${String(d).padStart(2, "0")}`;
    cells.push({ day, on: set.has(day), future: day > today });
  }
  while (cells.length % 7) cells.push(null);
  const weeks: HeatCell[][] = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));
  return weeks;
}

export function shiftMonth(month: string, delta: number): string {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(y ?? 1970, (m ?? 1) - 1 + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}
