import assert from "node:assert/strict";
import test from "node:test";
import type { Project, Task } from "./planner-types";
import {
  DEFAULT_STAGES,
  adoptLegacy,
  boardOf,
  dropProject,
  dropStage,
  inInbox,
  moveToStage,
  newCardTask,
  projectColorAt,
  projectOfTask,
  projectProgress,
  restoreProject,
  restoreStage,
  sendToProject,
  stageIdOf,
  toggleProjectTask,
} from "./projects.ts";
import { removeTask } from "./task-undo.ts";
import { emptyData, mergeData, stampCollection, type SyncData, type SyncEntity } from "./sync/merge.ts";
import { applyPut, viewFor, type AclConfig, type WorldDoc } from "./sync/world.ts";

const T0 = 1_793_000_000_000;
const ctx = { me: null, today: "2026-11-10", now: T0 };

function task(id: string, fields: Partial<Task> = {}): Task {
  return { id, title: id, notes: "", listId: null, done: false, priority: 0, due: null, tags: [], subtasks: [], createdAt: T0, completedAt: null, ...fields };
}

function project(fields: Partial<Project> = {}): Project {
  return {
    id: "p",
    title: "Ремонт",
    start: null,
    end: null,
    stages: [
      { id: "s1", title: "Сделать", cards: [] },
      { id: "s2", title: "В работе", cards: [] },
      { id: "s3", title: "Готово", cards: [] },
    ],
    ...fields,
  };
}

const titles = (p: Project, tasks: Task[]) => boardOf(p, tasks).map((column) => [...column.tasks.map((t) => t.title), ...column.cards.map((c) => `card:${c.title}`)]);

test("new projects get «Сделать → В работе → Готово»", () => {
  assert.deepEqual([...DEFAULT_STAGES], ["Сделать", "В работе", "Готово"]);
});

test("a card is a task: created in its stage, in order, done when added to the last stage", () => {
  const p = project();
  const a = newCardTask(p, "s1", " Замерить ", [], "a", T0)!;
  assert.equal(a.title, "Замерить");
  assert.equal(a.projectId, "p");
  assert.equal(a.stageId, "s1");
  assert.equal(a.listId, null);
  assert.equal(a.done, false);
  const b = newCardTask(p, "s1", "Купить", [a], "b", T0)!;
  assert.ok((b.projectOrder ?? 0) > (a.projectOrder ?? 0));
  const c = newCardTask(p, "s3", "Согласовано", [a, b], "c", T0)!;
  assert.equal(c.done, true);
  assert.equal(newCardTask(p, "s1", "   ", [], "x", T0), null);
  assert.equal(newCardTask(p, "nope", "x", [], "x", T0), null);
  assert.deepEqual(titles(p, [c, b, a]), [["Замерить", "Купить"], [], ["Согласовано"]]);
});

test("the title always comes from the task", () => {
  const p = project();
  const a = newCardTask(p, "s1", "Старое", [], "a", T0)!;
  assert.deepEqual(titles(p, [{ ...a, title: "Новое" }]), [["Новое"], [], []]);
});

test("ticking moves to the last stage, unticking out of it; progress = done/all", () => {
  const p = project();
  let tasks = [task("a", { projectId: "p", stageId: "s2" }), task("b", { projectId: "p", stageId: "s1" })];
  tasks = tasks.map((t) => (t.id === "a" ? toggleProjectTask(t, [p], ctx) : t));
  assert.equal(tasks[0]!.done, true);
  assert.equal(stageIdOf(p, tasks[0]!), "s3");
  assert.deepEqual(projectProgress(p, tasks), { done: 1, total: 2 });
  tasks = tasks.map((t) => (t.id === "a" ? toggleProjectTask(t, [p], ctx) : t));
  assert.equal(tasks[0]!.done, false);
  assert.equal(stageIdOf(p, tasks[0]!), "s1", "back to the first stage");
  // A task outside any project just toggles.
  const plain = toggleProjectTask(task("z"), [p], ctx);
  assert.equal(plain.done, true);
  assert.equal(plain.projectId, undefined);
});

test("moving into the last stage ticks, out of it reopens; order follows the drop place", () => {
  const p = project();
  let tasks = [task("a", { projectId: "p", stageId: "s1", projectOrder: 0 }), task("b", { projectId: "p", stageId: "s2", projectOrder: 0 }), task("c", { projectId: "p", stageId: "s2", projectOrder: 1 })];
  tasks = moveToStage(tasks, p, "a", "s2", "c", ctx);
  assert.deepEqual(titles(p, tasks)[1], ["b", "a", "c"]);
  tasks = moveToStage(tasks, p, "a", "s3", null, ctx);
  assert.equal(tasks.find((t) => t.id === "a")!.done, true);
  assert.ok(tasks.find((t) => t.id === "a")!.completedAt);
  tasks = moveToStage(tasks, p, "a", "s1", null, ctx);
  const a = tasks.find((t) => t.id === "a")!;
  assert.equal(a.done, false);
  assert.equal(a.completedAt, null);
  assert.equal(stageIdOf(p, a), "s1");
  // Unknown stage: nothing moves.
  assert.deepEqual(moveToStage(tasks, p, "a", "nope", null, ctx), tasks);
});

