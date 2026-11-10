/**
 * Проекты (1.24): a project is a board of stages; every card on it is a normal
 * task. Membership lives on the task (`projectId`, `stageId`, `projectOrder`),
 * so the sync merges a move or an edit per task and two devices never
 * overwrite each other's cards. `project.stages` keeps only the columns.
 *
 * Rules:
 * - a task whose stage is unknown sits in the first stage (done → the last);
 * - with two or more stages the last one means «готово»: ticking a task moves
 *   it there, moving it there ticks it, moving it out (or unticking) reopens it;
 * - progress = done tasks / all tasks of the project.
 *
 * Old data (≤1.23) kept cards inside stages, optionally pointing at a task.
 * `adoptLegacy` turns them into task fields once, idempotently: a linked task
 * gets the card's place, a plain card becomes a task with the card's own id
 * (two devices converting the same card produce the same task).
 *
 * Pure (no store / React), unit-tested in projects.test.ts.
 */
import { CYCLE, type IconColor } from "./design/tokens.ts";
import type { Project, ProjectCard, ProjectStage, Task } from "./planner-types";
import { toggleTaskDone } from "./task-done.ts";
import { removeTask, restoreDeleted, type DeletedTask } from "./task-undo.ts";

export const DEFAULT_STAGES = ["Сделать", "В работе", "Готово"] as const;

/** Side-menu colour of the project at `index` (the same order as before 1.24). */
export function projectColorAt(index: number): IconColor {
  return CYCLE[(index + 3) % CYCLE.length]!;
}

export function lastStage(project: Project): ProjectStage | null {
  return project.stages.length > 1 ? project.stages[project.stages.length - 1]! : null;
}

export function isDoneStage(project: Project, stageId: string | null | undefined): boolean {
  const last = lastStage(project);
  return Boolean(last && stageId === last.id);
}

/** The stage a task of this project is shown in. */
export function stageIdOf(project: Project, task: Pick<Task, "stageId" | "done">): string | null {
  if (task.stageId && project.stages.some((stage) => stage.id === task.stageId)) return task.stageId;
  const last = lastStage(project);
  if (task.done && last) return last.id;
  return project.stages[0]?.id ?? null;
}

export function byProjectOrder(a: Task, b: Task): number {
  return (a.projectOrder ?? 0) - (b.projectOrder ?? 0) || a.createdAt - b.createdAt || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}

/** Legacy card → the task it points at, when that task has no 1.24 place yet. */
function legacyLinked(card: ProjectCard, byId: Map<string, Task>): Task | null {
  if (!card.taskId) return null;
  const task = byId.get(card.taskId);
  return task && task.projectId === undefined ? task : null;
}

/** A plain legacy card not converted yet (no task with its id). */
function legacyPlain(card: ProjectCard, byId: Map<string, Task>): boolean {
  return !card.taskId && !byId.has(card.id);
}

export type BoardColumn = { stage: ProjectStage; tasks: Task[]; cards: ProjectCard[] };

/**
 * What the board shows: per stage its tasks (in order) and the old plain cards
 * that are still waiting to become tasks. Orphan cards (their task is gone)
 * are not shown: deleting a task removes its card.
 */
export function boardOf(project: Project, tasks: readonly Task[]): BoardColumn[] {
  const byId = new Map(tasks.map((task) => [task.id, task]));
  const columns = project.stages.map((stage) => ({ stage, tasks: [] as Task[], cards: [] as ProjectCard[] }));
  const at = new Map(columns.map((column) => [column.stage.id, column]));
  for (const task of tasks) {
    if (task.projectId !== project.id) continue;
    const id = stageIdOf(project, task);
    if (id) at.get(id)?.tasks.push(task);
  }
  for (const column of columns) {
    for (const card of column.stage.cards ?? []) {
      const linked = legacyLinked(card, byId);
      if (linked) {
        if (!column.tasks.includes(linked)) column.tasks.push(linked);
      } else if (legacyPlain(card, byId)) column.cards.push(card);
    }
    column.tasks.sort(byProjectOrder);
  }
  return columns;
}

