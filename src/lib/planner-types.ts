import type { TaskColor } from "./task-colors";

export type Priority = 0 | 1 | 2 | 3;

export type Repeat = "day" | "weekdays" | "week" | "month" | "dates";

/**
 * Sharing (several profiles, see src/lib/sync/world.ts). Set by the server /
 * the share controls; absent with one profile.
 */
export type Shared = {
  /** Login of the owner. Missing = the server's APP_OWNER (data from before profiles). */
  owner?: string;
  /** «Совместная»: logins that see and edit it too. */
  members?: string[];
  /** Server bookkeeping: last editor of a shared item. */
  updatedBy?: string | null;
  /** Server bookkeeping: access regained (forces the item back onto devices). */
  aclAt?: number;
};

export type Subtask = {
  id: string;
  title: string;
  done: boolean;
};

export type Task = {
  id: string;
  title: string;
  notes: string;
  listId: string | null;
  done: boolean;
  priority: Priority;
  due: string | null;
  tags: string[];
  subtasks: Subtask[];
  createdAt: number;
  completedAt: number | null;
  /** When unset, derived from priority so older saved tasks still land in the matrix. */
  important?: boolean;
  urgent?: boolean;
  /** HH:mm on the due date. Empty means no alarm. */
  remindAt?: string | null;
  /** HH:mm when the task starts on the due date. */
  startAt?: string | null;
  /** HH:mm when the task ends. Empty means the board draws one hour. */
  endAt?: string | null;
  /** Completing the task moves the date forward instead of archiving it. */
  repeat?: Repeat | null;
  /** repeat = "dates": the chosen ISO dates («Выбранные даты»). `due` is the current one. */
  repeatDates?: string[];
  /** «Назначить»: who should do it (sees it even if not a member). */
  assignee?: string | null;
  /** Who ticked it off last («выполнил(а) Пользователь 2»). */
  completedBy?: string | null;
  /** Repeating task: the date it was last ticked for (shown in «Готово», «Отменить»). */
  lastDue?: string | null;
  /** Colour from our 10-colour palette (see task-colors.ts). */
  color?: TaskColor | null;
  /** Sync stamp (ms, server-corrected clock). Missing on old data = 0. */
  updatedAt?: number;
} & Shared;

export type TaskList = {
  id: string;
  name: string;
  updatedAt?: number;
} & Shared;

/**
 * How often a habit is planned («Частота»):
 * - daily: every day;
 * - weekdays: chosen days of the week, 1 = Monday … 7 = Sunday;
 * - weekly: N times a week on any days;
 * - interval: once every N days (counted from the last check-in).
 */
export type HabitFreq =
  | { kind: "daily" }
  | { kind: "weekdays"; days: number[] }
  | { kind: "weekly"; times: number }
  | { kind: "interval"; every: number };

/** Time-of-day section of the habit list («Утро / День / Вечер / Другое»). */
export type HabitSection = "morning" | "afternoon" | "evening" | "other";

/** One day of a habit's log. `id` is the day (YYYY-MM-DD), so per-day edits sync independently. */
export type HabitEntry = {
  id: string;
  /** skip = «Пропуск» (excused, does not break the streak); fail = «Не выполнено». Done lives in `checks`. */
  status?: "skip" | "fail" | null;
  /** Progress towards `goal` for amount habits (e.g. 5 of 8 glasses). */
  amount?: number | null;
  note?: string;
  /** 1 (плохо) … 5 (отлично). */
  mood?: number | null;
  updatedAt?: number;
};

