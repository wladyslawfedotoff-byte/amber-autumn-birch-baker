import { daysBetween, dueLabel, formatShort, nextOccurrence, shiftIso, todayIso } from "./dates.ts";
import { DAYS, pluralN } from "./plural.ts";
import { goalOf, entryOf, isDue, reminderTimes } from "./habit-plan.ts";
import { leadDays } from "./special-dates.ts";
import type { Habit, Milestone, Task } from "@/lib/planner-types";

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

/** «Напомнить заранее» (minutes before the reminder time): 1440 = the day before. */
export const REMIND_LEADS = [0, 5, 15, 30, 60, 1440] as const;

export function normalizeLead(value: unknown): number {
  return typeof value === "number" && (REMIND_LEADS as readonly number[]).includes(value) ? value : 0;
}

/** «в момент», «за 5 мин», «за час», «за день». */
export function leadShort(lead: number): string {
  if (lead === 0) return "в момент";
  if (lead === 60) return "за час";
  if (lead === 1440) return "за день";
  return `за ${lead} мин`;
}

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
  habits?: Habit[];
  remindAck: Record<string, string>;
  now: number;
}): ReminderHit[] {
  const today = todayIso(new Date(input.now));
  const tomorrowEnd = localStamp(shiftIso(today, 1), "23:59");
  const ack = input.remindAck ?? {};
  const hits: ReminderHit[] = [];

  for (const task of input.tasks) {
    if (task.done || !validTime(task.remindAt) || !task.due) continue;
    const lead = normalizeLead(task.remindLead);
    const at = localStamp(task.due, task.remindAt) - lead * 60_000;
    if (at > tomorrowEnd) continue;
    // Same moment key as the server's push reminder (date, time and lead).
    const stamp = lead ? `${task.due}T${task.remindAt}-${lead}` : `${task.due}T${task.remindAt}`;
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
      whenLabel: `${dueLabel(task.due, today)} в ${task.remindAt}${lead ? ` · ${leadShort(lead)}` : ""}`,
      at,
      status,
    });
  }

  for (const item of input.milestones) {
    if (!validTime(item.remindAt)) continue;
    // Several reminders: «в день, за 3 дня» — each lead time is its own reminder.
    const when = nextOccurrence(item.date, item.yearly, today);
    const leads = leadDays(item);
    for (const lead of leads) {
      const notifyDay = shiftIso(when, -lead);
      const days = daysBetween(today, notifyDay);
      if (days < 0 || days > 1) continue;
      const at = localStamp(notifyDay, item.remindAt);
      if (at > tomorrowEnd) continue;
      const stamp = `${notifyDay}T${item.remindAt}`;
      // The first lead keeps the old key so an acknowledged reminder stays acknowledged after the update.
      const key = lead === leads[0] ? `date:${item.id}` : `date:${item.id}:${lead}`;
      const status = at <= input.now ? "due" : "later";
      if (status === "due" && ack[key] === stamp) continue;
      hits.push({
        key,
        stamp,
        kind: "date",
        refId: item.id,
        title: item.title,
        time: item.remindAt,
        whenLabel:
          lead > 0
            ? `${dueLabel(notifyDay, today)} в ${item.remindAt} · до даты ${pluralN(lead, DAYS)} (${formatShort(when)})`
            : `${dueLabel(when, today)} в ${item.remindAt}`,
        at,
        status,
      });
    }
  }

  // Habits: every reminder time of a habit planned for today and not done yet
  // (amount habits: until the goal is reached). Each time is its own reminder.
  for (const habit of input.habits ?? []) {
    if (habit.archived || habit.checks.includes(today) || !isDue(habit, today)) continue;
    const goal = goalOf(habit);
    const amount = entryOf(habit, today)?.amount ?? 0;
    const status = entryOf(habit, today)?.status;
    if (status === "skip" || status === "fail") continue;
    for (const time of reminderTimes(habit)) {
      const at = localStamp(today, time);
      const stamp = `${today}T${time}`;
      const key = `habit:${habit.id}:${time}`;
      const state = at <= input.now ? "due" : "later";
      if (state === "due" && ack[key] === stamp) continue;
      hits.push({
        key,
        stamp,
        kind: "habit",
        refId: habit.id,
        title: `${habit.icon ? `${habit.icon} ` : ""}${habit.name}`,
        time,
        whenLabel: goal > 1 ? `сегодня в ${time} · ${amount} из ${goal}${habit.unit ? ` ${habit.unit}` : ""}` : `сегодня в ${time}`,
        at,
        status: state,
      });
    }
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
