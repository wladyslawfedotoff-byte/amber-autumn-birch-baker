/**
 * Small pure helpers around tasks: duplicating, subtask progress, and turning
 * a list typed into the notes into subtasks. No store or React imports, so
 * they are unit-tested directly (task-tools.test.ts).
 */
import type { Subtask, Task } from "./planner-types";

export type Progress = { done: number; total: number };

export function subtaskProgress(task: Pick<Task, "subtasks">): Progress {
  const subs = task.subtasks ?? [];
  return { done: subs.filter((sub) => sub.done).length, total: subs.length };
}

/** «2/5» — or "" when the task has no subtasks. */
export function progressLabel(progress: Progress): string {
  return progress.total ? `${progress.done}/${progress.total}` : "";
}

/**
 * «Дублировать»: a fresh task (new id, not done) with the same title, notes,
 * tags, list, priority, Eisenhower flags and times, and the same subtasks with
 * new ids, all unticked. `due` overrides the date («Дублировать на дату…»).
 * Not copied: completion, repeat, sharing/assignment (the copy is private to
 * whoever makes it), sync stamps. The store stamps it as a brand-new entity,
 * so it merges like any task created on this device.
 */
export function duplicateTask(
  task: Task,
  options: { id: string; newSubId: () => string; now: number; due?: string | null },
): Task {
  return {
    id: options.id,
    title: task.title,
    notes: task.notes ?? "",
    listId: task.listId ?? null,
    done: false,
    priority: task.priority ?? 0,
    due: options.due !== undefined ? options.due : (task.due ?? null),
    tags: [...(task.tags ?? [])],
    subtasks: (task.subtasks ?? []).map((sub): Subtask => ({ id: options.newSubId(), title: sub.title, done: false })),
    createdAt: options.now,
    completedAt: null,
    ...(task.important !== undefined ? { important: task.important } : {}),
    ...(task.urgent !== undefined ? { urgent: task.urgent } : {}),
    remindAt: task.remindAt ?? null,
    startAt: task.startAt ?? null,
    endAt: task.endAt ?? null,
  };
}

const LIST_LINE = /^\s*(?:[-*•–—]\s*)?(?:\[(?: |x|х|X|Х)?\]\s*|\d{1,3}[.)]\s+)?/u;
const MARKED = /^\s*(?:[-*•–—]\s+|\[(?: |x|х|X|Х)?\]\s*|[-*•–—]\s*\[(?: |x|х|X|Х)?\]\s*|\d{1,3}[.)]\s+)/u;

/** One subtask title per line, list markers («- », «• », «1. », «[ ]») removed. */
export function splitLines(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.replace(LIST_LINE, "").trim())
    .filter(Boolean);
}

/**
 * Lines of the notes that look like a list item («- молоко», «• хлеб»,
 * «1. билеты», «[ ] отель»). `items` are their texts (to become subtasks),
 * `rest` is the notes without them.
 */
export function listInNotes(notes: string): { items: string[]; rest: string } {
  const items: string[] = [];
  const rest: string[] = [];
  for (const line of (notes ?? "").split(/\r?\n/)) {
    if (MARKED.test(line)) {
      const text = line.replace(LIST_LINE, "").trim();
      if (text) items.push(text);
    } else {
      rest.push(line);
    }
  }
  return { items, rest: rest.join("\n").replace(/\n{3,}/g, "\n\n").trim() };
}

/** First non-empty line of the notes, for the preview under the task title. */
export function notesPreview(notes: string | undefined, max = 90): string {
  const line = (notes ?? "").split(/\r?\n/).map((part) => part.trim()).find(Boolean) ?? "";
  return line.length > max ? `${line.slice(0, max - 1)}…` : line;
}