/** The project a task is on (1.24 field, or an old card pointing at it). */
export function projectOfTask(task: Task, projects: readonly Project[]): Project | null {
  if (task.projectId !== undefined) return task.projectId ? (projects.find((p) => p.id === task.projectId) ?? null) : null;
  return projects.find((p) => p.stages.some((stage) => (stage.cards ?? []).some((card) => card.taskId === task.id))) ?? null;
}

export function projectProgress(project: Project, tasks: readonly Task[]): { done: number; total: number } {
  let done = 0;
  let total = 0;
  for (const column of boardOf(project, tasks)) {
    total += column.tasks.length + column.cards.length;
    done += column.tasks.filter((task) => task.done).length;
  }
  return { done, total };
}

/** Order value for a task placed before `beforeId` in a stage (end when null). */
export function orderIn(column: readonly Task[], movingId: string, beforeId: string | null): number {
  const rest = column.filter((task) => task.id !== movingId);
  const index = beforeId ? rest.findIndex((task) => task.id === beforeId) : -1;
  if (index < 0) return rest.length ? (rest[rest.length - 1]!.projectOrder ?? 0) + 1 : 0;
  const next = rest[index]!.projectOrder ?? 0;
  const prev = index > 0 ? (rest[index - 1]!.projectOrder ?? 0) : next - 2;
  return prev < next ? (prev + next) / 2 : next - 1;
}

type Ctx = { me: string | null; today: string; now: number };

/**
 * Put a task into a stage of a project. Entering the last stage ticks it,
 * leaving it reopens it. A repeating task ticked this way moves to its next
 * date and stays where it was (it is never «done» for good).
 */
export function placeTask(task: Task, project: Project, toStageId: string, order: number, ctx: Ctx): Task {
  const from = task.projectId === project.id ? stageIdOf(project, task) : null;
  let next: Task = { ...task, projectId: project.id, stageId: toStageId, projectOrder: order };
  const entering = isDoneStage(project, toStageId);
  if (entering && !task.done) {
    next = toggleTaskDone(next, ctx);
    if (!next.done) next = { ...next, stageId: from && !isDoneStage(project, from) ? from : (project.stages[0]?.id ?? null) };
  } else if (!entering && task.done && lastStage(project)) {
    next = toggleTaskDone(next, ctx);
  }
  return next;
}

/** After a task was ticked / unticked elsewhere: keep its stage in step. */
export function stageAfterToggle(project: Project, before: Task, after: Task): Partial<Task> | null {
  const last = lastStage(project);
  if (!last || before.done === after.done) return null;
  const current = stageIdOf(project, before);
  if (after.done) return current === last.id ? null : { stageId: last.id };
  return current === last.id ? { stageId: project.stages[0]!.id } : null;
}

/** «Выполнить» / «Вернуть в работу» anywhere: a project card follows to / from the last stage. */
export function toggleProjectTask(task: Task, projects: readonly Project[], ctx: Ctx): Task {
  const after = toggleTaskDone(task, ctx);
  const project = projectOfTask(task, projects);
  const patch = project ? stageAfterToggle(project, task, after) : null;
  return patch && project ? { ...after, ...patch, projectId: project.id } : after;
}

/** A task made from a plain legacy card (its id = the card id, so every device makes the same one). */
export function taskFromCard(card: ProjectCard, project: Project, stage: ProjectStage, order: number, now: number): Task {
  const done = isDoneStage(project, stage.id);
  return {
    id: card.id,
    title: card.title.trim() || "Без названия",
    notes: "",
    listId: null,
    done,
    priority: 0,
    due: null,
    tags: [],
    subtasks: [],
    createdAt: now,
    completedAt: done ? now : null,
    projectId: project.id,
    stageId: stage.id,
    projectOrder: order,
  };
}

export type LegacyState = { tasks: Task[]; projects: Project[]; deletedTasks?: Record<string, number> };

/**
 * One-time move of ≤1.23 cards into task fields + a stored colour for every
 * project. Returns null when there is nothing to do (the usual case), so it is
 * safe to run after every sync. Orphan cards (task not known here and not
 * deleted) are kept untouched: their task may simply not have arrived yet.
 */
