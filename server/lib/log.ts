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
