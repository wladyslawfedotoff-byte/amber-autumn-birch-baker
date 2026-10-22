/**
 * «Данные готовы»: until the planner was read from this device or the first
 * server copy arrived, the app shows a skeleton — never sample tasks, and
 * nothing a tap could change (1.15).
 */
import { create } from "zustand";

type Boot = { ready: boolean };

export const useBoot = create<Boot>(() => ({ ready: false }));

export function markReady(): void {
  if (!useBoot.getState().ready) useBoot.setState({ ready: true });
}

export function isReady(): boolean {
  return useBoot.getState().ready;
}