export function adoptLegacy(state: LegacyState, now: number): { tasks: Task[]; projects: Project[] } | null {
  const byId = new Map(state.tasks.map((task) => [task.id, task]));
  const patched = new Map<string, Task>();
  const added: Task[] = [];
  let changed = false;
  const projects = state.projects.map((project, index) => {
    let next = project;
    if (!project.color) {
      next = { ...next, color: projectColorAt(index) };
      changed = true;
    }
    if (!project.stages.some((stage) => (stage.cards ?? []).length > 0)) return next;
    const stages = project.stages.map((stage) => {
      const keep: ProjectCard[] = [];
      (stage.cards ?? []).forEach((card, order) => {
        if (card.taskId) {
          const task = patched.get(card.taskId) ?? byId.get(card.taskId);
          if (!task) {
            if (state.deletedTasks?.[card.taskId] === undefined) keep.push(card);
            return;
          }
          if (task.projectId === undefined) {
            const done = task.done && project.stages.length > 1 ? project.stages[project.stages.length - 1]!.id : stage.id;
            patched.set(task.id, { ...task, projectId: project.id, stageId: done, projectOrder: order });
          }
          return;
        }
        if (byId.has(card.id) || added.some((task) => task.id === card.id)) return;
        if (state.deletedTasks?.[card.id] !== undefined) return;
        added.push(taskFromCard(card, project, stage, order, now));
      });
      return keep.length === (stage.cards ?? []).length ? stage : { ...stage, cards: keep };
    });
    if (stages.some((stage, i) => stage !== project.stages[i])) {
      next = { ...next, stages };
      changed = true;
    }
    return next;
  });
  if (!changed && !patched.size && !added.length) return null;
  const tasks = state.tasks.map((task) => patched.get(task.id) ?? task);
  return { tasks: added.length ? [...added, ...tasks] : tasks, projects };
}

/** Fields that take a task off its project. */
export const NOT_IN_PROJECT = { projectId: null, stageId: null } as const;

/** «Входящие»: no list, not a project card, not an «Обслуживание» task. */
export function inInbox(task: Pick<Task, "listId" | "maint" | "projectId">): boolean {
  return task.listId == null && !task.maint && !task.projectId;
}

/** «+ Новое дело» on a stage: a real task (done at once when added to the last stage). */
export function newCardTask(project: Project, stageId: string, title: string, tasks: readonly Task[], id: string, now: number): Task | null {
  const clean = title.trim();
  const column = boardOf(project, tasks).find((item) => item.stage.id === stageId);
  if (!clean || !column) return null;
  const done = isDoneStage(project, stageId);
  return {
    id,
    title: clean,
    notes: "",
    listId: null,
    done,
    priority: 0,
    due: null,
    tags: [],
    subtasks: [],
    createdAt: now,
    completedAt: done ? now : null,
    projectId: project.id,
    stageId,
    projectOrder: orderIn(column.tasks, id, null),
  };
}

/** Drag / «Переместить в этап…»: the task goes before `beforeId` (end when null). */
export function moveToStage(tasks: readonly Task[], project: Project, taskId: string, toStageId: string, beforeId: string | null, ctx: Ctx): Task[] {
  if (!project.stages.some((stage) => stage.id === toStageId)) return [...tasks];
  const column = boardOf(project, tasks).find((item) => item.stage.id === toStageId)?.tasks ?? [];
  const order = orderIn(column, taskId, beforeId);
  return tasks.map((task) => (task.id === taskId ? placeTask(task, project, toStageId, order, ctx) : task));
}

/**
 * «Проект» in the task sheet / «В проект» in the menu. `projectId` null =
 * «Не в проекте». Old cards that pointed at the task are dropped (its fields are the place now).
 */
