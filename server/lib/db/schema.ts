/**
 * SQLite schema of DATA_DIR/pora.db (1.12.0+).
 *
 * The sync model (src/lib/sync) is a document of collections whose entities
 * carry per-field stamps (`_b`, `_f`, `_s`, `_d`). The schema stores it as
 * real tables without re-interpreting any field:
 *
 *   - one table per collection (lists, tasks, habits, milestones, projects,
 *     assets): `id` + order (`pos`) + `doc` — the entity's own fields as JSON,
 *     stamps included, byte-for-byte what the merge code produced;
 *   - one child table per list-valued field (task tags, subtasks, links,
 *     contacts, attachments; habit log; service log, rules, fill-ups, parts …)
 *     with one row per element, in order;
 *   - frequently used fields (title, due date, owner, list, kind, km …) are
 *     VIRTUAL generated columns over the JSON, so they can never disagree with
 *     the stored entity, and are indexed where useful.
 *
 * Why entity fields stay JSON inside the row: the merge works on arbitrary
 * fields (new client versions add fields; old servers must keep them), stamps
 * are keyed by field name, and «no data loss» means the server must return
 * exactly what it stored. Splitting every scalar into a column would turn each
 * new field into a schema migration and risk dropping unknown ones.
 *
 * Assistant chats stay one JSON document per user (deeply nested messages and
 * proposals that are only ever read and written as a whole).
 *
 * Every change of this file after release is a new entry in MIGRATIONS
 * (never edit an applied one); `schema_migrations` records what was applied.
 */
import type { Collection } from "../../../src/lib/sync/merge.ts";

/** List-valued entity fields that live in child tables (snapshot of ENTITY_SPECIAL at schema v1). */
export const CHILD_FIELDS: Record<Collection, readonly string[]> = {
  lists: ["members"],
  tasks: ["tags", "repeatDates", "members", "subtasks", "attachments", "links", "contacts"],
  habits: ["checks", "members", "log"],
  milestones: ["members", "items"],
  projects: ["members", "contacts", "attachments"],
  assets: ["members", "rules", "log", "pains", "readings", "attachments", "links", "contacts", "fuel", "parts"],
};

const SINGULAR: Record<Collection, string> = {
  lists: "list",
  tasks: "task",
  habits: "habit",
  milestones: "milestone",
  projects: "project",
  assets: "asset",
};

function snake(name: string): string {
  return name.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);
}

/** «task_subtasks», «asset_fuel», «task_repeat_dates» … (fixed identifiers, never user input). */
export function childTable(collection: Collection, field: string): string {
  return `${SINGULAR[collection]}_${snake(field)}`;
}

/** Plain-value sets (strings) vs keyed object lists. */
const SET_FIELDS = new Set(["tags", "repeatDates", "members", "checks"]);

type Gen = [column: string, path: string];

const ENTITY_COLUMNS: Record<Collection, Gen[]> = {
  lists: [["name", "$.name"]],
  tasks: [
    ["title", "$.title"],
    ["list_id", "$.listId"],
    ["due", "$.due"],
    ["done", "$.done"],
    ["priority", "$.priority"],
    ["completed_at", "$.completedAt"],
    ["assignee", "$.assignee"],
  ],
  habits: [["name", "$.name"]],
  milestones: [
    ["title", "$.title"],
    ["date", "$.date"],
  ],
  projects: [["title", "$.title"]],
  assets: [
    ["name", "$.name"],
    ["kind", "$.kind"],
    ["km", "$.km"],
  ],
};

