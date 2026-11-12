/**
 * Limits of /api/helper/* (own counters, separate from the phone keys):
 * - per key: 30 new tasks per hour, 60 changes per hour, 120 reads per
 *   minute — a leaked key cannot flood «Входящие» or the server;
 * - per client IP: 10 wrong keys per 15 minutes, then 429 for that IP only.
 *   Malformed keys are refused before they are counted.
 */
export const CREATES_PER_HOUR = 30;
export const CHANGES_PER_HOUR = 60;
export const READS_PER_MINUTE = 120;
export const BAD_KEYS_PER_IP = 10;
export const BAD_KEY_WINDOW_MS = 15 * 60_000;
const HOUR = 60 * 60_000;
const MINUTE = 60_000;
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

const creates = new Map<string, number[]>();
const changes = new Map<string, number[]>();
const reads = new Map<string, number[]>();
const badKeys = new Map<string, number[]>();

export type HelperOp = "create" | "change" | "read";

/** Counts one operation of a key; false = over the limit (then not counted). */
export function allowHelper(keyId: string, op: HelperOp, now = Date.now()): boolean {
  if (op === "create") return hit(creates, keyId, now, HOUR, CREATES_PER_HOUR, true);
  if (op === "change") return hit(changes, keyId, now, HOUR, CHANGES_PER_HOUR, true);
  return hit(reads, keyId, now, MINUTE, READS_PER_MINUTE, true);
}

export function retryAfter(op: HelperOp): number {
  return op === "read" ? 60 : 3600;
}

/** May this IP try a key now? (Does not count.) */
export function ipMayTryHelperKey(ip: string, now = Date.now()): boolean {
  return hit(badKeys, ip, now, BAD_KEY_WINDOW_MS, BAD_KEYS_PER_IP, false);
}

/** A well-formed but wrong / revoked key from this IP. */
export function noteBadHelperKey(ip: string, now = Date.now()): void {
  hit(badKeys, ip, now, BAD_KEY_WINDOW_MS, Number.POSITIVE_INFINITY, true);
}

/** Test hook. */
export function resetHelperLimits(): void {
  creates.clear();
  changes.clear();
  reads.clear();
  badKeys.clear();
}
