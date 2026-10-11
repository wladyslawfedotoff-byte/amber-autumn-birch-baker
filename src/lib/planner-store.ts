import { create, type StateCreator } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { syncNow } from "@/lib/sync/clock";
import { COLLECTIONS, emptyTombstones, stampCollection, type Tombstones } from "@/lib/sync/merge";
import { cleanDates, firstChosenDate, shiftIso, todayIso } from "@/lib/dates";
import { currentLogin } from "@/lib/use-capabilities";
import { parseQuick } from "@/lib/quick-add";
import { stageRange } from "@/lib/stage-range";
import { clearDate, clearTime, duplicateTask as duplicateTaskData, listInNotes, splitLines } from "@/lib/task-tools";
import { isAccent, type AccentId } from "@/lib/accents";
import { DEFAULT_TABS, normalizeCalendarMode, normalizeTabs, type CalendarMode, type TabId } from "@/lib/ui-prefs";
import { sectionOf, sortHabits, tapDay, withEntry } from "@/lib/habit-plan";
import { normalizeArchiveDays, restoreFromArchive, toggleTaskDone, undoRepeatTick } from "@/lib/task-done";
import type {
  FocusClock,
  Habit,
  HabitEntry,
  Milestone,
  MilestoneItem,
  MilestoneItemKind,
  MilestoneKind,
  Priority,
  Project,
  ProjectStage,
  Task,
  TaskList,
  ThemeMode,
} from "@/lib/planner-types";

type MilestoneExtra = Partial<Pick<Milestone, "reminders" | "icon" | "color" | "showAge" | "showInToday" | "notes">>;
type HabitPatch = Partial<Omit<Habit, "id" | "checks" | "log" | "updatedAt" | "owner" | "updatedBy" | "aclAt" | "createdAt">>;
type HabitDayPatch = Partial<Omit<HabitEntry, "id" | "updatedAt">> & { done?: boolean };

type NewTask = {
  title: string;
  listId: string | null;
  due: string | null;
  important?: boolean;
  urgent?: boolean;
  priority?: Priority;
  notes?: string;
  startAt?: string | null;
  endAt?: string | null;
  remindAt?: string | null;
  tags?: string[];
  /** Quick add: the user dropped the recognised date / time («без даты», «без времени»). */
  noDate?: boolean;
  noTime?: boolean;
};

export function breakFor(workLen: number): number {
  return workLen >= 50 * 60 ? 10 * 60 : 5 * 60;
}

export function freshFocus(): FocusClock {
  return {
    mode: "work",
    workLen: 25 * 60,
    seconds: 25 * 60,
    running: false,
    endsAt: null,
    taskId: null,
    note: null,
  };
}

