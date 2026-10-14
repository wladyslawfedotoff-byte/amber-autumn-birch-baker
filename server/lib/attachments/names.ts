/**
 * Safe attachment ids and display names. An id is a uuid-like token;
 * a display name keeps letters and common punctuation, never path separators.
 */
import { resolve as pathResolve, sep } from "node:path";

const ID_RE = /^[a-z0-9][a-z0-9_-]{7,63}$/i;
// eslint-disable-next-line no-control-regex -- control characters are exactly what we strip
const BAD_NAME = /[\u0000-\u001f\u007f\\/]/g;

export function validAttachId(id: unknown): id is string {
  return typeof id === "string" && ID_RE.test(id);
}

/** Strip path bits; empty → «файл». */
export function safeDisplayName(raw: unknown, fallback = "файл"): string {
  if (typeof raw !== "string") return fallback;
  const cleaned = raw.replace(BAD_NAME, "").replace(/\s+/g, " ").trim().replace(/^\.+/, "").slice(0, 180);
  if (!cleaned || cleaned === "." || cleaned === "..") return fallback;
  return cleaned;
}

/** Resolve `dir/id` and refuse anything that escapes `dir`. */
export function resolveInside(dir: string, id: string): string | null {
  if (!validAttachId(id)) return null;
  const root = pathResolve(dir) + sep;
  const target = pathResolve(dir, id);
  if (!target.startsWith(root) || target === pathResolve(dir)) return null;
  return target;
}
