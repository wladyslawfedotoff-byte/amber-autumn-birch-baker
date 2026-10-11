/**
 * «Памятные даты»: the user enters the ORIGINAL date (birth, wedding); the app
 * repeats it every year and says how old / which anniversary, when and how
 * soon. Pure, unit-tested in special-dates.test.ts.
 *
 * 29 February: in a year without it the date is celebrated on 28 February.
 */
import { daysBetween, nextOccurrence } from "./dates.ts";
import { DAYS, YEARS, plural, pluralN } from "./plural.ts";
import type { Milestone, MilestoneItemKind, MilestoneKind } from "./planner-types";
import type { TaskColor } from "./task-colors";

function isLeap(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

/** The date in `year` (29.02 → 28.02 when the year has no 29th). */
export function inYear(date: string, year: number): string {
  const month = Number(date.slice(5, 7));
  let day = Number(date.slice(8, 10));
  if (month === 2 && day === 29 && !isLeap(year)) day = 28;
  return `${year}-${pad(month)}-${pad(day)}`;
}

/** Does a yearly date fall on `day`? */
export function occursOnDay(item: Pick<Milestone, "date" | "yearly">, day: string): boolean {
  if (!item.yearly) return item.date === day;
  return inYear(item.date, Number(day.slice(0, 4))) === day;
}

/** How many years at the occurrence `when` (null: year unknown, one-off, or not after the original). */
export function yearsAt(item: Pick<Milestone, "date" | "yearly" | "noYear">, when: string): number | null {
  if (item.noYear || !item.yearly) return null;
  const n = Number(when.slice(0, 4)) - Number(item.date.slice(0, 4));
  return n > 0 ? n : null;
}

/** «исполнится 35» / «исполняется 35» / «10 лет свадьбе» / «10 лет» — or "" when unknown. */
export function ageLabel(item: Pick<Milestone, "date" | "yearly" | "noYear" | "kind" | "showAge">, when: string, today: string): string {
  if (!showsAge(item)) return "";
  const n = yearsAt(item, when);
  if (n == null) return "";
  if (item.kind === "birthday") return when === today ? `исполняется ${n}` : `исполнится ${n}`;
  if (item.kind === "anniversary") return `${pluralN(n, YEARS)} свадьбе`;
  return pluralN(n, YEARS);
}

/** «сегодня», «завтра», «через 12 дней», «3 дня назад». */
export function daysLeftLabel(days: number): string {
  if (days === 0) return "сегодня";
  if (days === 1) return "завтра";
  if (days === 2) return "послезавтра";
  if (days < 0) return `${pluralN(-days, DAYS)} назад`;
  return `через ${pluralN(days, DAYS)}`;
}

export type Upcoming = { item: Milestone; when: string; days: number; age: string };

/** Upcoming first (soonest on top), then past one-time events (most recent first). */
export function upcoming(items: Milestone[], today: string): Upcoming[] {
  return items
    .map((item) => {
      const when = nextOccurrence(item.date, item.yearly, today);
      return { item, when, days: daysBetween(today, when), age: ageLabel(item, when, today) };
    })
    .sort((a, b) => {
      const pa = a.days < 0 ? 1 : 0;
      const pb = b.days < 0 ? 1 : 0;
      if (pa !== pb) return pa - pb;
      return (pa ? b.days - a.days : a.days - b.days) || a.item.title.localeCompare(b.item.title, "ru");
    });
}

export type KindMeta = { id: MilestoneKind; label: string; icon: string; color: TaskColor; yearly: boolean; age: boolean; dateLabel: string; example: string };

/** Date types («Обратный отсчёт» and others): icon, colour and defaults of a new date. */
export const KINDS: readonly KindMeta[] = [
  { id: "birthday", label: "День рождения", icon: "🎂", color: "peacock", yearly: true, age: true, dateLabel: "Дата рождения", example: "Например: Мама" },
  { id: "anniversary", label: "Годовщина", icon: "💍", color: "tomato", yearly: true, age: true, dateLabel: "Дата события", example: "Например: Свадьба" },
  { id: "holiday", label: "Праздник", icon: "🎉", color: "sage", yearly: true, age: false, dateLabel: "Дата", example: "Например: Новый год" },
  { id: "countdown", label: "Обратный отсчёт", icon: "⏳", color: "blueberry", yearly: false, age: false, dateLabel: "Когда", example: "Например: Отпуск" },
  { id: "other", label: "Другое", icon: "★", color: "graphite", yearly: true, age: true, dateLabel: "Дата", example: "Например: День переезда" },
];

export function kindMeta(kind: unknown): KindMeta {
  return KINDS.find((k) => k.id === kind) ?? KINDS[KINDS.length - 1]!;
}

export function iconOf(item: Pick<Milestone, "icon" | "kind">): string {
  return item.icon || kindMeta(item.kind).icon;
}

/** «Показать возраст»: explicit switch, else on for birthdays and anniversaries; never without a year. */
export function showsAge(item: Pick<Milestone, "noYear" | "kind" | "showAge">): boolean {
  if (item.noYear) return false;
  return typeof item.showAge === "boolean" ? item.showAge : kindMeta(item.kind).age;
}

/** Short age for the card: «(37 л.)», «(1 г.)» — "" when hidden/unknown. */
export function shortAge(item: Pick<Milestone, "date" | "yearly" | "noYear" | "kind" | "showAge">, when: string): string {
  if (!showsAge(item)) return "";
  const n = yearsAt(item, when);
  return n == null ? "" : `(${n} ${plural(n, ["г.", "г.", "л."])})`;
}

/** The big number on the right of a card and its caption. */
export function countLabel(days: number): { value: string; caption: string; past: boolean } {
  if (days === 0) return { value: "Сегодня!", caption: "", past: false };
  const n = Math.abs(days);
  return { value: String(n), caption: `${plural(n, ["день", "дня", "дней"])} ${days < 0 ? "назад" : "до"}`, past: days < 0 };
}

/** Lead times (days before) of the reminders: the list, else the legacy single value. */
export function leadDays(item: Pick<Milestone, "reminders" | "remindDays">): number[] {
  const raw = Array.isArray(item.reminders) ? item.reminders : [typeof item.remindDays === "number" ? item.remindDays : 0];
  return [...new Set(raw.filter((n) => Number.isInteger(n) && n >= 0 && n <= 60))].sort((a, b) => a - b);
}

/** «в день, за 3 дня». */
export function leadsLabel(item: Pick<Milestone, "reminders" | "remindDays" | "remindAt">): string {
  if (!item.remindAt) return "Нет";
  const leads = leadDays(item);
  return leads.length ? `${leads.map((n) => (n === 0 ? "в день" : `за ${pluralN(n, DAYS)}`)).join(", ")} в ${item.remindAt}` : "Нет";
}

/** Shown in «Сегодня» today? From `showInToday` days before up to the day itself. */
export function showInTodayNow(item: Milestone, today: string): Upcoming | null {
  const lead = item.showInToday === null ? -1 : typeof item.showInToday === "number" ? item.showInToday : 0;
  if (lead < 0) return null;
  const when = nextOccurrence(item.date, item.yearly, today);
  const days = daysBetween(today, when);
  if (days < 0 || days > lead) return null;
  return { item, when, days, age: ageLabel(item, when, today) };
}

export const TODAY_OPTIONS: readonly { value: number | null; label: string }[] = [
  { value: null, label: "Не показывать" },
  { value: 0, label: "В этот день" },
  { value: 1, label: "За 1 день" },
  { value: 3, label: "За 3 дня" },
  { value: 7, label: "За неделю" },
];

export const ITEM_KINDS: { id: MilestoneItemKind; label: string; hint: string }[] = [
  { id: "gift", label: "Идеи подарков", hint: "Например: книга по фотографии" },
  { id: "idea", label: "Идеи", hint: "Например: сюрприз-завтрак" },
  { id: "todo", label: "Дела", hint: "Например: забронировать столик" },
  { id: "buy", label: "Покупки", hint: "Например: свечи для торта" },
];

/** Reminder lead time options (days before). */
export const LEAD_OPTIONS = [0, 1, 2, 3, 7, 14, 30] as const;

export function leadLabel(days: number): string {
  if (days === 0) return "в сам день";
  return `за ${pluralN(days, DAYS)}`;
}

export { nextOccurrence, plural };
