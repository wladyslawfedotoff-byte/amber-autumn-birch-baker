/**
 * Tasks and lists of a helper key (1.25, lists 1.26). Every task and list a
 * key creates carries the author stamp `helper: { keyId, name }`; the key
 * reads and changes only entities with its own keyId. Anything else — other
 * tasks, lists, projects, tags, contacts, settings — never leaves this module:
 * callers get a short view of own items. A task's `listId` is shown only when
 * it is one of the key's own lists (the user's list or project → null).
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
export const LIST_NAME_MAX = 60;
/** Own lists a key may have at once. */
export const MAX_OWN_LISTS = 30;

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

export class InputError extends Error {}
/** A list id that is not one of the key's lists: answered like an unknown task (404). */
export class ForeignRef extends Error {}

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
  const allowed = new Set(["title", "notes", "due", "startAt", "endAt", "listId"]);
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
  if (raw.listId !== undefined) {
    if (raw.listId !== null && (typeof raw.listId !== "string" || !ID_RE.test(raw.listId))) throw new InputError("listId: id своего списка или null");
    out.listId = raw.listId;
  }
  if (!Object.keys(out).length) throw new InputError("нечего менять");
  return out;
}

const ID_RE = /^[A-Za-z0-9_-]{1,200}$/;

/** Body of create / rename list → its name. */
export function parseListName(raw: unknown): string {
  if (!isRecord(raw)) throw new InputError("нужен JSON-объект");
  for (const key of Object.keys(raw)) if (key !== "name") throw new InputError(`поле «${key}» не поддерживается`);
  const name = cleanText(raw.name ?? "", "name", LIST_NAME_MAX, false);
  if (!name) throw new InputError("name: нужно название списка");
  return name;
}

const sameName = (a: unknown, b: string) => typeof a === "string" && a.trim().toLocaleLowerCase("ru") === b.trim().toLocaleLowerCase("ru");

export function parseComment(raw: unknown): CommentInput {
  if (!isRecord(raw)) throw new InputError("нужен JSON-объект");
  for (const key of Object.keys(raw)) if (key !== "text" && key !== "result") throw new InputError(`поле «${key}» не поддерживается`);
  const text = cleanText(raw.text ?? "", "text", COMMENT_MAX, true);
  if (raw.result !== undefined && raw.result !== null && raw.result !== "ok" && raw.result !== "fail") throw new InputError("result: ok, fail или нет");
  if (!text && !raw.result) throw new InputError("text: пустой комментарий");
  return { text, ...(raw.result === "ok" || raw.result === "fail" ? { result: raw.result } : {}) };
}

/** Created by this key (task or list). */
export function isOwn(entity: SyncEntity, keyId: string): boolean {
  return isRecord(entity.helper) && entity.helper.keyId === keyId;
}

/** Ids of the key's own lists that still exist. */
function ownListIds(data: SyncData, keyId: string): Set<string> {
  return new Set(data.lists.filter((l) => isOwn(l, keyId)).map((l) => l.id));
}

export function listViewOf(list: SyncEntity): HelperListView {
  return { id: list.id, name: typeof list.name === "string" ? list.name : "", updatedAt: typeof list.updatedAt === "number" ? list.updatedAt : 0 };
}

function comments(task: SyncEntity): HelperComment[] {
  if (!Array.isArray(task.helperNotes)) return [];
  return task.helperNotes.filter((c): c is HelperComment => isRecord(c) && typeof c.id === "string" && typeof c.text === "string" && typeof c.at === "number");
}

