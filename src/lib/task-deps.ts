/**
 * Task dependencies («Ждёт: …»). A task is blocked while its prerequisite
 * exists and is not done. Cycles are refused when setting dependsOn.
 */
import type { Task } from "./planner-types";

export function prereqOf(task: Pick<Task, "dependsOn">): string | null {
  return typeof task.dependsOn === "string" && task.dependsOn ? task.dependsOn : null;
}

/** True when the prerequisite exists and is not done. Missing prereq = not blocked. */
export function isBlocked(task: Pick<Task, "dependsOn" | "done">, tasks: readonly Pick<Task, "id" | "done">[]): boolean {
  const id = prereqOf(task);
  if (!id || task.done) return false;
  const prereq = tasks.find((item) => item.id === id);
  return Boolean(prereq && !prereq.done);
}

/**
 * Would setting `taskId.dependsOn = dependsOn` create a cycle?
 * Walks from `dependsOn` along dependsOn links; hitting `taskId` = cycle.
 */
export function wouldCycle(
  taskId: string,
  dependsOn: string | null | undefined,
  tasks: readonly Pick<Task, "id" | "dependsOn">[],
): boolean {
  if (!dependsOn) return false;
  if (dependsOn === taskId) return true;
  const byId = new Map(tasks.map((t) => [t.id, prereqOf(t)]));
  let cur: string | null = dependsOn;
  const seen = new Set<string>();
  while (cur) {
    if (cur === taskId) return true;
    if (seen.has(cur)) return true; // already a cycle elsewhere; treat as unsafe
    seen.add(cur);
    cur = byId.get(cur) ?? null;
  }
  return false;
}

/** Safe patch: null when clearing or when the link would cycle. */
export function safeDependsOn(
  taskId: string,
  dependsOn: string | null | undefined,
  tasks: readonly Pick<Task, "id" | "dependsOn">[],
): string | null {
  if (!dependsOn) return null;
  if (!tasks.some((t) => t.id === dependsOn)) return null;
  if (wouldCycle(taskId, dependsOn, tasks)) return null;
  return dependsOn;
}

/** Smart lists that hide blocked tasks by default. */
export const SMART_VIEWS_HIDE_BLOCKED = new Set(["today", "tomorrow", "week", "inbox", "checklist", "shared"]);

export function hideBlockedIn(view: string): boolean {
  if (SMART_VIEWS_HIDE_BLOCKED.has(view)) return true;
  return view.startsWith("list:") || view.startsWith("tag:") || view.startsWith("day:");
}
