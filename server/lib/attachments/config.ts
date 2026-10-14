/**
 * Attachment limits from the environment.
 */
import { ALLOWED_TYPES } from "./detect.ts";

export const DEFAULT_MAX_BYTES = 25 * 1024 * 1024;

export type AttachConfig = {
  maxBytes: number;
  allowed: ReadonlySet<string>;
  /** Files of a deleted task/project stay this long before the cleanup removes them. */
  orphanDays: number;
};

function num(raw: string | undefined, fallback: number, min: number, max: number): number {
  const value = Number((raw ?? "").trim());
  return (raw ?? "").trim() !== "" && Number.isFinite(value) && value >= min && value <= max ? value : fallback;
}

export function attachConfig(env: NodeJS.ProcessEnv = process.env): AttachConfig {
  const mb = num(env.ATTACH_MAX_MB, 25, 0.01, 200);
  return {
    maxBytes: Math.round(mb * 1024 * 1024),
    allowed: ALLOWED_TYPES,
    orphanDays: num(env.ATTACH_ORPHAN_DAYS, 30, 0, 365),
  };
}
