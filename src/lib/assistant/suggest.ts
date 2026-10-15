/**
 * Suggestion chips above the assistant's input, picked by the app from the
 * user's own data — no model call, no tokens. The assistant never writes
 * first: these are only buttons; a question is sent when one is tapped.
 */

export type Suggestion = {
  /** Stable id (tests, analytics-free keys). */
  id: string;
  /** Text on the chip. */
  label: string;
  /** What is sent to the assistant when tapped. */
  ask: string;
};

export type SuggestInput = {
  /** Open tasks with a date before today. */
  overdue: number;
  /** Open tasks for today (including overdue). */
  today: number;
  /** Open tasks without a list. */
  inbox: number;
  /** Local hour 0…23. */
  hour: number;
  /** Text in the input right now. */
  draft: string;
  /** Title of the project the assistant was opened from, if any. */
  project?: string | null;
  /** «Обслуживание»: cards with a rule overdue. */
  maintOverdue?: number;
};

export const MAX_SUGGESTIONS = 3;
/** A pasted text this long (or several lines) is worth turning into tasks. */
export const LONG_TEXT = 120;
export const EVENING_FROM = 18;

export const GENERAL: Suggestion[] = [
  { id: "plan", label: "Спланируй мой день", ask: "Спланируй мой день" },
  { id: "steps", label: "Разбей задачу на шаги", ask: "Разбей задачу на шаги" },
  { id: "overdue-check", label: "Что у меня просрочено?", ask: "Что у меня просрочено?" },
];

export function isLongText(draft: string): boolean {
  const text = draft.trim();
  return text.length >= LONG_TEXT || text.split(/\n+/).filter((line) => line.trim()).length >= 3;
}

/** Up to MAX_SUGGESTIONS chips: the situational ones first, then general ones to fill up. */
export function suggestChips(input: SuggestInput): Suggestion[] {
  const out: Suggestion[] = [];
  if (isLongText(input.draft)) {
    out.push({ id: "from-text", label: "Сделать из этого задачи", ask: `Сделай задачи из этого текста:\n${input.draft.trim()}` });
  }
  if (input.project) {
    out.push({ id: "project-steps", label: "Разбей проект на шаги", ask: `Разбей проект «${input.project}» на шаги` });
  }
  if ((input.maintOverdue ?? 0) > 0) {
    out.push({ id: "maint", label: `Обслуживание: просрочено (${input.maintOverdue})`, ask: "Что по обслуживанию просрочено?" });
  }
  if (input.overdue > 0) {
    out.push({ id: "overdue", label: `Перенести просроченное (${input.overdue})`, ask: "Что у меня просрочено? Предложи, на когда перенести." });
  }
  if (input.today === 0 && input.inbox > 0) {
    out.push({ id: "inbox", label: `Разобрать входящие (${input.inbox})`, ask: "Помоги разобрать «Входящие»: что сделать сегодня, что запланировать, что в какой список." });
  }
  if (input.hour >= EVENING_FROM) {
    out.push({ id: "evening", label: "Что перенести на завтра?", ask: "Что из сегодняшнего перенести на завтра?" });
  }
  for (const chip of GENERAL) {
    if (out.length >= MAX_SUGGESTIONS) break;
    // «Что у меня просрочено?» repeats «Перенести просроченное».
    if (chip.id === "overdue-check" && out.some((item) => item.id === "overdue")) continue;
    if (chip.id === "steps" && out.some((item) => item.id === "project-steps")) continue;
    out.push(chip);
  }
  return out.slice(0, MAX_SUGGESTIONS);
}
