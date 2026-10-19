/**
 * Small tables of pora.db: in-app passwords and session epochs, push
 * subscriptions, attachment metadata, assistant documents, key-value JSON.
 * Each function is one statement or is called inside a transaction by the
 * store; values are always bound parameters.
 */
import type { Db } from "./database.ts";
import { stmt } from "./database.ts";
import type { AttachMeta, MetaFile, PushFile, StoredSub } from "./legacy.ts";

/* ---------------------------------- users --------------------------------- */

export type UserOverride = { passwordHash?: string; changedAt?: number; epoch?: number };
export type UsersFile = { v: 1; users: Record<string, UserOverride> };

export function readUsers(db: Db): UsersFile {
  const users: Record<string, UserOverride> = Object.create(null);
  const rows = stmt(db, "SELECT login, password_hash, changed_at, epoch FROM users ORDER BY login").all() as {
    login: string;
    password_hash: string | null;
    changed_at: number | null;
    epoch: number | null;
  }[];
  for (const row of rows) {
    const entry: UserOverride = {};
    if (row.password_hash !== null) entry.passwordHash = row.password_hash;
    if (row.changed_at !== null) entry.changedAt = row.changed_at;
    if (row.epoch !== null) entry.epoch = row.epoch;
    users[row.login] = entry;
  }
  return { v: 1, users };
}

/** Replace the whole table with `file` (call inside a transaction). */
export function writeUsers(db: Db, file: UsersFile): void {
  stmt(db, "DELETE FROM users").run();
  const insert = stmt(db, "INSERT INTO users (login, password_hash, changed_at, epoch) VALUES (?, ?, ?, ?)");
  for (const [login, entry] of Object.entries(file.users)) insert.run(login, entry.passwordHash ?? null, entry.changedAt ?? null, entry.epoch ?? null);
}

/* ---------------------------------- push ---------------------------------- */

export function readPush(db: Db): PushFile {
  const out: PushFile = { v: 1, subs: {}, sent: {} };
  const subs = stmt(db, "SELECT login, value FROM push_subscriptions ORDER BY login, pos").all() as { login: string; value: string }[];
  const order = stmt(db, "SELECT login, MIN(rowid) AS r FROM push_subscriptions GROUP BY login ORDER BY r").all() as { login: string }[];
  for (const { login } of order) out.subs[login] = [];
  for (const row of subs) out.subs[row.login]!.push(JSON.parse(row.value) as StoredSub);
  const sent = stmt(db, "SELECT key, at FROM push_sent ORDER BY pos").all() as { key: string; at: number }[];
  for (const row of sent) out.sent[row.key] = row.at;
  return out;
}

/** Replace both push tables (small: ≤ 10 devices per user, sent marks of 3 days). */
export function writePush(db: Db, file: PushFile): void {
  stmt(db, "DELETE FROM push_subscriptions").run();
  stmt(db, "DELETE FROM push_sent").run();
  const sub = stmt(db, "INSERT INTO push_subscriptions (login, pos, value) VALUES (?, ?, ?)");
  for (const [login, list] of Object.entries(file.subs)) list.forEach((item, pos) => sub.run(login, pos, JSON.stringify(item)));
  const sent = stmt(db, "INSERT INTO push_sent (key, at, pos) VALUES (?, ?, ?)");
  Object.entries(file.sent).forEach(([key, at], pos) => sent.run(key, at, pos));
}

/* ------------------------------- attachments ------------------------------ */

export function readAttachments(db: Db): MetaFile {
  const out: MetaFile = { v: 1, items: {} };
  for (const row of stmt(db, "SELECT id, value FROM attachments ORDER BY pos").all() as { id: string; value: string }[]) {
    out.items[row.id] = JSON.parse(row.value) as AttachMeta;
  }
  return out;
}

export function getAttachment(db: Db, id: string): AttachMeta | null {
  const row = stmt(db, "SELECT value FROM attachments WHERE id = ?").get(id) as { value: string } | undefined;
  return row ? (JSON.parse(row.value) as AttachMeta) : null;
}

export function attachmentsOf(db: Db, kind: string, parentId: string): AttachMeta[] {
  const rows = stmt(db, "SELECT value FROM attachments WHERE parent_kind = ? AND parent_id = ? ORDER BY pos").all(kind, parentId) as { value: string }[];
  return rows.map((row) => JSON.parse(row.value) as AttachMeta);
}

/** Insert (appended at the end) or update in place. */
export function putAttachment(db: Db, meta: AttachMeta): void {
  stmt(
    db,
    "INSERT INTO attachments (id, pos, value) VALUES (?, (SELECT COALESCE(MAX(pos), -1) + 1 FROM attachments), ?) ON CONFLICT(id) DO UPDATE SET value = excluded.value",
  ).run(meta.id, JSON.stringify(meta));
}

export function deleteAttachment(db: Db, id: string): boolean {
  return stmt(db, "DELETE FROM attachments WHERE id = ?").run(id).changes > 0;
}

export function writeAttachments(db: Db, file: MetaFile): void {
  stmt(db, "DELETE FROM attachments").run();
  const insert = stmt(db, "INSERT INTO attachments (id, pos, value) VALUES (?, ?, ?)");
  Object.entries(file.items).forEach(([id, meta], pos) => insert.run(id, pos, JSON.stringify(meta)));
}

/* -------------------------------- assistant ------------------------------- */

export function readAssistant(db: Db, key: string): Record<string, unknown> | null {
  const row = stmt(db, "SELECT value FROM assistant_users WHERE file_key = ?").get(key) as { value: string } | undefined;
  return row ? (JSON.parse(row.value) as Record<string, unknown>) : null;
}

export function writeAssistant(db: Db, key: string, value: unknown): void {
  stmt(db, "INSERT INTO assistant_users (file_key, value) VALUES (?, ?) ON CONFLICT(file_key) DO UPDATE SET value = excluded.value").run(key, JSON.stringify(value));
}

export function deleteAssistant(db: Db, key: string): void {
  stmt(db, "DELETE FROM assistant_users WHERE file_key = ?").run(key);
}

export function allAssistant(db: Db): Record<string, Record<string, unknown>> {
  const out: Record<string, Record<string, unknown>> = {};
  for (const row of stmt(db, "SELECT file_key, value FROM assistant_users ORDER BY file_key").all() as { file_key: string; value: string }[]) {
    out[row.file_key] = JSON.parse(row.value) as Record<string, unknown>;
  }
  return out;
}

/* ----------------------------------- kv ----------------------------------- */

export const KV_USAGE = "assistant-usage";

export function readKv(db: Db, key: string): unknown {
  const row = stmt(db, "SELECT value FROM kv WHERE key = ?").get(key) as { value: string } | undefined;
  return row ? (JSON.parse(row.value) as unknown) : null;
}

export function writeKv(db: Db, key: string, value: unknown): void {
  stmt(db, "INSERT INTO kv (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(key, JSON.stringify(value));
}

export function deleteKv(db: Db, key: string): void {
  stmt(db, "DELETE FROM kv WHERE key = ?").run(key);
}
