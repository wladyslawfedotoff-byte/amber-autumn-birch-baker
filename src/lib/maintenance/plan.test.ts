import assert from "node:assert/strict";
import test from "node:test";
import { addPart, addPain, patchAsset, buildRule, createAsset, logService, setMileage } from "./ops.ts";
import { kmTaskId, openTasksFor, painTask, planIsEmpty, planMaintenance, ruleTaskId } from "./plan.ts";
import type { Asset, Task } from "../planner-types.ts";

const TODAY = "2026-10-14";
const NOW = 1_800_000_000_000;

function oilCar(km = 80000): Asset {
  const a = createAsset({ name: "Легковая", kind: "car", km }, "a1", 1, TODAY)!;
  const b = buildRule(a, { title: "Замена масла", everyKm: 10000, everyMonths: 12, lastDoneAt: "2026-06-02", lastDoneKm: 74200 }, { rule: "r1", entry: "e1" }, TODAY)!;
  return { ...a, rules: [b.rule], log: [b.entry!] };
}

/** What the store does with a plan. */
function apply(assets: Asset[], tasks: Task[], plan: ReturnType<typeof planMaintenance>): { assets: Asset[]; tasks: Task[] } {
  const patches = new Map(plan.patch.map((p) => [p.id, p.patch]));
  return {
    tasks: [...tasks.map((t) => (patches.has(t.id) ? { ...t, ...patches.get(t.id)! } : t)), ...plan.create],
    assets: assets.map((a) => ({
      ...a,
      ...(plan.kmNotified.find((n) => n.assetId === a.id) ? { kmNotified: plan.kmNotified.find((n) => n.assetId === a.id)!.month } : {}),
      rules: a.rules.map((r) => {
        const m = plan.ruleNotified.find((n) => n.assetId === a.id && n.ruleId === r.id);
        return m ? { ...r, notified: m.notified } : r;
      }),
    })),
  };
}

test("nothing is made while a rule is far away", () => {
  assert.ok(planIsEmpty(planMaintenance([oilCar()], [], TODAY, NOW)));
});

test("a rule that became «скоро» by mileage makes one ordinary task; running again changes nothing", () => {
  let assets = [setMileage(oilCar(), 83800, TODAY, "x")!];
  let tasks: Task[] = [];
  const plan = planMaintenance(assets, tasks, TODAY, NOW);
  assert.equal(plan.create.length, 1);
  const task = plan.create[0]!;
  assert.equal(task.id, ruleTaskId(assets[0]!.rules[0]!));
  assert.equal(task.due, TODAY);
  assert.equal(task.maint, "a1/r1");
  assert.match(task.title, /Замена масла — Легковая/);
  ({ assets, tasks } = apply(assets, tasks, plan));
  assert.ok(planIsEmpty(planMaintenance(assets, tasks, TODAY, NOW + 1000)), "idempotent");
  // the next morning: the km-driven task does not roll forward
  assert.ok(planIsEmpty(planMaintenance(assets, tasks, "2026-10-15", NOW + 86_400_000)));
});

test("a task the user deleted is not made again in the same round", () => {
  let assets = [setMileage(oilCar(), 83800, TODAY, "x")!];
  let tasks: Task[] = [];
  ({ assets, tasks } = apply(assets, tasks, planMaintenance(assets, tasks, TODAY, NOW)));
  tasks = []; // deleted by the user
  assert.ok(planIsEmpty(planMaintenance(assets, tasks, TODAY, NOW + 5)));
});

test("after the work is logged the next round gets its own task id", () => {
  let assets = [setMileage(oilCar(), 83800, TODAY, "x")!];
  let tasks: Task[] = [];
  ({ assets, tasks } = apply(assets, tasks, planMaintenance(assets, tasks, TODAY, NOW)));
  const firstId = tasks[0]!.id;
  const done = logService(assets[0]!, { title: "Масло", date: TODAY, km: 83900, ruleIds: ["r1"] }, { entry: "e2", reading: "rd" }, TODAY)!.asset;
  assert.notEqual(ruleTaskId(done.rules[0]!), firstId);
  assert.ok(planIsEmpty(planMaintenance([done], tasks, TODAY, NOW + 9)));
  // 10 000 km later it comes again, as a new task
  const later = setMileage(done, 93500, "2027-01-10", "y")!;
  const plan = planMaintenance([later], tasks, "2027-01-10", NOW + 99);
  assert.equal(plan.create.length, 1);
  assert.notEqual(plan.create[0]!.id, firstId);
});

