/**
 * Which task reminders are due right now (pure; node --test loads it directly).
 *
 * A task reminds when it is not done, has a date and «Напомнить» (HH:mm), and
 * is not assigned to somebody else. `remindLead` moves the moment earlier
 * (minutes: 5, 15, 30, 60, or 1440 = the day before). Times are wall-clock
 * times in the user's time zone.
 *
 * The key names one concrete moment: a changed date, time or lead is a new
 * reminder; the same one is never sent twice (the scheduler remembers keys).
 */

export const REMIND_LEADS = [0, 5, 15, 30, 60, 1440] as const;
export const DEFAULT_TIME_ZONE = "Europe/Moscow";
/** A reminder missed by up to this much (server restart, NAS asleep) is still sent. */
export const GRACE_MS = 2 * 60 * 60 * 1000;

export type ReminderTask = {
  id: string;
  title?: unknown;
  done?: unknown;
  due?: unknown;
  remindAt?: unknown;
  remindLead?: unknown;
  assignee?: unknown;
};

export type DueReminder = { key: string; taskId: string; title: string; body: string; fireAt: number };

export function validTimeZone(tz: unknown): tz is string {
  if (typeof tz !== "string" || !tz || tz.length > 64) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

export function normalizeLead(value: unknown): number {
  return typeof value === "number" && (REMIND_LEADS as readonly number[]).includes(value) ? value : 0;
}

const formatters = new Map<string, Intl.DateTimeFormat>();

function offsetAt(ms: number, tz: string): number {
  let format = formatters.get(tz);
  if (!format) {
    format = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    formatters.set(tz, format);
  }
  const parts: Record<string, number> = {};
  for (const part of format.formatToParts(new Date(ms))) {
    if (part.type !== "literal") parts[part.type] = Number(part.value);
  }
  const asUtc = Date.UTC(parts.year!, parts.month! - 1, parts.day!, parts.hour!, parts.minute!, parts.second!);
  return asUtc - Math.floor(ms / 1000) * 1000;
}

/** Epoch ms of wall-clock `day` (YYYY-MM-DD) `time` (HH:mm) in `tz`. */
export function zonedTime(day: string, time: string, tz: string): number {
  const [y, m, d] = day.split("-").map(Number);
  const [h, min] = time.split(":").map(Number);
  const wall = Date.UTC(y!, m! - 1, d!, h!, min!);
  const first = wall - offsetAt(wall, tz);
  const second = wall - offsetAt(first, tz);
  return second;
}

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

export function leadLabel(lead: number, time: string): string {
  if (lead === 0) return `Сейчас · ${time}`;
  if (lead === 1440) return `Завтра в ${time}`;
  if (lead === 60) return `Через час · в ${time}`;
  return `Через ${lead} мин · в ${time}`;
}

export function dueReminders(input: {
  tasks: ReminderTask[];
  login: string;
  now: number;
  tz: string;
  graceMs?: number;
}): DueReminder[] {
  const grace = input.graceMs ?? GRACE_MS;
  const out: DueReminder[] = [];
  for (const task of input.tasks) {
    if (!task || typeof task.id !== "string" || task.done === true) continue;
    if (typeof task.due !== "string" || !DAY_RE.test(task.due)) continue;
    if (typeof task.remindAt !== "string" || !TIME_RE.test(task.remindAt)) continue;
    if (typeof task.assignee === "string" && task.assignee && task.assignee !== input.login) continue;
    const lead = normalizeLead(task.remindLead);
    const fireAt = zonedTime(task.due, task.remindAt, input.tz) - lead * 60_000;
    if (fireAt > input.now || fireAt <= input.now - grace) continue;
    out.push({
      key: `${task.id}|${task.due}T${task.remindAt}|${lead}`,
      taskId: task.id,
      title: typeof task.title === "string" && task.title.trim() ? task.title.trim().slice(0, 120) : "Задача",
      body: leadLabel(lead, task.remindAt),
      fireAt,
    });
  }
  return out.sort((a, b) => a.fireAt - b.fireAt);
}
