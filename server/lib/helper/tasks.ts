/**
 * Tasks of a helper key (1.25). Every task a key creates carries the author
 * stamp `helper: { keyId, name }`; the key reads and changes only tasks with
 * its own keyId. Anything else — other tasks, lists, projects, contacts,
 * settings — never leaves this module: callers get a short view of own tasks.
 *
 * Writes go through the same store the devices sync with (getFor/putFor under
 * the profile's ACL, or the whole document with one profile); changed fields
 * are stamped with editEntity, so a device editing the same task at the same
 * time merges per field exactly like a sync PATCH. A concurrent write →
 * re-read and retry. Nothing here deletes anything.
 */
import { randomUUID } from "node:crypto";
import { editEntity, type SyncData, type SyncEntity } from "../../../src/lib/sync/merge.ts";
import { toggleTaskDone, undoRepeatTick } from "../../../src/lib/task-done.ts";
import type { Task } from "../../../src/lib/planner-types.ts";
import type { Principal } from "../principal.ts";
import { aclFor } from "../sync-access.ts";
import { getStore } from "../sync-store.ts";

const RETRIES = 4;
export const TITLE_MAX = 200;
export const NOTES_MAX = 4000;
export const COMMENT_MAX = 1000;
export const COMMENTS_KEPT = 20;
/** Own tasks a key may have at once (deleted ones do not count). */
export const MAX_OWN_TASKS = 500;

export type HelperAuthor = { keyId: string; name: string };
export type HelperComment = { id: string; at: number; text: string; result?: "ok" | "fail" };

/** What a key sees of its task. No list, project, owner or sharing data. */
export type HelperTaskView = {
  id: string;
  title: string;
  notes: string;
  due: string | null;
  startAt: string | null;
  endAt: string | null;
  done: boolean;
  completedAt: number | null;
  createdAt: number;
  updatedAt: number;
  comments: HelperComment[];
};

export type TaskFields = { title?: string; notes?: string; due?: string | null; startAt?: string | null; endAt?: string | null };
export type CommentInput = { text: string; result?: "ok" | "fail" };

export class InputError extends Error {}

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
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

/** Body of create / update → checked fields. Unknown fields are refused. */
export function parseFields(raw: unknown, creating: boolean): TaskFields {
  if (!isRecord(raw)) throw new InputError("нужен JSON-объект");
  const allowed = new Set(["title", "notes", "due", "startAt", "endAt"]);
  for (const key of Object.keys(raw)) if (!allowed.has(key)) throw new InputError(`поле «${key}» менять нельзя`);
  const out: TaskFields = {};
  if (raw.title !== undefined || creating) {
    const title = cleanText(raw.title ?? "", "title", TITLE_MAX, false);
    if (!title) throw new InputError("title: нужно название");
    out.title = title;
  }
  if (raw.notes !== undefined) out.notes = cleanText(raw.notes, "notes", NOTES_MAX, true);
  if (raw.due !== undefined) {
    if (raw.due !== null && (typeof raw.due !== "string" || !validDate(raw.due))) throw new InputError("due: дата ГГГГ-ММ-ДД или null");
    out.due = raw.due;
  }
  for (const key of ["startAt", "endAt"] as const) {
    const value = raw[key];
    if (value === undefined) continue;
    if (value !== null && (typeof value !== "string" || !TIME_RE.test(value))) throw new InputError(`${key}: время ЧЧ:ММ или null`);
    out[key] = value;
  }
  if (!Object.keys(out).length) throw new InputError("нечего менять");
  return out;
}

export function parseComment(raw: unknown): CommentInput {
  if (!isRecord(raw)) throw new InputError("нужен JSON-объект");
  for (const key of Object.keys(raw)) if (key !== "text" && key !== "result") throw new InputError(`поле «${key}» не поддерживается`);
  const text = cleanText(raw.text ?? "", "text", COMMENT_MAX, true);
  if (raw.result !== undefined && raw.result !== null && raw.result !== "ok" && raw.result !== "fail") throw new InputError("result: ok, fail или нет");
  if (!text && !raw.result) throw new InputError("text: пустой комментарий");
  return { text, ...(raw.result === "ok" || raw.result === "fail" ? { result: raw.result } : {}) };
}

export function isOwn(task: SyncEntity, keyId: string): boolean {
  return isRecord(task.helper) && task.helper.keyId === keyId;
}

function comments(task: SyncEntity): HelperComment[] {
  if (!Array.isArray(task.helperNotes)) return [];
  return task.helperNotes.filter((c): c is HelperComment => isRecord(c) && typeof c.id === "string" && typeof c.text === "string" && typeof c.at === "number");
}

export function viewOf(task: SyncEntity): HelperTaskView {
  const str = (v: unknown) => (typeof v === "string" ? v : null);
  const num = (v: unknown) => (typeof v === "number" ? v : null);
  return {
    id: task.id,
    title: str(task.title) ?? "",
    notes: str(task.notes) ?? "",
    due: str(task.due),
    startAt: str(task.startAt),
    endAt: str(task.endAt),
    done: task.done === true,
    completedAt: num(task.completedAt),
    createdAt: num(task.createdAt) ?? 0,
    updatedAt: num(task.updatedAt) ?? 0,
    comments: comments(task),
  };
}

function today(now: number): string {
  return new Date(now).toLocaleDateString("sv-SE", { timeZone: process.env.TZ || "Europe/Moscow" });
}

async function read(user: Principal): Promise<{ revision: number; data: SyncData }> {
  const acl = aclFor(user);
  return acl ? getStore().getFor(user.login, acl) : getStore().get();
}

