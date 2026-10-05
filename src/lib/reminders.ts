import { daysBetween, dueLabel, nextOccurrence, shiftIso, todayIso } from "@/lib/dates";
import type { Milestone, Task } from "@/lib/planner-types";

export type ReminderKind = "task" | "habit" | "date";

export type ReminderHit = {
  key: string;
  stamp: string;
  kind: ReminderKind;
  refId: string;
  title: string;
  time: string;
  whenLabel: string;
  at: number;
  status: "due" | "later";
};

export function localStamp(day: string, time: string): number {
  const [y, m, d] = day.split("-").map(Number);
  const [h, min] = time.split(":").map(Number);
  return new Date(y ?? 1970, (m ?? 1) - 1, d ?? 1, h ?? 0, min ?? 0, 0, 0).getTime();
}

export function validTime(value: string | null | undefined): value is string {
  return typeof value === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
}

export function kindLabel(kind: ReminderKind): string {
  if (kind === "habit") return "Привычка";
  if (kind === "date") return "Дата";
  return "Задача";
}

export function collectReminders(input: {
  tasks: Task[];
  milestones: Milestone[];
  remindAck: Record<string, string>;
  now: number;
}): ReminderHit[] {
  const today = todayIso(new Date(input.now));
  const tomorrowEnd = localStamp(shiftIso(today, 1), "23:59");
  const ack = input.remindAck ?? {};
  const hits: ReminderHit[] = [];

  for (const task of input.tasks) {
    if (task.done || !validTime(task.remindAt) || !task.due) continue;
    const at = localStamp(task.due, task.remindAt);
    if (task.due > shiftIso(today, 1)) continue;
    const stamp = `${task.due}T${task.remindAt}`;
    const key = `task:${task.id}`;
    const status = at <= input.now ? "due" : "later";
    if (status === "due" && ack[key] === stamp) continue;
    hits.push({
      key,
      stamp,
      kind: "task",
      refId: task.id,
      title: task.title,
      time: task.remindAt,
      whenLabel: `${dueLabel(task.due, today)} в ${task.remindAt}`,
      at,
      status,
    });
  }

  for (const item of input.milestones) {
    if (!validTime(item.remindAt)) continue;
    const when = nextOccurrence(item.date, item.yearly, today);
    const days = daysBetween(today, when);
    if (days < 0 || days > 1) continue;
    const at = localStamp(when, item.remindAt);
    if (at > tomorrowEnd) continue;
    const stamp = `${when}T${item.remindAt}`;
    const key = `date:${item.id}`;
    const status = at <= input.now ? "due" : "later";
    if (status === "due" && ack[key] === stamp) continue;
    hits.push({
      key,
      stamp,
      kind: "date",
      refId: item.id,
      title: item.title,
      time: item.remindAt,
      whenLabel: `${dueLabel(when, today)} в ${item.remindAt}`,
      at,
      status,
    });
  }

  hits.sort((a, b) => a.at - b.at || a.title.localeCompare(b.title, "ru"));
  return hits;
}

export function notifyReminder(hit: ReminderHit) {
  if (typeof Notification === "undefined" || Notification.permission !== "granted") return;
  try {
    new Notification(hit.title, { body: hit.whenLabel, tag: hit.key });
  } catch {
    /* optional while the tab is open */
  }
}
