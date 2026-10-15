import assert from "node:assert/strict";
import test from "node:test";
import { applyItems, itemTitle, withTitle, type ApplyApi } from "../../../src/lib/assistant/apply.ts";
import { suggestChips } from "../../../src/lib/assistant/suggest.ts";
import type { ProposalItem } from "../../../src/lib/assistant/types.ts";
import { emptyData } from "../../../src/lib/sync/merge.ts";
import { contextFor, intentOf, localAnswer, toolsFor } from "./context.ts";
import { assetsOf, findAsset } from "./maint.ts";
import { runTool, type ToolContext } from "./tools.ts";

const TODAY = "2026-10-14";

function ctx(): ToolContext {
  let n = 0;
  const data = emptyData();
  data.assets = [
    {
      id: "real-car-id",
      name: "Легковая",
      kind: "car",
      plate: "А000ББ",
      km: 83800,
      kmAt: TODAY,
      notes: "",
      rules: [{ id: "r1", title: "Замена масла", everyKm: 10000, everyMonths: 12, since: "2026-06-02", sinceKm: 74200, lastDoneAt: "2026-06-02", lastDoneKm: 74200 }],
      log: [],
      pains: [],
      readings: [],
    },
    { id: "water", name: "Фильтр воды", kind: "consumable", notes: "", rules: [{ id: "r2", title: "Замена", everyMonths: 6, since: "2026-03-01", lastDoneAt: "2026-03-01" }], log: [], pains: [], readings: [] },
    { id: "gone", name: "Удалённая", kind: "other", deleted: true, notes: "", rules: [], log: [], pains: [], readings: [] },
  ];
  return { data, today: TODAY, now: "10:00", newId: () => `id${++n}` };
}

test("assets: deleted cards are invisible, short ids and name lookup work", () => {
  const c = ctx();
  const list = assetsOf(c);
  assert.deepEqual(list.map((a) => a.id), ["real-car-id", "water"]);
  assert.equal(findAsset(list, "a1")?.id, "real-car-id");
  assert.equal(findAsset(list, "легк")?.id, "real-car-id");
  assert.equal(findAsset(list, "а000бб")?.id, "real-car-id");
  assert.equal(findAsset(list, "фильтр")?.id, "water");
  assert.equal(findAsset(list, "Удалённая"), null);
  assert.equal(findAsset(list, "несуществующая"), null);
});

test("create_asset: a proposal, never a change; bad kind and rules without a condition are cleaned", () => {
  const c = ctx();
  const r = runTool("create_asset", { assets: [{ name: "Кроссовер", kind: "car", plate: "А111АА", km: 52000, rules: [{ title: "Масло", every_km: 10000, every_months: 12 }, { title: "Пустое" }] }, { name: "Пылесос", kind: "unknown" }, { name: "" }] }, c);
  assert.ok(r.proposal);
  assert.equal(r.proposal!.items.length, 2);
  const [car, other] = r.proposal!.items as Extract<ProposalItem, { op: "asset" }>[];
  assert.equal(car!.kind, "car");
  assert.equal(car!.rules.length, 1);
  assert.equal(car!.rules[0]!.everyKm, 10000);
  assert.equal(other!.kind, "other");
  assert.equal(c.data.assets.length, 3, "the data is untouched");
});

test("add_service: finds the card and the rule it resets; date defaults to today; unknown card is an error", () => {
  const c = ctx();
  const r = runTool("add_service", { entries: [{ asset: "a1", title: "Замена масла и фильтра", km: 83900, cost: 6400, rule: "масла", place: "Сервис" }] }, c);
  const item = r.proposal!.items[0] as Extract<ProposalItem, { op: "service" }>;
  assert.equal(item.assetId, "real-car-id");
  assert.equal(item.date, TODAY);
  assert.deepEqual(item.ruleIds, ["r1"]);
  assert.deepEqual(item.ruleNames, ["Замена масла"]);
  assert.equal(item.km, 83900);
  const bad = runTool("add_service", { entries: [{ asset: "nope", title: "x" }] }, c);
  assert.equal(bad.proposal, null);
  assert.match(bad.content, /error/);
});

test("create_rule and set_mileage validate their input", () => {
  const c = ctx();
  const rule = runTool("create_rule", { rules: [{ asset: "Легковая", title: "Колодки", every_km: 30000 }, { asset: "Легковая", title: "Без срока" }, { asset: "Фильтр воды", title: "Км у фильтра", every_km: 5 }] }, c);
  assert.equal(rule.proposal!.items.length, 1, "no condition → dropped; km on a non-car → dropped");
  const km = runTool("set_mileage", { asset: "a1", km: 84100 }, c);
  const item = km.proposal!.items[0] as Extract<ProposalItem, { op: "mileage" }>;
  assert.equal(item.km, 84100);
  assert.equal(item.was, 83800);
  assert.equal(runTool("set_mileage", { asset: "a2", km: 5 }, c).proposal, null, "not a car");
  assert.equal(runTool("set_mileage", { asset: "a1", km: "abc" }, c).proposal, null);
});

