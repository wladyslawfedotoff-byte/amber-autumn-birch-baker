/**
 * Server-side session generation ("epoch"), stored in `${DATA_DIR}/.session-epoch`
 * (mode 0600, next to .session-secret). Every session cookie carries the epoch
 * it was issued in; bumping it («Выйти на всех устройствах») invalidates all
 * cookies at once — including a stolen one.
 */
import { chmodSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { log } from "./log.ts";
import { dataDir } from "./sync-store.ts";

let cached: number | null = null;

function epochFile(dir = dataDir()): string {
  return join(dir, ".session-epoch");
}

export function readSessionEpoch(dir = dataDir()): number {
  try {
    const value = Number.parseInt(readFileSync(epochFile(dir), "utf8").trim(), 10);
    return Number.isSafeInteger(value) && value >= 0 ? value : 0;
  } catch {
    return 0;
  }
}

export function getSessionEpoch(): number {
  if (cached === null) cached = readSessionEpoch();
  return cached;
}

/** Bump and persist the epoch. Returns the new value. Throws when it cannot be saved. */
export function bumpSessionEpoch(dir = dataDir()): number {
  const next = Math.max(readSessionEpoch(dir), cached ?? 0) + 1;
  const file = epochFile(dir);
  mkdirSync(dir, { recursive: true });
  const tmp = `${file}.tmp-${process.pid}`;
  writeFileSync(tmp, `${next}\n`, { mode: 0o600 });
  chmodSync(tmp, 0o600);
  renameSync(tmp, file);
  cached = next;
  log("info", "auth.sessions_revoked", { epoch: next });
  return next;
}

/** Test hook. */
export function resetSessionEpochCache(): void {
  cached = null;
}
