/**
 * Tools the model may call. Reads run here, on the signed-in user's own view
 * of the data (the same ACL-filtered document /api/sync serves), so the model
 * never sees anyone else's private items. Writes are NOT applied: they become
 * proposals the user confirms in the app («Применить»).
 */
import type { SyncData, SyncEntity } from "../../../src/lib/sync/merge.ts";
import type { Proposal, ProposalItem } from "../../../src/lib/assistant/types.ts";
import type { HabitFreq, HabitSection, Priority } from "../../../src/lib/planner-types.ts";
import type { ToolSpec } from "./provider.ts";

export type ToolContext = {
  data: SyncData;
  today: string;
  /** HH:mm on the user's device. */
  now: string;
  newId: () => string;
  /** Short task ids for the model (t1, t2…) ↔ real ids; built on first use, stable for one answer. */
  aliases?: { short: Map<string, string>; real: Map<string, string> };
};

function aliases(ctx: ToolContext) {
  if (!ctx.aliases) {
    const short = new Map<string, string>();
    const real = new Map<string, string>();
    tasksOf(ctx.data).forEach((t, i) => {
      short.set(t.id, `t${i + 1}`);
      real.set(`t${i + 1}`, t.id);
    });
    ctx.aliases = { short, real };
  }
  return ctx.aliases;
}

/** A real task id as the model sees it (saves ~20 tokens per task). */
export function shortId(ctx: ToolContext, id: string): string {
  return aliases(ctx).short.get(id) ?? id;
}

