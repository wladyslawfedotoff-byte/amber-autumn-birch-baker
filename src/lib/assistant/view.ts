/** Helpers for the answers the app draws itself (rows, timeline, «было → стало»). */
import { dueLabel, todayIso } from "../dates.ts";
import { colorHex } from "../task-colors.ts";
import type { Task } from "../planner-types.ts";
import type { ProposalItem } from "./types.ts";

const PRIORITY_DOT = ["", "var(--accent)", "var(--warn)", "var(--danger)"];
const PRIORITY = ["нет", "низкий", "средний", "высокий"];

/** The task's own colour, else its priority, else a quiet grey. */
export function dotColor(task: Pick<Task, "color" | "priority"> | undefined): string {
  return colorHex(task?.color) ?? (task?.priority ? PRIORITY_DOT[task.priority]! : "var(--subtle)");
}

type Update = Extract<ProposalItem, { op: "update" }>;
export type DiffLine = { label: string; was: string; now: string };

/**
 * The changed fields of an update: «Срок: 9 окт → завтра». «Было» comes from
 * the card (stored by the server); without it, from the task as it is now.
 */
export function diffLines(item: Update, current?: Pick<Task, "due" | "startAt" | "endAt" | "priority">, listName?: string | null, today = todayIso()): DiffLine[] {
  const was = item.was ?? {};
  const out: DiffLine[] = [];
  const day = (d: string | null | undefined) => (d ? dueLabel(d, today) : "без даты");
  const clock = (s: string | null | undefined, e?: string | null) => (s ? (e ? `${s}–${e}` : s) : "без времени");
  if (item.title !== undefined && item.title !== (was.title ?? item.taskTitle)) out.push({ label: "Название", was: was.title ?? item.taskTitle, now: item.title });
  if (item.due !== undefined) {
    const before = "due" in was ? was.due : (current?.due ?? null);
    if (before !== item.due) out.push({ label: "Срок", was: day(before), now: day(item.due) });
  }
  if (item.start !== undefined || item.end !== undefined) {
    const s = "start" in was ? was.start : (current?.startAt ?? null);
    const e = "end" in was ? was.end : (current?.endAt ?? null);
    const ns = item.start !== undefined ? item.start : s;
    const ne = item.end !== undefined ? item.end : e;
    if (s !== ns || e !== ne) out.push({ label: "Время", was: clock(s, e), now: clock(ns, ne) });
  }
  if (item.list !== undefined) {
    const before = "list" in was ? was.list : (listName ?? null);
    if ((before ?? "Входящие") !== (item.list ?? "Входящие")) out.push({ label: "Список", was: before ?? "Входящие", now: item.list ?? "Входящие" });
  }
  if (item.priority !== undefined) {
    const before = "priority" in was ? was.priority : current?.priority;
    if (before !== item.priority) out.push({ label: "Приоритет", was: PRIORITY[before ?? 0]!, now: PRIORITY[item.priority]! });
  }
  return out;
}

/** With a timeline card under it, the «HH:mm — задача» lines of the reply would repeat it. */
export function withoutPlanLines(text: string): string {
  return text
    .split("\n")
    .filter((line) => !/^\s*(?:[-*]\s*)?\**\d{1,2}:\d{2}(?:\s*[–-]\s*\d{1,2}:\d{2})?\**\s*[—–-]\s/.test(line))
    .join("\n")
    .trim();
}