test("date-based: the task is made ahead, on the first «скоро» day, and moves with the rule", () => {
  const a = createAsset({ name: "Фильтр воды", kind: "consumable" }, "c1", 1, TODAY)!;
  const b = buildRule(a, { title: "Замена", everyMonths: 6, lastDoneAt: "2026-05-01" }, { rule: "r9", entry: "e9" }, TODAY)!;
  const asset: Asset = { ...a, rules: [b.rule], log: [b.entry!] };
  // due 2026-11-01, «скоро» from 2026-10-18 (14 days before)
  const early = planMaintenance([asset], [], TODAY, NOW);
  assert.equal(early.create.length, 1);
  assert.equal(early.create[0]!.due, "2026-10-18");
  // but not months ahead: a card whose date is far away makes no task yet
  assert.ok(planIsEmpty(planMaintenance([asset], [], "2026-05-02", NOW)));
  assert.equal(early.create[0]!.remindAt, "09:00");
});

test("a changed rule moves the open task; a done one is left alone", () => {
  const a = createAsset({ name: "Фильтр воды", kind: "consumable" }, "c1", 1, TODAY)!;
  const b = buildRule(a, { title: "Замена", everyMonths: 6, lastDoneAt: "2026-05-01" }, { rule: "r9", entry: "e9" }, TODAY)!;
  let asset: Asset = { ...a, rules: [b.rule], log: [b.entry!] };
  let tasks: Task[] = [];
  ({ tasks } = apply([asset], tasks, planMaintenance([asset], tasks, TODAY, NOW)));
  asset = { ...asset, rules: [{ ...asset.rules[0]!, everyMonths: 7 }] };
  const plan = planMaintenance([asset], tasks, TODAY, NOW + 1);
  assert.equal(plan.patch.length, 1);
  assert.equal(plan.patch[0]!.patch.due, "2026-11-17");
  const doneTasks = tasks.map((t) => ({ ...t, done: true }));
  assert.equal(planMaintenance([asset], doneTasks, TODAY, NOW + 2).patch.length, 0);
});

test("monthly «Обновите пробег»: this month (unless updated), next month ahead, never twice", () => {
  let assets: Asset[] = [{ ...oilCar(), kmRemind: true, kmAt: "2026-09-20" }];
  let tasks: Task[] = [];
  const plan = planMaintenance(assets, tasks, TODAY, NOW);
  assert.deepEqual(plan.create.map((t) => t.id).sort(), [kmTaskId("a1", "2026-10"), kmTaskId("a1", "2026-11")]);
  assert.equal(plan.create.find((t) => t.id === kmTaskId("a1", "2026-11"))!.due, "2026-11-01");
  ({ assets, tasks } = apply(assets, tasks, plan));
  assert.ok(planIsEmpty(planMaintenance(assets, tasks, TODAY, NOW + 1)));
  // already updated this month: no task for this month
  const fresh = [{ ...oilCar(), kmRemind: true, kmAt: TODAY }];
  assert.deepEqual(planMaintenance(fresh, [], TODAY, NOW).create.map((t) => t.id), [kmTaskId("a1", "2026-11")]);
  // switched off: nothing
  assert.ok(planIsEmpty(planMaintenance([{ ...oilCar(), kmRemind: false }], [], TODAY, NOW)));
});

test("year boundary for the monthly reminder", () => {
  const a = { ...oilCar(), kmRemind: true, kmAt: "2026-11-01" };
  const ids = planMaintenance([a], [], "2026-12-15", NOW).create.map((t) => t.id).sort();
  assert.deepEqual(ids, [kmTaskId("a1", "2026-12"), kmTaskId("a1", "2027-01")]);
});

test("openTasksFor finds open reminder tasks of a card, a rule or the mileage", () => {
  const base = { title: "x", notes: "", listId: null, done: false, priority: 0 as const, due: TODAY, tags: [], subtasks: [], createdAt: 1, completedAt: null };
  const tasks: Task[] = [
    { ...base, id: "1", maint: "a1/r1" },
    { ...base, id: "2", maint: "a1/km" },
    { ...base, id: "3", maint: "a2/r1" },
    { ...base, id: "4", maint: "a1/r1", done: true },
    { ...base, id: "5" },
  ];
  assert.deepEqual(openTasksFor(tasks, "a1/r1"), ["1"]);
  assert.deepEqual(openTasksFor(tasks, "a1/").sort(), ["1", "2"]);
  assert.deepEqual(openTasksFor(tasks, "a1/km"), ["2"]);
});

