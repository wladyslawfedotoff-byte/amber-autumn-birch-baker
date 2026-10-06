import { occursOn, shiftIso, taskDates } from "@/lib/dates";
import type { Task, TaskList, View } from "@/lib/planner-types";

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

export function countToday(tasks: Task[], today: string): number {
  return tasks.filter((t) => !t.done && t.due != null && t.due <= today).length;
}

export function countTomorrow(tasks: Task[], today: string): number {
  const tomorrow = shiftIso(today, 1);
  return tasks.filter((t) => !t.done && occursOn(t, tomorrow)).length;
}

export function countWeek(tasks: Task[], today: string): number {
  const end = shiftIso(today, 6);
  return tasks.filter((t) => !t.done && inRange(t, today, end)).length;
}

export function countOpen(tasks: Task[]): number {
  return tasks.filter((t) => !t.done).length;
}

export function countInbox(tasks: Task[]): number {
  return tasks.filter((t) => !t.done && t.listId == null).length;
}

export function countList(tasks: Task[], id: string): number {
  return tasks.filter((t) => !t.done && t.listId === id).length;
}

export type ShareScope = { lists: TaskList[]; me: string; dataOwner: string };

export function scopeTasks(tasks: Task[], view: View, today: string, share?: ShareScope): Task[] {
  const end = shiftIso(today, 6);
  return tasks.filter((t) => {
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
    if (view === "inbox") return !t.done && t.listId == null;
    if (view === "done") return t.done;
    if (view.startsWith("list:")) return !t.done && t.listId === view.slice(5);
    if (view.startsWith("tag:")) return !t.done && t.tags.includes(view.slice(4));
    if (view.startsWith("day:")) return !t.done && occursOn(t, view.slice(4));
    return false;
  });
}

export function doneInScope(tasks: Task[], view: View, today: string, share?: ShareScope): Task[] {
  if (view === "done" || view === "week" || view === "calendar" || view === "focus" || view === "habits") {
    return [];
  }
  return tasks
    .filter((t) => {
      if (!t.done) return false;
      if (view === "today") return t.due != null && t.due <= today;
      if (view === "tomorrow") return t.due === shiftIso(today, 1);
      if (view === "inbox") return t.listId == null;
      if (view === "shared") return Boolean(share && isSharedTask(t, share.lists, share.me, share.dataOwner));
      if (view.startsWith("list:")) return t.listId === view.slice(5);
      if (view.startsWith("tag:")) return t.tags.includes(view.slice(4));
      if (view.startsWith("day:")) return t.due === view.slice(4);
      return false;
    })
    .sort((a, b) => (b.completedAt ?? 0) - (a.completedAt ?? 0));
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
