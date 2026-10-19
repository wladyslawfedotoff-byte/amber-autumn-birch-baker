/**
 * «Техника»: warranty, investment and age. Pure. No fuel or mileage in here.
 */
import type { Asset, TechPart } from "../planner-types.ts";
import { addDays, addMonths, dateWords, diffDays, isIso } from "./rules.ts";

export const DEFAULT_WARN_DAYS = 30;

export type WarrantySubject = { boughtAt?: string | null; warrantyMonths?: number | null; warrantyUntil?: string | null };

/** The last day of the warranty: an explicit date, or the purchase date plus N months. null = no warranty known. */
export function warrantyUntil(s: WarrantySubject): string | null {
  if (s.warrantyUntil && isIso(s.warrantyUntil)) return s.warrantyUntil;
  if (s.boughtAt && isIso(s.boughtAt) && typeof s.warrantyMonths === "number" && s.warrantyMonths > 0) return addMonths(s.boughtAt, Math.round(s.warrantyMonths));
  return null;
}

export type WarrantyStatus = "none" | "ok" | "soon" | "expired";
export type WarrantyState = { status: WarrantyStatus; until: string | null; daysLeft: number | null };

export function warrantyState(s: WarrantySubject, today: string, soonDays = DEFAULT_WARN_DAYS): WarrantyState {
  const until = warrantyUntil(s);
  if (!until) return { status: "none", until: null, daysLeft: null };
  const daysLeft = diffDays(today, until);
  if (daysLeft < 0) return { status: "expired", until, daysLeft };
  return { status: daysLeft <= Math.max(0, soonDays) ? "soon" : "ok", until, daysLeft };
}

const fullDate = (iso: string) => `${dateWords(iso)} ${iso.slice(0, 4)}`;

/** «до 12 фев 2027» / «заканчивается через 30 дн.» / «истекла» / «без гарантии». */
export function warrantyText(state: WarrantyState): string {
  switch (state.status) {
    case "none":
      return "без гарантии";
    case "expired":
      return "истекла";
    case "soon":
      return state.daysLeft === 0 ? "заканчивается сегодня" : `заканчивается через ${state.daysLeft} дн.`;
    case "ok":
      return `действует до ${fullDate(state.until!)}`;
  }
}

/** Short badge for a row. */
export function warrantyBadge(state: WarrantyState): string {
  switch (state.status) {
    case "none":
      return "без гарантии";
    case "expired":
      return "истекла";
    case "soon":
      return state.daysLeft === 0 ? "гарантия сегодня" : `гарантия ${state.daysLeft} дн.`;
    case "ok":
      return `до ${state.until!.slice(8, 10)}.${state.until!.slice(5, 7)}.${state.until!.slice(2, 4)}`;
  }
}

/** «3 г. 7 мес.» / «5 мес.» / «меньше месяца». */
export function ageText(from: string | null | undefined, today: string): string {
  if (!from || !isIso(from) || from > today) return "";
  let months = (Number(today.slice(0, 4)) - Number(from.slice(0, 4))) * 12 + Number(today.slice(5, 7)) - Number(from.slice(5, 7));
  if (Number(today.slice(8, 10)) < Number(from.slice(8, 10))) months--;
  if (months < 1) return "меньше месяца";
  const y = Math.floor(months / 12);
  const m = months % 12;
  return [y ? `${y} г.` : "", m ? `${m} мес.` : ""].filter(Boolean).join(" ");
}

/** Age in years (fraction), null without a date. */
export function ageYears(from: string | null | undefined, today: string): number | null {
  if (!from || !isIso(from) || from > today) return null;
  return diffDays(from, today) / 365.25;
}

/** One thing with a warranty: the card itself or one of its parts. */
export type Subject = { id: string; label: string; part: TechPart | null; boughtAt?: string | null; warrantyMonths?: number | null; warrantyUntil?: string | null; price?: number | null; made?: string };

export function subjectsOf(asset: Asset): Subject[] {
  const own: Subject = { id: asset.id, label: asset.name, part: null, boughtAt: asset.boughtAt, warrantyMonths: asset.warrantyMonths, warrantyUntil: asset.warrantyUntil, price: asset.price, made: asset.warnMade };
  const parts = (asset.parts ?? []).map<Subject>((p) => ({ id: p.id, label: `${p.name} — ${asset.name}`, part: p, boughtAt: p.boughtAt ?? asset.boughtAt, warrantyMonths: p.warrantyMonths, warrantyUntil: p.warrantyUntil, price: p.price, made: p.warnMade }));
  return [own, ...parts];
}

