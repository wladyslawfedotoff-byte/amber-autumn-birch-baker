import type { Asset, Task } from "../planner-types.ts";

export type NearestGroup = { asset: Asset; tasks: Task[] };

/**
 * «Ближайшее» in «Обслуживание»: open auto tasks grouped by card, each group
 * by date, groups by their nearest date (undated last).
 */
export function nearestByCard(tasks: readonly Task[], assets: readonly Asset[]): NearestGroup[] {
  const key = (t: Task) => t.due ?? "9999-99-99";
  const byId = new Map(assets.map((a) => [a.id, a]));
  const groups = new Map<string, NearestGroup>();
  for (const task of tasks) {
    if (task.done || !task.maint) continue;
    const asset = byId.get(task.maint.split("/")[0]!);
    if (!asset) continue;
    const group = groups.get(asset.id) ?? { asset, tasks: [] };
    group.tasks.push(task);
    groups.set(asset.id, group);
  }
  const list = [...groups.values()];
  for (const g of list) g.tasks.sort((a, b) => key(a).localeCompare(key(b)) || a.title.localeCompare(b.title, "ru"));
  return list.sort((a, b) => key(a.tasks[0]!).localeCompare(key(b.tasks[0]!)) || a.asset.name.localeCompare(b.asset.name, "ru"));
}
