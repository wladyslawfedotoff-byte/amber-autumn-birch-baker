import assert from "node:assert/strict";
import test from "node:test";
import { addPain, buildRule, cleanNumber, createAsset, guessRules, logService, patchAsset, removeEntry, removePain, removeRule, setMileage, setPainSolved, sortAssets, summarize } from "./ops.ts";
import type { Asset } from "../planner-types.ts";

const TODAY = "2026-10-14";

function car(): Asset {
  return createAsset({ name: "  Легковая ", kind: "car", plate: "а000бб", km: "84 300" }, "a1", 1, TODAY)!;
}

test("createAsset: trims, normalises, drops fields that do not belong to the kind", () => {
  const a = car();
  assert.equal(a.name, "Легковая");
  assert.equal(a.plate, "А000ББ");
  assert.equal(a.km, 84300);
  assert.equal(a.readings.length, 1);
  assert.equal(createAsset({ name: "   ", kind: "car" }, "x", 1, TODAY), null);
  const device = createAsset({ name: "Пылесос", kind: "device", plate: "zzz", km: 5, model: "X1", boughtAt: "2024-03-01" }, "d", 1, TODAY)!;
  assert.equal(device.plate, undefined);
  assert.equal(device.km, undefined);
  assert.equal(device.model, "X1");
  assert.equal(createAsset({ name: "Фильтр", kind: "consumable", boughtAt: "31/12/2024" }, "c", 1, TODAY)!.boughtAt, undefined);
});

test("cleanNumber: spaces, comma, junk, negatives and absurd values", () => {
  assert.equal(cleanNumber("84 300"), 84300);
  assert.equal(cleanNumber("12,5"), 12.5);
  assert.equal(cleanNumber("-3"), undefined);
  assert.equal(cleanNumber("abc"), undefined);
  assert.equal(cleanNumber(""), undefined);
  assert.equal(cleanNumber(1e12), undefined);
  assert.equal(cleanNumber(0), 0);
});

test("setMileage: one reading per day, cars only, rules without a base start from here", () => {
  let a = car();
  const built = buildRule({ ...a, km: null }, { title: "Масло", everyKm: 10000 }, { rule: "r1", entry: "e1" }, TODAY)!;
  a = { ...a, rules: [built.rule] }; // sinceKm null: the car had no mileage when the rule was made
  const next = setMileage(a, "85000", TODAY, "r2")!;
  assert.equal(next.km, 85000);
  assert.equal(next.readings.filter((r) => r.date === TODAY).length, 1);
  assert.equal(next.readings.find((r) => r.date === TODAY)!.km, 85000);
  assert.equal(next.rules[0]!.sinceKm, 85000);
  assert.equal(setMileage(a, "x", TODAY, "r3"), null);
  const device = createAsset({ name: "Пылесос", kind: "device" }, "d", 1, TODAY)!;
  assert.equal(setMileage(device, 5, TODAY, "r"), null);
});

test("buildRule: needs a condition, ignores km on non-cars, last time becomes a history entry", () => {
  const a = car();
  assert.equal(buildRule(a, { title: "Ничего" }, { rule: "r", entry: "e" }, TODAY), null);
  assert.equal(buildRule(a, { title: "", everyKm: 10 }, { rule: "r", entry: "e" }, TODAY), null);
  const device = createAsset({ name: "Пылесос", kind: "device" }, "d", 1, TODAY)!;
  assert.equal(buildRule(device, { title: "Фильтр", everyKm: 100 }, { rule: "r", entry: "e" }, TODAY), null);
  const r = buildRule(a, { title: "Замена масла", everyKm: "10 000", everyMonths: 12, lastDoneAt: "2026-06-02", lastDoneKm: 74200 }, { rule: "r1", entry: "e1" }, TODAY)!;
  assert.equal(r.rule.everyKm, 10000);
  assert.equal(r.rule.everyMonths, 12);
  assert.equal(r.rule.lastDoneAt, "2026-06-02");
  assert.equal(r.rule.lastDoneKm, 74200);
  assert.equal(r.entry!.km, 74200);
  assert.deepEqual(r.entry!.ruleIds, ["r1"]);
  const fixed = buildRule(a, { title: "Страховка", fixedMonth: 12, fixedDay: 31 }, { rule: "r2", entry: "e2" }, TODAY)!;
  assert.equal(fixed.rule.fixedMonth, 12);
  assert.equal(fixed.entry, null);
  assert.equal(buildRule(a, { title: "x", fixedMonth: 13 }, { rule: "r", entry: "e" }, TODAY), null);
});

function withOil(): Asset {
  const a = car();
  const built = buildRule(a, { title: "Замена масла", everyKm: 10000, everyMonths: 12, lastDoneAt: "2026-06-02", lastDoneKm: 74200 }, { rule: "r1", entry: "e1" }, TODAY)!;
  return { ...a, rules: [built.rule], log: [built.entry!] };
}