const CHILD_COLUMNS: Record<string, Gen[]> = {
  subtasks: [["title", "$.title"], ["done", "$.done"]],
  attachments: [["name", "$.name"], ["mime", "$.mime"], ["size", "$.size"]],
  links: [["url", "$.url"]],
  contacts: [["name", "$.name"], ["phone", "$.phone"]],
  log: [["date", "$.date"], ["title", "$.title"], ["km", "$.km"], ["cost", "$.cost"]],
  items: [["title", "$.title"]],
  rules: [["title", "$.title"]],
  pains: [["text", "$.text"]],
  readings: [["date", "$.date"], ["km", "$.km"]],
  fuel: [["date", "$.date"], ["liters", "$.liters"], ["sum", "$.sum"], ["km", "$.km"]],
  parts: [["name", "$.name"], ["warranty_until", "$.warrantyUntil"]],
};

function gen(column: string, source: string, path: string): string {
  return `  ${column} GENERATED ALWAYS AS (json_extract(${source}, '${path}')) VIRTUAL`;
}

function collectionDdl(collection: Collection): string[] {
  const out: string[] = [];
  const cols = [
    "  id TEXT PRIMARY KEY NOT NULL",
    "  pos INTEGER NOT NULL",
    "  doc TEXT NOT NULL CHECK (json_valid(doc))",
    "  kids TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(kids))",
    gen("owner", "doc", "$.owner"),
    gen("updated_at", "doc", "$.updatedAt"),
    ...ENTITY_COLUMNS[collection].map(([c, p]) => gen(c, "doc", p)),
  ];
  out.push(`CREATE TABLE ${collection} (\n${cols.join(",\n")}\n)`);
  out.push(`CREATE INDEX ${collection}_owner ON ${collection}(owner)`);
  if (collection === "tasks") {
    out.push("CREATE INDEX tasks_list ON tasks(list_id)");
    out.push("CREATE INDEX tasks_due ON tasks(due)");
  }
  for (const field of CHILD_FIELDS[collection]) {
    const table = childTable(collection, field);
    const extra: string[] = SET_FIELDS.has(field)
      ? [gen("item", "value", "$")]
      : [gen("item_id", "value", "$.id"), gen("updated_at", "value", "$.updatedAt"), ...(CHILD_COLUMNS[field] ?? []).map(([c, p]) => gen(c, "value", p))];
    const body = [
      `  parent_id TEXT NOT NULL REFERENCES ${collection}(id) ON DELETE CASCADE`,
      "  pos INTEGER NOT NULL",
      "  value TEXT NOT NULL CHECK (json_valid(value))",
      ...extra,
      "  PRIMARY KEY (parent_id, pos)",
    ];
    out.push(`CREATE TABLE ${table} (\n${body.join(",\n")}\n)`);
  }
  return out;
}

export type Migration = { version: number; name: string; up: string[] };

