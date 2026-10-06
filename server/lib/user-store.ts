/**
 * Per-user state that can change at runtime: the in-app password (wins over
 * .env) and the per-user session epoch («Выйти на всех устройствах»), both in
 * ${DATA_DIR}/users.json (scripts/users-file.mjs). The file is re-read when it
 * changes on disk (scripts/reset-password.mjs runs in another process).
 */
import { createHash } from "node:crypto";
import { verifyPasswordHash, hashPassword } from "../../scripts/password-hash.mjs";
import {
  readUsersFile,
  usersFileSig,
  withEpochBump,
  withPassword,
  writeUsersFileSync,
  type UserOverride,
  type UsersFile,
} from "../../scripts/users-file.mjs";
import type { Account, AuthConfig } from "./auth.ts";
import { log } from "./log.ts";
import { getSessionEpoch } from "./session-epoch.ts";
import { dataDir } from "./sync-store.ts";

type Sig = { size: number; mtimeMs: number; ino: number } | null;

let cache: { dir: string; sig: Sig; file: UsersFile } | null = null;

function sameSig(a: Sig, b: Sig): boolean {
  if (!a || !b) return a === b;
  return a.size === b.size && a.mtimeMs === b.mtimeMs && a.ino === b.ino;
}

export function loadUsersFile(dir = dataDir()): UsersFile {
  const sig = usersFileSig(dir) as Sig;
  if (cache && cache.dir === dir && sameSig(cache.sig, sig)) return cache.file;
  try {
    const file = readUsersFile(dir) as UsersFile;
    cache = { dir, sig, file };
    return file;
  } catch (error) {
    log("error", "users.read_failed", { file: `${dir}/users.json`, note: "in-app passwords ignored until the file is fixed" }, error);
    // Keep the last good copy, if any.
    if (cache && cache.dir === dir) return cache.file;
    return { v: 1, users: Object.create(null) };
  }
}

export function userOverride(login: string, dir = dataDir()): UserOverride {
  return loadUsersFile(dir).users[login] ?? {};
}

function saveUsersFile(file: UsersFile, dir = dataDir()): void {
  writeUsersFileSync(dir, file);
  cache = { dir, sig: usersFileSig(dir) as Sig, file };
}

/** Fingerprint of the password that currently works for the account (signs its sessions). */
export function effectiveFingerprint(account: Account, dir = dataDir()): string {
  const hash = userOverride(account.login, dir).passwordHash;
  if (hash) return createHash("sha256").update(`override:${hash}`, "utf8").digest("base64url");
  return account.fingerprint;
}

/** Global epoch (.session-epoch) + per-user epoch (users.json). */
export function sessionEpochFor(login: string, dir = dataDir()): string {
  return `${getSessionEpoch()}-${userOverride(login, dir).epoch ?? 0}`;
}

export function hasInAppPassword(login: string, dir = dataDir()): boolean {
  return Boolean(userOverride(login, dir).passwordHash);
}

let dummyHash: string | null = null;

/** Check a login + password. Unknown logins cost the same as known ones (no user enumeration). */
export function verifyCredentials(config: AuthConfig, login: string, password: string, dir = dataDir()): Account | null {
  const account = "accounts" in config ? config.accounts.get(login) : undefined;
  if (!account) {
    dummyHash ??= hashPassword("pora-dummy-password");
    verifyPasswordHash(password, dummyHash);
    return null;
  }
  const hash = userOverride(login, dir).passwordHash;
  if (hash) return verifyPasswordHash(password, hash) ? account : null;
  return account.verify?.(password) ? account : null;
}

/** «Сменить пароль»: store the new hash and log the user out of other devices. */
export function setUserPassword(login: string, password: string, now = Date.now(), dir = dataDir()): void {
  const file = withPassword(loadUsersFile(dir), login, hashPassword(password), now) as UsersFile;
  saveUsersFile(file, dir);
  log("info", "auth.password_changed", { user: login });
}

export function bumpUserEpoch(login: string, dir = dataDir()): void {
  saveUsersFile(withEpochBump(loadUsersFile(dir), login) as UsersFile, dir);
  log("info", "auth.sessions_revoked", { user: login });
}

/** Test hook. */
export function resetUserStoreCache(): void {
  cache = null;
}
