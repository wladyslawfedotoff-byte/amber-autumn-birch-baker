/**
 * «Применить»: turns the confirmed items of a proposal into ordinary store
 * actions, so the changes sync like anything typed by hand.
 */
import type { Asset, Habit, Priority, Task } from "../planner-types.ts";
import type { AssetInput, FuelInput, PainPlanInput, PartInput, RuleInput, ServiceInput } from "../maintenance/ops.ts";
import type { ProposalItem } from "./types.ts";

export type ApplyApi = {
  lists: { id: string; name: string }[];
  tasks: { id: string; done: boolean }[];
  addList: (name: string) => string;
  addTask: (input: { title: string; listId: string | null; due: string | null; priority?: Priority; notes?: string; startAt?: string | null; endAt?: string | null; noTime?: boolean }) => string;
  updateTask: (id: string, patch: Partial<Omit<Task, "id">>) => void;
  toggleTask: (id: string) => void;
  addSubtask: (taskId: string, title: string) => void;
  addHabit: (name: string, extra?: Partial<Habit>) => string | null;
  /** «Обслуживание»; without it those items are skipped. */
  maint?: {
    assets: (Pick<Asset, "id" | "rules"> & { pains?: Asset["pains"] })[];
    addAsset: (input: AssetInput) => string | null;
    addRule: (assetId: string, input: RuleInput) => string | null;
    addService: (assetId: string, input: ServiceInput) => string | null;
    setKm: (assetId: string, km: number) => boolean;
    addFuel?: (assetId: string, input: FuelInput) => string | null;
    addPart?: (assetId: string, input: PartInput) => string | null;
    addPain?: (assetId: string, text: string, todo?: string) => string | null;
    planPain?: (assetId: string, painId: string, input: PainPlanInput) => boolean;
  };
};

const INBOX = /^(входящие|inbox)$/i;

/** Finds a list by name (case-insensitive) or creates it; «Входящие» = no list. */
function listIdFor(api: ApplyApi, name: string | null | undefined, created: Map<string, string>): string | null {
  const clean = (name ?? "").trim();
  if (!clean || INBOX.test(clean)) return null;
  const key = clean.toLowerCase();
  const found = api.lists.find((l) => l.name.trim().toLowerCase() === key);
  if (found) return found.id;
  const cached = created.get(key);
  if (cached) return cached;
  const id = api.addList(clean);
  created.set(key, id);
  return id;
}