test("intent: maintenance questions get the maint intent and only its tools; tasks stay tasks", () => {
  assert.equal(intentOf("Заменил масло, пробег 84000", TODAY).kind, "maint");
  assert.equal(intentOf("Добавь карточку машины Кроссовер", TODAY).kind, "maint");
  assert.equal(intentOf("Напомни заменить фильтр завтра", TODAY).kind, "create");
  assert.equal(intentOf("Добавь задачу купить хлеб", TODAY).kind, "create");
  const names = toolsFor(intentOf("Заменил масло", TODAY)).map((t) => t.function.name);
  assert.ok(names.includes("add_service") && names.includes("set_mileage"));
  assert.ok(!names.includes("create_tasks"));
  const general = toolsFor({ kind: "general", dates: [], local: false }).map((t) => t.function.name);
  assert.ok(!general.includes("add_service"), "the other intents do not pay tokens for maintenance tools");
});

test("«что по обслуживанию» is answered by the app, without a model", () => {
  const c = ctx();
  const intent = intentOf("Что по обслуживанию?", TODAY);
  assert.equal(intent.kind, "maint");
  assert.equal(intent.local, true);
  const answer = localAnswer(intent, c)!;
  assert.match(answer.text, /Легковая/);
  assert.match(answer.text, /Фильтр воды/);
  assert.equal(intentOf("Заменил масло на 84 000 км в сервисе", TODAY).local, false);
});

test("prompt context is compact: one line per card with short ids", () => {
  const c = ctx();
  const text = contextFor(intentOf("Заменил масло", TODAY), "Заменил масло", c);
  const lines = text.split("\n");
  assert.equal(lines[0], "Обслуживание:");
  assert.equal(lines.length, 3);
  assert.match(lines[1]!, /^a1 Легковая \(автомобиль, 83800 км\): Замена масла — /);
  assert.ok(text.length < 400);
});

function api() {
  const log: string[] = [];
  const a: ApplyApi = {
    lists: [],
    tasks: [],
    addList: () => "l",
    addTask: () => "t",
    updateTask: () => {},
    toggleTask: () => {},
    addSubtask: () => {},
    addHabit: () => null,
    maint: {
      assets: [{ id: "car1", rules: [{ id: "r1", title: "Масло", since: "2026-01-01" }] }],
      addAsset: (input) => (log.push(`asset ${input.name} ${input.kind} ${input.km}`), "new1"),
      addRule: (id, rule) => (log.push(`rule ${id} ${rule.title} ${rule.everyKm ?? "-"}`), "rr"),
      addService: (id, input) => (log.push(`service ${id} ${input.title} ${(input.ruleIds ?? []).join(",")} ${input.km}`), "ee"),
      setKm: (id, km) => (log.push(`km ${id} ${km}`), true),
    },
  };
  return { a, log };
}

test("apply: asset with rules, service (only live rules), rule, mileage; missing cards are skipped", () => {
  const { a, log } = api();
  const items: ProposalItem[] = [
    { op: "asset", key: "1", name: "Кроссовер", kind: "car", km: 52000, rules: [{ title: "Масло", everyKm: 10000 }] },
    { op: "service", key: "2", assetId: "car1", assetName: "Легковая", title: "Масло", date: TODAY, km: 84000, ruleIds: ["r1", "deleted"], ruleNames: ["Масло"] },
    { op: "rule", key: "3", assetId: "car1", assetName: "Легковая", rule: { title: "Колодки", everyKm: 30000 } },
    { op: "mileage", key: "4", assetId: "car1", assetName: "Легковая", km: 84100 },
    { op: "mileage", key: "5", assetId: "ghost", assetName: "?", km: 1 },
    { op: "service", key: "6", assetId: "ghost", assetName: "?", title: "x", date: TODAY, ruleIds: [], ruleNames: [] },
  ];
  const res = applyItems(items, a);
  assert.deepEqual(res, { applied: 4, skipped: 2 });
  assert.deepEqual(log, ["asset Кроссовер car 52000", "rule new1 Масло 10000", "service car1 Масло r1 84000", "rule car1 Колодки 30000", "km car1 84100"]);
  const noMaint: ApplyApi = { ...a, maint: undefined };
  assert.deepEqual(applyItems(items.slice(0, 1), noMaint), { applied: 0, skipped: 1 });
});

test("apply: titles of the new item kinds are editable and printable", () => {
  const svc: ProposalItem = { op: "service", key: "2", assetId: "c", assetName: "Легковая", title: "Масло", date: TODAY, ruleIds: [], ruleNames: [] };
  assert.equal(itemTitle(svc), "Легковая: Масло");
  const renamed = withTitle(svc, "Легковая: Масло и фильтр");
  assert.equal(renamed.op === "service" && renamed.title, "Масло и фильтр");
  const rule: ProposalItem = { op: "rule", key: "3", assetId: "c", assetName: "Легковая", rule: { title: "Колодки", everyKm: 1 } };
  assert.equal(itemTitle(rule), "Легковая: Колодки");
});

test("suggestion chip for overdue maintenance, no chip without it", () => {
  const base = { overdue: 0, today: 3, inbox: 0, hour: 10, draft: "" };
  assert.ok(suggestChips({ ...base, maintOverdue: 2 }).some((c) => c.id === "maint"));
  assert.ok(!suggestChips({ ...base, maintOverdue: 0 }).some((c) => c.id === "maint"));
  assert.ok(!suggestChips(base).some((c) => c.id === "maint"));
});

test("add_service: a vague rule name resets nothing (it must not match every rule)", () => {
  const c = ctx();
  const r = runTool("add_service", { entries: [{ asset: "a1", title: "Мойка", rule: "а" }] }, c);
  const item = r.proposal!.items[0] as Extract<ProposalItem, { op: "service" }>;
  assert.deepEqual(item.ruleIds, []);
});
