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
};

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
const MAX_LIST = 40;

type TaskLike = { id: string; title: string; done: boolean; due: string | null; startAt: string | null; endAt: string | null; listId: string | null; priority: number; notes: string; subtasks: { title: string; done: boolean }[] };

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

function listName(data: SyncData, id: string | null): string | null {
  if (!id) return null;
  const list = data.lists.find((l) => l.id === id);
  return typeof list?.name === "string" ? list.name : null;
}

/** Compact view of a task for the model (no owners, members, stamps). */
function brief(data: SyncData, task: TaskLike) {
  return {
    id: task.id,
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

const WEEKDAY_SHORT = ["вс", "пн", "вт", "ср", "чт", "пт", "сб"];

function addDays(date: string, days: number): string {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function weekdayOf(date: string): string {
  return WEEKDAY_SHORT[new Date(`${date}T12:00:00Z`).getUTCDay()] ?? "";
}

/**
 * Compact picture of the user's week for the system prompt, so a model
 * answers «what's today», «free windows tomorrow» even without tools:
 * overdue, today, the next 7 days, the count without a date, and free time
 * per day. Only the signed-in user's own view (ctx.data) is used.
 */
export function snapshot(ctx: ToolContext): string {
  const { data, today, now } = ctx;
  const open = tasksOf(data).filter((t) => !t.done);
  const weekEnd = addDays(today, 7);
  const line = (t: TaskLike) => {
    const b = brief(data, t);
    return `- [${b.id}] ${b.title}${b.due && b.due !== today ? ` · ${b.due} (${weekdayOf(b.due)})` : ""}${b.time ? ` · ${b.time}` : ""} · ${b.list}${b.priority ? ` · приоритет ${b.priority}` : ""}${b.steps ? ` · шаги ${b.steps}` : ""}`;
  };
  const byDue = (a: TaskLike, b: TaskLike) => `${a.due}${a.startAt ?? "99"}`.localeCompare(`${b.due}${b.startAt ?? "99"}`);
  const section = (title: string, rows: TaskLike[], max: number) => {
    if (!rows.length) return [`${title}: нет`];
    const more = rows.length > max ? [`  …и ещё ${rows.length - max} (list_tasks)`] : [];
    return [`${title}:`, ...rows.slice(0, max).map(line), ...more];
  };
  const overdue = open.filter((t) => t.due !== null && t.due < today).sort(byDue);
  const todays = open.filter((t) => t.due === today).sort(byDue);
  const week = open.filter((t) => t.due !== null && t.due > today && t.due <= weekEnd).sort(byDue);
  const noDate = open.filter((t) => !t.due).length;
  const hours = `${data.settings?.workStart ?? "09:00"}–${data.settings?.workEnd ?? "18:00"}`;
  const free = Array.from({ length: 8 }, (_, i) => addDays(today, i)).map((day) => {
    const slots = freeSlots(data, day, today, now);
    return `- ${day} (${weekdayOf(day)}): ${slots.length ? slots.map((s) => `${s.start}–${s.end}`).join(", ") : "свободного времени нет"}`;
  });
  return [
    "Данные пользователя на сейчас (открытые задачи, в квадратных скобках id для изменений):",
    ...section("Просрочено", overdue, 15),
    ...section("Сегодня", todays, 25),
    ...section(`Ближайшие 7 дней (до ${weekEnd})`, week, 30),
    `Без даты: ${noDate}${noDate ? " (list_tasks со scope no_date)" : ""}`,
    `Свободное время в рабочие часы ${hours} (с учётом задач со временем):`,
    ...free,
  ].join("\n");
}

/* ---- specs ------------------------------------------------------------- */

const taskFields = {
  title: { type: "string" },
  due: { type: "string", description: "YYYY-MM-DD или пусто" },
  time: { type: "string", description: "HH:mm начала или пусто" },
  end: { type: "string", description: "HH:mm окончания или пусто" },
  list: { type: "string", description: "название списка или пусто (Входящие)" },
  priority: { type: "integer", description: "0 нет, 1 низкий, 2 средний, 3 высокий" },
};

function spec(name: string, description: string, properties: Record<string, unknown>, required: string[] = []): ToolSpec {
  return { type: "function", function: { name, description, parameters: { type: "object", properties, required } } };
}

export const TOOL_SPECS: ToolSpec[] = [
  spec("list_tasks", "Открытые задачи пользователя: на сегодня, просроченные, на ближайшие дни, без даты или все; можно по списку.", {
    scope: { type: "string", enum: ["today", "overdue", "upcoming", "no_date", "all"] },
    list: { type: "string" },
  }),
  spec("search_tasks", "Найти открытые задачи по словам в названии или заметке.", { query: { type: "string" } }, ["query"]),
  spec("free_slots", "Свободное время дня в рабочих часах с учётом задач со временем.", { date: { type: "string", description: "YYYY-MM-DD" } }),
  spec(
    "create_tasks",
    "Предложить новые задачи (пользователь подтвердит).",
    { tasks: { type: "array", items: { type: "object", properties: { ...taskFields, subtasks: { type: "array", items: { type: "string" } }, notes: { type: "string" } }, required: ["title"] } } },
    ["tasks"],
  ),
  spec(
    "update_tasks",
    "Предложить изменения существующих задач: название, дата, время, список (перенос), приоритет.",
    { changes: { type: "array", items: { type: "object", properties: { id: { type: "string" }, ...taskFields }, required: ["id"] } } },
    ["changes"],
  ),
  spec("complete_tasks", "Предложить отметить задачи выполненными.", { ids: { type: "array", items: { type: "string" } } }, ["ids"]),
  spec("break_down_task", "Предложить разбить задачу на шаги (подзадачи).", { id: { type: "string" }, steps: { type: "array", items: { type: "string" } } }, ["id", "steps"]),
  spec(
    "plan_day",
    "Предложить расписание дня: поставить задачам время в свободные окна.",
    { date: { type: "string" }, items: { type: "array", items: { type: "object", properties: { id: { type: "string" }, time: { type: "string" }, end: { type: "string" } }, required: ["id", "time"] } } },
    ["items"],
  ),
  spec(
    "create_habits",
    "Предложить новые привычки.",
    {
      habits: {
        type: "array",
        items: {
          type: "object",
          properties: {
            name: { type: "string" },
            goal: { type: "integer", description: "сколько в день, если это количество" },
            unit: { type: "string" },
            section: { type: "string", enum: ["morning", "afternoon", "evening", "other"] },
            days: { type: "array", items: { type: "integer" }, description: "дни недели 1=пн … 7=вс; пусто = каждый день" },
            times_per_week: { type: "integer" },
          },
          required: ["name"],
        },
      },
    },
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

function plural(n: number, forms: [string, string, string]): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  const form = mod10 === 1 && mod100 !== 11 ? forms[0] : mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14) ? forms[1] : forms[2];
  return `${n} ${form}`;
}

const TASKS: [string, string, string] = ["задачу", "задачи", "задач"];
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
      return reply({ scope, count: rows.length, tasks: rows.slice(0, MAX_LIST).map((t) => brief(data, t)) });
    }
    case "search_tasks": {
      const words = text(args.query).toLowerCase().split(/\s+/).filter(Boolean);
      const rows = words.length ? open.filter((t) => words.every((w) => `${t.title} ${t.notes}`.toLowerCase().includes(w))) : [];
      return reply({ count: rows.length, tasks: rows.slice(0, MAX_LIST).map((t) => brief(data, t)) });
    }
    case "free_slots": {
      const day = date(args.date) ?? today;
      return reply({ date: day, workHours: `${data.settings?.workStart ?? "09:00"}–${data.settings?.workEnd ?? "18:00"}`, free: freeSlots(data, day, today, ctx.now) });
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
        const task = byId.get(text(row.id, 200));
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
        const task = byId.get(text(id, 200));
        return task ? [{ op: "complete" as const, key: ctx.newId(), taskId: task.id, taskTitle: task.title }] : [];
      });
      return propose(`Отметить выполненными ${plural(items.length, TASKS)}?`, items, "Предложено отметить выполненными.");
    }
    case "break_down_task": {
      const task = byId.get(text(args.id, 200));
      const list = steps(args.steps);
      if (!task || !list.length) return reply({ error: "Задача не найдена или нет шагов." });
      return propose(`Добавить ${plural(list.length, STEPS)} к «${task.title}»?`, [{ op: "subtasks", key: ctx.newId(), taskId: task.id, taskTitle: task.title, steps: list }], "Предложены шаги.");
    }
    case "plan_day": {
      const day = date(args.date) ?? today;
      const items: ProposalItem[] = array(args.items, 30).flatMap((raw) => {
        const row = (raw ?? {}) as Args;
        const task = byId.get(text(row.id, 200));
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
