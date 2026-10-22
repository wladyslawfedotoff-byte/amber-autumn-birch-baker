import type { Asset, Task } from "../planner-types.ts";

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** The card an auto task («Обслуживание») belongs to. */
export function maintAsset(task: Pick<Task, "maint">, assets: readonly Asset[]): Asset | undefined {
  if (!task.maint) return undefined;
  const id = task.maint.split("/")[0];
  return assets.find((a) => a.id === id);
}

/**
 * Display title of an auto task: the card name moves to the subline
 * («🔧 Котёл») or the group header, long fixed prefixes get shorter.
 * The stored title is unchanged (search still finds the full one).
 */
export function shortMaintTitle(task: Pick<Task, "title" | "maint">, assets: readonly Asset[]): string {
  if (!task.maint) return task.title;
  let t = task.title
    .replace(/^Гарантия заканчивается:\s*/, "Гарантия: ")
    .replace(/^Обновите пробег/, "Пробег")
    .replace(/^Сервисное обслуживание/, "Сервис");
  const asset = maintAsset(task, assets);
  if (asset) t = t.replace(new RegExp(`\\s+—\\s+${escape(asset.name)}$`), "");
  return t.trim() || task.title;
}
