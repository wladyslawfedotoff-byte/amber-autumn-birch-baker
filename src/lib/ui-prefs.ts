/**
 * Device-only interface preferences: the mobile tab bar («Панель вкладок»)
 * and the calendar view. Pure helpers so they can be unit-tested.
 */

export type TabId =
  | "today"
  | "calendar"
  | "schedule"
  | "habits"
  | "focus"
  | "matrix"
  | "dates"
  | "checklist"
  | "inbox"
  | "projects"
  | "assist"
  | "settings";

export const TAB_OPTIONS: { id: TabId; label: string }[] = [
  { id: "today", label: "Сегодня" },
  { id: "calendar", label: "Календарь" },
  { id: "schedule", label: "Расписание" },
  { id: "habits", label: "Привычки" },
  { id: "focus", label: "Фокус" },
  { id: "matrix", label: "Матрица" },
  { id: "dates", label: "Даты" },
  { id: "checklist", label: "Все" },
  { id: "inbox", label: "Входящие" },
  { id: "projects", label: "Проекты" },
  { id: "assist", label: "Помощник" },
  { id: "settings", label: "Настройки" },
];

export const DEFAULT_TABS: TabId[] = ["today", "calendar", "schedule", "habits", "focus"];
export const MIN_TABS = 2;
export const MAX_TABS = 5;

const TAB_IDS = new Set<string>(TAB_OPTIONS.map((tab) => tab.id));

export function isTabId(value: unknown): value is TabId {
  return typeof value === "string" && TAB_IDS.has(value);
}

/** Saved value → a valid tab list (unique, known ids, 2…5 items); anything else → default. */
export function normalizeTabs(input: unknown): TabId[] {
  if (!Array.isArray(input)) return [...DEFAULT_TABS];
  const seen = new Set<TabId>();
  for (const item of input) if (isTabId(item)) seen.add(item);
  const tabs = [...seen].slice(0, MAX_TABS);
  return tabs.length >= MIN_TABS ? tabs : [...DEFAULT_TABS];
}

/** Turn a tab on or off; keeps the bar between MIN_TABS and MAX_TABS (returns the same list when not allowed). */
export function toggleTab(tabs: TabId[], id: TabId): TabId[] {
  if (tabs.includes(id)) return tabs.length <= MIN_TABS ? tabs : tabs.filter((tab) => tab !== id);
  return tabs.length >= MAX_TABS ? tabs : [...tabs, id];
}

/** Move a tab one place left (-1) or right (+1). */
export function moveTab(tabs: TabId[], id: TabId, dir: -1 | 1): TabId[] {
  const from = tabs.indexOf(id);
  const to = from + dir;
  if (from < 0 || to < 0 || to >= tabs.length) return tabs;
  const next = [...tabs];
  [next[from], next[to]] = [next[to] as TabId, next[from] as TabId];
  return next;
}

export type CalendarMode = "list" | "month" | "week" | "three" | "day";

export const CALENDAR_MODES: { id: CalendarMode; label: string; days: number }[] = [
  { id: "list", label: "Список", days: 14 },
  { id: "month", label: "Месяц", days: 0 },
  { id: "week", label: "Неделя", days: 7 },
  { id: "three", label: "3 дня", days: 3 },
  { id: "day", label: "День", days: 1 },
];

export function normalizeCalendarMode(value: unknown): CalendarMode {
  return CALENDAR_MODES.some((mode) => mode.id === value) ? (value as CalendarMode) : "month";
}

export function modeDays(mode: CalendarMode): number {
  return CALENDAR_MODES.find((item) => item.id === mode)?.days ?? 0;
}