test("a repeating task dragged to the last stage moves to its next date and stays", () => {
  const p = project();
  const tasks = moveToStage([task("r", { projectId: "p", stageId: "s2", repeat: "day", due: "2026-11-10" })], p, "r", "s3", null, ctx);
  assert.equal(tasks[0]!.done, false);
  assert.equal(tasks[0]!.due, "2026-11-11");
  assert.equal(stageIdOf(p, tasks[0]!), "s2");
});

test("«Не в проекте» takes the task off; «В проект» puts it in the first stage (done → last)", () => {
  const p = project();
  const state = { tasks: [task("a", { projectId: "p", stageId: "s2" }), task("d", { done: true, completedAt: T0 })], projects: [p] };
  const off = sendToProject(state, "a", null, undefined, ctx)!;
  assert.equal(off.tasks[0]!.projectId, null);
  assert.equal(projectOfTask(off.tasks[0]!, [p]), null);
  assert.deepEqual(titles(p, off.tasks), [[], [], []]);
  const back = sendToProject(off, "a", "p", undefined, ctx)!;
  assert.equal(stageIdOf(p, back.tasks[0]!), "s1");
  const done = sendToProject(back, "d", "p", undefined, ctx)!;
  assert.equal(stageIdOf(p, done.tasks[1]!), "s3");
  assert.equal(done.tasks[1]!.done, true, "stays done");
  assert.equal(sendToProject(state, "missing", "p", undefined, ctx), null);
});

test("«Не в проекте» also drops an old card pointing at the task", () => {
  const p = project({ stages: [{ id: "s1", title: "План", cards: [{ id: "c", title: "a", taskId: "a" }] }, { id: "s2", title: "Готово", cards: [] }] });
  const tasks = [task("a")];
  assert.equal(projectOfTask(tasks[0]!, [p])?.id, "p");
  const off = sendToProject({ tasks, projects: [p] }, "a", null, undefined, ctx)!;
  assert.equal(off.projects[0]!.stages[0]!.cards.length, 0);
  assert.equal(projectOfTask(off.tasks[0]!, off.projects), null);
});

test("deleting a task removes its card (also an old card pointing at it)", () => {
  const p = project({ stages: [{ id: "s1", title: "План", cards: [{ id: "c", title: "old", taskId: "old" }] }, { id: "s2", title: "Готово", cards: [] }] });
  const tasks = [task("a", { projectId: "p", stageId: "s1" }), task("old")];
  assert.deepEqual(titles(p, tasks), [["a", "old"], []]);
  let rest = removeTask(tasks, "a").tasks;
  rest = removeTask(rest, "old").tasks;
  assert.deepEqual(titles(p, rest), [[], []], "the orphan card is not shown");
});

test("deleting a stage: its tasks show in the first stage, «Вернуть» brings them back", () => {
  const p = project();
  const tasks = [task("a", { projectId: "p", stageId: "s2" }), task("b", { projectId: "p", stageId: "s2", done: true }), task("c", { projectId: "p", stageId: "s1" })];
  const result = dropStage(p, "s2", tasks)!;
  assert.equal(result.deleted.count, 2);
  assert.equal(result.deleted.into, "Сделать");
  assert.deepEqual(titles(result.project, tasks).map((column) => column.sort()), [["a", "c"], ["b"]], "open → first stage, done → last");
  const back = restoreStage(result.project, result.deleted);
  assert.deepEqual(back.stages.map((s) => s.id), ["s1", "s2", "s3"]);
  assert.deepEqual(titles(back, tasks), [["c"], ["a", "b"], []]);
  assert.equal(restoreStage(back, result.deleted), back, "twice changes nothing");
  assert.equal(dropStage(project({ stages: [{ id: "only", title: "Один", cards: [] }] }), "only", tasks), null, "the last stage stays");
});

