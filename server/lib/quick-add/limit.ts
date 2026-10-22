/**
 * Limits of POST /api/quick-add (own counters, not the login limiter):
 * - per key: at most 30 adds per minute (a leaked key cannot flood «Входящие»);
 * - per client IP: at most 10 wrong keys per 15 minutes, then 429 for that IP
 *   only. There is no global lock: junk from one address never blocks the
 *   other phones. Malformed keys are refused before they are counted.
 */
export const PER_MINUTE = 30;
export const BAD_KEYS_PER_IP = 10;
export const BAD_KEY_WINDOW_MS = 15 * 60_000;
const WINDOW_MS = 60_000;
const MAX_TRACKED = 1000;

function hit(map: Map<string, number[]>, key: string, now: number, window: number, max: number, record: boolean): boolean {
  const list = (map.get(key) ?? []).filter((t) => t > now - window);
  if (list.length >= max) {
    map.set(key, list);
    return false;
  }
  if (record) list.push(now);
  if (list.length) map.set(key, list);
  else map.delete(key);
  if (map.size > MAX_TRACKED) map.delete(map.keys().next().value!);
  return true;
}

const adds = new Map<string, number[]>();
const badKeys = new Map<string, number[]>();

export function allowQuickAdd(key: string, now = Date.now()): boolean {
  return hit(adds, key, now, WINDOW_MS, PER_MINUTE, true);
}

/** May this IP try a key now? (Does not count.) */
export function ipMayTryKey(ip: string, now = Date.now()): boolean {
  return hit(badKeys, ip, now, BAD_KEY_WINDOW_MS, BAD_KEYS_PER_IP, false);
}

/** A well-formed but wrong / revoked key from this IP. */
export function noteBadKey(ip: string, now = Date.now()): void {
  hit(badKeys, ip, now, BAD_KEY_WINDOW_MS, Number.POSITIVE_INFINITY, true);
}

/** Test hook. */
export function resetQuickAddLimit(): void {
  adds.clear();
  badKeys.clear();
}