export function sendToProject(
  state: { tasks: readonly Task[]; projects: readonly Project[] },
  taskId: string,
  projectId: string | null,
  stageId: string | undefined,
  ctx: Ctx,
): { tasks: Task[]; projects: Project[] } | null {
  const task = state.tasks.find((item) => item.id === taskId);
  if (!task) return null;
  const projects = state.projects.map((project) =>
    project.stages.some((stage) => (stage.cards ?? []).some((card) => card.taskId === taskId))
      ? { ...project, stages: project.stages.map((stage) => ({ ...stage, cards: (stage.cards ?? []).filter((card) => card.taskId !== taskId) })) }
      : project,
  );
  const project = projectId ? projects.find((item) => item.id === projectId) : null;
  if (!project) return { projects, tasks: state.tasks.map((item) => (item.id === taskId ? { ...item, ...NOT_IN_PROJECT } : item)) };
  const target = stageId && project.stages.some((stage) => stage.id === stageId) ? stageId : task.done ? (lastStage(project) ?? project.stages[0])?.id : project.stages[0]?.id;
  if (!target) return null;
  const same = task.projectId === project.id && stageIdOf(project, task) === target;
  const column = boardOf(project, state.tasks).find((item) => item.stage.id === target)?.tasks ?? [];
  const order = same ? (task.projectOrder ?? 0) : orderIn(column, taskId, null);
  return { projects, tasks: state.tasks.map((item) => (item.id === taskId ? placeTask(item, project, target, order, ctx) : item)) };
}

/**
 * Remove a stage. Its tasks keep their `stageId`, so with the stage gone they
 * show in the first stage (done ones in the last) and «Вернуть» brings them
 * back; old plain cards move to the first stage.
 */
export function dropStage(project: Project, stageId: string, tasks: readonly Task[]): { project: Project; deleted: DeletedStage } | null {
  if (project.stages.length < 2) return null;
  const index = project.stages.findIndex((stage) => stage.id === stageId);
  if (index < 0) return null;
  const removed = project.stages[index]!;
  const column = boardOf(project, tasks)[index]!;
  const rest = project.stages.filter((stage) => stage.id !== stageId);
  if (column.cards.length) rest[0] = { ...rest[0]!, cards: [...(rest[0]!.cards ?? []), ...column.cards] };
  return {
    project: { ...project, stages: rest },
    deleted: { projectId: project.id, stage: { ...removed, cards: [] }, index, count: column.tasks.length + column.cards.length, into: rest[0]!.title },
  };
}

export function restoreStage(project: Project, deleted: DeletedStage): Project {
  if (project.id !== deleted.projectId || project.stages.some((stage) => stage.id === deleted.stage.id)) return project;
  const stages = [...project.stages];
  stages.splice(Math.min(deleted.index, stages.length), 0, deleted.stage);
  return { ...project, stages };
}

/** «Проект удалён · Вернуть»: the project, its place and its tasks. */
export type DeletedProject = { project: Project; index: number; tasks: DeletedTask[] };
/** «Этап удалён · Вернуть»: its tasks kept their stage id and come back with it. */
export type DeletedStage = { projectId: string; stage: ProjectStage; index: number; count: number; into: string };

/** «Удалить проект»: the project with its tasks (cards). */
export function dropProject(projects: readonly Project[], tasks: readonly Task[], id: string): { projects: Project[]; tasks: Task[]; deleted: DeletedProject } | null {
  const index = projects.findIndex((project) => project.id === id);
  if (index < 0) return null;
  let rest: Task[] = [...tasks];
  const removed: DeletedTask[] = [];
  for (const task of tasks.filter((item) => item.projectId === id)) {
    const result = removeTask(rest, task.id);
    rest = result.tasks;
    if (result.deleted) removed.push(result.deleted);
  }
  return { projects: projects.filter((project) => project.id !== id), tasks: rest, deleted: { project: projects[index]!, index, tasks: removed } };
}

/** «Вернуть» after «Удалить проект». */
export function restoreProject(projects: readonly Project[], tasks: readonly Task[], deleted: DeletedProject): { projects: Project[]; tasks: Task[] } {
  const next = [...projects];
  if (!next.some((project) => project.id === deleted.project.id)) next.splice(Math.min(deleted.index, next.length), 0, deleted.project);
  let back: Task[] = [...tasks];
  for (const item of [...deleted.tasks].reverse()) back = restoreDeleted(back, item);
  return { projects: next, tasks: back };
}
