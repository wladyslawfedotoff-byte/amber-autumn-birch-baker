/**
 * Token economy for «Помощник»:
 *  - the question's intent decides which data goes into the prompt
 *    («просрочено» → only overdue, «спланируй день» → today + free time…);
 *  - only the tools that intent needs are offered;
 *  - simple questions («что просрочено», «что на сегодня», «свободные окна
 *    завтра») are answered here, without a model and without tokens.
 */
import { TOOL_SPECS, TASKS, brief, freeSlots, plural, tasksOf, type TaskLike, type ToolContext } from "./tools.ts";
import type { ToolSpec } from "./provider.ts";
import type { AnswerView, Chip, Proposal, ProposalItem } from "../../../src/lib/assistant/types.ts";

export type IntentKind = "overdue" | "today" | "free" | "plan" | "create" | "update" | "complete" | "breakdown" | "habit" | "general";
export type Intent = { kind: IntentKind; dates: string[]; local: boolean };

const WEEKDAYS_SHORT = ["вс", "пн", "вт", "ср", "чт", "пт", "сб"];
const WEEKDAY_STEMS: [RegExp, number][] = [
  [/понедельн/, 1],
  [/вторник/, 2],
  [/сред[уаы]/, 3],
  [/четверг/, 4],
  [/пятниц/, 5],
  [/суббот/, 6],
  [/воскресень/, 0],
];

export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function weekdayOf(date: string): string {
  return WEEKDAYS_SHORT[new Date(`${date}T12:00:00Z`).getUTCDay()] ?? "";
}

/** Dates named in the question: сегодня, завтра, послезавтра, weekdays, 12.10, 2026-10-12, «на неделю». */
export function datesIn(question: string, today: string): string[] {
  const q = question.toLowerCase();
  const out: string[] = [];
  const push = (d: string) => {
    if (!out.includes(d)) out.push(d);
  };
  if (/сегодня|на день|мой день/.test(q)) push(today);
  if (/послезавтра/.test(q)) push(addDays(today, 2));
  if (/(^|[^а-я])завтра/.test(q)) push(addDays(today, 1));
  const todayDow = new Date(`${today}T12:00:00Z`).getUTCDay();
  for (const [stem, dow] of WEEKDAY_STEMS) if (stem.test(q)) push(addDays(today, ((dow - todayDow + 7) % 7) || 7));
  for (const m of q.matchAll(/\b(20\d\d-\d\d-\d\d)\b/g)) push(m[1]!);
  for (const m of q.matchAll(/\b(\d{1,2})\.(\d{1,2})\b/g)) {
    const year = Number(today.slice(0, 4));
    const candidate = `${year}-${m[2]!.padStart(2, "0")}-${m[1]!.padStart(2, "0")}`;
    if (/^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.test(candidate)) push(candidate < today ? `${year + 1}${candidate.slice(4)}` : candidate);
  }
  if (/недел/.test(q) && !out.length) for (let i = 0; i < 7; i++) push(addDays(today, i));
  return out.sort();
}

/** What the user wants. `local` = this app can answer it alone. */
export function intentOf(question: string, today: string): Intent {
  const q = question.toLowerCase().replace(/ё/g, "е").trim();
  const dates = datesIn(q, today);
  // Just a lookup: one clause, no advice or follow-up asked for.
  const advice = /(почему|как |делать|совет|помоги|предлож|лучше|стоит|\sи\s+(что|как|поч|постав|добав|перенес|сдела|созд|запиш|скажи|предлож)|,\s*(а|и|потом)\s)/.test(q);
  const short = q.length <= 80 && !advice && !/\b(и|а также|потом|затем)\b.*\b(добав|перенес|созд|постав)/.test(q);
  const writes = /(добав|создай|создать|запиши|напомни|перенеси|перенести|сдвинь|поменяй|измени|отметь|выполн|сделал|закрой|разбей|распиши|разложи|спланируй|распланируй|составь|расставь|поставь|привычк)/.test(q);
  if (/привычк/.test(q)) return { kind: "habit", dates, local: false };
  if (/(разбей|разложи|на шаги|подзадач)/.test(q)) return { kind: "breakdown", dates, local: false };
  if (/(спланируй|распланируй|план (на )?дня|план на (сегодня|завтра|день)|расставь|распиши (мой )?день|составь (план|расписание))/.test(q)) return { kind: "plan", dates: dates.length ? dates : [today], local: false };
  if (/(отметь|выполнил|сделал[аи]?\b|закрой задач|готово)/.test(q)) return { kind: "complete", dates, local: false };
  if (/(перенеси|перенести|сдвинь|поменяй|измени|переименуй|поставь .* на|в другой список)/.test(q)) return { kind: "update", dates, local: false };
  if (/(добав|создай|создать|запиши|напомни|новая задача|новую задачу)/.test(q)) return { kind: "create", dates, local: false };
  const simple = short && q.length <= 60 && !writes;
  if (/(свободн|окн[оа]|когда (я )?свобод|есть время|свободное время)/.test(q)) return { kind: "free", dates: dates.length ? dates : [today], local: short && !writes };
  if (/просроч|опаздыва|не успел|хвост/.test(q)) return { kind: "overdue", dates, local: simple };
  // «что на сегодня», «что у меня завтра», «покажи задачи на пятницу»
  const asks = /^(а )?(что|какие|покажи|список|мои)/.test(q) && /(задач|дел|у меня|на |сегодня|завтра)/.test(q);
  if (asks && dates.length <= 1 && (dates.length === 1 || /сегодня/.test(q))) return { kind: "today", dates: dates.length ? dates : [today], local: short && !writes && q.length <= 60 };
  if (/(сегодня|на сегодня)/.test(q) && /(задач|дел)/.test(q)) return { kind: "today", dates: [today], local: false };
  return { kind: "general", dates, local: false };
}

