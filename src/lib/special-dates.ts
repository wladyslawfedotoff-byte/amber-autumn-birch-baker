/**
 * «Памятные даты»: the user enters the ORIGINAL date (birth, wedding); the app
 * repeats it every year and says how old / which anniversary, when and how
 * soon. Pure, unit-tested in special-dates.test.ts.
 *
 * 29 February: in a year without it the date is celebrated on 28 February.
 */
import { daysBetween, nextOccurrence } from "./dates.ts";
import { DAYS, YEARS, plural, pluralN } from "./plural.ts";
import type { Milestone, MilestoneItemKind } from "./planner-types";

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
export function ageLabel(item: Pick<Milestone, "date" | "yearly" | "noYear" | "kind">, when: string, today: string): string {
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

export function upcoming(items: Milestone[], today: string): Upcoming[] {
  return items
    .map((item) => {
      const when = nextOccurrence(item.date, item.yearly, today);
      return { item, when, days: daysBetween(today, when), age: ageLabel(item, when, today) };
    })
    .sort((a, b) => a.days - b.days || a.item.title.localeCompare(b.item.title, "ru"));
}

export const ITEM_KINDS: { id: MilestoneItemKind; label: string; hint: string }[] = [
  { id: "gift", label: "Идеи подарков", hint: "Например: книга по фотографии" },
  { id: "idea", label: "Идеи", hint: "Например: сюрприз-завтрак" },
  { id: "todo", label: "Дела", hint: "Например: забронировать столик" },
  { id: "buy", label: "Покупки", hint: "Например: свечи для торта" },
];

/** Reminder lead time options (days before). */
export const LEAD_OPTIONS = [0, 1, 2, 3, 7, 14] as const;

export function leadLabel(days: number): string {
  if (days === 0) return "в сам день";
  return `за ${pluralN(days, DAYS)}`;
}

export { nextOccurrence, plural };
