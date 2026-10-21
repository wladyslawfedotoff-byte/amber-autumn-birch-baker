import type { TaskColor } from "./task-colors";
import type { MaintRule } from "./maintenance/rules";

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

/** File linked to a task or project (bytes live on the NAS under /data/attachments). */
export type AttachmentMeta = {
  id: string;
  name: string;
  mime: string;
  size: number;
  createdAt: number;
  /** Photo capture time (EXIF DateTimeOriginal, else upload time), ms. */
  takenAt?: number;
  /** «Обслуживание»: the file belongs to this service-log entry (missing = to the card itself). */
  entryId?: string;
  /** Sync stamp when the meta row itself changes. */
  updatedAt?: number;
};

export type ProjectContact = {
  id: string;
  name: string;
  /** Role on the object («заказчик», «поставщик»). */
  role?: string;
  phone?: string;
  email?: string;
  note?: string;
  updatedAt?: number;
};

/** «Ссылка» on a task: http(s) only. */
export type TaskLink = {
  id: string;
  url: string;
  title?: string;
  updatedAt?: number;
};

/** A link / contact of an «Обслуживание» card; with `entryId` it belongs to a log entry or a «что болит» note. */
export type AssetLink = TaskLink & { entryId?: string };

/** «Контакт» on a task (own, not from the project card). */
export type TaskContact = {
  id: string;
  name: string;
  phone?: string;
  updatedAt?: number;
};
export type AssetContact = TaskContact & { entryId?: string };

export type Subtask = {
  id: string;
  title: string;
  done: boolean;
  /** Legacy (1.9.0) photo «до» / «после»: the photo itself is a normal task attachment; not shown any more. */
  beforeId?: string | null;
  afterId?: string | null;
  updatedAt?: number;
};

/** «Обслуживание»: what a card is. Decides which fields it shows. */
export type AssetKind = "car" | "device" | "consumable" | "other";

/** A service-log entry: what was done, when, at what mileage, for how much. Resets the rules it names. */
export type ServiceEntry = {
  id: string;
  title: string;
  /** ISO day. */
  date: string;
  km?: number | null;
  cost?: number | null;
  place?: string;
  note?: string;
  /** Rules this entry counts for (their «last done» moves to this entry). */
  ruleIds?: string[];
  /** «ins» = paid for insurance or tax (counted apart from maintenance). Set when the entry resets such a rule. */
  cat?: "ins" | null;
  updatedAt?: number;
};

/** «Что болит»: stays until marked solved. */
export type PainNote = {
  id: string;
  text: string;
  createdAt: number;
  solvedAt?: number | null;
  /** «Что сделать»: the fix to make (free text). */
  todo?: string;
  /** «Запланировать»: a day, or a mileage, at which the task `maintpain-<id>` reminds. */
  planDate?: string | null;
  planKm?: number | null;
  /** The mileage task was made once (a deleted one is not made again). */
  taskMade?: boolean;
  updatedAt?: number;
};

/** A fuel fill-up of a car. `full` (default true) = the tank was filled up: consumption is counted between such fills. */
export type FuelFill = { id: string; date: string; liters: number; sum: number; km?: number | null; full?: boolean; place?: string; updatedAt?: number };

/** A component of a tech item (a PC part…): its own date, price, warranty, serial and files (`entryId` = its id). */
export type TechPart = {
  id: string;
  name: string;
  boughtAt?: string | null;
  price?: number | null;
  warrantyMonths?: number | null;
  warrantyUntil?: string | null;
  serial?: string;
  note?: string;
  /** The `warrantyUntil` day a reminder task was already made for (a deleted one is not made again). */
  warnMade?: string;
  updatedAt?: number;
};

/** One mileage value on a day (feeds «км в месяц»). */
export type KmReading = { id: string; date: string; km: number; updatedAt?: number };

/** «Обслуживание»: a car, an appliance, a consumable… with rules, history, notes and files. */
export type Asset = {
  id: string;
  name: string;
  kind: AssetKind;
  plate?: string;
  model?: string;
  /** ISO day. */
  boughtAt?: string | null;
  /** Cars: current mileage and the day it was set. */
  km?: number | null;
  kmAt?: string | null;
  notes: string;
  /** «Скоро» threshold of this card (default 14 days / 500 km). */
  soonDays?: number;
  soonKm?: number;
  /** Tech: price, warranty (months from `boughtAt`, or until a date), serial; reminder `warnDays` before it ends (0 = off, default 30). */
  price?: number | null;
  warrantyMonths?: number | null;
  warrantyUntil?: string | null;
  serial?: string;
  warnDays?: number;
  warnMade?: string;
  /** Cars: fuel fill-ups. Tech: components. */
  fuel?: FuelFill[];
  parts?: TechPart[];
  /** Monthly reminder «Обновите пробег». */
  kmRemind?: boolean;
  /** Last month («YYYY-MM») a reminder task was made for. */
  kmNotified?: string;
  rules: MaintRule[];
  log: ServiceEntry[];
  pains: PainNote[];
  readings: KmReading[];
  /** Files of the card and of its log entries / notes (`entryId`). */
  attachments?: AttachmentMeta[];
  /** Links and contacts, same idea (`entryId` = log entry or note id; none = the card itself). */
  links?: AssetLink[];
  contacts?: AssetContact[];
  createdAt: number;
  updatedAt?: number;
} & Shared;

export type Task = {
  id: string;
  /** Added from outside the app («В Пору» on the phone). */
  via?: "phone";
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
  /** Remind this many minutes before `remindAt` (5, 15, 30, 60, 1440 = the day before). Missing = at the time. */
  remindLead?: number;
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
  /** Legacy (1.9.0) task-level photo «до» / «после»; the photos stay in `attachments`. */
  beforeId?: string | null;
  afterId?: string | null;
  /** Files on this task (photos, PDF, scans). */
  attachments?: AttachmentMeta[];
  /** «Обслуживание»: made by a rule or a mileage reminder — «assetId/ruleId», «assetId/km» or «assetId/pain:noteId». */
  maint?: string;
  /** Links on this task. */
  links?: TaskLink[];
  /** People for this task (name + phone). */
  contacts?: TaskContact[];
  /** This task waits until `dependsOn` is done («Ждёт»). */
  dependsOn?: string | null;
  /** Contact from the project card linked to this task. */
  contactId?: string | null;
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
  /** People on the object (tap to call / write). */
  contacts?: ProjectContact[];
  /** Files on the project. */
  attachments?: AttachmentMeta[];
  updatedAt?: number;
} & Shared;

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
  | "maintenance"
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
