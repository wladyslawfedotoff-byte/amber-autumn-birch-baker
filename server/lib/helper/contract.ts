/**
 * Helper API contract (1.27): the one place that says what /api/helper
 * accepts and answers. The route and tasks.ts validate bodies only through
 * the schemas below; docs/HELPER-API.md is checked against this file by
 * contract.test.ts. Plain TypeScript — no schema library.
 *
 * Error texts and codes are the ones the API has answered since 1.25/1.26;
 * changing them breaks bots, so contract.test.ts pins them.
 */

export const TITLE_MAX = 200;
export const NOTES_MAX = 4000;
export const COMMENT_MAX = 1000;
export const LIST_NAME_MAX = 60;
/** Request body limit, bytes. */
export const MAX_BODY = 16 * 1024;
/** Task, list and path ids. */
export const ID_RE = /^[A-Za-z0-9_-]{1,200}$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

/** A bad request: answered 400 { error: "bad_request", message }. */
export class InputError extends Error {}

// ---------------------------------------------------------------- schemas

/**
 * One body field. `missing`: what an absent field means — "skip" (not in the
 * result), "empty" (checked as ""), "emptyOnCreate" (as "" only when creating).
 * `null` is accepted only where `nullable` is set.
 */
export type FieldSpec =
  | { type: "text"; max: number; multiline: boolean; missing: "skip" | "empty" | "emptyOnCreate"; emptyMessage?: string }
  | { type: "date" | "time" | "id"; nullable: true; message: string }
  | { type: "enum"; values: readonly string[]; nullable: true; message: string };

export type BodySchema = {
  /** Field order = check order (the first bad field is the one reported). */
  fields: Readonly<Record<string, FieldSpec>>;
  unknownMessage: (key: string) => string;
  /** Message when no field was given (PATCH-style bodies). */
  emptyMessage?: string;
};

export const TASK_BODY: BodySchema = {
  fields: {
    title: { type: "text", max: TITLE_MAX, multiline: false, missing: "emptyOnCreate", emptyMessage: "title: нужно название" },
    notes: { type: "text", max: NOTES_MAX, multiline: true, missing: "skip" },
    due: { type: "date", nullable: true, message: "due: дата ГГГГ-ММ-ДД или null" },
    startAt: { type: "time", nullable: true, message: "startAt: время ЧЧ:ММ или null" },
    endAt: { type: "time", nullable: true, message: "endAt: время ЧЧ:ММ или null" },
    listId: { type: "id", nullable: true, message: "listId: id своего списка или null" },
  },
  unknownMessage: (key) => `поле «${key}» менять нельзя`,
  emptyMessage: "нечего менять",
};

export const LIST_BODY: BodySchema = {
  fields: { name: { type: "text", max: LIST_NAME_MAX, multiline: false, missing: "empty", emptyMessage: "name: нужно название списка" } },
  unknownMessage: (key) => `поле «${key}» не поддерживается`,
};

export const COMMENT_BODY: BodySchema = {
  fields: {
    text: { type: "text", max: COMMENT_MAX, multiline: true, missing: "empty" },
    result: { type: "enum", values: ["ok", "fail"], nullable: true, message: "result: ok, fail или нет" },
  },
  unknownMessage: (key) => `поле «${key}» не поддерживается`,
};

// -------------------------------------------------------------- responses

/** Fields of a task in every answer, in this order. */
export const TASK_VIEW_FIELDS = ["id", "title", "notes", "due", "startAt", "endAt", "listId", "done", "completedAt", "createdAt", "updatedAt", "comments"] as const;
export const LIST_VIEW_FIELDS = ["id", "name", "updatedAt"] as const;
export const COMMENT_VIEW_FIELDS = ["id", "at", "text", "result"] as const;

export type HelperComment = { id: string; at: number; text: string; result?: "ok" | "fail" };
/** What a key sees of its task. No list, project, owner or sharing data. */
export type HelperTaskView = {
  id: string;
  title: string;
  notes: string;
  due: string | null;
  startAt: string | null;
  endAt: string | null;
  /** One of the key's own lists; null = «Входящие» or a place the key does not see. */
  listId: string | null;
  done: boolean;
  completedAt: number | null;
  createdAt: number;
  updatedAt: number;
  comments: HelperComment[];
};
export type HelperListView = { id: string; name: string; updatedAt: number };
export type TaskFields = { title?: string; notes?: string; due?: string | null; startAt?: string | null; endAt?: string | null; listId?: string | null };
export type CommentInput = { text: string; result?: "ok" | "fail" };

// -------------------------------------------------------------- endpoints

export type Endpoint = {
  method: "GET" | "POST" | "PATCH";
  /** Path after /api/helper, `:id` for an id. */
  path: string;
  body?: BodySchema;
  /** Success status and the top-level keys of the answer. */
  status: 200 | 201;
  answer: readonly string[];
};

