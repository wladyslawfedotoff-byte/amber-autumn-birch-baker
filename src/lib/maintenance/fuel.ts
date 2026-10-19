/**
 * «Авто»: fuel and the cost of ownership. Pure.
 *
 * Consumption is counted the usual way: between two «full tank» fill-ups that
 * both have a mileage; everything poured in between (partial fills too) counts
 * for the distance. A fill-up without mileage, or a partial one, is never the
 * start or the end of a stretch, but its liters and money still count inside it.
 */
import type { Asset, FuelFill } from "../planner-types.ts";
import { isIso } from "./rules.ts";
import { kmPerMonth } from "./stats.ts";

const finite = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n);

export function sortFills<T extends Pick<FuelFill, "date" | "km">>(fills: T[]): T[] {
  return [...fills].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : (a.km ?? 0) - (b.km ?? 0)));
}

export type FuelStats = {
  /** Liters per 100 km over all complete stretches (null = fewer than two usable full fills). */
  per100: number | null;
  /** Fuel money per km over the same stretches. */
  perKm: number | null;
  /** Distance and fuel of those stretches. */
  km: number;
  liters: number;
  spend: number;
  stretches: number;
  /** Average price of a liter over all fills. */
  price: number | null;
};

export function fuelStats(fills: FuelFill[], range?: { from?: string; to?: string }): FuelStats {
  const sorted = sortFills(fills.filter((f) => isIso(f.date) && finite(f.liters) && f.liters > 0));
  let anchor: FuelFill | null = null;
  let pendingL = 0;
  let pendingS = 0;
  let km = 0;
  let liters = 0;
  let spend = 0;
  let stretches = 0;
  for (const f of sorted) {
    const sum = finite(f.sum) && f.sum > 0 ? f.sum : 0;
    const full = f.full !== false;
    if (full && finite(f.km)) {
      const fk = f.km;
      if (anchor && finite(anchor.km) && fk > anchor.km) {
        const inRange = (!range?.from || f.date >= range.from) && (!range?.to || f.date <= range.to);
        if (inRange) {
          km += fk - anchor.km;
          liters += pendingL + f.liters;
          spend += pendingS + sum;
          stretches++;
        }
      }
      anchor = f;
      pendingL = 0;
      pendingS = 0;
    } else if (anchor) {
      pendingL += f.liters;
      pendingS += sum;
    }
  }
  const allL = sorted.reduce((n, f) => n + f.liters, 0);
  const allS = sorted.reduce((n, f) => n + (finite(f.sum) && f.sum > 0 ? f.sum : 0), 0);
  return {
    per100: km > 0 ? (liters / km) * 100 : null,
    perKm: km > 0 ? spend / km : null,
    km,
    liters,
    spend,
    stretches,
    price: allL > 0 && allS > 0 ? allS / allL : null,
  };
}

export type Spend = { fuel: number; service: number; ins: number };
const zero = (): Spend => ({ fuel: 0, service: 0, ins: 0 });
export const spendTotal = (s: Spend) => s.fuel + s.service + s.ins;
const round = (n: number) => Math.round(n * 100) / 100;

/** Fuel + maintenance + insurance/tax, by month («YYYY-MM») and by year («YYYY»). */
export function spendSplit(asset: Pick<Asset, "fuel" | "log">): { byMonth: Record<string, Spend>; byYear: Record<string, Spend> } {
  const byMonth: Record<string, Spend> = {};
  const byYear: Record<string, Spend> = {};
  const add = (date: string, key: keyof Spend, value: number) => {
    if (!isIso(date) || !finite(value) || value <= 0) return;
    for (const [map, k] of [[byMonth, date.slice(0, 7)], [byYear, date.slice(0, 4)]] as const) {
      const row = (map[k] ??= zero());
      row[key] = round(row[key] + value);
    }
  };
  for (const f of asset.fuel ?? []) add(f.date, "fuel", f.sum);
  for (const e of asset.log ?? []) add(e.date, e.cat === "ins" ? "ins" : "service", e.cost ?? 0);
  return { byMonth, byYear };
}

/** Km driven in a year, from the mileage readings (estimated months included). */
export function kmInYear(readings: Asset["readings"], year: string): number {
  return kmPerMonth(readings ?? []).filter((m) => m.month.startsWith(year)).reduce((n, m) => n + m.km, 0);
}

/** Cost of ownership of a year (or all years): the money split and ₽ per km (null without distance). */
export function ownership(asset: Pick<Asset, "fuel" | "log" | "readings">, year?: string): { spend: Spend; total: number; km: number; perKm: number | null } {
  const { byYear } = spendSplit(asset);
  const spend = zero();
  for (const [y, s] of Object.entries(byYear)) {
    if (year && y !== year) continue;
    spend.fuel = round(spend.fuel + s.fuel);
    spend.service = round(spend.service + s.service);
    spend.ins = round(spend.ins + s.ins);
  }
  const km = year ? kmInYear(asset.readings, year) : kmPerMonth(asset.readings ?? []).reduce((n, m) => n + m.km, 0);
  const total = spendTotal(spend);
  return { spend, total, km, perKm: km > 0 && total > 0 ? total / km : null };
}

export function liters(n: number): string {
  return n.toLocaleString("ru-RU", { maximumFractionDigits: 1 }).replace(/\u00a0|\u202f/g, " ");
}
export function rub1(n: number): string {
  return `${n.toLocaleString("ru-RU", { minimumFractionDigits: 1, maximumFractionDigits: 1 }).replace(/\u00a0|\u202f/g, " ")} ₽`;
}