export function applyItems(items: ProposalItem[], api: ApplyApi): { applied: number; skipped: number } {
  const created = new Map<string, string>();
  const open = new Map(api.tasks.map((t) => [t.id, t]));
  let applied = 0;
  let skipped = 0;
  for (const item of items) {
    switch (item.op) {
      case "create": {
        if (!item.title.trim()) {
          skipped++;
          break;
        }
        const id = api.addTask({
          title: item.title.trim(),
          listId: listIdFor(api, item.list, created),
          due: item.due,
          priority: item.priority,
          notes: item.notes || undefined,
          startAt: item.due ? item.start : null,
          endAt: item.due && item.start ? item.end : null,
          noTime: !item.start,
        });
        for (const step of item.subtasks) if (step.trim()) api.addSubtask(id, step.trim());
        applied++;
        break;
      }
      case "update": {
        if (!open.has(item.taskId)) {
          skipped++;
          break;
        }
        const patch: Partial<Omit<Task, "id">> = {};
        if (item.title?.trim()) patch.title = item.title.trim();
        if (item.due !== undefined) patch.due = item.due;
        if (item.start !== undefined) patch.startAt = item.start;
        if (item.end !== undefined) patch.endAt = item.end;
        if (item.list !== undefined) patch.listId = listIdFor(api, item.list, created);
        if (item.priority !== undefined) patch.priority = item.priority;
        api.updateTask(item.taskId, patch);
        applied++;
        break;
      }
      case "complete": {
        const task = open.get(item.taskId);
        if (!task || task.done) {
          skipped++;
          break;
        }
        api.toggleTask(item.taskId);
        applied++;
        break;
      }
      case "subtasks": {
        if (!open.has(item.taskId)) {
          skipped++;
          break;
        }
        for (const step of item.steps) if (step.trim()) api.addSubtask(item.taskId, step.trim());
        applied++;
        break;
      }
      case "asset": {
        const id = api.maint?.addAsset({ name: item.name, kind: item.kind, plate: item.plate ?? undefined, model: item.model ?? undefined, km: item.km ?? null, boughtAt: item.boughtAt ?? null, price: item.price ?? null, warrantyMonths: item.warrantyMonths ?? null, warrantyUntil: item.warrantyUntil ?? null });
        if (!id) {
          skipped++;
          break;
        }
        for (const rule of item.rules) api.maint?.addRule(id, rule);
        applied++;
        break;
      }
      case "service": {
        const asset = api.maint?.assets.find((a) => a.id === item.assetId);
        // Only rules that still exist: a rule deleted meanwhile is simply not reset.
        const ruleIds = item.ruleIds.filter((id) => asset?.rules.some((r) => r.id === id));
        const id = asset ? api.maint?.addService(item.assetId, { title: item.title, date: item.date, km: item.km, cost: item.cost, place: item.place, note: item.note, ruleIds }) : null;
        if (id) applied++;
        else skipped++;
        break;
      }
      case "rule": {
        const id = api.maint?.assets.some((a) => a.id === item.assetId) ? api.maint.addRule(item.assetId, item.rule) : null;
        if (id) applied++;
        else skipped++;
        break;
      }
      case "fuel": {
        const id = api.maint?.assets.some((a) => a.id === item.assetId) ? api.maint.addFuel?.(item.assetId, { date: item.date, liters: item.liters, sum: item.sum ?? null, km: item.km ?? null, full: item.full !== false }) : null;
        if (id) applied++;
        else skipped++;
        break;
      }
      case "part": {
        const id = api.maint?.assets.some((a) => a.id === item.assetId) ? api.maint.addPart?.(item.assetId, { name: item.name, boughtAt: item.boughtAt ?? null, price: item.price ?? null, warrantyMonths: item.warrantyMonths ?? null, warrantyUntil: item.warrantyUntil ?? null }) : null;
        if (id) applied++;
        else skipped++;
        break;
      }
      case "pain": {
        const asset = api.maint?.assets.find((a) => a.id === item.assetId);
        // An existing note is only reused while it still exists; otherwise a new one is made.
        const known = item.painId && asset?.pains?.some((p) => p.id === item.painId) ? item.painId : null;
        const id = asset ? (known ?? api.maint?.addPain?.(item.assetId, item.text, item.todo)) : null;
        if (!id) {
          skipped++;
          break;
        }
        const planned = item.date || item.days || item.km ? api.maint?.planPain?.(item.assetId, id, { date: item.date ?? null, days: item.days ?? null, km: item.km ?? null }) : true;
        if (planned) applied++;
        else skipped++;
        break;
      }
      case "mileage": {
        if (api.maint?.assets.some((a) => a.id === item.assetId) && api.maint.setKm(item.assetId, item.km)) applied++;
        else skipped++;
        break;
      }
      case "habit": {
        const id = api.addHabit(item.name, {
          goal: item.goal,
          unit: item.goal ? item.unit : null,
          section: item.section,
          freq: item.freq,
        });
        if (id) applied++;
        else skipped++;
        break;
      }
    }
  }
  return { applied, skipped };
}

/** One line for the card («Завтра 09:30 · Работа»). */
export function itemTitle(item: ProposalItem): string {
  switch (item.op) {
    case "create":
      return item.title;
    case "update":
      return item.title && item.title !== item.taskTitle ? `${item.taskTitle} → ${item.title}` : item.taskTitle;
    case "complete":
    case "subtasks":
      return item.taskTitle;
    case "habit":
    case "asset":
      return item.name;
    case "service":
      return `${item.assetName}: ${item.title}`;
    case "rule":
      return `${item.assetName}: ${item.rule.title}`;
    case "mileage":
      return `${item.assetName}: ${item.km} км`;
    case "fuel":
      return `${item.assetName}: заправка ${item.liters} л`;
    case "part":
      return `${item.assetName}: ${item.name}`;
    case "pain":
      return `${item.assetName}: ${item.text}`;
  }
}

/** Editable text of an item (title / habit name); null = not editable. */
export function withTitle(item: ProposalItem, title: string): ProposalItem {
  if (item.op === "create") return { ...item, title };
  if (item.op === "habit" || item.op === "asset") return { ...item, name: title };
  if (item.op === "service") return { ...item, title: title.replace(`${item.assetName}: `, "") };
  if (item.op === "part") return { ...item, name: title.replace(`${item.assetName}: `, "") };
  if (item.op === "pain") return { ...item, text: title.replace(`${item.assetName}: `, "") };
  if (item.op === "rule") return { ...item, rule: { ...item.rule, title: title.replace(`${item.assetName}: `, "") } };
  if (item.op === "update") return { ...item, title };
  return item;
}