/** The model's id back to the real one (a real id is accepted too). */
export function realId(ctx: ToolContext, id: string): string {
  return aliases(ctx).real.get(id.replace(/^\[|\]$/g, "")) ?? id;
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
const MAX_LIST = 40;

export type TaskLike = { id: string; title: string; done: boolean; due: string | null; startAt: string | null; endAt: string | null; listId: string | null; priority: number; notes: string; subtasks: { title: string; done: boolean }[] };

function asTask(entity: SyncEntity): TaskLike | null {
  if (typeof entity.title !== "string" || entity.deleted) return null;
  return {
    id: entity.id,
    title: entity.title,
    done: entity.done === true,
    due: typeof entity.due === "string" ? entity.due : null,
    startAt: typeof entity.startAt === "string" ? entity.startAt : null,
    endAt: typeof entity.endAt === "string" ? entity.endAt : null,
    listId: typeof entity.listId === "string" ? entity.listId : null,
    priority: typeof entity.priority === "number" ? entity.priority : 0,
    notes: typeof entity.notes === "string" ? entity.notes : "",
    subtasks: Array.isArray(entity.subtasks) ? (entity.subtasks as { title?: unknown; done?: unknown }[]).map((s) => ({ title: String(s?.title ?? ""), done: s?.done === true })) : [],
  };
}

export function tasksOf(data: SyncData): TaskLike[] {
  return data.tasks.flatMap((entity) => {
    const task = asTask(entity);
    return task ? [task] : [];
  });
}

export function listName(data: SyncData, id: string | null): string | null {
  if (!id) return null;
  const list = data.lists.find((l) => l.id === id);
  return typeof list?.name === "string" ? list.name : null;
}

/** Compact view of a task for the model (no owners, members, stamps). */
/** brief() without empty and default fields: what tool results send to the model. */
function compact(ctx: ToolContext, task: TaskLike) {
  const b = brief(ctx, task);
  return { id: b.id, title: b.title, ...(b.due ? { due: b.due } : {}), ...(b.time ? { time: b.time } : {}), ...(b.list !== "Входящие" ? { list: b.list } : {}), ...(b.priority ? { priority: b.priority } : {}), ...(b.steps ? { steps: b.steps } : {}) };
}

export function brief(ctx: ToolContext, task: TaskLike) {
  const { data } = ctx;
  return {
    id: shortId(ctx, task.id),
    title: task.title,
    due: task.due,
    time: task.startAt ? `${task.startAt}${task.endAt ? `–${task.endAt}` : ""}` : null,
    list: listName(data, task.listId) ?? "Входящие",
    priority: task.priority,
    ...(task.subtasks.length ? { steps: `${task.subtasks.filter((s) => s.done).length}/${task.subtasks.length}` } : {}),
  };
}

function toMin(time: string): number {
  const [h, m] = time.split(":").map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
}

function toTime(min: number): string {
  return `${String(Math.floor(min / 60)).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`;
}

/** Free intervals of a day inside the working hours, minus timed tasks (and the past, for today). */
export function freeSlots(data: SyncData, date: string, today: string, now: string): { start: string; end: string; minutes: number }[] {
  const startDay = toMin(TIME.test(data.settings?.workStart ?? "") ? data.settings.workStart : "09:00");
  const endDay = toMin(TIME.test(data.settings?.workEnd ?? "") ? data.settings.workEnd : "18:00");
  let from = startDay;
  if (date === today && TIME.test(now)) from = Math.max(from, Math.ceil(toMin(now) / 15) * 15);
  const busy = tasksOf(data)
    .filter((t) => !t.done && t.due === date && t.startAt && TIME.test(t.startAt))
    .map((t) => {
      const s = toMin(t.startAt!);
      const e = t.endAt && TIME.test(t.endAt) && toMin(t.endAt) > s ? toMin(t.endAt) : s + 60;
      return [s, e] as const;
    })
    .sort((a, b) => a[0] - b[0]);
  const slots: { start: string; end: string; minutes: number }[] = [];
  let cursor = from;
  for (const [s, e] of busy) {
    if (s > cursor && s <= endDay) slots.push({ start: toTime(cursor), end: toTime(Math.min(s, endDay)), minutes: Math.min(s, endDay) - cursor });
    cursor = Math.max(cursor, e);
  }
  if (cursor < endDay) slots.push({ start: toTime(cursor), end: toTime(endDay), minutes: endDay - cursor });
  return slots.filter((slot) => slot.minutes >= 15);
}

/* ---- specs ------------------------------------------------------------- */

// Kept terse: every byte here is sent with each request. Formats (YYYY-MM-DD, HH:mm) are in the system prompt.
const str = { type: "string" };
const strs = { type: "array", items: str };
const taskFields = { title: str, due: str, time: str, end: str, list: str, priority: { type: "integer", description: "0-3" } };

function spec(name: string, description: string, properties: Record<string, unknown>, required: string[] = []): ToolSpec {
  return { type: "function", function: { name, description, parameters: { type: "object", properties, required } } };
}

const objects = (properties: Record<string, unknown>, required: string[]) => ({ type: "array", items: { type: "object", properties, required } });

export const TOOL_SPECS: ToolSpec[] = [
  spec("list_tasks", "Открытые задачи.", { scope: { type: "string", enum: ["today", "overdue", "upcoming", "no_date", "all"] }, list: str }),
  spec("search_tasks", "Поиск задач по словам.", { query: str }, ["query"]),
  spec("free_slots", "Свободное время дня.", { date: str }),
  spec("create_tasks", "Новые задачи → карточка.", { tasks: objects({ ...taskFields, subtasks: strs, notes: str }, ["title"]) }, ["tasks"]),
  spec("update_tasks", "Изменить задачи (перенос, время, список…) → карточка.", { changes: objects({ id: str, ...taskFields }, ["id"]) }, ["changes"]),
  spec("complete_tasks", "Отметить выполненными → карточка.", { ids: strs }, ["ids"]),
  spec("break_down_task", "Шаги к задаче → карточка.", { id: str, steps: strs }, ["id", "steps"]),
  spec("plan_day", "Расставить задачи дня по времени → карточка.", { date: str, items: objects({ id: str, time: str, end: str }, ["id", "time"]) }, ["items"]),
  spec(
    "create_habits",
    "Новые привычки → карточка.",
    { habits: objects({ name: str, goal: { type: "integer" }, unit: str, section: { type: "string", enum: ["morning", "afternoon", "evening", "other"] }, days: { type: "array", items: { type: "integer" }, description: "1=пн…7=вс" }, times_per_week: { type: "integer" } }, ["name"]) },
    ["habits"],
  ),
];

export const WRITE_TOOLS = new Set(["create_tasks", "update_tasks", "complete_tasks", "break_down_task", "plan_day", "create_habits"]);

/* ---- helpers for arguments --------------------------------------------- */

type Args = Record<string, unknown>;

function text(value: unknown, max = 200): string {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function date(value: unknown): string | null {
  const s = text(value, 10);
  return DATE.test(s) ? s : null;
}

function time(value: unknown): string | null {
  const s = text(value, 5);
  if (TIME.test(s)) return s;
  const short = /^(\d):([0-5]\d)$/.exec(s);
  return short ? `0${short[1]}:${short[2]}` : null;
}

function priority(value: unknown): Priority {
  const n = Number(value);
  return n === 1 || n === 2 || n === 3 ? n : 0;
}

function array(value: unknown, max: number): unknown[] {
  return Array.isArray(value) ? value.slice(0, max) : [];
}

function steps(value: unknown): string[] {
  return array(value, 15)
    .map((s) => text(s, 140))
    .filter(Boolean);
}

export function plural(n: number, forms: [string, string, string]): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  const form = mod10 === 1 && mod100 !== 11 ? forms[0] : mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14) ? forms[1] : forms[2];
  return `${n} ${form}`;
}

