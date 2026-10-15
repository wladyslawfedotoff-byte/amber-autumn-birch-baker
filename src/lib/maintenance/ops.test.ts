import assert from "node:assert/strict";
import test from "node:test";
import { addAssetContactTo, addAssetLinkTo, addPain, buildRule, cleanNumber, createAsset, guessRules, logService, patchAsset, removeEntry, removePain, removeReading, removeRule, setMileage, setPainSolved, sortAssets, summarize, parsePainRef, painRef, painTaskId, resolvePainPlan, updatePain, updateReading, updateService } from "./ops.ts";
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

function withOilEntry(): Asset {
  const a = car();
  const rule = buildRule(a, { title: "Замена масла", everyKm: 10000, everyMonths: 12 }, { rule: "r1", entry: "x" }, TODAY)!.rule;
  const withRule: Asset = { ...a, rules: [rule] };
  return logService(withRule, { title: "Замена масла", date: "2026-06-01", km: 74000, cost: 6400, place: "Сервис", ruleIds: ["r1"] }, { entry: "e1", reading: "rd1" }, TODAY)!.asset;
}

test("updateService: changing date and mileage moves the rule's last-done and the readings", () => {
  const a = withOilEntry();
  assert.equal(a.rules[0]!.lastDoneAt, "2026-06-01");
  assert.equal(a.rules[0]!.lastDoneKm, 74000);
  const r = updateService(a, "e1", { title: "Замена масла и фильтра", date: "2026-05-20", km: "73 500", cost: 7000, place: "Другой сервис", note: "синтетика", ruleIds: ["r1"] }, "rd2")!;
  const rule = r.asset.rules[0]!;
  assert.equal(rule.lastDoneAt, "2026-05-20");
  assert.equal(rule.lastDoneKm, 73500);
  const e = r.asset.log.find((x) => x.id === "e1")!;
  assert.equal(e.title, "Замена масла и фильтра");
  assert.equal(e.cost, 7000);
  assert.equal(e.note, "синтетика");
  // the old reading is gone, the new one is there
  assert.ok(!r.asset.readings.some((x) => x.date === "2026-06-01"));
  assert.ok(r.asset.readings.some((x) => x.date === "2026-05-20" && x.km === 73500));
  // the current mileage (set later, today) stays
  assert.equal(r.asset.km, 84300);
});

test("updateService: un-ticking a rule frees it, ticking another resets it; the other entries and files stay", () => {
  let a = withOilEntry();
  a = { ...a, rules: [...a.rules, buildRule(a, { title: "Тормозная жидкость", everyMonths: 24 }, { rule: "r2", entry: "y" }, TODAY)!.rule], attachments: [{ id: "f1", entryId: "e1" } as never] };
  const r = updateService(a, "e1", { title: "Замена масла", date: "2026-06-01", km: 74000, ruleIds: ["r2"] }, "rd")!;
  assert.equal(r.asset.rules.find((x) => x.id === "r1")!.lastDoneAt, null);
  assert.equal(r.asset.rules.find((x) => x.id === "r2")!.lastDoneAt, "2026-06-01");
  assert.equal(r.asset.attachments?.length, 1, "files of the entry are kept");
  // next due recalculates: r1 has no last time any more
  assert.equal(r.asset.log.length, 1);
});

test("updateService: cleared fields become explicit empty values; an entry with the newest date sets the mileage", () => {
  const a = withOilEntry();
  const r = updateService(a, "e1", { title: "Замена масла", date: "2026-10-01", km: "", cost: "", place: "", note: "", ruleIds: ["r1"] }, "rd")!;
  const e = r.asset.log[0]!;
  assert.equal(e.cost, null);
  assert.equal(e.km, null);
  assert.equal(e.place, "");
  // km unknown → the rule counts again from the current mileage
  assert.equal(r.asset.rules[0]!.lastDoneKm, null);
  assert.equal(r.asset.rules[0]!.sinceKm, 84300);
  // an entry in the future of the last reading moves the mileage
  const b = updateService(a, "e1", { title: "Замена масла", date: "2026-10-14", km: 90000 }, "rd9")!;
  assert.equal(b.asset.km, 90000);
  assert.equal(b.asset.kmAt, "2026-10-14");
});

test("updateService: junk is rejected or cleaned (blank title, bad date, negative cost, unknown rule)", () => {
  const a = withOilEntry();
  assert.equal(updateService(a, "e1", { title: "  ", date: "2026-01-01" }, "r"), null);
  assert.equal(updateService(a, "nope", { title: "x", date: "2026-01-01" }, "r"), null);
  const r = updateService(a, "e1", { title: "x", date: "31.12.2026", cost: -5, ruleIds: ["ghost", "r1"] }, "r")!;
  assert.equal(r.entry.date, "2026-06-01", "bad date keeps the old one");
  assert.equal(r.entry.cost, null);
  assert.deepEqual(r.entry.ruleIds, ["r1"]);
});

