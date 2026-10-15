import type { Task } from "@/lib/planner-types";

/** Any file, link or contact on the task (a linked project contact counts too): the paperclip in lists. */
export function objectCount(task: Pick<Task, "attachments" | "links" | "contacts" | "contactId">): number {
  return (task.attachments?.length ?? 0) + (task.links?.length ?? 0) + (task.contacts?.length ?? 0) + (task.contactId ? 1 : 0);
}
