import { useCallback, useState } from "react";

/**
 * Whether a task row shows its subtasks inline. Remembered per task on this
 * device only (UI state, not synced). Default: open for tasks in progress,
 * closed for finished ones.
 */
const KEY = "pora-subtasks-open";

function readAll(): Record<string, boolean> {
  try {
    const raw = typeof window === "undefined" ? null : window.localStorage.getItem(KEY);
    const parsed = raw ? (JSON.parse(raw) as unknown) : null;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, boolean>) : {};
  } catch {
    return {};
  }
}

export function useSubtasksOpen(taskId: string, fallback: boolean): [boolean, (open: boolean) => void] {
  const [open, setOpen] = useState<boolean>(() => {
    const saved = readAll()[taskId];
    return typeof saved === "boolean" ? saved : fallback;
  });
  const set = useCallback(
    (next: boolean) => {
      setOpen(next);
      try {
        const all = readAll();
        all[taskId] = next;
        const keys = Object.keys(all);
        // Keep the map small: the oldest entries go first.
        for (const key of keys.slice(0, Math.max(0, keys.length - 300))) delete all[key];
        window.localStorage.setItem(KEY, JSON.stringify(all));
      } catch {
        /* private mode / quota: just not remembered */
      }
    },
    [taskId],
  );
  return [open, set];
}