/* ---- data for the prompt --------------------------------------------- */

function line(ctx: ToolContext, t: TaskLike): string {
  const b = brief(ctx, t);
  return `${b.id} ${b.title}${b.due && b.due !== ctx.today ? ` ${b.due.slice(5)}` : ""}${b.time ? ` ${b.time}` : ""}${b.list !== "Входящие" ? ` [${b.list}]` : ""}${b.priority ? ` !${b.priority}` : ""}`;
}

const byDue = (a: TaskLike, b: TaskLike) => `${a.due}${a.startAt ?? "99"}`.localeCompare(`${b.due}${b.startAt ?? "99"}`);

function section(ctx: ToolContext, title: string, rows: TaskLike[], max: number): string[] {
  if (!rows.length) return [`${title}: нет`];
  return [`${title}:`, ...rows.slice(0, max).map((t) => line(ctx, t)), ...(rows.length > max ? [`…ещё ${rows.length - max}`] : [])];
}

function freeLine(ctx: ToolContext, day: string): string {
  const slots = freeSlots(ctx.data, day, ctx.today, ctx.now);
  return `${day.slice(5)} ${weekdayOf(day)}: ${slots.length ? slots.map((s) => `${s.start}-${s.end}`).join(", ") : "нет"}`;
}

/** Words of the question that can find tasks it talks about. */
function mentioned(open: TaskLike[], question: string): TaskLike[] {
  const words = question
    .toLowerCase()
    .split(/[^a-zа-яё0-9]+/)
    .filter((w) => w.length >= 4 && !/^(задач|перенес|сдела|отмет|добав|завтра|сегодня|пятниц|неделе|разбей|шаги|можно|нужно|пожалуйста)/.test(w))
    .map((w) => w.slice(0, Math.max(4, w.length - 2)));
  if (!words.length) return [];
  return open.filter((t) => words.some((w) => t.title.toLowerCase().includes(w)));
}

/**
 * The data this intent needs, as compact lines («t3 Заказать парапет 10-09 !2»).
 * Ids are short (t1…); the model passes them back and they are mapped to real ids.
 */
export function contextFor(intent: Intent, question: string, ctx: ToolContext): string {
  const { today } = ctx;
  const open = tasksOf(ctx.data).filter((t) => !t.done);
  const overdue = open.filter((t) => t.due !== null && t.due < today).sort(byDue);
  const on = (day: string) => open.filter((t) => t.due === day).sort(byDue);
  const out: string[] = [];
  const hours = `${ctx.data.settings?.workStart ?? "09:00"}-${ctx.data.settings?.workEnd ?? "18:00"}`;
  switch (intent.kind) {
    case "overdue":
      out.push(...section(ctx, "Просрочено", overdue, 25));
      break;
    case "today": {
      const day = intent.dates[0] ?? today;
      out.push(...section(ctx, day === today ? "Сегодня" : `Задачи ${day}`, on(day), 25), `Просрочено: ${overdue.length}`);
      break;
    }
    case "free":
      out.push(`Свободно (рабочие часы ${hours}):`, ...intent.dates.slice(0, 7).map((d) => freeLine(ctx, d)));
      for (const d of intent.dates.slice(0, 3)) out.push(...section(ctx, `Задачи ${d.slice(5)}`, on(d), 10));
      break;
    case "plan": {
      const day = intent.dates[0] ?? today;
      out.push(...section(ctx, `Задачи ${day === today ? "сегодня" : day}`, on(day), 20), ...section(ctx, "Просрочено", overdue, 8), `Свободно (${hours}): ${freeLine(ctx, day)}`);
      break;
    }
    case "create":
      if (intent.dates.length) out.push(`Свободно: ${freeLine(ctx, intent.dates[0]!)}`);
      break;
    case "update":
    case "complete":
    case "breakdown": {
      const found = mentioned(open, question);
      const pool = found.length ? found : [...overdue, ...on(today)];
      out.push(...section(ctx, found.length ? "Подходящие задачи" : "Просрочено и сегодня", pool, 12));
      if (intent.kind === "update" && intent.dates[0]) out.push(`Свободно: ${freeLine(ctx, intent.dates[0])}`);
      break;
    }
    case "habit":
      break;
    default: {
      const week = open.filter((t) => t.due !== null && t.due > today && t.due <= addDays(today, 7)).sort(byDue);
      out.push(...section(ctx, "Сегодня", on(today), 12), ...section(ctx, "Просрочено", overdue, 8), ...section(ctx, "7 дней", week, 10), `Без даты: ${open.filter((t) => !t.due).length}`, `Свободно сегодня: ${freeLine(ctx, today).split(": ")[1]}`);
    }
  }
  return out.join("\n");
}