test("logService: resets only the named rules and moves the mileage forward", () => {
  const a = withOil();
  const done = logService(a, { title: "Масло и фильтр", date: TODAY, km: 84300, cost: "6 400", place: " Сервис ", ruleIds: ["r1", "ghost"] }, { entry: "e2", reading: "rd" }, TODAY)!;
  assert.deepEqual(done.entry.ruleIds, ["r1"]);
  assert.equal(done.entry.cost, 6400);
  assert.equal(done.entry.place, "Сервис");
  assert.equal(done.asset.rules[0]!.lastDoneAt, TODAY);
  assert.equal(done.asset.rules[0]!.lastDoneKm, 84300);
  assert.equal(done.asset.km, 84300);
  const none = logService(a, { title: "Мойка", date: TODAY }, { entry: "e3", reading: "rd" }, TODAY)!;
  assert.equal(none.asset.rules[0]!.lastDoneAt, "2026-06-02");
  assert.equal(logService(a, { title: " ", date: TODAY }, { entry: "e", reading: "r" }, TODAY), null);
});

test("logService: an old entry does not lower the mileage or push a rule back", () => {
  const a = withOil();
  const now = logService(a, { title: "Масло", date: TODAY, km: 84300, ruleIds: ["r1"] }, { entry: "e2", reading: "r1" }, TODAY)!.asset;
  const retro = logService(now, { title: "Масло (забыл записать)", date: "2026-03-01", km: 70000, ruleIds: ["r1"] }, { entry: "e3", reading: "r2" }, TODAY)!.asset;
  assert.equal(retro.km, 84300);
  assert.equal(retro.rules[0]!.lastDoneAt, TODAY);
  assert.ok(retro.readings.some((r) => r.date === "2026-03-01" && r.km === 70000));
});

test("removeEntry: the rule goes back to the previous time, files of the entry go too", () => {
  const a = withOil();
  const done = logService(a, { title: "Масло", date: TODAY, km: 84300, ruleIds: ["r1"] }, { entry: "e2", reading: "rd" }, TODAY)!.asset;
  const withFile = { ...done, attachments: [{ id: "f1", name: "чек.jpg", mime: "image/jpeg", size: 1, createdAt: 1, entryId: "e2" }, { id: "f2", name: "полис.pdf", mime: "application/pdf", size: 1, createdAt: 1 }] };
  const back = removeEntry(withFile, "e2");
  assert.equal(back.rules[0]!.lastDoneAt, "2026-06-02");
  assert.equal(back.rules[0]!.lastDoneKm, 74200);
  assert.deepEqual(back.attachments!.map((f) => f.id), ["f2"]);
});

test("removeRule keeps the history but detaches the rule", () => {
  const a = withOil();
  const b = removeRule(a, "r1");
  assert.equal(b.rules.length, 0);
  assert.equal(b.log.length, 1);
  assert.deepEqual(b.log[0]!.ruleIds, []);
});

test("pains: add, solve, reopen, remove; empty text ignored", () => {
  let a = car();
  assert.equal(addPain(a, "  ", "p", 1), null);
  a = addPain(a, "Стук спереди", "p1", 5)!;
  assert.equal(summarize(a, TODAY).openPains, 1);
  a = setPainSolved(a, "p1", true, 9);
  assert.equal(summarize(a, TODAY).openPains, 0);
  a = setPainSolved(a, "p1", false, 10);
  assert.equal(summarize(a, TODAY).openPains, 1);
  assert.equal(removePain(a, "p1").pains.length, 0);
});

test("patchAsset: thresholds fall back to defaults, blank name is ignored", () => {
  const a = car();
  assert.equal(patchAsset(a, { name: "  " }).name, "Легковая");
  assert.equal(patchAsset(a, { soonDays: 30 }).soonDays, 30);
  assert.equal(patchAsset(a, { soonDays: "" as unknown as number }).soonDays, 14);
  assert.equal(patchAsset(a, { soonKm: -5 }).soonKm, 500);
  assert.equal(patchAsset(a, { kmRemind: true }).kmRemind, true);
});

test("sortAssets: overdue first, then soon, then ok; nearest first inside a group", () => {
  const overdue = (() => {
    const a = createAsset({ name: "Фильтр воды", kind: "consumable" }, "c1", 1, TODAY)!;
    const b = buildRule(a, { title: "Замена", everyMonths: 6, lastDoneAt: "2026-03-01" }, { rule: "r", entry: "e" }, TODAY)!;
    return { ...a, rules: [b.rule], log: [b.entry!] };
  })();
  const fine = (() => {
    const a = createAsset({ name: "Пылесос", kind: "device" }, "d1", 1, TODAY)!;
    const b = buildRule(a, { title: "Фильтр", everyMonths: 12, lastDoneAt: "2026-09-01" }, { rule: "r", entry: "e" }, TODAY)!;
    return { ...a, rules: [b.rule], log: [b.entry!] };
  })();
  const soon = (() => {
    const a = withOil();
    return setMileage(a, 84000, TODAY, "x")!;
  })();
  const none = createAsset({ name: "Гараж", kind: "other" }, "o", 1, TODAY)!;
  const order = sortAssets([fine, none, soon, overdue], TODAY).map((x) => x.asset.name);
  assert.deepEqual(order.slice(0, 2), ["Фильтр воды", "Легковая"]);
  assert.equal(summarize(soon, TODAY).status, "soon");
  assert.ok(order.indexOf("Пылесос") < order.indexOf("Гараж"), "cards with a rule before cards without");
});

test("guessRules matches the entry title to rule titles by word stems", () => {
  const a = withOil();
  assert.deepEqual(guessRules(a, "Замена масла и фильтра"), ["r1"]);
  assert.deepEqual(guessRules(a, "Мойка"), []);
});
