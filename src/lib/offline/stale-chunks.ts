/**
 * 1.17: after an update the old version's files are gone from the server and
 * the cache. If a still-open old page asks for one of them (a section opened
 * for the first time), the page reloads once onto the new version instead of
 * showing an error. A guard in sessionStorage prevents a reload loop.
 */
const GUARD_KEY = "pora-chunk-reload";
const GUARD_MS = 30_000;

const CHUNK_ERROR = /Failed to fetch dynamically imported module|Importing a module script failed|error loading dynamically imported module|Unable to preload CSS|Loading chunk .* failed/i;

export function isChunkError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : typeof error === "string" ? error : "";
  return CHUNK_ERROR.test(message);
}

/** True when no reload was attempted within the guard window. */
export function mayReload(lastAt: number | null, now: number): boolean {
  return lastAt === null || !Number.isFinite(lastAt) || now - lastAt > GUARD_MS || now < lastAt;
}

/** Reloads the page once; returns false when a reload just happened (then the error is shown). */
export function reloadForNewVersion(): boolean {
  if (typeof window === "undefined") return false;
  let last: number | null = null;
  try {
    const raw = window.sessionStorage.getItem(GUARD_KEY);
    last = raw === null ? null : Number(raw);
  } catch {
    // storage unavailable: still reload, the browser keeps no loop state either
  }
  const now = Date.now();
  if (!mayReload(last, now)) return false;
  try {
    window.sessionStorage.setItem(GUARD_KEY, String(now));
  } catch {
    // ignore
  }
  window.location.reload();
  return true;
}

let installed = false;

export function watchStaleChunks(): void {
  if (installed || typeof window === "undefined") return;
  installed = true;
  window.addEventListener("vite:preloadError", (event) => {
    if (reloadForNewVersion()) event.preventDefault();
  });
  window.addEventListener("unhandledrejection", (event) => {
    if (isChunkError(event.reason)) reloadForNewVersion();
  });
}
