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
 * re-read and retry. Nothing here deletes anything. Bodies are checked by
 * the API contract (contract.ts, 1.27); its parsers are re-exported here.
 */
import { randomUUID } from "node:crypto";
import { editEntity, type SyncData, type SyncEntity } from "../../../src/lib/sync/merge.ts";
import { toggleTaskDone, undoRepeatTick } from "../../../src/lib/task-done.ts";
import type { Task } from "../../../src/lib/planner-types.ts";
import type { Principal } from "../principal.ts";
import { aclFor } from "../sync-access.ts";
import { getStore } from "../sync-store.ts";
import { InputError, type CommentInput, type HelperComment, type HelperListView, type HelperTaskView, type TaskFields } from "./contract.ts";

export { COMMENT_MAX, InputError, LIST_NAME_MAX, NOTES_MAX, TITLE_MAX, parseComment, parseFields, parseListName } from "./contract.ts";
export type { CommentInput, HelperComment, HelperListView, HelperTaskView, TaskFields } from "./contract.ts";

const RETRIES = 4;
export const COMMENTS_KEPT = 20;
/** Own tasks a key may have at once (deleted ones do not count). */
export const MAX_OWN_TASKS = 500;
/** Own lists a key may have at once. */
export const MAX_OWN_LISTS = 30;

export type HelperAuthor = { keyId: string; name: string };

/** A list id that is not one of the key's lists: answered like an unknown task (404). */
export class ForeignRef extends Error {}

const isRecord = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === "object" && !Array.isArray(value);

const sameName = (a: unknown, b: string) => typeof a === "string" && a.trim().toLocaleLowerCase("ru") === b.trim().toLocaleLowerCase("ru");

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
