import type { Asset, Task } from "../planner-types.ts";
import { groupKm, ruleState } from "./rules.ts";
import { limitsOf } from "./plan.ts";
import { subjectsOf, warrantyUntil } from "./warranty.ts";

const MONTHS_SHORT = ["янв.", "февр.", "марта", "апр.", "мая", "июня", "июля", "авг.", "сент.", "окт.", "нояб.", "дек."];

/** «5 нояб.» */
export function shortDate(iso: string): string {
  return `${Number(iso.slice(8, 10))} ${MONTHS_SHORT[Number(iso.slice(5, 7)) - 1]}`;
}

export type HonestDue = { text: string; tone: "danger" | "accent" | "muted" };

/**
 * The real deadline of an auto task in «Обслуживание» (1.18). The task's own
 * date is when it starts reminding («скоро»), not the deadline, so a red
 * «вчера» there was misleading. Shows «через 300 км», «до 5 нояб.», and is red
 * only when the rule itself is overdue.
 */
export function honestDue(task: Pick<Task, "maint" | "due">, assets: readonly Asset[], today: string): HonestDue {
  const ref = task.maint ?? "";
  const slash = ref.indexOf("/");
  const asset = slash > 0 ? assets.find((a) => a.id === ref.slice(0, slash)) : undefined;
  const rest = ref.slice(slash + 1);
  if (asset && rest.startsWith("warr:")) {
    const subject = subjectsOf(asset).find((s) => s.id === rest.slice(5));
    const until = subject ? warrantyUntil(subject) : null;
    if (until) return until < today ? { text: "гарантия закончилась", tone: "danger" } : { text: `до ${shortDate(until)}`, tone: until === today ? "accent" : "muted" };
  }
  const rule = asset?.rules.find((r) => r.id === rest);
  if (asset && rule) {
    const state = ruleState(rule, { today, km: typeof asset.km === "number" ? asset.km : null }, limitsOf(asset));
    const late: string[] = [];
    const left: string[] = [];
    if (state.kmLeft !== null) (state.kmLeft < 0 ? late : left).push(state.kmLeft < 0 ? `${groupKm(-state.kmLeft)} км` : `через ${groupKm(state.kmLeft)} км`);
    if (state.daysLeft !== null && state.nextDate) {
      if (state.daysLeft < 0) late.push(`с ${shortDate(state.nextDate)}`);
      else left.push(state.daysLeft === 0 ? "сегодня" : `до ${shortDate(state.nextDate)}`);
    }
    if (late.length) return { text: `просрочено: ${late.join(", ")}`, tone: "danger" };
    if (left.length) return { text: left.join(" или "), tone: state.daysLeft === 0 ? "accent" : "muted" };
  }
  // Mileage prompts, «что болит» and anything else: the reminder day, never alarming.
  if (!task.due) return { text: "без даты", tone: "muted" };
  if (task.due <= today) return { text: "пора", tone: "accent" };
  return { text: `с ${shortDate(task.due)}`, tone: "muted" };
}
