/**
 * `${DATA_DIR}/users.json`: per-user overrides made in the app.
 *
 *   { "v": 1, "users": { "<login>": { "passwordHash": "scrypt:…", "changedAt": 1700000000000, "epoch": 2 } } }
 *
 * - passwordHash: set by «Сменить пароль»; it wins over USER_<LOGIN>_PASSWORD(_HASH)
 *   / APP_PASSWORD in .env. Removing it (scripts/reset-password.mjs) brings the
 *   .env password back.
 * - epoch: per-user session generation; bumping it logs that user out everywhere.
 *
 * Mode 0600, written atomically (temp file + fsync + rename). Plain JS so the
 * server (server/lib/user-store.ts) and the scripts share one implementation.
 */
import { chownSync, closeSync, fsyncSync, mkdirSync, openSync, readFileSync, renameSync, statSync, unlinkSync, writeSync, chmodSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { join } from "node:path";

export const USERS_FILE = "users.json";

/** @typedef {{ passwordHash?: string, changedAt?: number, epoch?: number }} UserOverride */
/** @typedef {{ v: 1, users: Record<string, UserOverride> }} UsersFile */

/** @param {string} dir */
export function usersFilePath(dir) {
  return join(dir, USERS_FILE);
}

/**
 * @param {unknown} raw
 * @returns {UsersFile}
 */
export function normalizeUsersFile(raw) {
  /** @type {UsersFile} */
  const out = { v: 1, users: Object.create(null) };
  const users = raw && typeof raw === "object" ? /** @type {any} */ (raw).users : null;
  if (!users || typeof users !== "object") return out;
  for (const [login, value] of Object.entries(users)) {
    if (!/^[a-z0-9_-]{1,32}$/.test(login) || !value || typeof value !== "object") continue;
    /** @type {UserOverride} */
    const entry = {};
    const v = /** @type {Record<string, unknown>} */ (value);
    if (typeof v.passwordHash === "string" && v.passwordHash.startsWith("scrypt:")) entry.passwordHash = v.passwordHash;
    if (typeof v.changedAt === "number" && Number.isFinite(v.changedAt)) entry.changedAt = v.changedAt;
    if (typeof v.epoch === "number" && Number.isSafeInteger(v.epoch) && v.epoch >= 0) entry.epoch = v.epoch;
    out.users[login] = entry;
  }
  return out;
}

/**
 * Missing file → empty. A broken file throws (never silently drop overrides).
 * @param {string} dir
 * @returns {UsersFile}
 */
export function readUsersFile(dir) {
  let text;
  try {
    text = readFileSync(usersFilePath(dir), "utf8");
  } catch (error) {
    if (/** @type {NodeJS.ErrnoException} */ (error).code === "ENOENT") return { v: 1, users: Object.create(null) };
    throw error;
  }
  return normalizeUsersFile(JSON.parse(text));
}

/**
 * @param {string} dir
 * @returns {{ size: number, mtimeMs: number, ino: number } | null}
 */
export function usersFileSig(dir) {
  try {
    const st = statSync(usersFilePath(dir));
    return { size: st.size, mtimeMs: st.mtimeMs, ino: st.ino };
  } catch {
    return null;
  }
}

/**
 * @param {string} dir
 * @param {UsersFile} file
 * @param {{ uid: number, gid: number } | null} [owner] keep the file owned by the app user when a root script writes it
 */
export async function writeUsersFile(dir, file, owner = null) {
  writeUsersFileSync(dir, file, owner);
}


/**
 * @param {string} dir
 * @param {UsersFile} file
 * @param {{ uid: number, gid: number } | null} [owner]
 */
export function writeUsersFileSync(dir, file, owner = null) {
  mkdirSync(dir, { recursive: true });
  const target = usersFilePath(dir);
  const tmp = `${target}.tmp-${process.pid}-${randomBytes(4).toString("hex")}`;
  const sorted = { v: 1, users: Object.fromEntries(Object.entries(file.users).sort(([a], [b]) => (a < b ? -1 : 1))) };
  try {
    const fd = openSync(tmp, "w", 0o600);
    try {
      writeSync(fd, `${JSON.stringify(sorted, null, 2)}\n`);
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
    chmodSync(tmp, 0o600);
    if (owner) {
      try {
        chownSync(tmp, owner.uid, owner.gid);
      } catch {
        /* best effort (not root) */
      }
    }
    renameSync(tmp, target);
  } catch (error) {
    try {
      unlinkSync(tmp);
    } catch {
      /* already gone */
    }
    throw error;
  }
}

/**
 * Set a new password hash for `login`; bumps the user's session epoch.
 * @param {UsersFile} file
 * @param {string} login
 * @param {string} passwordHash
 * @param {number} now
 * @returns {UsersFile}
 */
export function withPassword(file, login, passwordHash, now) {
  const users = { ...file.users };
  const prev = users[login] ?? {};
  users[login] = { ...prev, passwordHash, changedAt: now, epoch: (prev.epoch ?? 0) + 1 };
  return { v: 1, users };
}

/**
 * Remove the in-app password of `login` (the .env password applies again); bumps the epoch.
 * @param {UsersFile} file
 * @param {string} login
 * @param {number} now
 * @returns {UsersFile}
 */
export function withoutPassword(file, login, now) {
  const users = { ...file.users };
  const prev = users[login] ?? {};
  const next = { ...prev, changedAt: now, epoch: (prev.epoch ?? 0) + 1 };
  delete next.passwordHash;
  users[login] = next;
  return { v: 1, users };
}

/**
 * @param {UsersFile} file
 * @param {string} login
 * @returns {UsersFile}
 */
export function withEpochBump(file, login) {
  const users = { ...file.users };
  const prev = users[login] ?? {};
  users[login] = { ...prev, epoch: (prev.epoch ?? 0) + 1 };
  return { v: 1, users };
}
