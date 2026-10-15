import type { ReactNode } from "react";
import { Car, Droplets, Plug, Wrench } from "lucide-react";
import { cn } from "@/lib/cn";
import type { Asset, AssetKind } from "@/lib/planner-types";
import type { MaintRule, RuleState, Status } from "@/lib/maintenance/rules";

export const field = "h-11 w-full rounded-xl bg-elevated px-3 text-base outline-none placeholder:text-subtle";
export const smallLabel = "mb-1 px-1 text-xs font-medium text-subtle";

export const KIND_ICON: Record<AssetKind, typeof Car> = { car: Car, device: Plug, consumable: Droplets, other: Wrench };

const BADGE: Record<Status, string> = { ok: "bg-ok/15 text-ok", soon: "bg-warn/15 text-warn", overdue: "bg-danger/15 text-danger" };
export const STATUS_WORD: Record<Status, string> = { ok: "ок", soon: "скоро", overdue: "просрочено" };

export function Badge({ status, children, className }: { status: Status; children?: ReactNode; className?: string }) {
  return <span className={cn("shrink-0 rounded-full px-2 py-0.5 text-[0.6875rem] font-semibold whitespace-nowrap", BADGE[status], className)}>{children ?? STATUS_WORD[status]}</span>;
}

export function KindIcon({ kind, className }: { kind: AssetKind; className?: string }) {
  const Icon = KIND_ICON[kind];
  return (
    <span className={cn("flex size-9 shrink-0 items-center justify-center rounded-lg border border-line bg-surface text-accent", className)} aria-hidden="true">
      <Icon className="size-[1.125rem]" strokeWidth={1.75} />
    </span>
  );
}

export function newId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return crypto.randomUUID();
  return `id-${Date.now().toString(36)}-${Math.random().toString(16).slice(2)}`;
}

/** How far a rule is to its limit, 0…1 (null when it has no period to measure against). */
export function progressOf(rule: MaintRule, state: RuleState): number | null {
  const parts: number[] = [];
  if (rule.everyKm && state.kmLeft !== null) parts.push(1 - state.kmLeft / rule.everyKm);
  if (rule.everyMonths && state.daysLeft !== null) parts.push(1 - state.daysLeft / (rule.everyMonths * 30.44));
  if (!parts.length) return null;
  return Math.min(1, Math.max(0.02, Math.max(...parts)));
}

export function Bar({ value, status }: { value: number; status: Status }) {
  return (
    <div className="mt-1.5 h-[5px] overflow-hidden rounded-full bg-line" aria-hidden="true">
      <div className={cn("h-full rounded-full", status === "overdue" ? "bg-danger" : status === "soon" ? "bg-warn" : "bg-accent")} style={{ width: `${Math.round(value * 100)}%` }} />
    </div>
  );
}

export function plural(n: number, one: string, few: string, many: string): string {
  const m = Math.abs(n) % 100;
  const d = m % 10;
  return m > 10 && m < 20 ? many : d === 1 ? one : d >= 2 && d <= 4 ? few : many;
}

export const MONTHS_SHORT = ["янв", "фев", "мар", "апр", "май", "июн", "июл", "авг", "сен", "окт", "ноя", "дек"];
export const MONTHS_FULL = ["Январь", "Февраль", "Март", "Апрель", "Май", "Июнь", "Июль", "Август", "Сентябрь", "Октябрь", "Ноябрь", "Декабрь"];

export function subtitle(asset: Asset): string {
  const kind = { car: "Автомобиль", device: "Техника", consumable: "Расходник", other: "Другое" }[asset.kind];
  return [kind, asset.plate || asset.model].filter(Boolean).join(" · ");
}