function v1(): string[] {
  const out: string[] = [
    // Small scalar state: revision, updatedAt, settings, import marker …
    "CREATE TABLE meta (key TEXT PRIMARY KEY NOT NULL, value TEXT NOT NULL)",
    // Per-profile state of the sync world (src/lib/sync/world.ts UserState).
    "CREATE TABLE user_states (login TEXT PRIMARY KEY NOT NULL, revision INTEGER NOT NULL, settings TEXT NOT NULL CHECK (json_valid(settings)), extra TEXT CHECK (extra IS NULL OR json_valid(extra)), pos INTEGER NOT NULL)",
    // Deletion markers: scope '' = shared world, '<login>' = that profile's own tombs.
    "CREATE TABLE tombstones (scope TEXT NOT NULL, collection TEXT NOT NULL, id TEXT NOT NULL, deleted_at NUMERIC NOT NULL, pos INTEGER NOT NULL, PRIMARY KEY (scope, collection, id))",
  ];
  for (const collection of ["lists", "tasks", "habits", "milestones", "projects", "assets"] as const) out.push(...collectionDdl(collection));
  out.push(
    // In-app password and per-user session generation (was users.json).
    "CREATE TABLE users (login TEXT PRIMARY KEY NOT NULL, password_hash TEXT, changed_at NUMERIC, epoch INTEGER)",
    // Web Push subscriptions (was push.json → subs); order matters (newest last, 10 per user).
    "CREATE TABLE push_subscriptions (login TEXT NOT NULL, pos INTEGER NOT NULL, value TEXT NOT NULL CHECK (json_valid(value)),\n" +
      "  endpoint GENERATED ALWAYS AS (json_extract(value, '$.endpoint')) VIRTUAL,\n" +
      "  tz GENERATED ALWAYS AS (json_extract(value, '$.tz')) VIRTUAL,\n" +
      "  created_at GENERATED ALWAYS AS (json_extract(value, '$.createdAt')) VIRTUAL,\n" +
      "  PRIMARY KEY (login, pos))",
    "CREATE INDEX push_subscriptions_endpoint ON push_subscriptions(endpoint)",
    // Reminders already sent («<login>|<key>» → time), kept 3 days.
    "CREATE TABLE push_sent (key TEXT PRIMARY KEY NOT NULL, at NUMERIC NOT NULL, pos INTEGER NOT NULL)",
    // Attachment metadata (was attachments/meta.json); the files stay in attachments/files/.
    "CREATE TABLE attachments (id TEXT PRIMARY KEY NOT NULL, pos INTEGER NOT NULL, value TEXT NOT NULL CHECK (json_valid(value)),\n" +
      "  owner GENERATED ALWAYS AS (json_extract(value, '$.owner')) VIRTUAL,\n" +
      "  parent_kind GENERATED ALWAYS AS (json_extract(value, '$.parent.kind')) VIRTUAL,\n" +
      "  parent_id GENERATED ALWAYS AS (json_extract(value, '$.parent.id')) VIRTUAL,\n" +
      "  name GENERATED ALWAYS AS (json_extract(value, '$.name')) VIRTUAL,\n" +
      "  mime GENERATED ALWAYS AS (json_extract(value, '$.mime')) VIRTUAL,\n" +
      "  size GENERATED ALWAYS AS (json_extract(value, '$.size')) VIRTUAL,\n" +
      "  orphan_since GENERATED ALWAYS AS (json_extract(value, '$.orphanSince')) VIRTUAL)",
    "CREATE INDEX attachments_parent ON attachments(parent_kind, parent_id)",
    // Assistant: one document per user file (chats, queue, notices, settings) — see the header.
    "CREATE TABLE assistant_users (file_key TEXT PRIMARY KEY NOT NULL, value TEXT NOT NULL CHECK (json_valid(value)),\n" +
      "  login GENERATED ALWAYS AS (json_extract(value, '$.login')) VIRTUAL)",
    // Small JSON documents by name (assistant usage counters).
    "CREATE TABLE kv (key TEXT PRIMARY KEY NOT NULL, value TEXT NOT NULL CHECK (json_valid(value)))",
    // One row per import of legacy JSON files (first start of 1.12, or after a rollback period).
    "CREATE TABLE legacy_imports (id INTEGER PRIMARY KEY AUTOINCREMENT, at INTEGER NOT NULL, files TEXT NOT NULL, summary TEXT NOT NULL, legacy_dir TEXT NOT NULL, moved_at INTEGER)",
  );
  return out;
}

/** 1.13.0: device keys for «Быстрое добавление» (only the sha256 of the secret is stored). */
function v2(): string[] {
  return [
    "CREATE TABLE quick_tokens (id TEXT PRIMARY KEY NOT NULL, login TEXT NOT NULL, name TEXT NOT NULL, hash TEXT NOT NULL, stamp TEXT NOT NULL,\n" +
      "  created_at INTEGER NOT NULL, last_used_at INTEGER, revoked_at INTEGER)",
    "CREATE INDEX quick_tokens_login ON quick_tokens(login)",
  ];
}

export const MIGRATIONS: readonly Migration[] = [
  { version: 1, name: "initial schema (1.12.0)", up: v1() },
  { version: 2, name: "quick add device keys (1.13.0)", up: v2() },
];

export const SCHEMA_VERSION = MIGRATIONS[MIGRATIONS.length - 1]!.version;
