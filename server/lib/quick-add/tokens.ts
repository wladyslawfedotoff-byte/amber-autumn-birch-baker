/**
 * «Быстрое добавление»: per-device keys for the phone shortcut.
 *
 * Key format: `pora_<id>.<secret>`; `id` (12 chars) finds the row, only
 * sha256(secret) is stored and compared in constant time. The key is shown
 * once at creation. Its only right is POST /api/quick-add (add to «Входящие»).
 *
 * Every row carries `stamp` = sha256(password fingerprint + session epoch) of
 * its profile at creation: a password change or «Выйти на всех устройствах»
 * changes it, so every key of that profile stops working at once (the routes
 * also revoke the rows explicitly).
 */
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { getAuthConfig } from "../auth.ts";
import { sqliteOf } from "../db/storage.ts";
import type { Db } from "../db/database.ts";
import { dataDir } from "../sync-store.ts";
import { effectiveFingerprint, sessionEpochFor } from "../user-store.ts";

export const MAX_TOKENS_PER_USER = 10;
const NAME_MAX = 40;

export type QuickToken = { id: string; name: string; createdAt: number; lastUsedAt: number | null };

type Row = { id: string; login: string; name: string; hash: string; stamp: string; created_at: number; last_used_at: number | null; revoked_at: number | null };

export class QuickAddUnavailable extends Error {}

function db(dir = dataDir()): Db {
  const storage = sqliteOf(dir);
  if (!storage) throw new QuickAddUnavailable("quick add needs the SQLite storage");
  return storage.db;
}

const sha = (value: string) => createHash("sha256").update(value, "utf8").digest("hex");

/** Current stamp of a profile; null if the login is not configured any more. */
export function stampFor(login: string, dir = dataDir()): string | null {
  const config = getAuthConfig();
  const account = "accounts" in config ? config.accounts.get(login) : undefined;
  if (!account) return null;
  return sha(`${effectiveFingerprint(account, dir)}|${sessionEpochFor(login, dir)}`);
}

export function cleanName(raw: unknown): string {
  const name = typeof raw === "string" ? [...raw].filter((ch) => ch.charCodeAt(0) >= 0x20 && ch.charCodeAt(0) !== 0x7f).join("").trim().slice(0, NAME_MAX) : "";
  return name || "Устройство";
}

export function listTokens(login: string, dir = dataDir()): QuickToken[] {
  const stamp = stampFor(login, dir);
  const rows = db(dir).prepare("SELECT * FROM quick_tokens WHERE login = ? AND revoked_at IS NULL ORDER BY created_at").all(login) as Row[];
  return rows.filter((r) => r.stamp === stamp).map((r) => ({ id: r.id, name: r.name, createdAt: r.created_at, lastUsedAt: r.last_used_at }));
}

/** New key: returns the full key (shown once) and its public part. */
export function createToken(login: string, name: string, now = Date.now(), dir = dataDir()): { token: string; item: QuickToken } | { error: "too_many" } {
  const stamp = stampFor(login, dir);
  if (!stamp) throw new Error("unknown login");
  if (listTokens(login, dir).length >= MAX_TOKENS_PER_USER) return { error: "too_many" };
  const id = randomBytes(9).toString("base64url");
  const secret = randomBytes(32).toString("base64url");
  db(dir)
    .prepare("INSERT INTO quick_tokens (id, login, name, hash, stamp, created_at) VALUES (?, ?, ?, ?, ?, ?)")
    .run(id, login, name, sha(secret), stamp, now);
  return { token: `pora_${id}.${secret}`, item: { id, name, createdAt: now, lastUsedAt: null } };
}

export function revokeToken(login: string, id: string, now = Date.now(), dir = dataDir()): boolean {
  const res = db(dir).prepare("UPDATE quick_tokens SET revoked_at = ? WHERE id = ? AND login = ? AND revoked_at IS NULL").run(now, id, login);
  return res.changes > 0;
}

/** Password change / «выйти везде»: every key of the profile. Never throws (JSON storage has no keys). */
export function revokeAllTokens(login: string, now = Date.now(), dir = dataDir()): number {
  try {
    return db(dir).prepare("UPDATE quick_tokens SET revoked_at = ? WHERE login = ? AND revoked_at IS NULL").run(now, login).changes;
  } catch {
    return 0;
  }
}

const KEY_RE = /^pora_([A-Za-z0-9_-]{12})\.([A-Za-z0-9_-]{43})$/;

export function tokenIdOf(raw: string): string | null {
  return KEY_RE.exec(raw)?.[1] ?? null;
}

/** Valid key → its owner and id; marks last use. */
export function verifyToken(raw: string, now = Date.now(), dir = dataDir()): { login: string; id: string } | null {
  const match = KEY_RE.exec(raw);
  if (!match) return null;
  const [, id, secret] = match as unknown as [string, string, string];
  const row = db(dir).prepare("SELECT * FROM quick_tokens WHERE id = ?").get(id) as Row | undefined;
  const given = Buffer.from(sha(secret), "hex");
  const stored = Buffer.from(row?.hash ?? "0".repeat(64), "hex");
  const same = stored.length === given.length && timingSafeEqual(stored, given);
  if (!row || !same || row.revoked_at !== null) return null;
  if (row.stamp !== stampFor(row.login, dir)) return null;
  db(dir).prepare("UPDATE quick_tokens SET last_used_at = ? WHERE id = ?").run(now, id);
  return { login: row.login, id };
}
