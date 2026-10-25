/**
 * 1.17 «мгновенный старт» on a fresh device: the first server copy is
 * requested by a tiny inline script in <head>, in parallel with the app's
 * files, instead of after them. The sync engine picks the answer up once.
 *
 * Only when this device has no synced copy yet (no `base` in the sync meta):
 * later starts read the local copy at once and ask the server with
 * If-None-Match, so there is nothing to win there.
 */
export const PREFETCH_META_KEY = "pora-server-sync";
const MAX_AGE_MS = 30_000;

export type Prefetch = { t0: number; t1?: number; response: Promise<Response> };

/** Decides from the raw sync meta (localStorage) whether a first copy is needed. */
export function needsFirstCopy(rawMeta: string | null): boolean {
  if (!rawMeta) return true;
  try {
    const meta = JSON.parse(rawMeta) as { base?: unknown } | null;
    return !meta || typeof meta.base !== "number";
  } catch {
    return true;
  }
}

/** Inline <head> script (same request as the engine's first GET, no secrets). */
export const PREFETCH_SCRIPT = `(function(){try{if(navigator.onLine===false||!window.fetch)return;var m=localStorage.getItem(${JSON.stringify(PREFETCH_META_KEY)});var b=null;try{b=m&&JSON.parse(m)}catch(e){}if(b&&typeof b.base==="number")return;var t=Date.now();var r=fetch("/api/sync",{method:"GET",cache:"no-store",credentials:"same-origin",priority:"high",headers:{Accept:"application/json"}});var o={t0:t,response:r};r.then(function(){o.t1=Date.now()},function(){});window.__poraFirstCopy=o}catch(e){}})();`;

/** Takes the prefetched answer once (null when there is none or it is too old). */
export function takePrefetch(now = Date.now()): Prefetch | null {
  if (typeof window === "undefined") return null;
  const holder = window as unknown as { __poraFirstCopy?: Prefetch };
  const found = holder.__poraFirstCopy;
  if (!found) return null;
  delete holder.__poraFirstCopy;
  return isFresh(found, now) ? found : null;
}

export function isFresh(found: { t0: number } | null | undefined, now: number): boolean {
  return !!found && Number.isFinite(found.t0) && now - found.t0 >= 0 && now - found.t0 < MAX_AGE_MS;
}