test("deleting a project removes its tasks; «Вернуть» restores both", () => {
  const p = project();
  const other = project({ id: "q", title: "Другой" });
  const tasks = [task("a", { projectId: "p" }), task("x"), task("b", { projectId: "p", stageId: "s3", done: true }), task("y", { projectId: "q" })];
  const result = dropProject([p, other], tasks, "p")!;
  assert.deepEqual(result.projects.map((item) => item.id), ["q"]);
  assert.deepEqual(result.tasks.map((t) => t.id), ["x", "y"]);
  const back = restoreProject(result.projects, result.tasks, result.deleted);
  assert.deepEqual(back.projects.map((item) => item.id), ["p", "q"]);
  assert.deepEqual(back.tasks.map((t) => t.id), ["a", "x", "b", "y"]);
});

test("«Входящие» never shows project cards", () => {
  assert.equal(inInbox(task("a")), true);
  assert.equal(inInbox(task("a", { projectId: "p" })), false);
  assert.equal(inInbox(task("a", { projectId: null })), true, "taken off the project → back in «Входящие»");
  assert.equal(inInbox(task("a", { listId: "l" })), false);
  assert.equal(inInbox(task("a", { maint: "car/oil" })), false);
});

/** ≤1.23 data: cards inside stages (plain, linked, linked to a deleted task, orphan). */
function legacyFixture(): { tasks: Task[]; projects: Project[]; deletedTasks: Record<string, number> } {
  return {
    tasks: [task("t-tile", { title: "Заказать плитку", notes: "Артикул 4471" }), task("t-gas", { title: "Вызвать газовщика", done: true, completedAt: T0 }), task("t-other")],
    deletedTasks: { "t-gone": T0 - 10 },
    projects: [
      {
        id: "p1",
        title: "Ремонт кухни",
        start: "2026-11-10",
        end: "2026-12-20",
        stages: [
          { id: "plan", title: "План", cards: [{ id: "c1", title: "Замерить стены" }, { id: "c2", title: "Заказать плитку (копия)", taskId: "t-tile" }, { id: "c-gone", title: "Удалённая", taskId: "t-gone" }] },
          { id: "work", title: "В работе", cards: [{ id: "c4", title: "Демонтаж" }, { id: "c5", title: "Вызвать газовщика", taskId: "t-gas" }, { id: "c-orphan", title: "Сирота", taskId: "t-unknown" }] },
          { id: "done", title: "Готово", cards: [{ id: "c6", title: "Согласовать бюджет" }] },
        ],
      },
      { id: "p2", title: "Дача", start: null, end: null, stages: [{ id: "d1", title: "План", cards: [] }] },
    ],
  };
}

test("legacy: cards become task fields once; nothing is lost; ids are stable", () => {
  const old = legacyFixture();
  // Before adoption the board already reads old data.
  assert.deepEqual(titles(old.projects[0]!, old.tasks), [["Заказать плитку", "card:Замерить стены"], ["Вызвать газовщика", "card:Демонтаж"], ["card:Согласовать бюджет"]]);
  assert.deepEqual(projectProgress(old.projects[0]!, old.tasks), { done: 1, total: 5 });

  const next = adoptLegacy(old, T0 + 5)!;
  assert.ok(next);
  const p = next.projects[0]!;
  // Plain cards → tasks with the card's id; linked tasks get the card's place; the title is the task's.
  assert.deepEqual(titles(p, next.tasks), [["Замерить стены", "Заказать плитку"], ["Демонтаж"], ["Согласовать бюджет", "Вызвать газовщика"]]);
  const tile = next.tasks.find((t) => t.id === "t-tile")!;
  assert.equal(tile.notes, "Артикул 4471", "the task is untouched apart from its place");
  assert.equal(tile.projectId, "p1");
  assert.equal(tile.stageId, "plan");
  assert.equal(next.tasks.find((t) => t.id === "c1")!.projectId, "p1");
  assert.equal(next.tasks.find((t) => t.id === "c6")!.done, true, "a card in the last stage was done");
  assert.equal(next.tasks.find((t) => t.id === "t-gas")!.stageId, "done", "a done task goes to the last stage");
  // Cards left: only the orphan (its task may not have arrived yet). The deleted task's card is gone.
  assert.deepEqual(p.stages.map((s) => s.cards.map((c) => c.id)), [[], ["c-orphan"], []]);
  assert.equal(next.tasks.find((t) => t.id === "t-unknown"), undefined, "an orphan never makes a task");
  assert.equal(next.tasks.length, old.tasks.length + 3);
  // Progress keeps its meaning.
  assert.deepEqual(projectProgress(p, next.tasks), { done: 2, total: 5 });
  // Colours: the ones the side menu showed before (by position).
  assert.equal(p.color, projectColorAt(0));
  assert.equal(next.projects[1]!.color, projectColorAt(1));
  // Idempotent: a second run has nothing to do.
  assert.equal(adoptLegacy({ ...next, deletedTasks: old.deletedTasks }, T0 + 9), null);
  // The orphan's task arrives later → adopted then.
  const later = adoptLegacy({ tasks: [...next.tasks, task("t-unknown", { title: "Пришла" })], projects: next.projects }, T0 + 20)!;
  assert.equal(later.tasks.find((t) => t.id === "t-unknown")!.stageId, "work");
  assert.equal(later.projects[0]!.stages[1]!.cards.length, 0);
});