test("planned pain note at N km: the task appears once, when the mileage is close", () => {
  const base = { ...oilCar(80000), rules: [] as Asset["rules"] };
  let a = addPain(base, "стук", "p1", 1, "заменить стойки")!;
  a = { ...a, pains: a.pains.map((p) => ({ ...p, planKm: 81000, taskMade: false })) };
  assert.ok(planIsEmpty(planMaintenance([a], [], TODAY, NOW)), "1 000 km left, not yet");
  const near = setMileage(a, 80600, TODAY, "rd")!;
  const plan = planMaintenance([near], [], TODAY, NOW);
  assert.equal(plan.create.length, 1);
  assert.equal(plan.create[0]!.id, "maintpain-p1");
  assert.equal(plan.create[0]!.title, "заменить стойки — Легковая");
  assert.equal(plan.create[0]!.maint, "a1/pain:p1");
  assert.equal(plan.create[0]!.remindAt, "10:00");
  assert.deepEqual(plan.painMade, [{ assetId: "a1", painId: "p1" }]);
  // made once: a deleted task is not made again
  const made = { ...near, pains: near.pains.map((p) => ({ ...p, taskMade: true })) };
  assert.ok(planIsEmpty(planMaintenance([made], [], TODAY, NOW)));
  // solved or without a mileage: nothing
  assert.ok(planIsEmpty(planMaintenance([{ ...near, pains: near.pains.map((p) => ({ ...p, solvedAt: 5 })) }], [], TODAY, NOW)));
});

test("painTask: title uses «что сделать» (or the note), the note text goes into the task notes", () => {
  const a = addPain(oilCar(), "стук спереди", "p1", 1, "заменить стойки")!;
  const t = painTask(a, a.pains[0]!, "2026-10-20", NOW);
  assert.equal(t.title, "заменить стойки — Легковая");
  assert.equal(t.notes, "Что болит: стук спереди");
  assert.equal(t.due, "2026-10-20");
  assert.equal(t.remindAt, "09:00");
  const plain = addPain(oilCar(), "стук спереди", "p2", 1)!;
  assert.equal(painTask(plain, plain.pains[0]!, TODAY, NOW).title, "стук спереди — Легковая");
});

function pcWithCard(): Asset {
  const a = createAsset({ name: "Домашний ПК", kind: "device" }, "pc", 1, TODAY)!;
  return addPart(a, { name: "Видеокарта", boughtAt: "2023-11-18", warrantyMonths: 36 }, "gpu")!.asset;
}

test("warranty: one task 30 days before the end, once; running again changes nothing", () => {
  const plan = planMaintenance([pcWithCard()], [], "2026-10-19", NOW);
  assert.equal(plan.create.length, 1);
  const t = plan.create[0]!;
  assert.equal(t.due, "2026-10-19", "the reminder day (2026-10-19) is today");
  assert.match(t.title, /Гарантия заканчивается: Видеокарта/);
  assert.equal(t.maint, "pc/warr:gpu");
  assert.deepEqual(plan.warnMade, [{ assetId: "pc", subjectId: "gpu", until: "2026-11-18" }]);
  let a = pcWithCard();
  a = { ...a, parts: a.parts!.map((p) => ({ ...p, warnMade: "2026-11-18" })) };
  assert.ok(planIsEmpty(planMaintenance([a], [], "2026-10-20", NOW)), "a deleted reminder is not made again");
  assert.ok(planIsEmpty(planMaintenance([pcWithCard()], plan.create, "2026-10-19", NOW)));
});

test("warranty: far away = nothing yet; the lead time is configurable; 0 turns it off", () => {
  const far = planMaintenance([pcWithCard()], [], "2026-07-01", NOW);
  assert.equal(far.create.length, 0);
  const a = patchAsset(pcWithCard(), { warnDays: 60 });
  const wide = planMaintenance([a], [], "2026-09-18", NOW);
  assert.equal(wide.create[0]!.due, "2026-09-19");
  const off = planMaintenance([patchAsset(pcWithCard(), { warnDays: 0 })], [], "2026-10-19", NOW);
  assert.ok(planIsEmpty(off));
});

test("warranty: a moved warranty drops the old task and makes a new one; expired warranty makes none", () => {
  const first = planMaintenance([pcWithCard()], [], "2026-10-19", NOW);
  const moved = { ...pcWithCard(), parts: [{ ...pcWithCard().parts![0]!, warrantyMonths: null, warrantyUntil: "2026-12-01" }] };
  const plan = planMaintenance([moved], first.create, "2026-10-19", NOW);
  assert.deepEqual(plan.remove, [first.create[0]!.id]);
  assert.equal(plan.create.length, 1);
  assert.equal(plan.create[0]!.due, "2026-11-01");
  const expired = planMaintenance([pcWithCard()], [], "2026-12-01", NOW);
  assert.ok(planIsEmpty(expired));
});

test("warranty: cars never get warranty tasks", () => {
  const car = { ...oilCar(), warrantyUntil: "2026-11-01" };
  assert.ok(planIsEmpty(planMaintenance([car], [], TODAY, NOW)));
});
