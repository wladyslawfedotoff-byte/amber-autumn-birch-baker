/**
 * «Ключи помощника» (1.25): keys for bots that create tasks for the user.
 *
 * Key format: `porah_<id>.<secret>` (other than the phone keys `pora_…`, so
 * neither kind is accepted where the other belongs). `id` (12 chars) finds the
 * row, only sha256(secret) is stored and compared in constant time; the key
 * is shown once. Rights: only /api/helper/* (see routes/api/helper/[...].ts),
 * and there only the tasks this key created.
 *
 * Like the phone keys, every row carries the profile `stamp` (password +
 * session epoch): a password change or «Выйти на всех устройствах» turns all
 * helper keys of the profile off (the routes also revoke the rows).
 *
 * Action log: one row per change (create / update / complete / reopen /
 * comment) and per refused attempt on someone else's task; kept 90 days.
 */
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { sqliteOf } from "../db/storage.ts";
import type { Db } from "../db/database.ts";
import { dataDir } from "../sync-store.ts";
import { stampFor } from "../quick-add/tokens.ts";

export const MAX_HELPER_KEYS = 5;
export const AUDIT_KEEP_MS = 90 * 24 * 60 * 60 * 1000;
export const AUDIT_PAGE = 100;
const NAME_MAX = 40;
const SUMMARY_MAX = 120;

export type HelperKey = { id: string; name: string; createdAt: number; lastUsedAt: number | null };
export type HelperAction = "create" | "update" | "complete" | "reopen" | "comment" | "denied" | "list.create" | "list.rename" | "task.move";
export type AuditEntry = { at: number; action: HelperAction; taskId: string | null; summary: string };

type Row = { id: string; login: string; name: string; hash: string; stamp: string; created_at: number; last_used_at: number | null; revoked_at: number | null };

export class HelperUnavailable extends Error {}

function db(dir = dataDir()): Db {
  const storage = sqliteOf(dir);
  if (!storage) throw new HelperUnavailable("helper keys need the SQLite storage");
  return storage.db;
}

const sha = (value: string) => createHash("sha256").update(value, "utf8").digest("hex");

/** Printable text without control characters, trimmed and cut. */
export function cleanLine(raw: unknown, max: number): string {
  if (typeof raw !== "string") return "";
  return [...raw]
    .filter((ch) => ch.charCodeAt(0) >= 0x20 && ch.charCodeAt(0) !== 0x7f)
    .join("")
    .trim()
    .slice(0, max);
}

export function cleanKeyName(raw: unknown): string {
  return cleanLine(raw, NAME_MAX) || "Помощник";
}

export function listHelperKeys(login: string, dir = dataDir()): HelperKey[] {
  const stamp = stampFor(login, dir);
  const rows = db(dir).prepare("SELECT * FROM helper_keys WHERE login = ? AND revoked_at IS NULL ORDER BY created_at").all(login) as Row[];
  return rows.filter((r) => r.stamp === stamp).map((r) => ({ id: r.id, name: r.name, createdAt: r.created_at, lastUsedAt: r.last_used_at }));
}

/** New key: the full key (shown once) and its public part. */
export function createHelperKey(login: string, name: string, now = Date.now(), dir = dataDir()): { token: string; item: HelperKey } | { error: "too_many" } {
  const stamp = stampFor(login, dir);
  if (!stamp) throw new Error("unknown login");
  if (listHelperKeys(login, dir).length >= MAX_HELPER_KEYS) return { error: "too_many" };
  const id = randomBytes(9).toString("base64url");
  const secret = randomBytes(32).toString("base64url");
  db(dir).prepare("INSERT INTO helper_keys (id, login, name, hash, stamp, created_at) VALUES (?, ?, ?, ?, ?, ?)").run(id, login, name, sha(secret), stamp, now);
  return { token: `porah_${id}.${secret}`, item: { id, name, createdAt: now, lastUsedAt: null } };
}

export function revokeHelperKey(login: string, id: string, now = Date.now(), dir = dataDir()): boolean {
  return db(dir).prepare("UPDATE helper_keys SET revoked_at = ? WHERE id = ? AND login = ? AND revoked_at IS NULL").run(now, id, login).changes > 0;
}

/** Password change / «выйти везде». Never throws (JSON storage has no keys). */
export function revokeAllHelperKeys(login: string, now = Date.now(), dir = dataDir()): number {
  try {
    return db(dir).prepare("UPDATE helper_keys SET revoked_at = ? WHERE login = ? AND revoked_at IS NULL").run(now, login).changes;
  } catch {
    return 0;
  }
}

const KEY_RE = /^porah_([A-Za-z0-9_-]{12})\.([A-Za-z0-9_-]{43})$/;

export function helperKeyIdOf(raw: string): string | null {
  return KEY_RE.exec(raw)?.[1] ?? null;
}

/** Valid key → owner login, key id and name; marks last use. */
export function verifyHelperKey(raw: string, now = Date.now(), dir = dataDir()): { login: string; id: string; name: string } | null {
  const match = KEY_RE.exec(raw);
  if (!match) return null;
  const [, id, secret] = match as unknown as [string, string, string];
  const row = db(dir).prepare("SELECT * FROM helper_keys WHERE id = ?").get(id) as Row | undefined;
  const given = Buffer.from(sha(secret), "hex");
  const stored = Buffer.from(row?.hash ?? "0".repeat(64), "hex");
  const same = stored.length === given.length && timingSafeEqual(stored, given);
  if (!row || !same || row.revoked_at !== null) return null;
  if (row.stamp !== stampFor(row.login, dir)) return null;
  db(dir).prepare("UPDATE helper_keys SET last_used_at = ? WHERE id = ?").run(now, id);
  return { login: row.login, id, name: row.name };
}

/** One log line; entries older than 90 days are dropped on the way. */
export function audit(keyId: string, login: string, action: HelperAction, taskId: string | null, summary: string, now = Date.now(), dir = dataDir()): void {
  const conn = db(dir);
  conn.prepare("DELETE FROM helper_audit WHERE at < ?").run(now - AUDIT_KEEP_MS);
  conn.prepare("INSERT INTO helper_audit (key_id, login, at, action, task_id, summary) VALUES (?, ?, ?, ?, ?, ?)").run(keyId, login, now, action, taskId, cleanLine(summary, SUMMARY_MAX));
}

/** Newest first, only for a key of this profile. */
export function auditLog(login: string, keyId: string, limit = AUDIT_PAGE, now = Date.now(), dir = dataDir()): AuditEntry[] {
  const rows = db(dir)
    .prepare("SELECT at, action, task_id, summary FROM helper_audit WHERE key_id = ? AND login = ? AND at >= ? ORDER BY at DESC, id DESC LIMIT ?")
    .all(keyId, login, now - AUDIT_KEEP_MS, limit) as { at: number; action: HelperAction; task_id: string | null; summary: string }[];
  return rows.map((r) => ({ at: r.at, action: r.action, taskId: r.task_id, summary: r.summary }));
}