test("legacy: a task already placed by 1.24 wins over an old card", () => {
  const old = legacyFixture();
  old.tasks[0] = { ...old.tasks[0]!, projectId: null };
  const next = adoptLegacy(old, T0)!;
  assert.equal(next.tasks.find((t) => t.id === "t-tile")!.projectId, null);
  assert.equal(next.projects[0]!.stages[0]!.cards.some((c) => c.taskId === "t-tile"), false);
});

test("stable colours: deleting a project does not repaint the others", () => {
  const old = legacyFixture();
  const next = adoptLegacy(old, T0)!;
  const colours = next.projects.map((p) => p.color);
  const after = dropProject(next.projects, next.tasks, "p1")!;
  assert.equal(after.projects[0]!.color, colours[1]);
  assert.equal(adoptLegacy({ tasks: after.tasks, projects: after.projects }, T0), null, "nothing to repaint");
});

// ---- sync ---------------------------------------------------------------------

const CFG: AclConfig = { owner: "user1", users: ["user1", "user2"] };

function stamp(data: SyncData, tasks: Task[], projects: Project[], now: number): SyncData {
  const t = stampCollection(data.tasks, tasks as unknown as SyncEntity[], data.tombstones.tasks, now, "tasks");
  const p = stampCollection(data.projects, projects as unknown as SyncEntity[], data.tombstones.projects, now, "projects");
  return { ...data, tasks: t.items, projects: p.items, tombstones: { ...data.tombstones, tasks: t.tombs, projects: p.tombs } };
}

const asTasks = (data: SyncData) => data.tasks as unknown as Task[];
const asProjects = (data: SyncData) => data.projects as unknown as Project[];

test("sync: two devices adopting the same old card make one task", () => {
  const old = legacyFixture();
  const base = stamp(emptyData(), old.tasks, old.projects, T0);
  const a = adoptLegacy({ tasks: asTasks(base), projects: asProjects(base) }, T0 + 10)!;
  const b = adoptLegacy({ tasks: asTasks(base), projects: asProjects(base) }, T0 + 20)!;
  const phone = stamp(base, a.tasks, a.projects, T0 + 10);
  const pc = stamp(base, b.tasks, b.projects, T0 + 20);
  const merged = mergeData(phone, pc);
  assert.equal(merged.tasks.filter((t) => t.id === "c1").length, 1);
  assert.equal(merged.tasks.length, old.tasks.length + 3);
});

test("sync: moves of different cards on two devices both survive (per task, not per project)", () => {
  const p = project();
  const tasks = [task("a", { projectId: "p", stageId: "s1" }), task("b", { projectId: "p", stageId: "s1" })];
  const base = stamp(emptyData(), tasks, [p], T0);
  let doc: WorldDoc = { revision: 1, updatedAt: T0, data: base, users: {} };
  const one: AclConfig = { owner: "user1", users: ["user1"] };
  const phone = stamp(base, moveToStage(asTasks(base), p, "a", "s2", null, ctx), [p], T0 + 10);
  const pc = stamp(base, moveToStage(asTasks(base), p, "b", "s3", null, ctx), [{ ...p, title: "Ремонт кухни" }], T0 + 20);
  doc = applyPut(doc, "user1", phone, one, T0 + 30).doc;
  doc = applyPut(doc, "user1", mergeData(pc, viewFor(doc, "user1", one, T0 + 31).data), one, T0 + 40).doc;
  const view = viewFor(doc, "user1", one, T0 + 50).data;
  const proj = asProjects(view)[0]!;
  assert.equal(proj.title, "Ремонт кухни");
  assert.deepEqual(titles(proj, asTasks(view)), [[], ["a"], ["b"]]);
});

test("sync: a card of a shared project is seen by the project's members", () => {
  const p = { ...project(), owner: "user1", members: ["user2"] } as Project;
  const data = stamp(emptyData(), [task("a", { projectId: "p", owner: "user1" } as Partial<Task>), task("private", { owner: "user1" } as Partial<Task>)], [p], T0);
  const doc: WorldDoc = { revision: 1, updatedAt: T0, data, users: {} };
  const view = viewFor(doc, "user2", CFG, T0 + 1).data;
  assert.deepEqual(view.tasks.map((t) => t.id), ["a"]);
  assert.deepEqual(view.projects.map((item) => item.id), ["p"]);
});
