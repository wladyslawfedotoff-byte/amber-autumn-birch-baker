import { create } from "zustand";
import type { DeletedTask } from "@/lib/task-undo";

/**
 * «Готово ✓ · Отменить» after ticking a task, «Задача удалена · Вернуть»
 * after deleting one (1.22). Not persisted, not synced.
 */
export type DoneToast = { id: string; title: string; repeat: boolean; next: string | null; at: number; deleted?: DeletedTask };

export const useDoneToast = create<{ toast: DoneToast | null; show: (toast: DoneToast) => void; clear: () => void }>()((set) => ({
  toast: null,
  show: (toast) => set({ toast }),
  clear: () => set({ toast: null }),
}));

/** Удалить задачу и показать «Вернуть». */
export function deleteWithUndo(deleteTask: (id: string) => DeletedTask | null, id: string, title: string): void {
  const deleted = deleteTask(id);
  if (deleted) useDoneToast.getState().show({ id, title, repeat: false, next: null, at: Date.now(), deleted });
}