type PlannerState = {
  lists: TaskList[];
  tasks: Task[];
  habits: Habit[];
  milestones: Milestone[];
  projects: Project[];
  workStart: string;
  workEnd: string;
  focus: FocusClock;
  theme: ThemeMode;
  accent: AccentId;
  pomoDate: string;
  pomoCount: number;
  remindAck: Record<string, string>;
  /** Deleted ids per collection (sync tombstones), pruned by the server after 30 days. */
  tombstones: Tombstones;
  /** Sync stamp of workStart/workEnd/archiveDays. */
  settingsUpdatedAt: number;
  /** «Убирать в архив через» N days (0 = never); synced with the settings. */
  archiveDays: number;
  /** «Расписание»: how many days to show (this device only). */
  scheduleDays: number;
  /** «Готово» group at the bottom of lists is folded (this device only). */
  doneFolded: boolean;
  /** «Панель вкладок»: the tabs of the bottom bar on a phone (this device only). */
  tabBar: TabId[];
  /** «Календарь»: Список / Месяц / Неделя / 3 дня / День (this device only). */
  calendarMode: CalendarMode;
  /** «Номера недель» in the month grid (this device only). */
  weekNumbers: boolean;
  setTabBar: (tabs: TabId[]) => void;
  setCalendarMode: (mode: CalendarMode) => void;
  setWeekNumbers: (on: boolean) => void;
  setArchiveDays: (days: number) => void;
  setScheduleDays: (days: number) => void;
  setDoneFolded: (folded: boolean) => void;
  /** «Отменить» on a ticked repeating task: back to the date it was ticked for. */
  undoRepeat: (id: string) => void;
  /** «Вернуть» from the archive. */
  restoreTask: (id: string) => void;
  /** «Очистить архив»: delete these tasks. */
  deleteTasks: (ids: string[]) => void;
  setMilestoneMembers: (id: string, members: string[]) => void;
  addMilestoneItem: (id: string, kind: MilestoneItemKind, title: string, extra?: { link?: string | null; price?: string | null }) => void;
  updateMilestoneItem: (id: string, itemId: string, patch: Partial<Omit<MilestoneItem, "id">>) => void;
  deleteMilestoneItem: (id: string, itemId: string) => void;
  addTask: (input: NewTask) => string;
  updateTask: (id: string, patch: Partial<Omit<Task, "id">>) => void;
  toggleTask: (id: string) => void;
  /** «Без времени»: keep the date, drop start/end/alarm (all-day). */
  clearTaskTime: (id: string) => void;
  /** «Без даты»: drop date and time (and the repeat). */
  clearTaskDate: (id: string) => void;
  /** «Выбранные даты»: replace the chosen dates (due follows the first one from today). */
  setRepeatDates: (id: string, dates: string[]) => void;
  /** «Совместная»: who else sees and edits the task (logins). */
  setTaskMembers: (id: string, members: string[]) => void;
  /** «Назначить»: who should do it (null = nobody). */
  assignTask: (id: string, login: string | null) => void;
  /** Share a whole list: its tasks are visible to these logins too. */
  setListMembers: (id: string, members: string[]) => void;
  deleteTask: (id: string) => void;
  /** One subtask per line (a pasted list becomes several). */
  addSubtask: (taskId: string, title: string) => void;
  /** «Дублировать»: copy right after the original; returns the copy's id. */
  duplicateTask: (id: string, due?: string | null) => string | null;
  /** Lines of the notes that look like a list («- молоко») become subtasks. */
  notesToSubtasks: (taskId: string) => number;
  toggleSubtask: (taskId: string, subId: string) => void;
  deleteSubtask: (taskId: string, subId: string) => void;
  addList: (name: string) => string;
  renameList: (id: string, name: string) => void;
  deleteList: (id: string) => void;
  /** Returns the new habit's id (null for an empty name). */
  addHabit: (name: string, extra?: HabitPatch) => string | null;
  updateHabit: (id: string, patch: HabitPatch) => void;
  /** One tap on a day: toggles a simple habit, adds a step to an amount habit. */
  toggleHabit: (id: string, date: string) => void;
  /** Edit one day of the log: done / skip / fail, amount, note, mood (also past days). */
  setHabitDay: (id: string, date: string, patch: HabitDayPatch) => void;
  /** Move a habit up (-1) or down (+1) inside its section. */
  moveHabit: (id: string, delta: -1 | 1) => void;
  /** Drag-to-reorder: the ids of one section in their new order. */
  setHabitOrder: (ids: string[]) => void;
  /** Habit page → ⋯ → «Фокус»: start a work session linked to the habit. */
  focusHabit: (id: string) => void;
  setFocusHabit: (id: string | null) => void;
  deleteHabit: (id: string) => void;
  addMilestone: (input: {
    title: string;
    date: string;
    yearly: boolean;
    kind: MilestoneKind;
    remindAt?: string | null;
    noYear?: boolean;
    remindDays?: number;
  } & MilestoneExtra) => string | null;
  updateMilestone: (
    id: string,
    patch: Partial<Pick<Milestone, "title" | "date" | "yearly" | "kind" | "noYear" | "remindAt" | "remindDays" | "notes">> & MilestoneExtra,
  ) => void;
  deleteMilestone: (id: string) => void;
  addProject: (title: string) => string;
  updateProject: (id: string, patch: { title?: string; start?: string | null; end?: string | null }) => void;
  deleteProject: (id: string) => void;
  addStage: (projectId: string, title: string) => void;
  renameStage: (projectId: string, stageId: string, title: string) => void;
  placeStage: (projectId: string, stageId: string, start: string, end: string) => void;
  deleteStage: (projectId: string, stageId: string) => void;
  addCard: (projectId: string, stageId: string, title: string) => void;
  moveCard: (projectId: string, cardId: string, toStageId: string) => void;
  deleteCard: (projectId: string, cardId: string) => void;
  sendTaskToProject: (taskId: string, projectId: string) => void;
  setWorkHours: (start: string, end: string) => void;
  ackReminder: (key: string, stamp: string) => void;
  setTheme: (theme: ThemeMode) => void;
  setAccent: (accent: AccentId) => void;
  bumpPomo: () => void;
  startFocus: () => void;
  pauseFocus: () => void;
  resetFocus: () => void;
  setWorkLen: (workLen: number) => void;
  setFocusTask: (taskId: string | null) => void;
  tickFocus: () => boolean;
};

function uid(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `id-${Date.now().toString(36)}-${Math.random().toString(16).slice(2)}`;
}

function seed(): Pick<
  PlannerState,
  | "lists"
  | "tasks"
  | "habits"
  | "milestones"
  | "projects"
  | "workStart"
  | "workEnd"
  | "focus"
  | "theme"
  | "accent"
  | "pomoDate"
  | "pomoCount"
  | "remindAck"
  | "tombstones"
  | "settingsUpdatedAt"
  | "archiveDays"
  | "scheduleDays"
  | "doneFolded"
  | "tabBar"
  | "calendarMode"
  | "weekNumbers"
