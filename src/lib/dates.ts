import { format, parseISO } from "date-fns";
import { ru } from "date-fns/locale";
import type { Repeat } from "@/lib/planner-types";

export function todayIso(d = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function shiftIso(iso: string, days: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(y, (m ?? 1) - 1, d ?? 1);
  dt.setDate(dt.getDate() + days);
  return todayIso(dt);
}

export function isoFromTs(ts: number): string {
  return todayIso(new Date(ts));
}

export function cap(value: string): string {
  if (!value) return value;
  return value.charAt(0).toUpperCase() + value.slice(1);
}

export function formatLong(iso: string): string {
  return cap(format(parseISO(iso), "EEEE, d MMMM", { locale: ru }));
}

export function formatShort(iso: string): string {
  return format(parseISO(iso), "d MMM", { locale: ru });
}

export function formatMonth(date: Date): string {
  return cap(format(date, "LLLL yyyy", { locale: ru }));
}

export function dueLabel(due: string, today: string): string {
  if (due === today) return "сегодня";
  if (due === shiftIso(today, 1)) return "завтра";
  if (due === shiftIso(today, -1)) return "вчера";
  return formatShort(due);
}

/** Monday-first week containing `anchor`. */
export function weekDays(anchor: string): string[] {
  const [y, m, d] = anchor.split("-").map(Number);
  const dt = new Date(y, (m ?? 1) - 1, d ?? 1);
  const mondayOffset = (dt.getDay() + 6) % 7;
  const monday = shiftIso(anchor, -mondayOffset);
  return Array.from({ length: 7 }, (_, i) => shiftIso(monday, i));
}

export function weekdayLetter(iso: string): string {
  return format(parseISO(iso), "EEEEEE", { locale: ru });
}

export function dayNumber(iso: string): string {
  return format(parseISO(iso), "d");
}

export function daysBetween(from: string, to: string): number {
  const [y1, m1, d1] = from.split("-").map(Number);
  const [y2, m2, d2] = to.split("-").map(Number);
  const a = Date.UTC(y1 ?? 1970, (m1 ?? 1) - 1, d1 ?? 1);
  const b = Date.UTC(y2 ?? 1970, (m2 ?? 1) - 1, d2 ?? 1);
  return Math.round((b - a) / 86_400_000);
}

export function repeatLabel(repeat: Repeat): string {
  if (repeat === "day") return "каждый день";
  if (repeat === "weekdays") return "по будням";
  if (repeat === "week") return "каждую неделю";
  return "каждый месяц";
}

function weekday(iso: string): number {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y ?? 1970, (m ?? 1) - 1, d ?? 1).getDay();
}

function addMonthsIso(iso: string, months: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const anchor = new Date(y ?? 1970, (m ?? 1) - 1 + months, 1);
  const last = new Date(anchor.getFullYear(), anchor.getMonth() + 1, 0).getDate();
  anchor.setDate(Math.min(d ?? 1, last));
  return todayIso(anchor);
}

function stepRepeat(iso: string, repeat: Repeat): string {
  if (repeat === "day") return shiftIso(iso, 1);
  if (repeat === "week") return shiftIso(iso, 7);
  if (repeat === "month") return addMonthsIso(iso, 1);
  const day = weekday(iso);
  const skip = day === 5 ? 3 : day === 6 ? 2 : 1;
  return shiftIso(iso, skip);
}

/** The next occurrence after both the current due date and today. */
export function nextRepeat(due: string, repeat: Repeat, today: string): string {
  let cursor = stepRepeat(due, repeat);
  let guard = 0;
  while (cursor <= today && guard < 400) {
    cursor = stepRepeat(cursor, repeat);
    guard += 1;
  }
  return cursor;
}
export function nextOccurrence(date: string, yearly: boolean, today: string): string {
  if (!yearly) return date;
  const monthDay = date.slice(5);
  const year = Number(today.slice(0, 4));
  const candidate = `${year}-${monthDay}`;
  return candidate < today ? `${year + 1}-${monthDay}` : candidate;
}

export function countdownLabel(days: number): string {
  if (days < 0) return `${Math.abs(days)} дн. назад`;
  if (days === 0) return "сегодня";
  if (days === 1) return "завтра";
  return `через ${days} дн.`;
}