export const TASKS: [string, string, string] = ["задачу", "задачи", "задач"];
const HABITS: [string, string, string] = ["привычку", "привычки", "привычек"];
const STEPS: [string, string, string] = ["шаг", "шага", "шагов"];

/* ---- run --------------------------------------------------------------- */

export type ToolResult = { content: string; proposal: Proposal | null };

/** Runs one tool call. Reads answer with data; writes answer with a proposal. */
export function runTool(name: string, rawArgs: string | Args, ctx: ToolContext): ToolResult {
  let args: Args;
  try {
    args = typeof rawArgs === "string" ? ((rawArgs.trim() ? JSON.parse(rawArgs) : {}) as Args) : rawArgs;
    if (!args || typeof args !== "object") args = {};
  } catch {
    return { content: JSON.stringify({ error: "Аргументы не разобраны: нужен JSON." }), proposal: null };
  }
  const { data, today } = ctx;
  const open = tasksOf(data).filter((t) => !t.done);
  const byId = new Map(open.map((t) => [t.id, t]));
  const reply = (body: unknown): ToolResult => ({ content: JSON.stringify(body), proposal: null });
  const propose = (title: string, items: ProposalItem[], note: string): ToolResult => {
    if (!items.length) return reply({ error: "Нечего предложить: проверьте id задач и поля." });
    const proposal: Proposal = { id: ctx.newId(), title, items, status: "pending" };
    return { content: JSON.stringify({ ok: true, proposal: proposal.id, note: `${note} Показано пользователю, применится после «Применить».` }), proposal };
  };

  switch (name) {
    case "list_tasks": {
      const scope = text(args.scope) || "today";
      const list = text(args.list).toLowerCase();
      let rows = open;
      if (list) rows = rows.filter((t) => (listName(data, t.listId) ?? "Входящие").toLowerCase().includes(list));
      if (scope === "today") rows = rows.filter((t) => t.due === today);
      else if (scope === "overdue") rows = rows.filter((t) => t.due !== null && t.due < today);
      else if (scope === "upcoming") rows = rows.filter((t) => t.due !== null && t.due > today).sort((a, b) => (a.due! < b.due! ? -1 : 1));
      else if (scope === "no_date") rows = rows.filter((t) => !t.due);
      return reply({ scope, count: rows.length, tasks: rows.slice(0, MAX_LIST).map((t) => compact(ctx, t)) });
    }
    case "search_tasks": {
      const words = text(args.query).toLowerCase().split(/\s+/).filter(Boolean);
      const rows = words.length ? open.filter((t) => words.every((w) => `${t.title} ${t.notes}`.toLowerCase().includes(w))) : [];
      return reply({ count: rows.length, tasks: rows.slice(0, MAX_LIST).map((t) => compact(ctx, t)) });
    }
    case "free_slots": {
      const day = date(args.date) ?? today;
      return reply({ date: day, workHours: `${data.settings?.workStart ?? "09:00"}–${data.settings?.workEnd ?? "18:00"}`, free: freeSlots(data, day, today, ctx.now).map((f) => `${f.start}-${f.end}`) });
    }
    case "create_tasks": {
      const items: ProposalItem[] = array(args.tasks, 20).flatMap((raw) => {
        const row = (raw ?? {}) as Args;
        const title = text(row.title, 200);
        if (!title) return [];
        return [
          {
            op: "create" as const,
            key: ctx.newId(),
            title,
            due: date(row.due),
            start: time(row.time),
            end: time(row.end),
            list: text(row.list, 60) || null,
            priority: priority(row.priority),
            subtasks: steps(row.subtasks),
            notes: text(row.notes, 1000),
          },
        ];
      });
      return propose(`Создать ${plural(items.length, TASKS)}?`, items, `Предложено создать ${plural(items.length, TASKS)}.`);
    }
    case "update_tasks": {
      const items: ProposalItem[] = array(args.changes, 30).flatMap((raw) => {
        const row = (raw ?? {}) as Args;
        const task = byId.get(realId(ctx, text(row.id, 200)));
        if (!task) return [];
        const item: ProposalItem = { op: "update", key: ctx.newId(), taskId: task.id, taskTitle: task.title };
        if (text(row.title)) item.title = text(row.title);
        if ("due" in row) item.due = date(row.due);
        if ("time" in row) item.start = time(row.time);
        if ("end" in row) item.end = time(row.end);
        if (text(row.list, 60)) item.list = text(row.list, 60);
        if ("priority" in row) item.priority = priority(row.priority);
        return Object.keys(item).length > 4 ? [item] : [];
      });
      return propose(`Изменить ${plural(items.length, TASKS)}?`, items, "Предложены изменения.");
    }
    case "complete_tasks": {
      const items: ProposalItem[] = array(args.ids, 30).flatMap((id) => {
        const task = byId.get(realId(ctx, text(id, 200)));
        return task ? [{ op: "complete" as const, key: ctx.newId(), taskId: task.id, taskTitle: task.title }] : [];
      });
      return propose(`Отметить выполненными ${plural(items.length, TASKS)}?`, items, "Предложено отметить выполненными.");
    }
    case "break_down_task": {
      const task = byId.get(realId(ctx, text(args.id, 200)));
      const list = steps(args.steps);
      if (!task || !list.length) return reply({ error: "Задача не найдена или нет шагов." });
      return propose(`Добавить ${plural(list.length, STEPS)} к «${task.title}»?`, [{ op: "subtasks", key: ctx.newId(), taskId: task.id, taskTitle: task.title, steps: list }], "Предложены шаги.");
    }
    case "plan_day": {
      const day = date(args.date) ?? today;
      const items: ProposalItem[] = array(args.items, 30).flatMap((raw) => {
        const row = (raw ?? {}) as Args;
        const task = byId.get(realId(ctx, text(row.id, 200)));
        const start = time(row.time);
        if (!task || !start) return [];
        return [{ op: "update" as const, key: ctx.newId(), taskId: task.id, taskTitle: task.title, due: day, start, end: time(row.end) }];
      });
      return propose(`Расставить ${plural(items.length, TASKS)} по времени?`, items, "Предложено расписание.");
    }
    case "create_habits": {
      const items: ProposalItem[] = array(args.habits, 10).flatMap((raw) => {
        const row = (raw ?? {}) as Args;
        const name = text(row.name, 200);
        if (!name) return [];
        const goal = Number(row.goal);
        const days = array(row.days, 7)
          .map(Number)
          .filter((d) => Number.isInteger(d) && d >= 1 && d <= 7);
        const weekly = Number(row.times_per_week);
        const freq: HabitFreq =
          Number.isInteger(weekly) && weekly >= 1 && weekly <= 6
            ? { kind: "weekly", times: weekly }
            : days.length && days.length < 7
              ? { kind: "weekdays", days: [...new Set(days)].sort() }
              : { kind: "daily" };
        const section = (["morning", "afternoon", "evening", "other"] as const).includes(row.section as HabitSection) ? (row.section as HabitSection) : "other";
        return [{ op: "habit" as const, key: ctx.newId(), name, goal: Number.isInteger(goal) && goal > 1 ? Math.min(goal, 10000) : null, unit: text(row.unit, 20) || null, section, freq }];
      });
      return propose(`Создать ${plural(items.length, HABITS)}?`, items, "Предложены привычки.");
    }
    default:
      return reply({ error: `Нет такого инструмента: ${name.slice(0, 40)}` });
  }
}
