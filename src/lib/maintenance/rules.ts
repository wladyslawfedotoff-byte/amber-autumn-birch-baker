/**
 * «Обслуживание»: when is a rule due. Pure (no DOM, no store) so the app, the
 * assistant server and the tests share one calculation.
 *
 * A rule may combine three kinds of deadline, whichever comes first:
 *  - by mileage:  every `everyKm` km since the last time (or since the rule was added);
 *  - by interval: every `everyMonths` months since the last time;
 *  - by date:     a fixed month (+ optional day), repeating every year or one-off.
 * Dates are ISO «YYYY-MM-DD» in the user's local calendar.
 */

export type MaintRule = {
  id: string;
  title: string;
  everyKm?: number;
  everyMonths?: number;
  /** 1…12. With `fixedDay` the exact day; without it «в течение месяца» (soon from the 1st, due by the last day). */
  fixedMonth?: number;
  fixedDay?: number;
  /** Set = one-off in that year; missing = every year. */
  fixedYear?: number;
  /** The day the rule was added: counting starts here when it was never done. */
  since: string;
  /** Mileage when it was added (filled when the car's mileage becomes known). */
  sinceKm?: number | null;
  lastDoneAt?: string | null;
  lastDoneKm?: number | null;
  /** Cycle key a reminder task was already made for (see plan.ts). */
  notified?: string;
  updatedAt?: number;
};

export type Status = "ok" | "soon" | "overdue";

export type Thresholds = { soonDays: number; soonKm: number };
export const DEFAULT_SOON_DAYS = 14;
export const DEFAULT_SOON_KM = 500;
/** A fixed date counts as done when the work was done up to this many days before it. */
export const FIXED_GRACE_DAYS = 60;

export type RuleState = {
  status: Status;
  /** Date deadline of the nearest open component (ISO) or null. */
  nextDate: string | null;
  /** First day it counts as «скоро» for a date component (ISO) or null. */
  soonFrom: string | null;
  nextKm: number | null;
  daysLeft: number | null;
  kmLeft: number | null;
  /** One-off fixed date already done: nothing left. */
  finished: boolean;
  /** Lower = more urgent (overdue is negative). */
  urgency: number;
};

const ISO = /^\d{4}-\d{2}-\d{2}$/;

