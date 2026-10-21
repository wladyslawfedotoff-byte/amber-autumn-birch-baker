/**
 * Writes one «Входящие» task for «Быстрое добавление» through the same store
 * the devices sync with (getFor/putFor under the profile's ACL, or the whole
 * document with one profile). A concurrent device write → re-read and retry.
 */
import { randomUUID } from "node:crypto";
import type { SyncEntity } from "../../../src/lib/sync/merge.ts";
import type { Principal } from "../principal.ts";
import { aclFor } from "../sync-access.ts";
import { getStore } from "../sync-store.ts";

const RETRIES = 4;

export type InboxInput = {
  id?: string;
  title: string;
  notes?: string;
  link?: { url: string; title?: string } | null;
  attachment?: { id: string; name: string; mime: string; size: number; createdAt: number; takenAt?: number } | null;
};

export function inboxTask(user: Principal, input: InboxInput, now: number): SyncEntity {
  const task: SyncEntity = {
    id: input.id ?? randomUUID(),
    title: input.title,
    notes: input.notes ?? "",
    listId: null,
    done: false,
    priority: 0,
    due: null,
    tags: [],
    subtasks: [],
    createdAt: now,
    completedAt: null,
    important: false,
    urgent: false,
    remindAt: null,
    startAt: null,
    endAt: null,
    via: "phone",
    updatedAt: now,
  };
  if (user.multiUser) task.owner = user.login;
  if (input.link) task.links = [{ id: randomUUID(), url: input.link.url, ...(input.link.title ? { title: input.link.title } : {}), updatedAt: now }];
  if (input.attachment) task.attachments = [{ ...input.attachment, updatedAt: now }];
  return task;
}

/** Adds the task; returns its id. Throws when the store keeps conflicting or fails. */
export async function addToInbox(user: Principal, input: InboxInput, now = Date.now()): Promise<string> {
  const store = getStore();
  const acl = aclFor(user);
  const task = inboxTask(user, input, now);
  for (let attempt = 0; attempt < RETRIES; attempt++) {
    if (acl) {
      const view = await store.getFor(user.login, acl);
      const result = await store.putFor(user.login, acl, view.revision, { ...view.data, tasks: [task, ...view.data.tasks] });
      if (result.status === "ok") {
        if (result.denied > 0) throw new Error("quick add denied by ACL");
        return task.id;
      }
    } else {
      const doc = await store.get();
      const result = await store.put(doc.revision, { ...doc.data, tasks: [task, ...doc.data.tasks] });
      if (result.status === "ok") return task.id;
    }
  }
  throw new Error("quick add: too many conflicts");
}
