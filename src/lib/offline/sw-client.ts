/**
 * Registers /sw.js (production builds only) and runs the update flow:
 * - a new version installs in the background and waits;
 * - right after a cold start (nothing typed yet) it is switched on at once and
 *   the page reloads once — the user sees the new version on the next launch;
 * - while the app is in use, «Обновить» appears in the status pill instead,
 *   and the new version also takes over the next time the app is opened.
 * 1.17: the main page opens from the saved copy at once and the fresh one is
 * fetched in the background; a new version is found on every start (sw.js is
 * never cached), so a stale version lives at most until that reload.
 */
type Listener = () => void;

const listeners = new Set<Listener>();
let waiting: ServiceWorker | null = null;
let reloading = false;
const startedAt = Date.now();
const COLD_START_MS = 8_000;

function emit(): void {
  listeners.forEach((listener) => listener());
}

export function updateReady(): boolean {
  return waiting !== null;
}

export function subscribeUpdate(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** «Обновить»: switch to the waiting version and reload. */
export function applyUpdate(): void {
  if (!waiting) return;
  reloading = true;
  waiting.postMessage({ type: "skip-waiting" });
}

function track(worker: ServiceWorker | null, interacted: () => boolean): void {
  if (!worker) return;
  const ready = () => {
    if (worker.state !== "installed" || !navigator.serviceWorker.controller) return;
    waiting = worker;
    if (!interacted() && Date.now() - startedAt < COLD_START_MS) applyUpdate();
    else emit();
  };
  if (worker.state === "installed") ready();
  else worker.addEventListener("statechange", ready);
}

export function swSupported(): boolean {
  return typeof navigator !== "undefined" && "serviceWorker" in navigator && typeof window !== "undefined" && window.isSecureContext;
}

export async function registerServiceWorker(): Promise<ServiceWorkerRegistration | null> {
  if (!swSupported() || !import.meta.env.PROD) return null;
  let touched = false;
  const mark = () => {
    touched = true;
  };
  window.addEventListener("pointerdown", mark, { once: true, capture: true });
  window.addEventListener("keydown", mark, { once: true, capture: true });
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (!reloading) return;
    window.location.reload();
  });
  try {
    const registration = await navigator.serviceWorker.register("/sw.js", { scope: "/", updateViaCache: "none" });
    track(registration.waiting, () => touched);
    registration.addEventListener("updatefound", () => track(registration.installing, () => touched));
    // Long-lived Home Screen app: look for a new version when it comes back.
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible" && navigator.onLine) void registration.update().catch(() => undefined);
    });
    return registration;
  } catch {
    return null;
  }
}

/** «Выйти»: drop the cached page (it holds no data, but nothing should outlive the session). */
export function forgetCachedShell(): void {
  if (!swSupported()) return;
  navigator.serviceWorker.controller?.postMessage({ type: "forget" });
}
