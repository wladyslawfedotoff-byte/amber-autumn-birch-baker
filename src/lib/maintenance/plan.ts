/**
 * «Обслуживание» → ordinary tasks. A rule that is (or will be) «скоро» gets a
 * regular task, so it shows in «Сегодня», reminds like any task and — through
 * the server's scheduler — arrives as a push, with no extra push code.
 *
 * Deterministic ids make two devices create the very same task (the sync
 * merges them into one). A task a user deleted is not made again: the rule
 * remembers the cycle it already made one for (`notified`).
 *
 * Pure: returns what to change, the store applies it.
 */
import type { Asset, Task } from "../planner-types.ts";
import { DEFAULT_SOON_DAYS, DEFAULT_SOON_KM, addDays, ruleLine, ruleState, type MaintRule } from "./rules.ts";

export const TASK_TIME = "09:00";
export const KM_TASK_TIME = "10:00";
/** A reminder is made at most this far ahead. */
const HORIZON_DAYS = 45;

export function hash(text: string): string {
  let h = 5381;
  for (let i = 0; i < text.length; i++) h = ((h * 33) ^ text.charCodeAt(i)) >>> 0;
  return h.toString(36);
}

/** One «round» of a rule: changes when it is done again, so the next round gets its own task. */
export function cycleKey(rule: MaintRule): string {
  return hash(`${rule.lastDoneAt ?? rule.since}|${rule.lastDoneKm ?? ""}`);
}

export const ruleTaskId = (rule: MaintRule) => `maint-${rule.id}-${cycleKey(rule)}`;
export const kmTaskId = (assetId: string, month: string) => `maintkm-${assetId}-${month}`;

export type Plan = {
  create: Task[];
  patch: { id: string; patch: Partial<Task> }[];
  ruleNotified: { assetId: string; ruleId: string; notified: string }[];
  kmNotified: { assetId: string; month: string }[];
};

export const emptyPlan = (): Plan => ({ create: [], patch: [], ruleNotified: [], kmNotified: [] });
export const planIsEmpty = (p: Plan) => !p.create.length && !p.patch.length && !p.ruleNotified.length && !p.kmNotified.length;

function maintTask(id: string, title: string, notes: string, due: string, time: string, ref: string, now: number): Task {
  return { id, title, notes, listId: null, done: false, priority: 0, due, tags: [], subtasks: [], createdAt: now, completedAt: null, remindAt: time, maint: ref };
}

export function limitsOf(asset: Pick<Asset, "soonDays" | "soonKm">) {
  return { soonDays: asset.soonDays ?? DEFAULT_SOON_DAYS, soonKm: asset.soonKm ?? DEFAULT_SOON_KM };
}

/**
 * When a reminder for this rule should sit: `target` is where its task belongs
 * (the date-based «скоро» day, or today when the mileage is the trigger),
 * `create` is the day for a brand-new task (never in the past).
 * null = nothing to remind about yet.
 */
export function reminderDay(rule: MaintRule, asset: Asset, today: string): { target: string; create: string; byKm: boolean } | null {
  const limits = limitsOf(asset);
  const state = ruleState(rule, { today, km: asset.km ?? null }, limits);
  if (state.finished) return null;
  const dateDay = state.soonFrom;
  const kmSoon = state.kmLeft !== null && state.kmLeft <= limits.soonKm;
  if (!dateDay && !kmSoon) return null;
  const byKm = kmSoon && !(dateDay && dateDay < today);
  const target = byKm ? today : (dateDay as string);
  if (target > addDays(today, HORIZON_DAYS)) return null;
  return { target, create: target < today ? today : target, byKm };
}

export function planMaintenance(assets: Asset[], tasks: Task[], today: string, now: number): Plan {
  const plan = emptyPlan();
  const byId = new Map(tasks.map((t) => [t.id, t]));
  const month = today.slice(0, 7);
  const nextMonth = addDays(`${month}-28`, 5).slice(0, 7);
  for (const asset of assets) {
    for (const rule of asset.rules ?? []) {
      const when = reminderDay(rule, asset, today);
      if (!when) continue;
      const id = ruleTaskId(rule);
      const existing = byId.get(id);
      if (existing) {
        // A mileage-driven reminder keeps its day (it must not roll forward every morning).
        const move = when.byKm ? !!existing.due && existing.due > today : existing.due !== when.target;
        if (!existing.done && move) plan.patch.push({ id, patch: { due: when.target } });
        continue;
      }
      if (rule.notified === cycleKey(rule)) continue; // made before, then deleted by the user
      const task = maintTask(id, `${rule.title} — ${asset.name}`, ruleLine(rule), when.create, TASK_TIME, `${asset.id}/${rule.id}`, now);
      plan.create.push(task);
      plan.ruleNotified.push({ assetId: asset.id, ruleId: rule.id, notified: cycleKey(rule) });
    }
    if (asset.kind === "car" && asset.kmRemind) {
      let last = asset.kmNotified ?? "";
      for (const key of [month, nextMonth]) {
        if (key <= last) continue;
        last = key;
        if (key === month && asset.kmAt && asset.kmAt.slice(0, 7) === month) continue; // already updated this month
        const id = kmTaskId(asset.id, key);
        if (byId.has(id)) continue;
        const first = `${key}-01`;
        const day = key === month && first < today ? today : first;
        plan.create.push(maintTask(id, `Обновите пробег — ${asset.name}`, "Пробег: введите показание одометра.", day, KM_TASK_TIME, `${asset.id}/km`, now));
      }
      if (last !== (asset.kmNotified ?? "")) plan.kmNotified.push({ assetId: asset.id, month: last });
    }
  }
  return plan;
}

/** Ids of the not-done tasks made by `ref` («assetId/ruleId», «assetId/km», or all of an asset with «assetId/»). */
export function openTasksFor(tasks: Task[], ref: string): string[] {
  return tasks.filter((t) => !t.done && typeof t.maint === "string" && (ref.endsWith("/") ? t.maint.startsWith(ref) : t.maint === ref)).map((t) => t.id);
}
