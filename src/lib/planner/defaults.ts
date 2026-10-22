/** Initial values of a fresh planner (empty: no sample data since 1.15) and fillers for older saved copies. */
import { emptyTombstones } from "@/lib/sync/merge";
import { todayIso } from "@/lib/dates";
import { DEFAULT_TABS } from "@/lib/ui-prefs";
import type { Task } from "@/lib/planner-types";
import { freshFocus, type PlannerState } from "@/lib/planner/state";

export function uid(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `id-${Date.now().toString(36)}-${Math.random().toString(16).slice(2)}`;
}

export function seed(): Pick<
  PlannerState,
  | "lists"
  | "tasks"
  | "habits"
  | "milestones"
  | "projects"
  | "assets"
  | "workStart"
  | "workEnd"
  | "focus"
  | "theme"
  | "accent"
  | "pomoDate"
  | "pomoCount"
  | "remindAck"
  | "tombstones"
  | "settingsUpdatedAt"
  | "archiveDays"
  | "scheduleDays"
  | "doneFolded"
  | "tabBar"
  | "drawerHidden"
  | "drawerTab"
  | "pins"
  | "calendarMode"
  | "weekNumbers"
  | "remindLeadDefault"
> {
  const today = todayIso();
  return {
    theme: "light",
    accent: "ink",
    pomoDate: today,
    pomoCount: 1,
    remindAck: {},
    tombstones: emptyTombstones(),
    settingsUpdatedAt: 0,
    archiveDays: 7,
    scheduleDays: 1,
    doneFolded: false,
    tabBar: [...DEFAULT_TABS],
    drawerHidden: [],
    drawerTab: "lists",
    pins: [],
    calendarMode: "month",
    weekNumbers: false,
    remindLeadDefault: 0,
    // No sample data: a signed-in user only ever sees their own planner (1.15).
    lists: [],
    habits: [],
    milestones: [],
    projects: [],
    assets: [],
    tasks: [],
    focus: freshFocus(),
    workStart: "09:00",
    workEnd: "18:00",
  };
}

export const memoryStorage = {
  getItem: () => null,
  setItem: () => undefined,
  removeItem: () => undefined,
};

export function fillRemindAt<T extends { id: string; remindAt?: string | null }>(
  saved: T[] | undefined,
  seedRows: T[],
): T[] {
  if (!saved) return seedRows;
  const fromSeed = new Map(seedRows.map((row) => [row.id, row.remindAt]));
  return saved.map((row) => {
    if (row.remindAt !== undefined) return row;
    const fallback = fromSeed.get(row.id);
    return fallback === undefined ? { ...row, remindAt: null } : { ...row, remindAt: fallback };
  });
}

export function fillTasks(saved: Task[] | undefined, seedRows: Task[]): Task[] {
  const filled = fillRemindAt(saved, seedRows);
  return filled.map((row) => ({
    ...row,
    startAt: row.startAt ?? null,
    endAt: row.endAt ?? null,
    tags: row.tags ?? [],
    subtasks: row.subtasks ?? [],
  }));
}
