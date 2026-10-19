/**
 * Consistent copies of the live database for Hyper Backup & co:
 * `VACUUM INTO DATA_DIR/backup/pora-<YYYY-MM-DD>.db` (one per day, the newest
 * KEEP kept). A copy of the raw pora.db / -wal files taken while the server
 * writes can be inconsistent; these files never are.
 */
import { closeSync, fsyncSync, mkdirSync, openSync, readdirSync, renameSync, statSync, unlinkSync, chmodSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { join } from "node:path";
import type { Db } from "./database.ts";
import { openDb, quickCheck } from "./database.ts";

export const SNAPSHOT_DIR = "backup";
export const SNAPSHOT_KEEP = 7;
const DAILY = /^pora-\d{4}-\d{2}-\d{2}\.db$/;

export function localDate(time: number): string {
  const d = new Date(time);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function snapshotName(time: number, suffix = ""): string {
  return `pora-${localDate(time)}${suffix ? `-${suffix}` : ""}.db`;
}

function fsyncPath(path: string, flags = "r"): void {
  try {
    const fd = openSync(path, flags);
    try {
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
  } catch {
    // best effort (directories cannot be fsynced everywhere)
  }
}

/**
 * Write a consistent copy of `db` to DATA_DIR/backup/<name> (replacing a copy
 * of the same name atomically) and check it opens cleanly. Returns its path.
 */
export function writeSnapshot(db: Db, dir: string, name: string): string {
  const target = join(dir, SNAPSHOT_DIR);
  mkdirSync(target, { recursive: true, mode: 0o700 });
  const final = join(target, name);
  const tmp = join(target, `.${name}.tmp-${randomBytes(4).toString("hex")}`);
  try {
    db.prepare("VACUUM INTO ?").run(tmp);
    chmodSync(tmp, 0o600);
    fsyncPath(tmp, "r+");
    const check = openDb(tmp, { readonly: true });
    try {
      const result = quickCheck(check);
      if (result !== "ok") throw new Error(`snapshot check failed: ${result}`);
    } finally {
      check.close();
    }
    renameSync(tmp, final);
    fsyncPath(target);
  } catch (error) {
    try {
      unlinkSync(tmp);
    } catch {
      /* not created */
    }
    throw error;
  }
  return final;
}

function isOld(path: string): boolean {
  try {
    return Date.now() - statSync(path).mtimeMs > 60 * 60 * 1000;
  } catch {
    return false;
  }
}

/** Keep the newest `keep` daily copies; other files in backup/ are never touched. */
export function pruneSnapshots(dir: string, keep = SNAPSHOT_KEEP): string[] {
  let names: string[];
  try {
    names = readdirSync(join(dir, SNAPSHOT_DIR));
  } catch {
    return [];
  }
  const daily = names.filter((name) => DAILY.test(name)).sort().reverse();
  const doomed = daily.slice(Math.max(keep, 1));
  for (const name of doomed) {
    try {
      unlinkSync(join(dir, SNAPSHOT_DIR, name));
    } catch {
      /* already gone */
    }
  }
  // Leftover temp files of an interrupted copy (older than an hour: never one being written now).
  for (const name of names) {
    if (name.startsWith(".pora-") && name.includes(".tmp-") && isOld(join(dir, SNAPSHOT_DIR, name))) {
      try {
        unlinkSync(join(dir, SNAPSHOT_DIR, name));
      } catch {
        /* already gone */
      }
    }
  }
  return doomed;
}

/** Today's daily copy (replaces an older one of today) + rotation. */
export function dailySnapshot(db: Db, dir: string, now = Date.now(), keep = SNAPSHOT_KEEP): { path: string; removed: string[] } {
  const path = writeSnapshot(db, dir, snapshotName(now));
  return { path, removed: pruneSnapshots(dir, keep) };
}

export function hasSnapshotFor(dir: string, now = Date.now()): boolean {
  try {
    return readdirSync(join(dir, SNAPSHOT_DIR)).includes(snapshotName(now));
  } catch {
    return false;
  }
}