const TOOLS_FOR: Record<IntentKind, string[] | null> = {
  overdue: ["update_tasks", "complete_tasks"],
  today: ["update_tasks", "complete_tasks", "plan_day"],
  free: ["create_tasks", "plan_day"],
  plan: ["plan_day", "update_tasks"],
  create: ["create_tasks"],
  update: ["search_tasks", "update_tasks"],
  complete: ["search_tasks", "complete_tasks"],
  breakdown: ["search_tasks", "break_down_task"],
  habit: ["create_habits"],
  // Habits and step breakdowns have their own keyword intents, so an unclear question skips them.
  general: ["search_tasks", "create_tasks", "update_tasks", "complete_tasks", "plan_day", "free_slots"],
};

/** Only the tools this intent may need. Reads stay available for search. */
export function toolsFor(intent: Intent): ToolSpec[] {
  const names = TOOLS_FOR[intent.kind];
  if (!names) return TOOL_SPECS;
  const wanted = new Set(["list_tasks", ...names]);
  return TOOL_SPECS.filter((t) => wanted.has(t.function.name));
}

/* ---- answers without a model ------------------------------------------ */

/** «- 10.10 — Title» for overdue, «- 10:00–11:00 — Title» or «- Title» for a day. */
function humanLine(ctx: ToolContext, t: TaskLike, withDate: boolean): string {
  const b = brief(ctx, t);
  const lead = withDate && b.due ? `${Number(b.due.slice(8))}.${b.due.slice(5, 7)}` : b.time;
  return `- ${lead ? `**${lead}** — ` : ""}${t.title}`;
}

function dayName(day: string, today: string): string {
  if (day === today) return "Сегодня";
  if (day === addDays(today, 1)) return "Завтра";
  if (day === addDays(today, 2)) return "Послезавтра";
  return `${Number(day.slice(8))}.${day.slice(5, 7)} (${weekdayOf(day)})`;
}

export type LocalAnswer = { text: string; view?: AnswerView; chips?: Chip[] };

const MAX_ROWS = 20;

/** «Перенести всё на завтра»: a ready card, no model. */
function moveChip(ctx: ToolContext, rows: TaskLike[], to: string, label: string): Chip | null {
  const items: ProposalItem[] = rows.slice(0, 30).map((t) => ({ op: "update", key: ctx.newId(), taskId: t.id, taskTitle: t.title, due: to, was: { due: t.due } }));
  if (!items.length) return null;
  return { label, proposal: { id: ctx.newId(), title: `Перенести ${plural(items.length, TASKS)} на завтра?`, items, status: "pending" } };
}

/** «Разбить на шаги» for the first task of the day that has none. */
function stepsChip(rows: TaskLike[]): Chip | null {
  const task = rows.find((t) => !t.subtasks.length);
  return task ? { label: "Разбить на шаги", ask: `Разбей задачу «${task.title}» на шаги` } : null;
}

const ask = (label: string, question: string): Chip => ({ label, ask: question });

