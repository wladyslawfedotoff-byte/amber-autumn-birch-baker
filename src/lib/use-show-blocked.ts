import { useSyncExternalStore } from "react";

/**
 * «Показать ждущие»: blocked tasks are hidden from smart lists by default.
 * Device-only preference (not synced), shared by every list on this device.
 */
const KEY = "pora-show-blocked";
const listeners = new Set<() => void>();

function read(): boolean {
  try {
    return typeof window !== "undefined" && window.localStorage.getItem(KEY) === "1";
  } catch {
    return false;
  }
}

export function setShowBlocked(value: boolean): void {
  try {
    window.localStorage.setItem(KEY, value ? "1" : "0");
  } catch {
    /* private mode */
  }
  listeners.forEach((fn) => fn());
}

export function useShowBlocked(): boolean {
  return useSyncExternalStore(
    (fn) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    read,
    () => false,
  );
}
