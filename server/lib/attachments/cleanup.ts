/**
 * Removes attachment files whose task/project is gone (deleted directly, or
 * removed from «Архив» by the archive rules) after a grace period, so an
 * undo, a slow offline device or a backup restore within that window still
 * finds the files. Never touches a file that any entity still references.
 *
 * Idempotent: the first run that sees an orphan only marks it
 * (`orphanSince`); a later run past the grace period deletes it.
 */
import type { SyncData } from "../../../src/lib/sync/merge.ts";
import type { AttachMeta, AttachStore } from "./store.ts";

export type CleanupResult = { marked: number; removed: number; kept: number; unmarked: number };

/** Every attachment id referenced anywhere, plus every existing parent. */
export function references(data: SyncData): { ids: Set<string>; parents: Set<string> } {
  const ids = new Set<string>();
  const parents = new Set<string>();
  const collect = (entity: Record<string, unknown>) => {
    for (const item of Array.isArray(entity.attachments) ? entity.attachments : []) {
      const id = (item as { id?: unknown })?.id;
      if (typeof id === "string") ids.add(id);
    }
    for (const key of ["beforeId", "afterId"]) if (typeof entity[key] === "string") ids.add(entity[key] as string);
    for (const sub of Array.isArray(entity.subtasks) ? entity.subtasks : []) {
      const s = sub as Record<string, unknown>;
      for (const key of ["beforeId", "afterId"]) if (typeof s?.[key] === "string") ids.add(s[key] as string);
    }
  };
  for (const task of data.tasks) {
    parents.add(`task:${task.id}`);
    collect(task);
  }
  for (const project of data.projects) {
    parents.add(`project:${project.id}`);
    collect(project);
  }
  for (const asset of data.assets ?? []) {
    parents.add(`asset:${asset.id}`);
    collect(asset);
  }
  return { ids, parents };
}

/** Not referenced by any task or project (a deleted parent references nothing). */
export function isOrphan(meta: AttachMeta, refs: { ids: Set<string> }): boolean {
  return !refs.ids.has(meta.id);
}

export async function runCleanup(options: {
  store: AttachStore;
  data: SyncData;
  now: number;
  graceMs: number;
  /** A just-uploaded file is not in the synced entity yet: leave young files alone. */
  minAgeMs?: number;
  onLog?: (event: string, fields: Record<string, unknown>) => void;
}): Promise<CleanupResult> {
  const { store, data, now, graceMs } = options;
  const minAge = options.minAgeMs ?? 24 * 60 * 60 * 1000;
  const refs = references(data);
  const result: CleanupResult = { marked: 0, removed: 0, kept: 0, unmarked: 0 };
  const all = await store.all();
  // An empty document next to stored files means a broken or fresh data file, not deletions.
  if (all.length && refs.parents.size === 0) {
    options.onLog?.("attach.cleanup_skipped", { reason: "no tasks or projects in the data file", files: all.length });
    result.kept = all.length;
    return result;
  }
  for (const meta of all) {
    if (!isOrphan(meta, refs)) {
      if (meta.orphanSince) {
        await store.setOrphanSince(meta.id, null);
        result.unmarked++;
      }
      result.kept++;
      continue;
    }
    if (now - meta.createdAt < minAge) {
      result.kept++;
      continue;
    }
    if (!meta.orphanSince) {
      await store.setOrphanSince(meta.id, now);
      result.marked++;
      continue;
    }
    if (now - meta.orphanSince >= graceMs) {
      // Re-check right before deleting: the data may have changed meanwhile.
      const removed = await store.remove(meta.id);
      if (removed) {
        result.removed++;
        options.onLog?.("attach.cleaned", { id: meta.id, parent: `${meta.parent.kind}:${meta.parent.id}`, size: meta.size });
      }
    } else {
      result.kept++;
    }
  }
  return result;
}