/** A ready answer for a simple question, or null when a model is needed. */
export function localAnswer(intent: Intent, ctx: ToolContext): LocalAnswer | null {
  if (!intent.local) return null;
  const { today } = ctx;
  const tomorrow = addDays(today, 1);
  const open = tasksOf(ctx.data).filter((t) => !t.done);
  const overdueRows = open.filter((t) => t.due !== null && t.due < today).sort(byDue);
  const chips = (list: (Chip | null)[]) => list.filter((c): c is Chip => c !== null);
  switch (intent.kind) {
    case "overdue": {
      const rows = overdueRows;
      if (!rows.length) return { text: "Просроченных задач нет.", chips: chips([ask("Что на сегодня?", "Что на сегодня?")]) };
      const one = rows.length % 10 === 1 && rows.length % 100 !== 11;
      const title = `${one ? "Просрочена" : "Просрочено"} ${plural(rows.length, TASKS).replace("задачу", "задача")}:`;
      const more = Math.max(0, rows.length - MAX_ROWS);
      const text = [title, "", ...rows.slice(0, MAX_ROWS).map((t) => humanLine(ctx, t, true)), ...(more ? [`- …и ещё ${more}`] : [])].join("\n");
      return {
        text,
        view: { kind: "tasks", mode: "overdue", date: today, title, ids: rows.slice(0, MAX_ROWS).map((t) => t.id), more },
        chips: chips([moveChip(ctx, rows, tomorrow, rows.length > 1 ? "Перенести всё на завтра" : "Перенести на завтра"), ask("Спланировать день", "Спланируй мой день")]),
      };
    }
    case "today": {
      const day = intent.dates[0] ?? today;
      const rows = open.filter((t) => t.due === day).sort(byDue);
      const overdue = overdueRows.length;
      const note = overdue ? `Ещё просрочено: ${overdue}.` : undefined;
      const name = day === today ? "сегодня" : dayName(day, today).toLowerCase();
      const follow = chips([
        ask("Спланировать день", day === today ? "Спланируй мой день" : `Спланируй ${name}`),
        ask("Свободные окна", `Свободные окна ${day === today ? "сегодня" : name}`),
        rows.length ? stepsChip(rows) : null,
        overdue ? ask("Что просрочено?", "Что просрочено?") : null,
      ]).slice(0, 3);
      if (!rows.length) return { text: [`На ${name} задач нет.`, ...(note ? ["", note] : [])].join("\n"), chips: follow };
      const title = `На ${name} ${plural(rows.length, TASKS).replace("задачу", "задача")}:`;
      const more = Math.max(0, rows.length - MAX_ROWS);
      const text = [title, "", ...rows.slice(0, MAX_ROWS).map((t) => humanLine(ctx, t, false)), ...(more ? [`- …и ещё ${more}`] : []), ...(note ? ["", note] : [])].join("\n");
      return { text, view: { kind: "tasks", mode: "day", date: day, title, ids: rows.slice(0, MAX_ROWS).map((t) => t.id), more, ...(note ? { note } : {}) }, chips: follow };
    }
    case "free": {
      const hours = `${ctx.data.settings?.workStart ?? "09:00"}–${ctx.data.settings?.workEnd ?? "18:00"}`;
      const days = intent.dates.slice(0, 7).map((d) => ({ date: d, label: dayName(d, today), slots: freeSlots(ctx.data, d, today, ctx.now).map((s) => `${s.start}–${s.end}`) }));
      const title = `Свободно (${hours}):`;
      const text = [title, "", ...days.map((d) => `- **${d.label}:** ${d.slots.length ? d.slots.join(", ") : "свободного времени нет"}`)].join("\n");
      const first = days[0]?.date ?? today;
      const name = first === today ? "сегодня" : dayName(first, today).toLowerCase();
      return {
        text,
        view: { kind: "free", title, days },
        chips: [ask(`Что ${first === today ? "на сегодня" : `на ${name}`}?`, `Что у меня ${first === today ? "сегодня" : name}?`), ask("Спланировать день", first === today ? "Спланируй мой день" : `Спланируй ${name}`)],
      };
    }
    default:
      return null;
  }
}

/** Follow-ups under a model's answer, from its question and cards (no model). */
export function chipsAfter(intent: Intent, ctx: ToolContext, proposals: Proposal[]): Chip[] {
  const out: Chip[] = [];
  const open = tasksOf(ctx.data).filter((t) => !t.done);
  const overdue = open.filter((t) => t.due !== null && t.due < ctx.today);
  if (proposals.some((p) => p.kind === "plan")) out.push(ask("Свободные окна", "Свободные окна сегодня"));
  else if (intent.kind === "overdue" && overdue.length && !proposals.length) {
    const chip = moveChip(ctx, overdue.sort(byDue), addDays(ctx.today, 1), overdue.length > 1 ? "Перенести всё на завтра" : "Перенести на завтра");
    if (chip) out.push(chip);
  }
  if (!proposals.length && intent.kind === "today") {
    out.push(ask("Спланировать день", "Спланируй мой день"));
    const chip = stepsChip(open.filter((t) => t.due === ctx.today).sort(byDue));
    if (chip) out.push(chip);
  }
  return out.slice(0, 3);
}