export const ENDPOINTS: readonly Endpoint[] = [
  { method: "GET", path: "/me", status: 200, answer: ["name"] },
  { method: "GET", path: "/tasks", status: 200, answer: ["items"] },
  { method: "POST", path: "/tasks", body: TASK_BODY, status: 201, answer: ["item"] },
  { method: "GET", path: "/tasks/:id", status: 200, answer: ["item"] },
  { method: "PATCH", path: "/tasks/:id", body: TASK_BODY, status: 200, answer: ["item"] },
  { method: "POST", path: "/tasks/:id/complete", status: 200, answer: ["item"] },
  { method: "POST", path: "/tasks/:id/reopen", status: 200, answer: ["item"] },
  { method: "POST", path: "/tasks/:id/comments", body: COMMENT_BODY, status: 201, answer: ["item"] },
  { method: "GET", path: "/lists", status: 200, answer: ["items"] },
  // 200 { item, existed: true } when the key already has a list of that name.
  { method: "POST", path: "/lists", body: LIST_BODY, status: 201, answer: ["item"] },
  { method: "PATCH", path: "/lists/:id", body: LIST_BODY, status: 200, answer: ["item"] },
];

/** Error answers: HTTP status → `error` code. */
export const ERRORS = {
  bad_request: 400,
  bad_key: 401,
  not_found: 404,
  method_not_allowed: 405,
  too_many_tasks: 409,
  too_many_lists: 409,
  name_taken: 409,
  rate_limited: 429,
  unavailable: 503,
  storage_error: 503,
} as const;

// ------------------------------------------------------------- validation

const isRecord = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === "object" && !Array.isArray(value);

/** Text without control characters (newlines and tabs allowed when `multiline`). */
function cleanText(raw: unknown, field: string, max: number, multiline: boolean): string {
  if (typeof raw !== "string") throw new InputError(`${field}: нужна строка`);
  const text = [...raw.replace(/\r\n?/g, "\n")]
    .filter((ch) => {
      const code = ch.charCodeAt(0);
      if (multiline && (ch === "\n" || ch === "\t")) return true;
      return code >= 0x20 && code !== 0x7f;
    })
    .join("")
    .trim();
  if ([...text].length > max) throw new InputError(`${field}: не длиннее ${max} символов`);
  return text;
}

function validDate(value: string): boolean {
  if (!DATE_RE.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

const FORMAT: Record<"date" | "time" | "id", (value: string) => boolean> = { date: validDate, time: (v) => TIME_RE.test(v), id: (v) => ID_RE.test(v) };

function checkField(spec: FieldSpec, name: string, value: unknown): unknown {
  if (spec.type === "text") {
    const text = cleanText(value, name, spec.max, spec.multiline);
    if (!text && spec.emptyMessage) throw new InputError(spec.emptyMessage);
    return text;
  }
  if (value === null) return null;
  const ok = typeof value === "string" && (spec.type === "enum" ? spec.values.includes(value) : FORMAT[spec.type](value));
  if (!ok) throw new InputError(spec.message);
  return value;
}

/** Checks a JSON body against a schema; throws InputError with the API's text. */
export function parseBody(schema: BodySchema, raw: unknown, creating = false): Record<string, unknown> {
  if (!isRecord(raw)) throw new InputError("нужен JSON-объект");
  for (const key of Object.keys(raw)) if (!Object.hasOwn(schema.fields, key)) throw new InputError(schema.unknownMessage(key));
  const out: Record<string, unknown> = {};
  for (const [name, spec] of Object.entries(schema.fields)) {
    let value = raw[name];
    // Since 1.25 a null title / name / text was read as "" (`raw.x ?? ""`).
    if (value === null && spec.type === "text" && spec.missing !== "skip") value = "";
    if (value === undefined) {
      const asEmpty = spec.type === "text" && (spec.missing === "empty" || (spec.missing === "emptyOnCreate" && creating));
      if (!asEmpty) continue;
      value = "";
    }
    out[name] = checkField(spec, name, value);
  }
  if (schema.emptyMessage && !Object.keys(out).length) throw new InputError(schema.emptyMessage);
  return out;
}

/** Body of create / update task → checked fields. Unknown fields are refused. */
export function parseFields(raw: unknown, creating: boolean): TaskFields {
  return parseBody(TASK_BODY, raw, creating) as TaskFields;
}

/** Body of create / rename list → its name. */
export function parseListName(raw: unknown): string {
  return parseBody(LIST_BODY, raw).name as string;
}

/** Body of a task report → text and optional result (null result = none). */
export function parseComment(raw: unknown): CommentInput {
  const out = parseBody(COMMENT_BODY, raw) as { text: string; result?: "ok" | "fail" | null };
  if (!out.text && !out.result) throw new InputError("text: пустой комментарий");
  return { text: out.text, ...(out.result ? { result: out.result } : {}) };
}
