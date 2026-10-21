/** At most 30 quick adds per key per minute (a leaked key cannot flood «Входящие»). */
export const PER_MINUTE = 30;
const WINDOW_MS = 60_000;
const hits = new Map<string, number[]>();

export function allowQuickAdd(key: string, now = Date.now()): boolean {
  const list = (hits.get(key) ?? []).filter((t) => t > now - WINDOW_MS);
  if (list.length >= PER_MINUTE) {
    hits.set(key, list);
    return false;
  }
  list.push(now);
  hits.set(key, list);
  if (hits.size > 1000) hits.delete(hits.keys().next().value!);
  return true;
}

/** Test hook. */
export function resetQuickAddLimit(): void {
  hits.clear();
}
