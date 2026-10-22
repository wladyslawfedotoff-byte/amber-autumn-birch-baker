/** Sync stamps for local edits (see src/lib/sync/merge.ts). */
import { type StateCreator } from "zustand";
import { syncNow } from "@/lib/sync/clock";
import { COLLECTIONS, emptyTombstones, stampCollection, type Tombstones } from "@/lib/sync/merge";
import type { PlannerState } from "@/lib/planner/state";

type Synced = (typeof COLLECTIONS)[number];
type PersistedCreator = StateCreator<PlannerState, [["zustand/persist", unknown]], []>;

/**
 * Stamp local edits for sync: every action goes through this `set`, so changed
 * or new entities get `updatedAt` and removed ones become tombstones without
 * touching each action. Remote merges use `usePlanner.setState` directly and
 * are never re-stamped; persist's rehydrate bypasses it too.
 */
export function stampPatch(prev: PlannerState, patch: Partial<PlannerState>, now = syncNow()): Partial<PlannerState> {
  let out: Partial<PlannerState> = patch;
  let tombstones: Tombstones | null = null;
  for (const key of COLLECTIONS as readonly Synced[]) {
    const next = patch[key] as { id: string; updatedAt?: number }[] | undefined;
    const before = (prev[key] ?? []) as { id: string; updatedAt?: number }[];
    if (next === undefined || next === before) continue;
    const base: Tombstones = tombstones ?? prev.tombstones ?? emptyTombstones();
    const prevTombs: Record<string, number> = base[key] ?? {};
    const result = stampCollection(before, next, prevTombs, now, key);
    if (out === patch) out = { ...patch };
    (out as Record<string, unknown>)[key] = result.items;
    if (result.tombs !== prevTombs) {
      tombstones = { ...base, [key]: result.tombs };
    }
  }
  if (tombstones) {
    if (out === patch) out = { ...patch };
    out.tombstones = tombstones;
  }
  const hoursChanged =
    (patch.workStart !== undefined && patch.workStart !== prev.workStart) ||
    (patch.workEnd !== undefined && patch.workEnd !== prev.workEnd) ||
    (patch.archiveDays !== undefined && patch.archiveDays !== prev.archiveDays);
  if (hoursChanged) {
    if (out === patch) out = { ...patch };
    out.settingsUpdatedAt = Math.max(now, (prev.settingsUpdatedAt ?? 0) + 1);
  }
  return out;
}

export function stamped(config: PersistedCreator): PersistedCreator {
  return (set, get, api) => {
    const stampedSet = ((partial: unknown, replace?: boolean) => {
      const prev = get();
      const patch = (typeof partial === "function" ? (partial as (s: PlannerState) => Partial<PlannerState>)(prev) : partial) as Partial<PlannerState>;
      (set as (p: Partial<PlannerState>, r?: boolean) => void)(stampPatch(prev, patch ?? {}), replace);
    }) as typeof set;
    return config(stampedSet, get, api);
  };
}