/** Re-read → change → write, retried on a concurrent write. `null` from `change` = nothing to write. */
async function write<R>(user: Principal, change: (data: SyncData) => { data: SyncData; result: R } | { result: R }): Promise<R> {
  const store = getStore();
  const acl = aclFor(user);
  for (let attempt = 0; attempt < RETRIES; attempt++) {
    const view = await read(user);
    const out = change(view.data);
    if (!("data" in out)) return out.result;
    if (acl) {
      const result = await store.putFor(user.login, acl, view.revision, out.data);
      if (result.status === "ok") {
        if (result.denied > 0) throw new Error("helper write denied by ACL");
        return out.result;
      }
    } else {
      const result = await store.put(view.revision, out.data);
      if (result.status === "ok") return out.result;
    }
  }
  throw new Error("helper: too many conflicts");
}

export async function listOwn(user: Principal, keyId: string): Promise<HelperTaskView[]> {
  const { data } = await read(user);
  return data.tasks
    .filter((t) => isOwn(t, keyId))
    .map(viewOf)
    .sort((a, b) => b.createdAt - a.createdAt);
}

export async function getOwn(user: Principal, keyId: string, id: string): Promise<HelperTaskView | null> {
  const { data } = await read(user);
  const task = data.tasks.find((t) => t.id === id);
  return task && isOwn(task, keyId) ? viewOf(task) : null;
}

function checkTimes(fields: TaskFields, base: SyncEntity | null): void {
  const due = fields.due !== undefined ? fields.due : base ? (base.due as string | null) : null;
  const startAt = fields.startAt !== undefined ? fields.startAt : base ? (base.startAt as string | null | undefined) : null;
  const endAt = fields.endAt !== undefined ? fields.endAt : base ? (base.endAt as string | null | undefined) : null;
  if ((startAt || endAt) && !due) throw new InputError("время без даты: укажите due");
}

export type CreateResult = { item: HelperTaskView } | { error: "too_many_tasks" };

/** New task in «Входящие» with the author stamp. */
export async function createOwn(user: Principal, author: HelperAuthor, fields: TaskFields, now = Date.now()): Promise<CreateResult> {
  checkTimes(fields, null);
  const task: SyncEntity = {
    id: randomUUID(),
    title: fields.title ?? "",
    notes: fields.notes ?? "",
    listId: null,
    done: false,
    priority: 0,
    due: fields.due ?? null,
    tags: [],
    subtasks: [],
    createdAt: now,
    completedAt: null,
    important: false,
    urgent: false,
    remindAt: null,
    startAt: fields.startAt ?? null,
    endAt: fields.endAt ?? null,
    helper: { keyId: author.keyId, name: author.name },
    updatedAt: now,
  };
  if (user.multiUser) task.owner = user.login;
  return write<CreateResult>(user, (data) => {
    if (data.tasks.filter((t) => isOwn(t, author.keyId)).length >= MAX_OWN_TASKS) return { result: { error: "too_many_tasks" } };
    return { data: { ...data, tasks: [task, ...data.tasks] }, result: { item: viewOf(task) } };
  });
}

type Edit = (task: SyncEntity, now: number) => Record<string, unknown>;

/** Changes one own task; null when the id is not this key's task (or is gone). */
async function editOwn(user: Principal, keyId: string, id: string, edit: Edit, now: number): Promise<HelperTaskView | null> {
  return write<HelperTaskView | null>(user, (data) => {
    const index = data.tasks.findIndex((t) => t.id === id);
    const task = index >= 0 ? data.tasks[index]! : null;
    if (!task || !isOwn(task, keyId)) return { result: null };
    const next = editEntity(task, edit(task, now), now, "tasks");
    if (next === task) return { result: viewOf(task) };
    const tasks = [...data.tasks];
    tasks[index] = next;
    return { data: { ...data, tasks }, result: viewOf(next) };
  });
}

export function updateOwn(user: Principal, keyId: string, id: string, fields: TaskFields, now = Date.now()): Promise<HelperTaskView | null> {
  return editOwn(
    user,
    keyId,
    id,
    (task) => {
      checkTimes(fields, task);
      return { ...fields };
    },
    now,
  );
}

const DONE_FIELDS = ["done", "completedAt", "lastDue", "due", "completedBy"] as const;

function doneDiff(before: Task, after: Task): Record<string, unknown> {
  const patch: Record<string, unknown> = {};
  for (const key of DONE_FIELDS) patch[key] = after[key] ?? null;
  return before === after ? {} : patch;
}

/** «Выполнено» (a repeating task moves to its next date, like the tick in the app) or «вернуть». */
export function setDoneOwn(user: Principal, keyId: string, id: string, done: boolean, now = Date.now()): Promise<HelperTaskView | null> {
  return editOwn(
    user,
    keyId,
    id,
    (raw) => {
      const task = raw as unknown as Task;
      if (done) return task.done ? {} : doneDiff(task, toggleTaskDone(task, { me: null, today: today(now), now }));
      if (task.done) return doneDiff(task, toggleTaskDone(task, { me: null, today: today(now), now }));
      return task.lastDue ? doneDiff(task, undoRepeatTick(task)) : {};
    },
    now,
  );
}

/** «Получилось / не получилось» + text; the newest 20 comments are kept on the task. */
export function commentOwn(user: Principal, keyId: string, id: string, input: CommentInput, now = Date.now()): Promise<HelperTaskView | null> {
  return editOwn(
    user,
    keyId,
    id,
    (task) => {
      const entry: HelperComment = { id: randomUUID(), at: now, text: input.text, ...(input.result ? { result: input.result } : {}) };
      return { helperNotes: [...comments(task), entry].slice(-COMMENTS_KEPT) };
    },
    now,
  );
}