const RANK: Record<WarrantyStatus, number> = { soon: 0, ok: 1, expired: 2, none: 3 };

/** The warranty that decides a card's badge: ending soonest among the active ones, else the latest that ended. */
export function leadWarranty(asset: Asset, today: string): { state: WarrantyState; subject: Subject } | null {
  const soon = asset.warnDays ?? DEFAULT_WARN_DAYS;
  const all = subjectsOf(asset).map((subject) => ({ subject, state: warrantyState(subject, today, soon) })).filter((x) => x.state.status !== "none");
  if (!all.length) return null;
  all.sort((a, b) => RANK[a.state.status] - RANK[b.state.status] || (a.state.status === "expired" ? (b.state.until! > a.state.until! ? 1 : -1) : (a.state.until! < b.state.until! ? -1 : 1)));
  return all[0]!;
}

/** Money put into an item: its own price plus the parts (a part without a date counts in the year of the card's purchase). */
export function investedByYear(asset: Asset): Record<string, number> {
  const out: Record<string, number> = {};
  const add = (date: string | null | undefined, price: number | null | undefined) => {
    if (typeof price !== "number" || !Number.isFinite(price) || price <= 0) return;
    const key = date && isIso(date) ? date.slice(0, 4) : "—";
    out[key] = Math.round(((out[key] ?? 0) + price) * 100) / 100;
  };
  add(asset.boughtAt, asset.price);
  for (const p of asset.parts ?? []) add(p.boughtAt ?? asset.boughtAt, p.price);
  return out;
}

export const totalInvested = (asset: Asset) => Object.values(investedByYear(asset)).reduce((n, v) => n + v, 0);

export type WarrantyRow = { assetId: string; assetName: string; subject: Subject; state: WarrantyState };

export type TechSummary = {
  invested: number;
  byYear: [string, number][];
  soon: WarrantyRow[];
  active: WarrantyRow[];
  expired: WarrantyRow[];
  /** Per item: age and the cost spread over its years. */
  items: { asset: Asset; invested: number; age: string; perYear: number | null }[];
};

const isTech = (a: Asset) => a.kind !== "car";

/** Everything the tech statistics screen shows. Cars and their fuel/mileage are not part of it. */
export function techSummary(assets: Asset[], today: string): TechSummary {
  const tech = assets.filter(isTech);
  const years: Record<string, number> = {};
  const rows: WarrantyRow[] = [];
  const items: TechSummary["items"] = [];
  for (const asset of tech) {
    const by = investedByYear(asset);
    for (const [y, v] of Object.entries(by)) years[y] = Math.round(((years[y] ?? 0) + v) * 100) / 100;
    const soon = asset.warnDays ?? DEFAULT_WARN_DAYS;
    for (const subject of subjectsOf(asset)) {
      const state = warrantyState(subject, today, soon);
      if (state.status !== "none") rows.push({ assetId: asset.id, assetName: asset.name, subject, state });
    }
    const invested = totalInvested(asset);
    const first = [asset.boughtAt, ...(asset.parts ?? []).map((p) => p.boughtAt)].filter((d): d is string => !!d && isIso(d)).sort()[0] ?? null;
    const yrs = ageYears(first, today);
    items.push({ asset, invested, age: ageText(first, today), perYear: yrs !== null && invested > 0 ? invested / Math.max(yrs, 1) : null });
  }
  const byUntil = (a: WarrantyRow, b: WarrantyRow) => (a.state.until! < b.state.until! ? -1 : 1);
  return {
    invested: Object.values(years).reduce((n, v) => n + v, 0),
    byYear: Object.entries(years).sort((a, b) => (a[0] < b[0] ? -1 : 1)),
    soon: rows.filter((r) => r.state.status === "soon").sort(byUntil),
    active: rows.filter((r) => r.state.status === "ok").sort(byUntil),
    expired: rows.filter((r) => r.state.status === "expired").sort((a, b) => -byUntil(a, b)),
    items: items.sort((a, b) => b.invested - a.invested),
  };
}

export const warnDate = (until: string, days: number) => addDays(until, -days);