> {
  const today = todayIso();
  const stamp = Date.now();
  const task = (
    partial: Omit<Task, "notes" | "tags" | "subtasks" | "completedAt" | "done"> &
      Partial<Pick<Task, "notes" | "tags" | "subtasks" | "completedAt" | "done">>,
  ): Task => ({
    notes: "",
    tags: [],
    subtasks: [],
    done: false,
    completedAt: null,
    important: false,
    urgent: false,
    remindAt: null,
    startAt: null,
    endAt: null,
    ...partial,
  });

  return {
    theme: "light",
    accent: "ink",
    pomoDate: today,
    pomoCount: 1,
    remindAck: {},
    tombstones: emptyTombstones(),
    settingsUpdatedAt: 0,
    archiveDays: 7,
    scheduleDays: 1,
    doneFolded: false,
    tabBar: [...DEFAULT_TABS],
    calendarMode: "month",
    weekNumbers: false,
    lists: [
      { id: "work", name: "Работа" },
      { id: "home", name: "Дом" },
      { id: "study", name: "Учёба" },
    ],
    habits: [
      {
        id: "water",
        name: "Вода",
        checks: [shiftIso(today, -1), shiftIso(today, -2), shiftIso(today, -3)],
        why: "Стакан сразу после подъёма",
        remindAt: null,
        reminders: ["09:00", "13:00", "18:00"],
        icon: "💧",
        color: "peacock",
        goal: 8,
        unit: "стаканов",
        section: "morning",
        log: [{ id: today, amount: 3 }],
        order: 1,
      },
      {
        id: "walk",
        name: "Прогулка",
        checks: [shiftIso(today, -1), shiftIso(today, -2)],
        why: "20 минут без телефона",
        remindAt: null,
        icon: "🚶",
        color: "sage",
        freq: { kind: "weekly", times: 4 },
        section: "afternoon",
        order: 2,
      },
      {
        id: "read",
        name: "Чтение",
        checks: [shiftIso(today, -1), today],
        why: "Десять страниц перед сном",
        remindAt: "21:30",
        icon: "📖",
        color: "grape",
        section: "evening",
        goalDays: 21,
        startDate: shiftIso(today, -1),
        order: 3,
      },
    ],
    milestones: [
      {
        id: "m-bday",
        title: "День рождения друга",
        date: `1991${shiftIso(today, 4).slice(4)}`,
        yearly: true,
        kind: "birthday",
        remindAt: "09:00",
        remindDays: 3,
        reminders: [0, 3],
        showInToday: 3,
        items: [
          { id: "mi-1", kind: "gift", title: "Книга по фотографии", done: false, link: null, price: "1 800 ₽" },
          { id: "mi-2", kind: "todo", title: "Забронировать столик", done: false },
        ],
      },
      {
        id: "m-ann",
        title: "Годовщина свадьбы",
        date: `2016${shiftIso(today, 18).slice(4)}`,
        yearly: true,
        kind: "anniversary",
        remindAt: "09:00",
        remindDays: 7,
        items: [{ id: "mi-3", kind: "idea", title: "Ужин там же, где было первое свидание", done: false }],
      },
      {
        id: "m-ny",
        title: "Новый год",
        date: "2000-12-31",
        yearly: true,
        kind: "holiday",
        remindAt: "10:00",
        remindDays: 7,
        reminders: [0, 7],
        items: [{ id: "mi-4", kind: "buy", title: "Ёлка", done: false, link: null, price: "4 000 ₽" }],
      },
      {
        id: "m-trip",
        title: "Отпуск",
        date: shiftIso(today, 45),
        yearly: false,
        kind: "countdown",
        remindAt: null,
        items: [],
      },
    ],
    focus: freshFocus(),
    workStart: "09:00",
    workEnd: "18:00",
    projects: [
      {
        id: "p-deck",
        title: "Презентация",
        start: shiftIso(today, -1),
        end: shiftIso(today, 6),
        stages: [
          {
            id: "st-plan",
            title: "План",
            start: shiftIso(today, -1),
            end: shiftIso(today, 1),
            cards: [
              { id: "c-nums", title: "Собрать цифры" },
              { id: "c-shape", title: "Структура слайдов" },
            ],
          },
          { id: "st-work", title: "В работе", start: shiftIso(today, 2), end: shiftIso(today, 4), cards: [{ id: "c-draft", title: "Черновик" }] },
          { id: "st-done", title: "Готово", start: shiftIso(today, 5), end: shiftIso(today, 6), cards: [] },
        ],
      },
    ],
    tasks: [
      task({
        id: "t-draft",
        title: "Сдать черновик презентации",
        listId: "work",
        priority: 3,
        due: shiftIso(today, -1),
        notes: "Коротко: проблема, решение, срок. Без лишних слайдов.",
        tags: ["жду"],
        important: true,
        urgent: true,
        remindAt: "10:00",
        createdAt: stamp - 86_400_000,
      }),
      task({
        id: "t-call",
        title: "Созвон с командой",
        listId: "work",
        priority: 3,
        due: today,
        tags: ["звонок"],
        notes: "Повестка: статус, блокеры, кто что берёт на неделю.",
        important: true,
        urgent: true,
        remindAt: "09:00",
        startAt: "09:00",
        endAt: "10:00",
        createdAt: stamp - 72_000_000,
      }),
      task({
        id: "t-shop",
        title: "Купить продукты",
        listId: "home",
        priority: 2,
        due: today,
        important: false,
        urgent: true,
        remindAt: "19:30",
        startAt: "19:00",
        endAt: "19:45",
        subtasks: [
          { id: "s1", title: "Молоко", done: true },
          { id: "s2", title: "Хлеб", done: false },
          { id: "s3", title: "Фрукты", done: false },
        ],
        createdAt: stamp - 50_000_000,
      }),
      task({
        id: "t-letter",
        title: "Письмо клиенту",
        listId: "work",
        priority: 2,
        due: today,
        important: true,
        urgent: false,
        startAt: "09:30",
        endAt: "10:30",
        remindAt: "09:30",
        createdAt: stamp - 18_000_000,
      }),
      task({
        id: "t-notes",
        title: "Конспект главы",
        listId: "study",
        priority: 1,
        due: today,
        important: true,
        urgent: false,
        startAt: "11:00",
        endAt: "12:30",
        createdAt: stamp - 20_000_000,
      }),
      task({
        id: "t-mail",
        title: "Разобрать почту",
        listId: "work",
        priority: 0,
        due: today,
        done: true,
        completedAt: stamp - 3_600_000,
        createdAt: stamp - 90_000_000,
      }),
      task({
        id: "t-doctor",
        title: "Записаться к врачу",
        listId: null,
        priority: 2,
        due: shiftIso(today, 1),
        important: true,
        urgent: false,
        createdAt: stamp - 10_000_000,
      }),
      task({
        id: "t-net",
        title: "Оплатить интернет",
        listId: "home",
        priority: 1,
        due: shiftIso(today, 2),
        createdAt: stamp - 9_000_000,
      }),
      task({
        id: "t-study",
        title: "Разобрать заметки с лекции",
        listId: "study",
        priority: 0,
        due: shiftIso(today, 3),
        createdAt: stamp - 8_000_000,
      }),
      task({
        id: "t-plan",
        title: "План на следующую неделю",
        listId: "work",
        priority: 1,
        due: shiftIso(today, 5),
        important: true,
        urgent: false,
        repeat: "week",
        createdAt: stamp - 7_000_000,
      }),
      task({
        id: "t-idea",
        title: "Идея для побочного проекта",
        listId: null,
        priority: 0,
        due: null,
        notes: "Короткий список: для кого, зачем, что можно выкинуть.",
        createdAt: stamp - 6_000_000,
      }),
    ],
  };
}

