/**
 * Who may read or write an attachment: the signed-in user must see the
 * parent task or project (same ACL as /api/sync).
 */
import type { SyncData, SyncEntity } from "../../../src/lib/sync/merge.ts";
import { canSee, type AclConfig } from "../../../src/lib/sync/world.ts";
import { aclFor } from "../sync-access.ts";
import { getStore } from "../sync-store.ts";
import type { Principal } from "../principal.ts";
import type { AttachMeta, AttachParent } from "./store.ts";

export type AccessResult =
  | { ok: true; data: SyncData; acl: AclConfig | null }
  | { ok: false; reason: "not_found" | "forbidden" };

async function loadView(user: Principal): Promise<{ data: SyncData; acl: AclConfig | null }> {
  const acl = aclFor(user);
  if (acl) {
    const view = await getStore().getFor(user.login, acl);
    return { data: view.data, acl };
  }
  const doc = await getStore().get();
  return { data: doc.data, acl: null };
}

function findParent(data: SyncData, parent: AttachParent): SyncEntity | null {
  const list = parent.kind === "task" ? data.tasks : data.projects;
  return (list.find((item) => item.id === parent.id) as SyncEntity | undefined) ?? null;
}

function allowed(user: Principal, data: SyncData, acl: AclConfig | null, parent: AttachParent, entity: SyncEntity): boolean {
  if (!acl) return true;
  const collection = parent.kind === "task" ? "tasks" : "projects";
  return canSee(collection, entity, user.login, acl, new Map(data.lists.map((list) => [list.id, list])));
}

/** May `user` touch files of this parent (upload / list)? */
export async function canAccessParent(user: Principal, parent: AttachParent): Promise<AccessResult> {
  const { data, acl } = await loadView(user);
  const entity = findParent(data, parent);
  if (!entity) return { ok: false, reason: "not_found" };
  if (!allowed(user, data, acl, parent, entity)) return { ok: false, reason: "forbidden" };
  return { ok: true, data, acl };
}

/** May `user` read/delete this stored attachment? */
export async function canAccessMeta(user: Principal, meta: AttachMeta): Promise<AccessResult> {
  return canAccessParent(user, meta.parent);
}
