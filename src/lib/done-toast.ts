import { create } from "zustand";
import type { DeletedTask } from "@/lib/task-undo";

/**
 * «Готово ✓ · Отменить» after ticking a task, «Задача удалена · Вернуть»
 * after deleting one (1.22). Not persisted, not synced.
 */
/** «Смена сдвинута вместе с делами · Вернуть» (1.23): times before the move. */
export type MovedTimes = { count: number; before: { id: string; due: string | null; startAt: string | null; endAt: string | null; remindAt: string | null }[] };

/** Any other «… · Вернуть» (1.24: a deleted stage or project): the whole line and what «Вернуть» does. */
export type UndoAction = { text: string; run: () => void };

export type DoneToast = { id: string; title: string; repeat: boolean; next: string | null; at: number; deleted?: DeletedTask; moved?: MovedTimes; undo?: UndoAction };

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

/** «… · Вернуть» for something that is not one task (a stage, a project). */
export function showUndo(id: string, text: string, run: () => void): void {
  useDoneToast.getState().show({ id, title: text, repeat: false, next: null, at: Date.now(), undo: { text, run } });
}
