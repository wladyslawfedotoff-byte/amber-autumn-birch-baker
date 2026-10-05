export type Priority = 0 | 1 | 2 | 3;

export type Repeat = "day" | "weekdays" | "week" | "month";

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
};

export type TaskList = {
  id: string;
  name: string;
};

export type Habit = {
  id: string;
  name: string;
  checks: string[];
  why?: string;
  /** Daily HH:mm. Empty means no alarm. */
  remindAt?: string | null;
};

export type MilestoneKind = "birthday" | "anniversary" | "holiday" | "other";

export type Milestone = {
  id: string;
  title: string;
  date: string;
  yearly: boolean;
  kind: MilestoneKind;
  /** HH:mm on the occurrence day. Empty means no alarm. */
  remindAt?: string | null;
};

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
};

export type FocusClock = {
  mode: "work" | "break";
  workLen: number;
  seconds: number;
  running: boolean;
  endsAt: number | null;
  taskId: string | null;
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
  | "calendar"
  | "focus"
  | "habits"
  | "dates"
  | "assist"
  | "schedule"
  | "projects"
  | "settings"
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