const memoryStorage = {
  getItem: () => null,
  setItem: () => undefined,
  removeItem: () => undefined,
};

function fillRemindAt<T extends { id: string; remindAt?: string | null }>(
  saved: T[] | undefined,
  seedRows: T[],
): T[] {
  if (!saved) return seedRows;
  const fromSeed = new Map(seedRows.map((row) => [row.id, row.remindAt]));
  return saved.map((row) => {
    if (row.remindAt !== undefined) return row;
    const fallback = fromSeed.get(row.id);
    return fallback === undefined ? { ...row, remindAt: null } : { ...row, remindAt: fallback };
  });
}

function fillTasks(saved: Task[] | undefined, seedRows: Task[]): Task[] {
  const filled = fillRemindAt(saved, seedRows);
  return filled.map((row) => ({
    ...row,
    startAt: row.startAt ?? null,
    endAt: row.endAt ?? null,
    tags: row.tags ?? [],
    subtasks: row.subtasks ?? [],
  }));
}

type Synced = (typeof COLLECTIONS)[number];
type PersistedCreator = StateCreator<PlannerState, [["zustand/persist", unknown]], []>;

/**
 * Stamp local edits for sync: every action goes through this `set`, so changed
 * or new entities get `updatedAt` and removed ones become tombstones without
 * touching each action. Remote merges use `usePlanner.setState` directly and
 * are never re-stamped; persist's rehydrate bypasses it too.
 */
export function stampPatch(prev: PlannerState, patch: Partial<PlannerState>, now = syncNow()): Partial<PlannerState> {
  let out: Partial<PlannerState> = patch;
  let tombstones: Tombstones | null = null;
  for (const key of COLLECTIONS as readonly Synced[]) {
    const next = patch[key] as { id: string; updatedAt?: number }[] | undefined;
    const before = (prev[key] ?? []) as { id: string; updatedAt?: number }[];
    if (next === undefined || next === before) continue;
    const base: Tombstones = tombstones ?? prev.tombstones ?? emptyTombstones();
    const prevTombs: Record<string, number> = base[key] ?? {};
    const result = stampCollection(before, next, prevTombs, now, key);
    if (out === patch) out = { ...patch };
    (out as Record<string, unknown>)[key] = result.items;
    if (result.tombs !== prevTombs) {
      tombstones = { ...base, [key]: result.tombs };
    }
  }
  if (tombstones) {
    if (out === patch) out = { ...patch };
    out.tombstones = tombstones;
  }
  const hoursChanged =
    (patch.workStart !== undefined && patch.workStart !== prev.workStart) ||
    (patch.workEnd !== undefined && patch.workEnd !== prev.workEnd) ||
    (patch.archiveDays !== undefined && patch.archiveDays !== prev.archiveDays);
  if (hoursChanged) {
    if (out === patch) out = { ...patch };
    out.settingsUpdatedAt = Math.max(now, (prev.settingsUpdatedAt ?? 0) + 1);
  }
  return out;
}

function stamped(config: PersistedCreator): PersistedCreator {
  return (set, get, api) => {
    const stampedSet = ((partial: unknown, replace?: boolean) => {
      const prev = get();
      const patch = (typeof partial === "function" ? (partial as (s: PlannerState) => Partial<PlannerState>)(prev) : partial) as Partial<PlannerState>;
      (set as (p: Partial<PlannerState>, r?: boolean) => void)(stampPatch(prev, patch ?? {}), replace);
    }) as typeof set;
    return config(stampedSet, get, api);
  };
}