export function viewOf(task: SyncEntity, ownLists: ReadonlySet<string> = new Set()): HelperTaskView {
  const str = (v: unknown) => (typeof v === "string" ? v : null);
  const num = (v: unknown) => (typeof v === "number" ? v : null);
  return {
    id: task.id,
    title: str(task.title) ?? "",
    notes: str(task.notes) ?? "",
    due: str(task.due),
    startAt: str(task.startAt),
    endAt: str(task.endAt),
    listId: typeof task.listId === "string" && ownLists.has(task.listId) ? task.listId : null,
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
  const lists = ownListIds(data, keyId);
  return data.tasks
    .filter((t) => isOwn(t, keyId))
    .map((t) => viewOf(t, lists))
    .sort((a, b) => b.createdAt - a.createdAt);
}

export async function getOwn(user: Principal, keyId: string, id: string): Promise<HelperTaskView | null> {
  const { data } = await read(user);
  const task = data.tasks.find((t) => t.id === id);
  return task && isOwn(task, keyId) ? viewOf(task, ownListIds(data, keyId)) : null;
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
  const make = (): SyncEntity => ({
    id: "",
    title: fields.title ?? "",
    notes: fields.notes ?? "",
    listId: fields.listId ?? null,
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
    ...(user.multiUser ? { owner: user.login } : {}),
    updatedAt: now,
  });
  const id = randomUUID();
  return write<CreateResult>(user, (data) => {
    const lists = ownListIds(data, author.keyId);
    if (fields.listId && !lists.has(fields.listId)) throw new ForeignRef("list");
    if (data.tasks.filter((t) => isOwn(t, author.keyId)).length >= MAX_OWN_TASKS) return { result: { error: "too_many_tasks" } };
    const task = { ...make(), id };
    return { data: { ...data, tasks: [task, ...data.tasks] }, result: { item: viewOf(task, lists) } };
  });
}

type Edit = (task: SyncEntity, now: number, lists: ReadonlySet<string>) => Record<string, unknown>;

/** Changes one own task; null when the id is not this key's task (or is gone). */
async function editOwn(user: Principal, keyId: string, id: string, edit: Edit, now: number): Promise<HelperTaskView | null> {
  return write<HelperTaskView | null>(user, (data) => {
    const index = data.tasks.findIndex((t) => t.id === id);
    const task = index >= 0 ? data.tasks[index]! : null;
    if (!task || !isOwn(task, keyId)) return { result: null };
    const lists = ownListIds(data, keyId);
    const next = editEntity(task, edit(task, now, lists), now, "tasks");
    if (next === task) return { result: viewOf(task, lists) };
    const tasks = [...data.tasks];
    tasks[index] = next;
    return { data: { ...data, tasks }, result: viewOf(next, lists) };
  });
}

export function updateOwn(user: Principal, keyId: string, id: string, fields: TaskFields, now = Date.now()): Promise<HelperTaskView | null> {
  return editOwn(
    user,
    keyId,
    id,
    (task, _now, lists) => {
      checkTimes(fields, task);
      if (fields.listId && !lists.has(fields.listId)) throw new ForeignRef("list");
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

export async function listOwnLists(user: Principal, keyId: string): Promise<HelperListView[]> {
  const { data } = await read(user);
  return data.lists.filter((l) => isOwn(l, keyId)).map(listViewOf);
}

/** Name of an own list (for the action log); null when it is not the key's. */
export async function ownListName(user: Principal, keyId: string, id: string | null): Promise<string | null> {
  if (!id) return null;
  const { data } = await read(user);
  const list = data.lists.find((l) => l.id === id && isOwn(l, keyId));
  return list ? listViewOf(list).name : null;
}

export type CreateListResult = { item: HelperListView; existed: boolean } | { error: "too_many_lists" };

/**
 * A regular list (side menu «Мои списки») with the author stamp. The same
 * name (trimmed, any case) as one of the key's lists → that list, no copy.
 */
export async function createOwnList(user: Principal, author: HelperAuthor, name: string, now = Date.now()): Promise<CreateListResult> {
  const id = randomUUID();
  return write<CreateListResult>(user, (data) => {
    const own = data.lists.filter((l) => isOwn(l, author.keyId));
    const same = own.find((l) => sameName(l.name, name));
    if (same) return { result: { item: listViewOf(same), existed: true } };
    if (own.length >= MAX_OWN_LISTS) return { result: { error: "too_many_lists" } };
    const list: SyncEntity = { id, name, helper: { keyId: author.keyId, name: author.name }, ...(user.multiUser ? { owner: user.login } : {}), updatedAt: now };
    return { data: { ...data, lists: [...data.lists, list] }, result: { item: listViewOf(list), existed: false } };
  });
}

export type RenameListResult = { item: HelperListView; before: string } | { error: "name_taken" } | null;

/** Renames an own list; null when the id is not the key's list (or is gone). */
export async function renameOwnList(user: Principal, keyId: string, id: string, name: string, now = Date.now()): Promise<RenameListResult> {
  return write<RenameListResult>(user, (data) => {
    const index = data.lists.findIndex((l) => l.id === id);
    const list = index >= 0 ? data.lists[index]! : null;
    if (!list || !isOwn(list, keyId)) return { result: null };
    if (data.lists.some((l) => l.id !== id && isOwn(l, keyId) && sameName(l.name, name))) return { result: { error: "name_taken" } };
    const before = listViewOf(list).name;
    const next = editEntity(list, { name }, now, "lists");
    if (next === list) return { result: { item: listViewOf(list), before } };
    const lists = [...data.lists];
    lists[index] = next;
    return { data: { ...data, lists }, result: { item: listViewOf(next), before } };
  });
}
