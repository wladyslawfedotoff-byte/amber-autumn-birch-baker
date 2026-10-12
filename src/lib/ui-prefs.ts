/**
 * Device-only interface preferences: «Навигация» (the mobile tab bar and the
 * side menu) and the calendar view. Pure helpers so they can be unit-tested.
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
  | "tomorrow"
  | "week"
  | "shared"
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
  { id: "tomorrow", label: "Завтра" },
  { id: "week", label: "7 дней" },
  { id: "shared", label: "Общие" },
  /** Not offered any more (the gear sits in the menu header); kept so an old bar with it stays valid. */
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

/** Drag-to-reorder in «Навигация»: put `id` at position `to`. */
export function placeTab(tabs: TabId[], id: TabId, to: number): TabId[] {
  const from = tabs.indexOf(id);
  if (from < 0) return tabs;
  const index = Math.max(0, Math.min(tabs.length - 1, Math.round(to)));
  if (index === from) return tabs;
  const next = tabs.filter((tab) => tab !== id);
  next.splice(index, 0, id);
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

/* ---- «Навигация»: where each section lives -------------------------------
 *
 * Every navigation item has one place: «Внизу» (the phone tab bar), «В меню»
 * (the side drawer) or «Скрыть». The tab bar keeps its own order in `tabBar`
 * (2…5 items, unchanged since 1.0, so existing devices keep their bar); the
 * drawer stores only what the user switched off in `drawerHidden`. Anything
 * that is neither in the bar nor hidden is in the menu — new items therefore
 * show up in the menu by default.
 */

export type NavId =
  | "today"
  | "calendar"
  | "schedule"
  | "habits"
  | "assist"
  | "focus"
  | "matrix"
  | "dates"
  | "checklist"
  | "inbox"
  | "tomorrow"
  | "week"
  | "shared"
  | "projects"
  | "lists"
  | "tags"
  | "pinned";

export type Placement = "bottom" | "menu" | "hidden";

export const PLACEMENTS: { id: Placement; label: string }[] = [
  { id: "bottom", label: "Внизу" },
  { id: "menu", label: "В меню" },
  { id: "hidden", label: "Скрыть" },
];

/** All items of «Навигация», in the order of the settings screen. `tab` — can sit in the bottom bar. */
export const NAV_ITEMS: { id: NavId; label: string; tab: boolean; group: "views" | "smart" | "groups" }[] = [
  { id: "today", label: "Сегодня", tab: true, group: "views" },
  { id: "calendar", label: "Календарь", tab: true, group: "views" },
  { id: "schedule", label: "Расписание", tab: true, group: "views" },
  { id: "habits", label: "Привычки", tab: true, group: "views" },
  { id: "assist", label: "Помощник", tab: true, group: "views" },
  { id: "focus", label: "Фокус", tab: true, group: "views" },
  { id: "matrix", label: "Матрица", tab: true, group: "views" },
  { id: "dates", label: "Даты", tab: true, group: "views" },
  { id: "checklist", label: "Все", tab: true, group: "smart" },
  { id: "inbox", label: "Входящие", tab: true, group: "smart" },
  { id: "tomorrow", label: "Завтра", tab: true, group: "smart" },
  { id: "week", label: "7 дней", tab: true, group: "smart" },
  { id: "shared", label: "Общие", tab: true, group: "smart" },
  { id: "projects", label: "Проекты", tab: true, group: "groups" },
  { id: "lists", label: "Списки", tab: false, group: "groups" },
  { id: "tags", label: "Теги", tab: false, group: "groups" },
  { id: "pinned", label: "Закреплённые", tab: false, group: "groups" },
];

const NAV_IDS = new Set<string>(NAV_ITEMS.map((item) => item.id));
const TAB_CAPABLE = new Set<string>(NAV_ITEMS.filter((item) => item.tab).map((item) => item.id));

export function isNavId(value: unknown): value is NavId {
  return typeof value === "string" && NAV_IDS.has(value);
}

export function canBeTab(id: string): boolean {
  return TAB_CAPABLE.has(id);
}

export type NavPrefs = { tabBar: TabId[]; drawerHidden: NavId[] };

/** Saved value → unique known ids; never hides what sits in the bar (an item has one place). */
export function normalizeHidden(input: unknown, tabBar: readonly string[] = []): NavId[] {
  if (!Array.isArray(input)) return [];
  const inBar = new Set(tabBar);
  const seen = new Set<NavId>();
  for (const item of input) if (isNavId(item) && !inBar.has(item)) seen.add(item);
  return [...seen];
}

export function placementOf(id: NavId, prefs: NavPrefs): Placement {
  if ((prefs.tabBar as readonly string[]).includes(id)) return "bottom";
  if (prefs.drawerHidden.includes(id)) return "hidden";
  return "menu";
}

/**
 * Move an item to another place. Keeps every rule of «Навигация»: the bar has
 * 2…5 items, only tab-capable items go there, an item is in one place only.
 * Returns the same object when the move is not allowed (so the UI can grey it out).
 */
export function setPlacement(prefs: NavPrefs, id: NavId, to: Placement): NavPrefs {
  const from = placementOf(id, prefs);
  if (from === to) return prefs;
  if (to === "bottom" && (!canBeTab(id) || prefs.tabBar.length >= MAX_TABS)) return prefs;
  if (from === "bottom" && prefs.tabBar.length <= MIN_TABS) return prefs;
  const tabBar = to === "bottom" ? [...prefs.tabBar, id as TabId] : prefs.tabBar.filter((tab) => tab !== id);
  const rest = prefs.drawerHidden.filter((item) => item !== id);
  const drawerHidden = to === "hidden" ? [...rest, id] : rest;
  return { tabBar, drawerHidden };
}

/** Is the move allowed? Same rules as setPlacement. */
export function canPlace(prefs: NavPrefs, id: NavId, to: Placement): boolean {
  return placementOf(id, prefs) === to || setPlacement(prefs, id, to) !== prefs;
}

/**
 * Shown in the side menu? On a phone the bar and the menu never repeat each
 * other. A desktop has no bar, so there the bar items stay in the sidebar too
 * (only «Скрыть» hides them).
 */
export function inDrawer(id: NavId, prefs: NavPrefs, phone: boolean): boolean {
  if (prefs.drawerHidden.includes(id)) return false;
  if (phone && (prefs.tabBar as readonly string[]).includes(id)) return false;
  return true;
}

export function drawerItems<T extends { id: string }>(items: T[], prefs: NavPrefs, phone: boolean): T[] {
  return items.filter((item) => !isNavId(item.id) || inDrawer(item.id, prefs, phone));
}

/* ---- side menu: groups, pins --------------------------------------------- */

export type DrawerTab = "lists" | "projects" | "tags";

export const DRAWER_TABS: { id: DrawerTab; label: string; search: string; add: string | null }[] = [
  { id: "lists", label: "Списки", search: "Найти список", add: "Новый список" },
  { id: "projects", label: "Проекты", search: "Найти проект", add: "Новый проект" },
  { id: "tags", label: "Теги", search: "Найти тег", add: null },
];

/** Search in a drawer group appears from this many items. */
export const DRAWER_SEARCH_FROM = 8;

export function normalizeDrawerTab(value: unknown): DrawerTab {
  return value === "projects" || value === "tags" ? value : "lists";
}

/** The remembered group if it is still on screen, else the first visible one (null — no groups at all). */
export function pickDrawerTab(saved: DrawerTab, visible: readonly DrawerTab[]): DrawerTab | null {
  if (visible.includes(saved)) return saved;
  return visible[0] ?? null;
}

/** «list:<id>» / «project:<id>». */
export type PinKey = `list:${string}` | `project:${string}`;

export function isPinKey(value: unknown): value is PinKey {
  return typeof value === "string" && /^(list|project):.+/.test(value);
}

export function normalizePins(input: unknown): PinKey[] {
  if (!Array.isArray(input)) return [];
  return [...new Set(input.filter(isPinKey))];
}

export function togglePin(pins: readonly PinKey[], key: PinKey): PinKey[] {
  return pins.includes(key) ? pins.filter((pin) => pin !== key) : [...pins, key];
}

/** Pins whose list / project still exists, in pin order. */
export function livePins(pins: readonly PinKey[], lists: readonly { id: string }[], projects: readonly { id: string }[]): PinKey[] {
  const ids = new Set([...lists.map((list) => `list:${list.id}`), ...projects.map((project) => `project:${project.id}`)]);
  return pins.filter((pin) => ids.has(pin));
}

/** Case-insensitive name filter for the drawer search. */
export function matchName(name: string, query: string): boolean {
  const q = query.trim().toLocaleLowerCase("ru");
  return q === "" || name.toLocaleLowerCase("ru").includes(q);
}

/**
 * Device prefs of «Навигация» from a saved state. 1.6 and older stored only
 * `tabBar`: it is kept as is (same tabs, same order), and with no
 * `drawerHidden` every other item lands in the menu, as before.
 */
export function migrateNav(saved: { tabBar?: unknown; drawerHidden?: unknown; drawerTab?: unknown; pins?: unknown }): NavPrefs & { drawerTab: DrawerTab; pins: PinKey[] } {
  const tabBar = normalizeTabs(saved.tabBar);
  return {
    tabBar,
    drawerHidden: normalizeHidden(saved.drawerHidden, tabBar),
    drawerTab: normalizeDrawerTab(saved.drawerTab),
    pins: normalizePins(saved.pins),
  };
}

/** Lists that can switch to the priority board (icon in the header). */
export function canBoard(view: string): boolean {
  return view === "inbox" || view === "tomorrow" || view === "week" || view.startsWith("list:") || view.startsWith("tag:");
}