export const usePlanner = create<PlannerState>()(
  persist(
    stamped((set, get) => ({
      ...seed(),
      addTask: (input) => {
        const parsed = parseQuick(input.title);
        const title = parsed.title.trim();
        const id = uid();
        if (!title) return id;
        const timed = parsed.startAt != null;
        const task: Task = {
          id,
          title,
          notes: input.notes ?? "",
          listId: input.listId,
          done: false,
          priority: input.priority ?? 0,
          due: parsed.due ?? input.due,
          tags: input.tags ?? [],
          subtasks: [],
          createdAt: Date.now(),
          completedAt: null,
          important: input.important ?? false,
          urgent: input.urgent ?? false,
          remindAt: timed ? parsed.startAt : (input.remindAt ?? null),
          startAt: timed ? parsed.startAt : (input.startAt ?? null),
          endAt: timed ? parsed.endAt : (input.endAt ?? null),
        };
        const final = input.noDate ? clearDate(task) : input.noTime ? clearTime(task) : task;
        set((s) => ({ tasks: [final, ...s.tasks] }));
        return id;
      },
      updateTask: (id, patch) =>
        set((s) => ({
          tasks: s.tasks.map((t) => (t.id === id ? { ...t, ...patch } : t)),
        })),
      toggleTask: (id) =>
        set((s) => ({
          tasks: s.tasks.map((t) =>
            t.id === id ? toggleTaskDone(t, { me: currentLogin() || null, today: todayIso(), now: syncNow() }) : t,
          ),
        })),
      clearTaskTime: (id) => set((s) => ({ tasks: s.tasks.map((t) => (t.id === id ? clearTime(t) : t)) })),
      clearTaskDate: (id) => set((s) => ({ tasks: s.tasks.map((t) => (t.id === id ? clearDate(t) : t)) })),
      undoRepeat: (id) => set((s) => ({ tasks: s.tasks.map((t) => (t.id === id ? undoRepeatTick(t) : t)) })),
      restoreTask: (id) => set((s) => ({ tasks: s.tasks.map((t) => (t.id === id ? restoreFromArchive(t) : t)) })),
      deleteTasks: (ids) => {
        const gone = new Set(ids);
        set((s) => ({ tasks: s.tasks.filter((t) => !gone.has(t.id)) }));
      },
      setArchiveDays: (days) => set({ archiveDays: normalizeArchiveDays(days) }),
      setScheduleDays: (days) => set({ scheduleDays: [1, 2, 3, 5, 7].includes(days) ? days : 1 }),
      setDoneFolded: (folded) => set({ doneFolded: folded }),
      setMilestoneMembers: (id, members) =>
        set((s) => ({
          milestones: s.milestones.map((m) => (m.id === id ? { ...m, members: [...new Set(members)] } : m)),
        })),
      addMilestoneItem: (id, kind, title, extra) => {
        const titles = splitLines(title);
        if (!titles.length) return;
        set((s) => ({
          milestones: s.milestones.map((m) =>
            m.id === id
              ? {
                  ...m,
                  items: [
                    ...(m.items ?? []),
                    ...titles.map((clean) => ({
                      id: uid(),
                      kind,
                      title: clean,
                      done: false,
                      link: extra?.link?.trim() || null,
                      price: extra?.price?.trim() || null,
                    })),
                  ],
                }
              : m,
          ),
        }));
      },
      updateMilestoneItem: (id, itemId, patch) =>
        set((s) => ({
          milestones: s.milestones.map((m) =>
            m.id === id ? { ...m, items: (m.items ?? []).map((item) => (item.id === itemId ? { ...item, ...patch } : item)) } : m,
          ),
        })),
      deleteMilestoneItem: (id, itemId) =>
        set((s) => ({
          milestones: s.milestones.map((m) => (m.id === id ? { ...m, items: (m.items ?? []).filter((item) => item.id !== itemId) } : m)),
        })),
      setRepeatDates: (id, dates) =>
        set((s) => ({
          tasks: s.tasks.map((t) => {
            if (t.id !== id) return t;
            const clean = cleanDates(dates);
            const due = firstChosenDate(clean, todayIso());
            const reopen = t.done && due !== null && due >= todayIso();
            return { ...t, repeat: "dates", repeatDates: clean, due, ...(reopen ? { done: false, completedAt: null } : {}) };
          }),
        })),
      setTaskMembers: (id, members) =>
        set((s) => ({
          tasks: s.tasks.map((t) => (t.id === id ? { ...t, members: [...new Set(members)] } : t)),
        })),
      assignTask: (id, login) =>
        set((s) => ({
          tasks: s.tasks.map((t) => (t.id === id ? { ...t, assignee: login } : t)),
        })),
      setListMembers: (id, members) =>
        set((s) => ({
          lists: s.lists.map((l) => (l.id === id ? { ...l, members: [...new Set(members)] } : l)),
        })),
      deleteTask: (id) => set((s) => ({ tasks: s.tasks.filter((t) => t.id !== id) })),
      addSubtask: (taskId, title) => {
        const titles = splitLines(title);
        if (!titles.length) return;
        set((s) => ({
          tasks: s.tasks.map((t) =>
            t.id === taskId
              ? {
                  ...t,
                  subtasks: [...(t.subtasks ?? []), ...titles.map((clean) => ({ id: uid(), title: clean, done: false }))],
                }
              : t,
          ),
        }));
      },
      duplicateTask: (id, due) => {
        const original = get().tasks.find((t) => t.id === id);
        if (!original) return null;
        const copy = duplicateTaskData(original, { id: uid(), newSubId: uid, now: Date.now(), due });
        set((s) => {
          const at = s.tasks.findIndex((t) => t.id === id);
          const tasks = [...s.tasks];
          tasks.splice(at < 0 ? 0 : at + 1, 0, copy);
          return { tasks };
        });
        return copy.id;
      },
      notesToSubtasks: (taskId) => {
        const task = get().tasks.find((t) => t.id === taskId);
        if (!task) return 0;
        const { items, rest } = listInNotes(task.notes);
        if (!items.length) return 0;
        set((s) => ({
          tasks: s.tasks.map((t) =>
            t.id === taskId
              ? { ...t, notes: rest, subtasks: [...(t.subtasks ?? []), ...items.map((title) => ({ id: uid(), title, done: false }))] }
              : t,
          ),
        }));
        return items.length;
      },
      toggleSubtask: (taskId, subId) =>
        set((s) => ({
          tasks: s.tasks.map((t) =>
            t.id === taskId
              ? {
                  ...t,
                  subtasks: (t.subtasks ?? []).map((sub) =>
                    sub.id === subId ? { ...sub, done: !sub.done } : sub,
                  ),
                }
              : t,
          ),
        })),
      deleteSubtask: (taskId, subId) =>
        set((s) => ({
          tasks: s.tasks.map((t) =>
            t.id === taskId
              ? { ...t, subtasks: (t.subtasks ?? []).filter((sub) => sub.id !== subId) }
              : t,
          ),
        })),
      addList: (name) => {
        const id = uid();
        const clean = name.trim() || "Новый список";
        set((s) => ({ lists: [...s.lists, { id, name: clean }] }));
        return id;
      },
renameList: (id, name) =>
        set((s) => ({
          lists: s.lists.map((l) => (l.id === id ? { ...l, name } : l)),
        })),
      deleteList: (id) =>
        set((s) => {
          const list = s.lists.find((l) => l.id === id);
          const me = currentLogin();
          // Somebody else's shared list: «удалить» = leave it; their tasks stay where they are.
          const foreign = Boolean(me && list?.owner && list.owner !== me);
          return {
            lists: s.lists.filter((l) => l.id !== id),
            tasks: s.tasks.map((t) =>
              t.listId === id && (!foreign || t.owner === me) ? { ...t, listId: null } : t,
            ),
          };
        }),
      addHabit: (name, extra) => {
        const clean = name.trim().slice(0, 200);
        if (!clean) return null;
        const id = uid();
        set((s) => {
          const order = s.habits.reduce((max, h) => Math.max(max, h.order ?? 0), 0) + 1;
          const habit: Habit = { remindAt: null, ...extra, id, name: clean, checks: [], log: [], order, createdAt: Date.now() };
          return { habits: [...s.habits, habit] };
        });
        return id;
      },
      updateHabit: (id, patch) =>
        set((s) => ({
          habits: s.habits.map((h) => {
            if (h.id !== id) return h;
            const next: Habit = { ...h, ...patch };
            if (patch.name !== undefined) next.name = patch.name.trim().slice(0, 200) || h.name;
            return next;
          }),
        })),
      toggleHabit: (id, date) =>
        set((s) => ({
          habits: s.habits.map((h) => (h.id === id ? tapDay(h, date) : h)),
        })),
      setHabitDay: (id, date, patch) =>
        set((s) => ({
          habits: s.habits.map((h) => (h.id === id ? withEntry(h, date, patch) : h)),
        })),
      moveHabit: (id, delta) =>
        set((s) => {
          const habit = s.habits.find((h) => h.id === id);
          if (!habit) return {};
          const section = sectionOf(habit);
          const peers = sortHabits(s.habits.filter((h) => !h.archived === !habit.archived && sectionOf(h) === section));
          const index = peers.findIndex((h) => h.id === id);
          const target = index + delta;
          if (index < 0 || target < 0 || target >= peers.length) return {};
          [peers[index], peers[target]] = [peers[target]!, peers[index]!];
          const order = new Map(peers.map((h, i) => [h.id, i + 1]));
          return {
            habits: s.habits.map((h) => (order.has(h.id) && h.order !== order.get(h.id) ? { ...h, order: order.get(h.id) } : h)),
          };
        }),
      setHabitOrder: (ids) =>
        set((s) => {
          const order = new Map(ids.map((id, i) => [id, i + 1]));
          return {
            habits: s.habits.map((h) => (order.has(h.id) && h.order !== order.get(h.id) ? { ...h, order: order.get(h.id) } : h)),
          };
        }),
      deleteHabit: (id) => set((s) => ({ habits: s.habits.filter((h) => h.id !== id) })),
      addMilestone: (input) => {
        const title = input.title.trim();
        if (!title || !/^\d{4}-\d{2}-\d{2}$/.test(input.date)) return null;
        const id = uid();
        set((s) => ({
          milestones: [
            ...s.milestones,
            {
              id,
              title,
              date: input.date,
              yearly: input.yearly,
              kind: input.kind,
              noYear: Boolean(input.noYear),
              remindAt: input.remindAt === undefined ? "09:00" : input.remindAt,
              remindDays: input.remindDays ?? input.reminders?.[0] ?? 0,
              ...(input.reminders ? { reminders: [...new Set(input.reminders)].sort((a, b) => a - b) } : {}),
              ...(input.icon ? { icon: input.icon } : {}),
              ...(input.color ? { color: input.color } : {}),
              ...(typeof input.showAge === "boolean" ? { showAge: input.showAge } : {}),
              ...(input.showInToday !== undefined ? { showInToday: input.showInToday } : {}),
              ...(input.notes ? { notes: input.notes } : {}),
              items: [],
            },
          ],
        }));
        return id;
      },
      updateMilestone: (id, patch) =>
        set((s) => ({
          milestones: s.milestones.map((m) => {
            if (m.id !== id) return m;
            const next = { ...m, ...patch };
            if (patch.title !== undefined) next.title = patch.title.slice(0, 200);
            // Keep the legacy single lead in step so older app versions still remind.
            if (patch.reminders) next.remindDays = patch.reminders[0] ?? 0;
            return next;
          }),
        })),
      deleteMilestone: (id) => set((s) => ({ milestones: s.milestones.filter((m) => m.id !== id) })),
      addProject: (title) => {
        const id = uid();
        const clean = title.trim();
        if (!clean) return id;
        const stages: ProjectStage[] = [
          { id: uid(), title: "План", cards: [] },
          { id: uid(), title: "В работе", cards: [] },
          { id: uid(), title: "Готово", cards: [] },
        ];
        const project: Project = { id, title: clean, start: null, end: null, stages };
        set((s) => ({ projects: [...(s.projects ?? []), project] }));
        return id;
      },
      updateProject: (id, patch) =>
        set((s) => ({
          projects: (s.projects ?? []).map((project) => (project.id === id ? { ...project, ...patch } : project)),
        })),
      deleteProject: (id) =>
        set((s) => ({ projects: (s.projects ?? []).filter((project) => project.id !== id) })),
      addStage: (projectId, title) => {
        const clean = title.trim();
        if (!clean) return;
        set((s) => ({
          projects: (s.projects ?? []).map((project) =>
            project.id === projectId
              ? { ...project, stages: [...project.stages, { id: uid(), title: clean, cards: [] }] }
              : project,
          ),
        }));
      },
      renameStage: (projectId, stageId, title) =>
        set((s) => ({
          projects: (s.projects ?? []).map((project) =>
            project.id === projectId
              ? {
                  ...project,
                  stages: project.stages.map((stage) =>
                    stage.id === stageId ? { ...stage, title: title.trim() || stage.title } : stage,
                  ),
                }
              : project,
          ),
        })),
      placeStage: (projectId, stageId, start, end) =>
        set((s) => ({
          projects: (s.projects ?? []).map((project) => {
            if (project.id !== projectId || end < start) return project;
            return {
              ...project,
              stages: project.stages.map((stage, index) => {
                if (stage.id === stageId) return { ...stage, start, end };
                if (stage.start && stage.end) return stage;
                const range = stageRange(project, stage, index);
                return range ? { ...stage, start: range.start, end: range.end } : stage;
              }),
            };
          }),
        })),
      deleteStage: (projectId, stageId) =>
        set((s) => ({
          projects: (s.projects ?? []).map((project) => {
            if (project.id !== projectId || project.stages.length < 2) return project;
            const index = project.stages.findIndex((stage) => stage.id === stageId);
            if (index < 0) return project;
            const removed = project.stages[index];
            const rest = project.stages.filter((stage) => stage.id !== stageId);
            const host = rest[Math.max(0, index - 1)];
            if (!host || !removed) return project;
            rest[Math.max(0, index - 1)] = { ...host, cards: [...host.cards, ...removed.cards] };
            return { ...project, stages: rest };
          }),
        })),
      addCard: (projectId, stageId, title) => {
        const clean = title.trim();
        if (!clean) return;
        set((s) => ({
          projects: (s.projects ?? []).map((project) =>
            project.id === projectId
              ? {
                  ...project,
                  stages: project.stages.map((stage) =>
                    stage.id === stageId
                      ? { ...stage, cards: [...stage.cards, { id: uid(), title: clean }] }
                      : stage,
                  ),
                }
              : project,
          ),
        }));
      },
      moveCard: (projectId, cardId, toStageId) =>
        set((s) => ({
          projects: (s.projects ?? []).map((project) => {
            if (project.id !== projectId) return project;
            let moving: Project["stages"][number]["cards"][number] | null = null;
            const stripped = project.stages.map((stage) => {
              const card = stage.cards.find((item) => item.id === cardId);
              if (!card) return stage;
              moving = card;
              return { ...stage, cards: stage.cards.filter((item) => item.id !== cardId) };
            });
            if (!moving) return project;
            return {
              ...project,
              stages: stripped.map((stage) =>
                stage.id === toStageId ? { ...stage, cards: [...stage.cards, moving!] } : stage,
              ),
            };
          }),
        })),
      deleteCard: (projectId, cardId) =>
        set((s) => ({
          projects: (s.projects ?? []).map((project) =>
            project.id === projectId
              ? {
                  ...project,
                  stages: project.stages.map((stage) => ({
                    ...stage,
                    cards: stage.cards.filter((card) => card.id !== cardId),
                  })),
                }
              : project,
          ),
        })),
      sendTaskToProject: (taskId, projectId) =>
        set((s) => {
          const task = s.tasks.find((item) => item.id === taskId);
          const projects = s.projects ?? [];
          if (!task || !projects.some((project) => project.id === projectId)) return {};
          const card = { id: uid(), title: task.title, taskId };
          return {
            projects: projects.map((project) => {
              const stages = project.stages.map((stage) => ({
                ...stage,
                cards: stage.cards.filter((item) => item.taskId !== taskId),
              }));
              if (project.id !== projectId) return { ...project, stages };
              const [first, ...rest] = stages;
              if (!first) return { ...project, stages };
              return { ...project, stages: [{ ...first, cards: [...first.cards, card] }, ...rest] };
            }),
          };
        }),
      setWorkHours: (start, end) => set({ workStart: start, workEnd: end }),
      ackReminder: (key, stamp) =>
        set((s) => ({ remindAck: { ...(s.remindAck ?? {}), [key]: stamp } })),
      setTheme: (theme) => set({ theme }),
      setTabBar: (tabs) => set({ tabBar: normalizeTabs(tabs) }),
      setCalendarMode: (mode) => set({ calendarMode: normalizeCalendarMode(mode) }),
      setWeekNumbers: (on) => set({ weekNumbers: on }),
      setAccent: (accent) => set({ accent }),
      bumpPomo: () =>
        set((s) => {
          const today = todayIso();
          return {
            pomoDate: today,
            pomoCount: s.pomoDate === today ? s.pomoCount + 1 : 1,
          };
        }),
      startFocus: () =>
        set((s) => ({
          focus: {
            ...s.focus,
            running: true,
            endsAt: Date.now() + Math.max(1, s.focus.seconds) * 1000,
            note: null,
          },
        })),
      pauseFocus: () => set((s) => ({ focus: { ...s.focus, running: false, endsAt: null } })),
      resetFocus: () =>
        set((s) => {
          const seconds = s.focus.mode === "work" ? s.focus.workLen : breakFor(s.focus.workLen);
          return { focus: { ...s.focus, running: false, endsAt: null, seconds, note: null } };
        }),
      setWorkLen: (workLen) =>
        set((s) => ({
          focus: {
            ...s.focus,
            workLen,
            mode: "work",
            seconds: workLen,
            running: false,
            endsAt: null,
            note: null,
          },
        })),
      setFocusTask: (taskId) => set((s) => ({ focus: { ...s.focus, taskId, habitId: taskId ? null : s.focus.habitId } })),
      setFocusHabit: (habitId) => set((s) => ({ focus: { ...s.focus, habitId } })),
      focusHabit: (id) =>
        set((s) => ({
          focus: {
            ...s.focus,
            habitId: id,
            taskId: null,
            mode: "work",
            seconds: s.focus.workLen,
            running: true,
            endsAt: Date.now() + Math.max(1, s.focus.workLen) * 1000,
            note: null,
          },
        })),
      tickFocus: () => {
        const s = get();
        if (!s.focus.running || s.focus.endsAt == null) return false;
        const left = Math.max(0, Math.round((s.focus.endsAt - Date.now()) / 1000));
        if (left > 0) {
          if (left !== s.focus.seconds) set({ focus: { ...s.focus, seconds: left } });
          return false;
        }
        const work = s.focus.mode === "work";
        const today = todayIso();
        const habit = work && s.focus.habitId ? s.habits.find((h) => h.id === s.focus.habitId && !h.archived) : undefined;
        const step = habit && !habit.checks.includes(today);
        set({
          habits: step ? s.habits.map((h) => (h.id === habit.id ? tapDay(h, today) : h)) : s.habits,
          pomoDate: work ? today : s.pomoDate,
          pomoCount: work ? (s.pomoDate === today ? s.pomoCount + 1 : 1) : s.pomoCount,
          focus: {
            ...s.focus,
            running: false,
            endsAt: null,
            mode: work ? "break" : "work",
            seconds: work ? breakFor(s.focus.workLen) : s.focus.workLen,
            note: work
              ? step
                ? `Фокус-сессия завершена, отметка в «${habit.name}». Можно сделать перерыв.`
                : "Фокус-сессия завершена. Можно сделать перерыв."
              : "Перерыв закончился.",
          },
        });
        return true;
      },
    })),
    {
      name: "srok-planner",
      skipHydration: true,
      merge: (persisted, current) => {
        const saved = (persisted ?? {}) as Partial<PlannerState>;
        return {
          ...current,
          ...saved,
          milestones: fillRemindAt(saved.milestones, current.milestones).map((m) => (Array.isArray(m.items) ? m : { ...m, items: [] })),
          projects: saved.projects ?? current.projects,
          workStart: saved.workStart ?? current.workStart,
          workEnd: saved.workEnd ?? current.workEnd,
          focus: saved.focus ?? current.focus,
          habits: fillRemindAt(saved.habits, current.habits),
          tasks: fillTasks(saved.tasks, current.tasks),
          lists: saved.lists ?? current.lists,
          remindAck: saved.remindAck ?? {},
          tombstones: { ...emptyTombstones(), ...(saved.tombstones ?? {}) },
          settingsUpdatedAt: typeof saved.settingsUpdatedAt === "number" ? saved.settingsUpdatedAt : 0,
          archiveDays: normalizeArchiveDays(saved.archiveDays),
          scheduleDays: [1, 2, 3, 5, 7].includes(saved.scheduleDays as number) ? (saved.scheduleDays as number) : 1,
          doneFolded: saved.doneFolded === true,
          tabBar: normalizeTabs(saved.tabBar),
          calendarMode: normalizeCalendarMode(saved.calendarMode),
          weekNumbers: saved.weekNumbers === true,
          theme: saved.theme === "dark" ? "dark" : "light",
          accent: isAccent(saved.accent) ? saved.accent : current.accent,
        };
      },
      storage: createJSONStorage(() =>
        typeof window === "undefined" ? memoryStorage : window.localStorage,
      ),
    },
  ),
);

