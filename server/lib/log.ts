/**
 * One-line, timestamped logs for Container Manager → «Журнал».
 * Format: `2026-10-06T09:30:00.000Z INFO  sync.put rev=12 ip=1.2.3.4`.
 * Never pass passwords, cookies or tokens in `fields`.
 */
type Level = "info" | "warn" | "error";

function formatValue(value: unknown): string {
  if (value === undefined) return "";
  const text = typeof value === "string" ? value : JSON.stringify(value);
  const oneLine = String(text).replace(/\s+/g, " ").slice(0, 500);
  return /[\s"=]/.test(oneLine) || oneLine === "" ? JSON.stringify(oneLine) : oneLine;
}

export function log(level: Level, event: string, fields: Record<string, unknown> = {}, error?: unknown): void {
  const parts = [new Date().toISOString(), level.toUpperCase().padEnd(5), event];
  for (const [key, value] of Object.entries(fields)) {
    if (value === undefined) continue;
    parts.push(`${key}=${formatValue(value)}`);
  }
  if (error !== undefined) {
    const err = error instanceof Error ? error : new Error(String(error));
    parts.push(`error=${formatValue(err.message)}`);
  }
  const line = parts.join(" ");
  if (level === "error") {
    console.error(line);
    if (error instanceof Error && error.stack) console.error(error.stack);
  } else if (level === "warn") {
    console.warn(line);
  } else {
    console.log(line);
  }
}

type ThrottleState = { windowStart: number; suppressed: number };
const throttles = new Map<string, ThrottleState>();
export const LOG_THROTTLE_MS = 60_000;

/**
 * Like `log`, but at most one line per `key` per minute. Occurrences inside the
 * window are counted and reported as `suppressed=N` on the next line, so a
 * flood (brute force, a misbehaving page) cannot fill the container log.
 * Returns true when a line was written.
 */
export function logThrottled(
  key: string,
  level: Level,
  event: string,
  fields: Record<string, unknown> = {},
  now = Date.now(),
): boolean {
  const state = throttles.get(key);
  if (state && now - state.windowStart < LOG_THROTTLE_MS) {
    state.suppressed++;
    return false;
  }
  const suppressed = state?.suppressed ?? 0;
  throttles.set(key, { windowStart: now, suppressed: 0 });
  log(level, event, suppressed ? { ...fields, suppressed, suppressedWindowSec: LOG_THROTTLE_MS / 1000 } : fields);
  return true;
}

/** Test hook. */
export function resetLogThrottle(): void {
  throttles.clear();
}
