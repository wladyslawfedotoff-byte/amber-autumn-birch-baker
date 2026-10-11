import { create } from "zustand";

/** «Готово ✓ · Отменить» after ticking a task (not persisted, not synced). */
export type DoneToast = { id: string; title: string; repeat: boolean; next: string | null; at: number };

export const useDoneToast = create<{ toast: DoneToast | null; show: (toast: DoneToast) => void; clear: () => void }>()((set) => ({
  toast: null,
  show: (toast) => set({ toast }),
  clear: () => set({ toast: null }),
}));
