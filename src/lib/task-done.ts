/**
 * Completing tasks, the «Готово» group and the «Архив».
 *
 * Pure (no store / React), unit-tested in task-done.test.ts.
 *
 * - A plain task: «Выполнить» sets done + completedAt (+ completedBy).
 * - A repeating task never becomes done: the date moves to the next
 *   occurrence. So that the tick is still visible (in «Готово» on that day,
 *   and «Отменить» works), it remembers `completedAt` and the date it was
 *   ticked for (`lastDue`).
 * - Archive: done tasks whose completedAt is older than N days (setting
 *   «Убирать в архив через», synced with the other settings) leave the lists
 *   and the «Готово» group and show up in «Архив». It is derived, not stored,
 *   so every device and every participant of a shared task agrees as soon as
 *   `done`/`completedAt` are synced; «Вернуть» simply reopens the task.
 */
import { isoFromTs, nextChosenDate, nextRepeat } from "./dates.ts";
import type { Task } from "./planner-types";

export const DAY_MS = 86_400_000;
/** «Убирать в архив через»: days; 0 = never. */
export const ARCHIVE_OPTIONS = [1, 2, 3, 5, 7, 30, 0] as const;
export const DEFAULT_ARCHIVE_DAYS = 7;

export function normalizeArchiveDays(value: unknown): number {
  return typeof value === "number" && (ARCHIVE_OPTIONS as readonly number[]).includes(value) ? value : DEFAULT_ARCHIVE_DAYS;
}

export function archiveOptionLabel(days: number): string {
  if (days === 0) return "никогда";
  if (days === 1) return "через 1 день";
  if (days < 5) return `через ${days} дня`;
  return `через ${days} дней`;
}

type Toggle = { me: string | null; today: string; now: number };

/** «Выполнить» / «Вернуть в работу». */
export function toggleTaskDone(t: Task, { me, today, now }: Toggle): Task {
  const by = me ? { completedBy: me } : {};
  if (!t.done && t.repeat === "dates") {
    // «Выбранные даты»: move to the next chosen date; none left → done.
    const next = nextChosenDate(t.repeatDates, t.due, today);
    if (next) return { ...t, done: false, completedAt: now, lastDue: t.due, due: next, ...by };
    return { ...t, done: true, completedAt: now, lastDue: null, ...by };
  }
  if (!t.done && t.repeat && t.repeat !== "dates" && t.due) {
    return { ...t, done: false, completedAt: now, lastDue: t.due, due: nextRepeat(t.due, t.repeat, today), ...by };
  }
  const done = !t.done;
  return { ...t, done, completedAt: done ? now : null, lastDue: null, ...(done ? by : { completedBy: null }) };
}

/** A repeating task ticked today (shown in «Готово» until midnight). */
export function repeatTickedOn(t: Task, day: string): boolean {
  return !t.done && Boolean(t.repeat) && typeof t.completedAt === "number" && Boolean(t.lastDue) && isoFromTs(t.completedAt) === day;
}

/** «Отменить» for a repeating task: back to the date it was ticked for. */
export function undoRepeatTick(t: Task): Task {
  if (t.done || !t.lastDue) return t;
  return { ...t, due: t.lastDue, lastDue: null, completedAt: null, completedBy: null };
}

export function isArchived(t: Pick<Task, "done" | "completedAt">, now: number, days: number): boolean {
  if (!t.done || days <= 0) return false;
  const at = typeof t.completedAt === "number" ? t.completedAt : 0;
  return now - at >= days * DAY_MS;
}

/** Done and not yet archived, newest first. */
export function recentDone(tasks: Task[], now: number, days: number): Task[] {
  return tasks.filter((t) => t.done && !isArchived(t, now, days)).sort(byCompleted);
}

export function archivedTasks(tasks: Task[], now: number, days: number): Task[] {
  return tasks.filter((t) => isArchived(t, now, days)).sort(byCompleted);
}

export function byCompleted(a: Task, b: Task): number {
  return (b.completedAt ?? 0) - (a.completedAt ?? 0);
}

/** «Вернуть» from the archive: open again, no completion. */
export function restoreFromArchive(t: Task): Task {
  return { ...t, done: false, completedAt: null, completedBy: null, lastDue: null };
}
