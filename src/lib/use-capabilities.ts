import { useSyncExternalStore } from "react";

/** Optional server features, from GET /api/capabilities (authenticated). */
export type Capabilities = { assistant: boolean };

const NONE: Capabilities = { assistant: false };
let current: Capabilities = NONE;
let started = false;
const listeners = new Set<() => void>();

function load(): void {
  if (started || typeof window === "undefined") return;
  started = true;
  void fetch("/api/capabilities", { credentials: "same-origin", cache: "no-store", headers: { Accept: "application/json" } })
    .then((response) => (response.ok ? response.json() : null))
    .then((body: unknown) => {
      if (body && typeof body === "object" && (body as { assistant?: unknown }).assistant === true) {
        current = { assistant: true };
        listeners.forEach((listener) => listener());
      }
    })
    .catch(() => {
      // offline: optional features stay hidden; retry on the next page load
      started = false;
    });
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  load();
  return () => {
    listeners.delete(listener);
  };
}

export function useCapabilities(): Capabilities {
  return useSyncExternalStore(
    subscribe,
    () => current,
    () => NONE,
  );
}
