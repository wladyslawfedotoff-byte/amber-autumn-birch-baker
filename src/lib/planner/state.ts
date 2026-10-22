/** The planner state and its actions (types only) — split out of planner-store.ts in 1.15. */
import { patchAsset, type FuelInput, type PartInput, type PainPlanInput, type AssetInput, type RuleInput, type ServiceInput } from "@/lib/maintenance/ops";
import { type Tombstones } from "@/lib/sync/merge";
import { type AccentId } from "@/lib/accents";
import { type CalendarMode, type DrawerTab, type NavId, type NavPrefs, type PinKey, type TabId } from "@/lib/ui-prefs";
import type { FocusClock, Habit, HabitEntry, Milestone, MilestoneItem, MilestoneItemKind, MilestoneKind, Priority, AttachmentMeta, Asset, Project, ProjectContact, Task, TaskList, ThemeMode } from "@/lib/planner-types";

export type MilestoneExtra = Partial<Pick<Milestone, "reminders" | "icon" | "color" | "showAge" | "showInToday" | "notes">>;
export type HabitPatch = Partial<Omit<Habit, "id" | "checks" | "log" | "updatedAt" | "owner" | "updatedBy" | "aclAt" | "createdAt">>;
export type HabitDayPatch = Partial<Omit<HabitEntry, "id" | "updatedAt">> & { done?: boolean };

export type NewTask = {
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

export type PlannerState = {
  lists: TaskList[];
  tasks: Task[];
  habits: Habit[];
  milestones: Milestone[];
  projects: Project[];
  assets: Asset[];
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
  /** «Навигация»: the tabs of the bottom bar on a phone, in order (this device only). */
  tabBar: TabId[];
  /** «Навигация»: items switched off («Скрыть»); the rest of the non-bar items are in the menu (this device only). */
  drawerHidden: NavId[];
  /** Side menu: the last open group «Списки / Проекты / Теги» (this device only). */
  drawerTab: DrawerTab;
  /** Side menu: «Закреплённые» lists and projects, in pin order (this device only). */
  pins: PinKey[];
  /** «Календарь»: Список / Месяц / Неделя / 3 дня / День (this device only). */
  calendarMode: CalendarMode;
  /** «Номера недель» in the month grid (this device only). */
  weekNumbers: boolean;
  /** «Напоминать по умолчанию» for new reminders on this device (minutes before; 0 = at the time). */
  remindLeadDefault: number;
  setTabBar: (tabs: TabId[]) => void;
  /** Bar and menu together, so one move never leaves an item in two places. */
  setNav: (prefs: NavPrefs) => void;
  setDrawerTab: (tab: DrawerTab) => void;
  togglePin: (key: PinKey) => void;
  setCalendarMode: (mode: CalendarMode) => void;
  setWeekNumbers: (on: boolean) => void;
  setRemindLeadDefault: (lead: number) => void;
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
  /** Checklist: move an item up (-1) or down (+1). */
  moveSubtask: (taskId: string, subId: string, delta: -1 | 1) => void;
  /** Drag-and-drop: put the checklist item at `toIndex`. */
  placeSubtask: (taskId: string, subId: string, toIndex: number) => void;
  /** «Ссылка» on a task; returns the id or null when the URL is not http(s). */
  addTaskLink: (taskId: string, url: string, title?: string) => string | null;
  removeTaskLink: (taskId: string, linkId: string) => void;
  /** «Контакт» on a task; returns the id or null without a name and phone. */
  addTaskContact: (taskId: string, contact: { name: string; phone?: string | null }) => string | null;
  removeTaskContact: (taskId: string, contactId: string) => void;
  /** «Ждёт»: returns false when the link would form a cycle. */
  setTaskDependsOn: (taskId: string, dependsOn: string | null) => boolean;
  /** File meta on a task, project or «Обслуживание» card (the bytes go to the NAS separately). */
  addAttachment: (kind: "task" | "project" | "asset", parentId: string, meta: AttachmentMeta) => void;
  removeAttachment: (kind: "task" | "project" | "asset", parentId: string, attachId: string) => void;
  /** After upload the server may convert (HEIC → JPEG): update name/type/size. */
  patchAttachment: (kind: "task" | "project" | "asset", parentId: string, attachId: string, patch: Partial<Pick<AttachmentMeta, "name" | "mime" | "size">>) => void;
  /* «Обслуживание» */
  addAsset: (input: AssetInput) => string | null;
  updateAsset: (id: string, patch: Parameters<typeof patchAsset>[1]) => void;
  deleteAsset: (id: string) => void;
  /** New mileage for a car; false when the value is not a number. */
  setAssetKm: (id: string, km: number | string) => boolean;
  addAssetRule: (assetId: string, input: RuleInput) => string | null;
  updateAssetRule: (assetId: string, ruleId: string, input: RuleInput) => boolean;
  deleteAssetRule: (assetId: string, ruleId: string) => void;
  /** A log entry: resets the rules it names, moves the mileage, closes their reminder tasks. */
  addAssetService: (assetId: string, input: ServiceInput) => string | null;
  /** `parentId` = log entry or note id; null = the card itself. */
  addAssetLink: (assetId: string, parentId: string | null, url: string, title?: string) => boolean;
  removeAssetLink: (assetId: string, linkId: string) => void;
  addAssetContact: (assetId: string, parentId: string | null, contact: { name: string; phone?: string | null }) => boolean;
  removeAssetContact: (assetId: string, contactId: string) => void;
  /** Drops links and contacts of a log entry / note that was never saved. */
  discardAssetChildren: (assetId: string, parentId: string) => void;
  /* Cars: fuel. Tech: components. */
  addAssetFuel: (assetId: string, input: FuelInput) => string | null;
  updateAssetFuel: (assetId: string, fillId: string, input: FuelInput) => boolean;
  deleteAssetFuel: (assetId: string, fillId: string) => void;
  addAssetPart: (assetId: string, input: PartInput) => string | null;
  updateAssetPart: (assetId: string, partId: string, input: PartInput) => boolean;
  deleteAssetPart: (assetId: string, partId: string) => void;
  updateAssetEntry: (assetId: string, entryId: string, input: ServiceInput) => boolean;
  deleteAssetEntry: (assetId: string, entryId: string) => void;
  updateAssetPain: (assetId: string, painId: string, text: string, todo?: string) => boolean;
  updateAssetReading: (assetId: string, readingId: string, km: number | string) => boolean;
  deleteAssetReading: (assetId: string, readingId: string) => void;
  addAssetPain: (assetId: string, text: string, todo?: string) => string | null;
  planAssetPain: (assetId: string, painId: string, input: PainPlanInput) => boolean;
  unplanAssetPain: (assetId: string, painId: string) => void;
  setAssetPainSolved: (assetId: string, painId: string, solved: boolean) => void;
  deleteAssetPain: (assetId: string, painId: string) => void;
  setAssetMembers: (id: string, members: string[]) => void;
  /** Rules that are (or soon will be) due → ordinary tasks; safe to call any time. */
  syncMaintenance: () => void;
  addContact: (projectId: string, contact: Omit<ProjectContact, "id">) => string | null;
  updateContact: (projectId: string, contactId: string, patch: Partial<Omit<ProjectContact, "id">>) => void;
  deleteContact: (projectId: string, contactId: string) => void;
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