export type Habit = {
  id: string;
  name: string;
  /** Days done (YYYY-MM-DD). Kept as the single source of «выполнено» (older versions read only this). */
  checks: string[];
  why?: string;
  /** Legacy single daily reminder HH:mm (still honoured); new habits use `reminders`. */
  remindAt?: string | null;
  /** Several daily reminders, HH:mm. */
  reminders?: string[];
  /** Emoji shown next to the name. */
  icon?: string | null;
  color?: TaskColor | null;
  freq?: HabitFreq | null;
  /** Amount per day (e.g. 8 glasses). null/1 = a simple check-in. */
  goal?: number | null;
  unit?: string | null;
  /** How much one tap adds (default 1). */
  step?: number | null;
  section?: HabitSection | null;
  /** First planned day; nothing before it counts as missed. */
  startDate?: string | null;
  /** Challenge length in done days (e.g. 21 or 100). */
  goalDays?: number | null;
  archived?: boolean;
  /** «Показывать дневник при отметке»: completing the day opens the check-in sheet. */
  journal?: boolean;
  /** Manual order inside its section (smaller first). */
  order?: number | null;
  log?: HabitEntry[];
  createdAt?: number;
  updatedAt?: number;
} & Shared;

/** countdown: a one-time event that counts down, then counts the days since («Обратный отсчёт»). */
export type MilestoneKind = "birthday" | "anniversary" | "holiday" | "countdown" | "other";

/** Lists attached to a special date: gift ideas (wishlist), ideas, to-dos, purchases. */
export type MilestoneItemKind = "gift" | "idea" | "todo" | "buy";

export type MilestoneItem = {
  id: string;
  kind: MilestoneItemKind;
  title: string;
  done: boolean;
  /** Optional link (a shop page for a gift idea). */
  link?: string | null;
  /** Optional price, free text («3 500 ₽»). */
  price?: string | null;
  updatedAt?: number;
};

export type Milestone = {
  id: string;
  title: string;
  /** The ORIGINAL date (birth / wedding). With `noYear` only month and day count. */
  date: string;
  yearly: boolean;
  kind: MilestoneKind;
  /** Year unknown: no age / «N лет» is shown. */
  noYear?: boolean;
  /** HH:mm on the reminder day. Empty means no alarm. */
  remindAt?: string | null;
  /** Legacy single lead time (days before; 0 = on the day). Used when `reminders` is absent. */
  remindDays?: number;
  /** Several lead times in days before the date, e.g. [0, 3] = «в день, за 3 дня». */
  reminders?: number[];
  /** Emoji in the coloured circle; empty = the type's icon. */
  icon?: string | null;
  color?: TaskColor | null;
  /** «Показать возраст» («(37 л.)», «10 лет свадьбе»). Missing = on for birthdays/anniversaries. */
  showAge?: boolean;
  /** Show in «Сегодня» from N days before (0 = on the day, null = never). Missing = on the day. */
  showInToday?: number | null;
  items?: MilestoneItem[];
  notes?: string;
  updatedAt?: number;
} & Shared;

export type ProjectCard = {
  id: string;
  title: string;
  taskId?: string;
};

export type ProjectStage = {
  id: string;
  title: string;
  cards: ProjectCard[];
  /** Inclusive ISO dates. Empty means the calendar splits the project range. */
  start?: string | null;
  end?: string | null;
};

export type Project = {
  id: string;
  title: string;
  start: string | null;
  end: string | null;
  stages: ProjectStage[];
  updatedAt?: number;
};

export type FocusClock = {
  mode: "work" | "break";
  workLen: number;
  seconds: number;
  running: boolean;
  endsAt: number | null;
  taskId: string | null;
  /** Habit the session is for (habit page → ⋯ → «Фокус»); a finished session adds a step to today. */
  habitId?: string | null;
  note: string | null;
};

export type View =
  | "today"
  | "tomorrow"
  | "week"
  | "inbox"
  | "checklist"
  | "matrix"
  | "done"
  | "archive"
  | "calendar"
  | "focus"
  | "habits"
  | "dates"
  | "assist"
  | "schedule"
  | "projects"
  | "settings"
  | "shared"
  | `list:${string}`
  | `tag:${string}`
  | `day:${string}`;

export type ThemeMode = "light" | "dark";

export function isImportant(task: Pick<Task, "important" | "priority">): boolean {
  return typeof task.important === "boolean" ? task.important : task.priority >= 2;
}

export function isUrgent(task: Pick<Task, "urgent" | "priority">): boolean {
  return typeof task.urgent === "boolean" ? task.urgent : task.priority >= 3;
}