export function isIso(value: unknown): value is string {
  if (typeof value !== "string" || !ISO.test(value)) return false;
  const d = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

function toDay(iso: string): number {
  return Math.floor(Date.parse(`${iso}T00:00:00Z`) / 86_400_000);
}
function fromDay(day: number): string {
  return new Date(day * 86_400_000).toISOString().slice(0, 10);
}
export function diffDays(from: string, to: string): number {
  return toDay(to) - toDay(from);
}
export function addDays(iso: string, days: number): string {
  return fromDay(toDay(iso) + days);
}
export function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}
/** Jan 31 + 1 month = Feb 28/29 (the day is clamped, never spills into March). */
export function addMonths(iso: string, months: number): string {
  const y = Number(iso.slice(0, 4));
  const m = Number(iso.slice(5, 7)) - 1;
  const d = Number(iso.slice(8, 10));
  const total = y * 12 + m + months;
  const year = Math.floor(total / 12);
  const month = total - year * 12 + 1;
  const day = Math.min(d, daysInMonth(year, month));
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

/** Deadline and first «soon» day of one occurrence of a fixed date. */
function occurrence(rule: MaintRule, year: number): { due: string; from: string } | null {
  const month = rule.fixedMonth;
  if (!month || month < 1 || month > 12) return null;
  const last = daysInMonth(year, month);
  if (rule.fixedDay) {
    const day = Math.min(Math.max(1, Math.floor(rule.fixedDay)), last);
    const due = `${year}-${pad(month)}-${pad(day)}`;
    return { due, from: due };
  }
  return { due: `${year}-${pad(month)}-${pad(last)}`, from: `${year}-${pad(month)}-01` };
}

function positive(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

/** The next occurrence of the fixed date that is not done yet; "finished" = a one-off already done; null = none. */
export function nextFixed(rule: MaintRule): { due: string; from: string } | null | "finished" {
  if (!rule.fixedMonth) return null;
  const start = isIso(rule.since) ? rule.since : "1970-01-01";
  const done = rule.lastDoneAt && isIso(rule.lastDoneAt) ? rule.lastDoneAt : null;
  const covered = (o: { from: string }) => done !== null && done >= addDays(o.from, -FIXED_GRACE_DAYS);
  if (rule.fixedYear) {
    const o = occurrence(rule, rule.fixedYear);
    if (!o) return null;
    return covered(o) ? "finished" : o;
  }
  const first = Number(start.slice(0, 4));
  const end = Math.max(first, done ? Number(done.slice(0, 4)) : first) + 2;
  for (let year = first; year <= end; year++) {
    const o = occurrence(rule, year);
    if (!o) return null;
    // Before the rule existed it is not our deadline.
    if (o.due < start || covered(o)) continue;
    return o;
  }
  return null;
}

export function ruleState(rule: MaintRule, now: { today: string; km: number | null }, limits: Thresholds): RuleState {
  const { today } = now;
  let status: Status = "ok";
  const raise = (to: Status) => {
    if (to === "overdue" || (to === "soon" && status === "ok")) status = to;
  };
  let nextDate: string | null = null;
  let soonFrom: string | null = null;
  let finished = false;
  const candidates: { due: string; from: string }[] = [];

  const base = rule.lastDoneAt && isIso(rule.lastDoneAt) ? rule.lastDoneAt : isIso(rule.since) ? rule.since : null;
  if (positive(rule.everyMonths) && base) {
    const due = addMonths(base, Math.floor(rule.everyMonths));
    candidates.push({ due, from: addDays(due, -limits.soonDays) });
  }
  if (rule.fixedMonth) {
    const fixed = nextFixed(rule);
    if (fixed === "finished") finished = !candidates.length && !positive(rule.everyKm);
    else if (fixed) candidates.push({ due: fixed.due, from: fixed.from === fixed.due ? addDays(fixed.due, -limits.soonDays) : fixed.from });
  }
  candidates.sort((a, b) => (a.due < b.due ? -1 : a.due > b.due ? 1 : 0));
  // The earliest «soon» start decides the trigger; the earliest deadline is shown.
  const first = candidates[0];
  let daysLeft: number | null = null;
  if (first) {
    nextDate = first.due;
    soonFrom = candidates.reduce((min, c) => (c.from < min ? c.from : min), first.from);
    daysLeft = diffDays(today, first.due);
    if (daysLeft < 0) raise("overdue");
    else if (today >= soonFrom) raise("soon");
  }

  let nextKm: number | null = null;
  let kmLeft: number | null = null;
  if (positive(rule.everyKm)) {
    const baseKm = rule.lastDoneKm ?? rule.sinceKm ?? null;
    if (typeof baseKm === "number") {
      nextKm = baseKm + rule.everyKm;
      if (typeof now.km === "number") {
        kmLeft = nextKm - now.km;
        if (kmLeft < 0) raise("overdue");
        else if (kmLeft <= limits.soonKm) raise("soon");
      }
    }
  }

  // Comparable «days»: 50 km ≈ one day (only used to sort).
  const parts = [daysLeft, kmLeft === null ? null : kmLeft / 50].filter((v): v is number => v !== null);
  const urgency = parts.length ? Math.min(...parts) : finished ? 99_999 : 9_999;
  return { status, nextDate, soonFrom, nextKm, daysLeft, kmLeft, finished, urgency };
}

/* ---- words ---------------------------------------------------------------- */

const MONTHS_GEN = ["января", "февраля", "марта", "апреля", "мая", "июня", "июля", "августа", "сентября", "октября", "ноября", "декабря"];
const MONTHS_PREP = ["январе", "феврале", "марте", "апреле", "мае", "июне", "июле", "августе", "сентябре", "октябре", "ноябре", "декабре"];

export function groupKm(km: number): string {
  return Math.round(km).toLocaleString("ru-RU").replace(/\u00a0|\u202f/g, " ");
}

/** «3 дн.», «2 нед.», «5 мес.» for a number of days (≥ 0). */
export function spanLabel(days: number): string {
  if (days < 14) return `${days} дн.`;
  if (days < 70) return `${Math.round(days / 7)} нед.`;
  return `${Math.round(days / 30.4)} мес.`;
}

export function dateWords(iso: string): string {
  return `${Number(iso.slice(8))} ${MONTHS_GEN[Number(iso.slice(5, 7)) - 1]}`;
}

/** «~1 200 км или 3 нед.», «просрочено на 400 км», «в декабре». */
export function stateText(rule: MaintRule, state: RuleState): string {
  if (state.finished) return "сделано";
  const overdue: string[] = [];
  const left: string[] = [];
  if (state.kmLeft !== null) (state.kmLeft < 0 ? overdue : left).push(`${groupKm(Math.abs(state.kmLeft))} км`);
  if (state.daysLeft !== null) {
    if (state.daysLeft < 0) overdue.push(spanLabel(-state.daysLeft));
    else if (rule.fixedMonth && !rule.fixedDay && state.soonFrom && state.status !== "ok" && state.nextDate) left.push(`до ${dateWords(state.nextDate)}`);
    else left.push(state.daysLeft === 0 ? "сегодня" : spanLabel(state.daysLeft));
  }
  if (overdue.length) return `просрочено на ${overdue.join(" или ")}`;
  if (!left.length) return state.nextKm === null && state.nextDate === null && positiveKm(rule) ? "нужен пробег" : "без срока";
  if (rule.fixedMonth && !rule.fixedDay && state.status === "ok" && state.nextDate) {
    const month = Number(state.nextDate.slice(5, 7));
    return `в ${MONTHS_PREP[month - 1]} ${state.nextDate.slice(0, 4)}`;
  }
  const approx = state.kmLeft !== null && state.kmLeft >= 0 ? "~" : "";
  return `${approx}${left.join(" или ")}`;
}

function positiveKm(rule: MaintRule): boolean {
  return positive(rule.everyKm);
}

/** «каждые 10 000 км или 12 мес.», «в декабре, каждый год». */
export function ruleLine(rule: MaintRule): string {
  const parts: string[] = [];
  if (positive(rule.everyKm)) parts.push(`каждые ${groupKm(rule.everyKm)} км`);
  if (positive(rule.everyMonths)) parts.push(`каждые ${rule.everyMonths} мес.`);
  if (rule.fixedMonth) {
    const when = rule.fixedDay ? `${rule.fixedDay} ${MONTHS_GEN[rule.fixedMonth - 1]}` : `в ${MONTHS_PREP[rule.fixedMonth - 1]}`;
    parts.push(rule.fixedYear ? `${when} ${rule.fixedYear}` : `${when}, каждый год`);
  }
  const line = parts.join(" или ");
  return parts.length > 1 ? `${line} — что раньше` : line;
}

/** The worst status of several. */
export function worst(a: Status, b: Status): Status {
  const rank: Record<Status, number> = { ok: 0, soon: 1, overdue: 2 };
  return rank[b] > rank[a] ? b : a;
}
