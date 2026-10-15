/**
 * «Обслуживание»: statistics. Pure.
 *  - km per month from mileage readings; a month without any reading is
 *    estimated (distance between two readings spread by days) and marked, so
 *    the screen can say «за 2 мес.» instead of pretending to be exact;
 *  - maintenance spend per year per item.
 */
import { addMonths, daysInMonth, isIso } from "./rules.ts";

export type Reading = { id?: string; date: string; km: number };
export type MonthKm = {
  /** «YYYY-MM» */
  month: string;
  km: number;
  /** No reading inside this month: the number is spread from a longer span. */
  estimated: boolean;
  /** How many months the distance between two readings covers (1 = measured). */
  spanMonths: number;
};

const ym = (iso: string) => iso.slice(0, 7);
const dayNo = (iso: string) => Math.floor(Date.parse(`${iso}T00:00:00Z`) / 86_400_000);

/** Mileage at the end of `iso`'s day, interpolated between readings (null outside the readings). */
function kmAt(sorted: Reading[], at: string): number | null {
  const first = sorted[0];
  const last = sorted[sorted.length - 1];
  if (!first || !last || at < first.date || at > last.date) return null;
  for (let i = 0; i < sorted.length; i++) {
    const cur = sorted[i]!;
    if (cur.date === at) return cur.km;
    const next = sorted[i + 1];
    if (next && cur.date < at && at < next.date) {
      const span = dayNo(next.date) - dayNo(cur.date);
      return cur.km + ((next.km - cur.km) * (dayNo(at) - dayNo(cur.date))) / span;
    }
  }
  return null;
}

/** One entry per calendar month from the first to the last reading (the first month has no start point and is skipped). */
export function kmPerMonth(readings: Reading[]): MonthKm[] {
  const sorted = readings
    .filter((r) => isIso(r.date) && Number.isFinite(r.km))
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.km - b.km));
  if (sorted.length < 2) return [];
  const withReading = new Set(sorted.map((r) => ym(r.date)));
  const out: MonthKm[] = [];
  let month = ym(sorted[0]!.date);
  const lastMonth = ym(sorted[sorted.length - 1]!.date);
  // The distance in the first month starts at its first reading, so it is never «complete» — begin with the next one.
  month = ym(addMonths(`${month}-01`, 1));
  while (month <= lastMonth) {
    const y = Number(month.slice(0, 4));
    const m = Number(month.slice(5, 7));
    const end = `${month}-${String(daysInMonth(y, m)).padStart(2, "0")}`;
    const prevEnd = addMonthEnd(month, -1);
    const a = kmAt(sorted, prevEnd);
    const b = kmAt(sorted, end) ?? sorted[sorted.length - 1]!.km;
    if (a !== null) out.push({ month, km: Math.max(0, Math.round(b - a)), estimated: !withReading.has(month), spanMonths: 1 });
    month = ym(addMonths(`${month}-01`, 1));
  }
  // «за N мес.»: a run of estimated months plus the measured one after it is one span.
  let run: MonthKm[] = [];
  for (const item of out) {
    run.push(item);
    if (!item.estimated) {
      for (const r of run) r.spanMonths = run.length;
      run = [];
    }
  }
  for (const r of run) r.spanMonths = Math.max(run.length, 1);
  return out;
}

function addMonthEnd(month: string, delta: number): string {
  const first = addMonths(`${month}-01`, delta);
  const y = Number(first.slice(0, 4));
  const m = Number(first.slice(5, 7));
  return `${first.slice(0, 7)}-${String(daysInMonth(y, m)).padStart(2, "0")}`;
}

/** Cost entries per year: { "2026": 19700 }. */
export function spendByYear(entries: { date: string; cost?: number | null }[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const e of entries) {
    if (!isIso(e.date) || typeof e.cost !== "number" || !Number.isFinite(e.cost) || e.cost <= 0) continue;
    const year = e.date.slice(0, 4);
    out[year] = Math.round(((out[year] ?? 0) + e.cost) * 100) / 100;
  }
  return out;
}

export function money(value: number): string {
  return `${Math.round(value).toLocaleString("ru-RU").replace(/\u00a0|\u202f/g, " ")} ₽`;
}