test("updatePain: edits the text, keeps solved state; blank is ignored", () => {
  let a = addPain(car(), "стук", "p1", 5)!;
  a = setPainSolved(a, "p1", true, 9);
  const e = updatePain(a, "p1", "  стук спереди слева ")!;
  assert.equal(e.pains[0]!.text, "стук спереди слева");
  assert.equal(e.pains[0]!.solvedAt, 9);
  assert.equal(updatePain(a, "p1", "   "), null);
  assert.equal(setPainSolved(e, "p1", false, 10).pains[0]!.solvedAt, null);
});

test("readings: correcting or deleting one recalculates the current mileage", () => {
  let a = setMileage(car(), 85000, "2026-10-14", "rd-today")!;
  a = setMileage({ ...a }, 86000, "2026-10-15", "rd-next")!;
  assert.equal(a.km, 86000);
  const fixed = updateReading(a, "rd-next", "85 500")!;
  assert.equal(fixed.km, 85500);
  assert.equal(removeReading(fixed, "rd-next").km, 85000);
  assert.equal(updateReading(a, "ghost", 1), null);
  assert.equal(updateReading(a, "rd-next", "abc"), null);
});

test("pain notes: «что сделать» is kept, cleared explicitly and edited", () => {
  let a = addPain(car(), "стук", "p1", 5, "  заменить стойки ")!;
  assert.equal(a.pains[0]!.todo, "заменить стойки");
  assert.equal(updatePain(a, "p1", "стук слева")!.pains[0]!.todo, "заменить стойки", "undefined = unchanged");
  a = updatePain(a, "p1", "стук слева", "")!;
  assert.equal(a.pains[0]!.todo, "", "cleared = explicit empty value");
  assert.equal(addPain(car(), "стук", "p2", 5)!.pains[0]!.todo, undefined);
});

test("resolvePainPlan: a date, N days, or a mileage (cars only); junk gives nothing", () => {
  const c = car();
  assert.deepEqual(resolvePainPlan(c, { date: "2026-11-01" }, TODAY), { planDate: "2026-11-01", planKm: null });
  assert.deepEqual(resolvePainPlan(c, { date: "2026-01-01" }, TODAY), { planDate: TODAY, planKm: null }, "a past day means today");
  assert.deepEqual(resolvePainPlan(c, { days: "14" }, TODAY), { planDate: "2026-10-28", planKm: null });
  assert.deepEqual(resolvePainPlan(c, { days: 0 }, TODAY), { planDate: TODAY, planKm: null });
  assert.deepEqual(resolvePainPlan(c, { km: "90 000" }, TODAY), { planDate: null, planKm: 90000 });
  const device = createAsset({ name: "Пылесос", kind: "device" }, "d", 1, TODAY)!;
  assert.equal(resolvePainPlan(device, { km: 5000 }, TODAY), null, "no mileage on a non-car");
  assert.equal(resolvePainPlan(c, {}, TODAY), null);
  assert.equal(resolvePainPlan(c, { days: "abc", km: "" }, TODAY), null);
  assert.equal(resolvePainPlan(c, { km: 0 }, TODAY), null);
});

test("pain task refs round-trip and do not collide with rule or mileage refs", () => {
  assert.deepEqual(parsePainRef(painRef("a1", "p9")), { assetId: "a1", painId: "p9" });
  assert.equal(parsePainRef("a1/r1"), null);
  assert.equal(parsePainRef("a1/km"), null);
  assert.equal(parsePainRef(undefined), null);
  assert.equal(painTaskId("p9"), "maintpain-p9");
});

test("links and contacts: http(s) only, on the card or on an entry/note; they go away with their parent", () => {
  let a = withOilEntry();
  assert.equal(addAssetLinkTo(a, "e1", "l0", "javascript:alert(1)"), null);
  assert.equal(addAssetLinkTo(a, "e1", "l0", "ftp://host/file"), null);
  assert.equal(addAssetLinkTo(a, "e1", "l0", "   "), null);
  a = addAssetLinkTo(a, "e1", "l1", "docs.example.ru/manual", " Инструкция ")!;
  a = addAssetLinkTo(a, null, "l2", "https://example.ru/a")!;
  a = addAssetContactTo(a, "e1", "c1", { name: " Мастер ", phone: "+7 900 000-00-00" })!;
  assert.equal(addAssetContactTo(a, null, "c0", { name: "", phone: "x" }), null);
  assert.deepEqual(a.links!.map((l) => [l.id, l.url, l.title, l.entryId]), [["l1", "https://docs.example.ru/manual", "Инструкция", "e1"], ["l2", "https://example.ru/a", undefined, undefined]]);
  assert.equal(a.contacts![0]!.name, "Мастер");
  const gone = removeEntry({ ...a, attachments: [{ id: "f1", entryId: "e1" } as never, { id: "f2" } as never] }, "e1");
  assert.deepEqual(gone.links!.map((l) => l.id), ["l2"], "the card's own link stays");
  assert.equal(gone.contacts!.length, 0);
  assert.deepEqual(gone.attachments!.map((f) => f.id), ["f2"]);
  const noted = addAssetLinkTo(addPain(a, "стук", "p1", 5)!, "p1", "l3", "https://example.ru/p")!;
  assert.equal(removePain(noted, "p1").links!.some((l) => l.id === "l3"), false);
});
