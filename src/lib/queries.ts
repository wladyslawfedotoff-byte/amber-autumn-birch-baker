import { isoFromTs, occursOn, shiftIso, taskDates } from "@/lib/dates";
import { DEFAULT_ARCHIVE_DAYS, byCompleted, isArchived, repeatTickedOn } from "@/lib/task-done";
import type { Task, TaskList, View } from "@/lib/planner-types";
import { hideBlockedIn, isBlocked } from "@/lib/task-deps";

/** Who owns it: items from before profiles belong to the server's APP_OWNER. */
export function ownerOf(item: { owner?: string }, dataOwner: string): string {
  return item.owner || dataOwner;
}

/** Shared with me / by me: another owner, members, an assignee, or a shared list. */
export function isSharedTask(task: Task, lists: TaskList[], me: string, dataOwner: string): boolean {
  if (!me) return false;
  if (ownerOf(task, dataOwner) !== me) return true;
  if ((task.members ?? []).length > 0 || task.assignee) return true;
  const list = task.listId ? lists.find((l) => l.id === task.listId) : null;
  return Boolean(list && (ownerOf(list, dataOwner) !== me || (list.members ?? []).length > 0));
}

function inRange(task: Task, from: string, to: string): boolean {
  return taskDates(task).some((date) => date >= from && date <= to);
}

export function countToday(tasks: Task[], today: string, showBlocked = false): number {
  return tasks.filter((t) => !t.done && t.due != null && t.due <= today && (showBlocked || !isBlocked(t, tasks))).length;
}

export function countTomorrow(tasks: Task[], today: string, showBlocked = false): number {
  const tomorrow = shiftIso(today, 1);
  return tasks.filter((t) => !t.done && occursOn(t, tomorrow) && (showBlocked || !isBlocked(t, tasks))).length;
}

export function countWeek(tasks: Task[], today: string, showBlocked = false): number {
  const end = shiftIso(today, 6);
  return tasks.filter((t) => !t.done && inRange(t, today, end) && (showBlocked || !isBlocked(t, tasks))).length;
}

export function countOpen(tasks: Task[]): number {
  return tasks.filter((t) => !t.done).length;
}

export function countInbox(tasks: Task[], showBlocked = false): number {
  return tasks.filter((t) => !t.done && t.listId == null && !t.maint && (showBlocked || !isBlocked(t, tasks))).length;
}

export function countList(tasks: Task[], id: string): number {
  return tasks.filter((t) => !t.done && t.listId === id).length;
}

export type ShareScope = { lists: TaskList[]; me: string; dataOwner: string };

export type ScopeOptions = { showBlocked?: boolean };

export function scopeTasks(tasks: Task[], view: View, today: string, share?: ShareScope, options?: ScopeOptions): Task[] {
  const end = shiftIso(today, 6);
  const showBlocked = options?.showBlocked === true;
  return tasks.filter((t) => {
    if (!showBlocked && hideBlockedIn(view) && isBlocked(t, tasks)) return false;
    if (view === "today") {
      if (t.done) return false;
      return t.due != null && t.due <= today;
    }
    if (view === "tomorrow") {
      return !t.done && occursOn(t, shiftIso(today, 1));
    }
    if (view === "week") {
      return !t.done && inRange(t, today, end);
    }
    if (view === "shared") return !t.done && Boolean(share && isSharedTask(t, share.lists, share.me, share.dataOwner));
    // Auto tasks of «Обслуживание» live in «Сегодня» / «Календарь» on their day, not here.
    if (view === "inbox") return !t.done && t.listId == null && !t.maint;
    if (view === "done") return t.done;
    if (view === "archive") return t.done;
    if (view.startsWith("list:")) return !t.done && t.listId === view.slice(5);
    if (view.startsWith("tag:")) return !t.done && t.tags.includes(view.slice(4));
    if (view.startsWith("day:")) return !t.done && occursOn(t, view.slice(4));
    return false;
  });
}

export type DoneOptions = { now: number; archiveDays: number };

/**
 * The «Готово» group at the bottom of a list: done tasks of that list that are
 * not archived yet, plus repeating tasks ticked today (their date already
 * moved on, so without this the tick left no trace). Newest first.
 */
export function doneInScope(tasks: Task[], view: View, today: string, share?: ShareScope, options?: DoneOptions): Task[] {
  if (view === "done" || view === "archive" || view === "calendar" || view === "focus" || view === "habits") {
    return [];
  }
  const now = options?.now ?? Date.now();
  const days = options?.archiveDays ?? DEFAULT_ARCHIVE_DAYS;
  const end = shiftIso(today, 6);
  return tasks
    .filter((t) => {
      const ticked = repeatTickedOn(t, today);
      if (!t.done && !ticked) return false;
      if (t.done && isArchived(t, now, days)) return false;
      const doneToday = typeof t.completedAt === "number" && isoFromTs(t.completedAt) === today;
      if (view === "today") return ticked || doneToday || (t.due != null && t.due <= today);
      if (view === "week") return ticked || doneToday || inRange(t, today, end);
      if (view === "tomorrow") return !ticked && t.due === shiftIso(today, 1);
      if (view.startsWith("day:")) return !ticked && t.due === view.slice(4);
      if (view === "inbox") return t.listId == null && !t.maint;
      if (view === "shared") return Boolean(share && isSharedTask(t, share.lists, share.me, share.dataOwner));
      if (view.startsWith("list:")) return t.listId === view.slice(5);
      if (view.startsWith("tag:")) return t.tags.includes(view.slice(4));
      return false;
    })
    .sort(byCompleted);
}

export function matchesQuery(task: Task, query: string, lists: TaskList[]): boolean {
  const n = query.trim().toLowerCase();
  if (!n) return true;
  const listName = lists.find((l) => l.id === task.listId)?.name ?? "входящие";
  return (
    task.title.toLowerCase().includes(n) ||
    task.notes.toLowerCase().includes(n) ||
    listName.toLowerCase().includes(n) ||
    task.tags.some((tag) => tag.toLowerCase().includes(n)) ||
    task.subtasks.some((sub) => sub.title.toLowerCase().includes(n))
  );
}

export function byNewest(a: Task, b: Task): number {
  return b.createdAt - a.createdAt;
}

export function listName(lists: TaskList[], id: string | null): string {
  if (!id) return "Входящие";
  return lists.find((l) => l.id === id)?.name ?? "Входящие";
}
