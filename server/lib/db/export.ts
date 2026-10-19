/**
 * pora.db → the 1.11 JSON files (scripts/export-json.mjs): pora.json,
 * users.json, push.json, attachments/meta.json, assistant/<login>.json,
 * assistant-usage.json — in exactly the formats 1.11 reads, so a rollback to
 * the previous image keeps the edits made with 1.12. Read in one transaction
 * (a consistent picture even while the server writes).
 */
import { closeSync, fsyncSync, mkdirSync, openSync, writeSync } from "node:fs";
import { dirname, join } from "node:path";
import type { Db } from "./database.ts";
import { readStoredDoc } from "./doc-tables.ts";
import { LEGACY_ASSISTANT_DIR, LEGACY_ATTACH_META, LEGACY_DOC, LEGACY_PUSH, LEGACY_USAGE, LEGACY_USERS, serializeStoredDoc } from "./legacy.ts";
import { KV_USAGE, allAssistant, readAttachments, readKv, readPush, readUsers } from "./records.ts";

function writeNew(file: string, text: string): void {
  mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
  const fd = openSync(file, "wx", 0o600);
  try {
    writeSync(fd, text);
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
}

export type ExportResult = { files: string[]; revision: number | null };

/** Write the JSON files into `target` (must not contain them yet). */
export function exportJson(db: Db, target: string): ExportResult {
  return db.transaction((): ExportResult => {
    const files: string[] = [];
    const put = (rel: string, text: string) => {
      writeNew(join(target, rel), text);
      files.push(rel);
    };
    const doc = readStoredDoc(db);
    if (doc) put(LEGACY_DOC, serializeStoredDoc(doc));
    const users = readUsers(db);
    if (Object.keys(users.users).length) put(LEGACY_USERS, `${JSON.stringify(users, null, 2)}\n`);
    const push = readPush(db);
    if (Object.keys(push.subs).length || Object.keys(push.sent).length) put(LEGACY_PUSH, JSON.stringify(push));
    const meta = readAttachments(db);
    if (Object.keys(meta.items).length) put(LEGACY_ATTACH_META, JSON.stringify(meta));
    for (const [key, value] of Object.entries(allAssistant(db))) put(`${LEGACY_ASSISTANT_DIR}/${key}.json`, JSON.stringify(value));
    const usage = readKv(db, KV_USAGE);
    if (usage) put(LEGACY_USAGE, JSON.stringify(usage));
    return { files, revision: doc ? doc.revision : null };
  })();
}
