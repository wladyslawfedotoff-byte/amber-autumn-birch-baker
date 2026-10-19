import assert from "node:assert/strict";
import test from "node:test";
import { fuelStats, ownership, sortFills, spendSplit } from "./fuel.ts";
import { addFill, buildRule, createAsset, logService, removeFill, updateFill } from "./ops.ts";
import type { Asset, FuelFill } from "../planner-types.ts";

const TODAY = "2026-10-14";
const f = (id: string, date: string, liters: number, sum: number, km?: number | null, full?: boolean): FuelFill => ({ id, date, liters, sum, km: km ?? null, ...(full === undefined ? {} : { full }) });

test("consumption: between two full fills, the first fill only starts the stretch", () => {
  const s = fuelStats([f("a", "2026-01-01", 40, 2000, 1000), f("b", "2026-01-20", 36, 2160, 1400), f("c", "2026-02-10", 44, 2640, 1900)]);
  // 1000→1400: 36 l; 1400→1900: 44 l  → 80 l / 900 km
  assert.equal(s.stretches, 2);
  assert.equal(s.km, 900);
  assert.ok(Math.abs(s.per100! - (80 / 900) * 100) < 1e-9);
  assert.ok(Math.abs(s.perKm! - 4800 / 900) < 1e-9);
});

test("a partial fill inside a stretch counts its liters but is never an end", () => {
  const s = fuelStats([f("a", "2026-01-01", 40, 2000, 1000), f("p", "2026-01-10", 20, 1200, 1200, false), f("b", "2026-01-20", 25, 1500, 1500)]);
  assert.equal(s.stretches, 1);
  assert.equal(s.km, 500);
  assert.equal(s.liters, 45, "20 partial + 25 full");
  assert.equal(s.spend, 2700);
});

test("fills without mileage: liters still count inside a stretch; no stretch without two full fills with km", () => {
  assert.equal(fuelStats([f("a", "2026-01-01", 40, 2000, 1000), f("b", "2026-01-10", 30, 1800)]).per100, null);
  assert.equal(fuelStats([]).per100, null);
  const s = fuelStats([f("a", "2026-01-01", 40, 2000, 1000), f("n", "2026-01-10", 30, 1800), f("b", "2026-01-20", 20, 1200, 1500)]);
  assert.equal(s.liters, 50);
  assert.equal(s.km, 500);
});

test("bad data: a mileage that goes back restarts the stretch instead of producing nonsense; unsorted input is sorted", () => {
  const s = fuelStats([f("c", "2026-03-01", 40, 2000, 3000), f("a", "2026-01-01", 40, 2000, 2000), f("b", "2026-02-01", 40, 2000, 1500)]);
  // sorted by date: 2000, 1500 (back → restart), 3000 → one stretch 1500→3000
  assert.equal(s.stretches, 1);
  assert.equal(s.km, 1500);
  assert.equal(sortFills([f("x", "2026-02-01", 1, 1), f("y", "2026-01-01", 1, 1)])[0]!.id, "y");
});

test("range: only stretches that END inside the period count", () => {
  const fills = [f("a", "2025-12-20", 40, 2000, 1000), f("b", "2026-01-05", 40, 2000, 1500), f("c", "2026-02-05", 40, 2000, 2100)];
  assert.equal(fuelStats(fills, { from: "2026-01-01", to: "2026-12-31" }).km, 1100);
  assert.equal(fuelStats(fills, { from: "2026-02-01", to: "2026-12-31" }).km, 600);
});

test("average price of a liter over all fills", () => {
  assert.equal(fuelStats([f("a", "2026-01-01", 10, 500), f("b", "2026-01-02", 30, 1800)]).price, 57.5);
});

function car(): Asset {
  return createAsset({ name: "Кроссовер", kind: "car", km: 80000 }, "a1", 1, TODAY)!;
}

test("addFill: mileage becomes a reading and the current mileage; liters must be positive; cars only", () => {
  const done = addFill(car(), { date: "2026-10-15", liters: "41,2", sum: "2 380", km: 84300 }, { fill: "f1", reading: "r1" }, TODAY)!;
  assert.equal(done.fill.liters, 41.2);
  assert.equal(done.fill.sum, 2380);
  assert.equal(done.fill.full, true);
  assert.equal(done.asset.km, 84300);
  assert.equal(done.asset.kmAt, "2026-10-15");
  assert.ok(done.asset.readings.some((r) => r.date === "2026-10-15" && r.km === 84300));
  assert.equal(addFill(car(), { date: "2026-10-12", liters: 0, sum: 1 }, { fill: "f", reading: "r" }, TODAY), null);
  assert.equal(addFill(car(), { date: "2026-10-12", liters: "abc" }, { fill: "f", reading: "r" }, TODAY), null);
  const device = createAsset({ name: "Триммер", kind: "device" }, "d", 1, TODAY)!;
  assert.equal(addFill(device, { date: TODAY, liters: 5 }, { fill: "f", reading: "r" }, TODAY), null);
  // mileage and sum are optional
  const bare = addFill(car(), { date: "2026-10-13", liters: 30 }, { fill: "f2", reading: "r2" }, TODAY)!;
  assert.equal(bare.fill.km, null);
  assert.equal(bare.fill.sum, 0);
  assert.equal(bare.asset.km, 80000);
});

test("updateFill / removeFill keep readings and the current mileage consistent", () => {
  let a = addFill(car(), { date: "2026-10-15", liters: 40, sum: 2300, km: 84300 }, { fill: "f1", reading: "r1" }, TODAY)!.asset;
  a = updateFill(a, "f1", { date: "2026-10-16", liters: 41, sum: 2400, km: 84250, full: false }, "r2", TODAY)!.asset;
  assert.equal(a.fuel![0]!.full, false);
  assert.equal(a.km, 84250);
  assert.ok(!a.readings.some((r) => r.km === 84300));
  const cleared = updateFill(a, "f1", { date: "2026-10-16", liters: 41, sum: 2400, km: "" }, "r3", TODAY)!.asset;
  assert.equal(cleared.fuel![0]!.km, null, "cleared = explicit null");
  assert.equal(cleared.km, 80000, "back to the previous reading");
  const gone = removeFill(a, "f1");
  assert.equal(gone.fuel!.length, 0);
  assert.equal(gone.km, 80000);
  assert.equal(updateFill(a, "ghost", { date: TODAY, liters: 1 }, "r", TODAY), null);
});

test("cost of ownership: fuel + maintenance + insurance/tax, split by month and year, ₽ per km", () => {
  let a = car();
  const ins = buildRule(a, { title: "Страховка", fixedMonth: 12, fixedDay: 12, cat: "ins", cost: 38000 }, { rule: "ri", entry: "x" }, TODAY)!;
  const oil = buildRule(a, { title: "Замена масла", everyKm: 10000 }, { rule: "ro", entry: "y" }, TODAY)!;
  assert.equal(ins.rule.cat, "ins");
  assert.equal(ins.rule.cost, 38000);
  a = { ...a, rules: [ins.rule, oil.rule] };
  a = logService(a, { title: "Страховка", date: "2026-03-05", cost: 38200, ruleIds: ["ri"] }, { entry: "e1", reading: "q1" }, TODAY)!.asset;
  a = logService(a, { title: "Замена масла", date: "2026-04-10", km: 81000, cost: 5400, ruleIds: ["ro"] }, { entry: "e2", reading: "q2" }, TODAY)!.asset;
  a = addFill(a, { date: "2026-04-12", liters: 40, sum: 2300, km: 81100 }, { fill: "f1", reading: "q3" }, TODAY)!.asset;
  a = addFill(a, { date: "2026-05-12", liters: 40, sum: 2400, km: 82000 }, { fill: "f2", reading: "q4" }, TODAY)!.asset;
  assert.equal(a.log.find((e) => e.id === "e1")!.cat, "ins");
  assert.ok(!a.log.find((e) => e.id === "e2")!.cat);
  const { byMonth, byYear } = spendSplit(a);
  assert.deepEqual(byMonth["2026-03"], { fuel: 0, service: 0, ins: 38200 });
  assert.deepEqual(byMonth["2026-04"], { fuel: 2300, service: 5400, ins: 0 });
  assert.deepEqual(byYear["2026"], { fuel: 4700, service: 5400, ins: 38200 });
  const o = ownership(a, "2026");
  assert.equal(o.total, 48300);
  assert.ok(o.km > 0 && Math.abs(o.perKm! - 48300 / o.km) < 1e-9);
  assert.equal(ownership(a, "2024").perKm, null, "no distance, no ₽/km");
  assert.equal(ownership(a).total, 48300);
});

test("an entry that no longer names an insurance rule is maintenance again", () => {
  const a0 = car();
  const ins = buildRule(a0, { title: "Налог", fixedMonth: 11, cat: "ins" }, { rule: "ri", entry: "x" }, TODAY)!;
  const a = logService({ ...a0, rules: [ins.rule] }, { title: "Налог", date: "2026-10-01", cost: 9600, ruleIds: ["ri"] }, { entry: "e1", reading: "q" }, TODAY)!.asset;
  assert.equal(spendSplit(a).byYear["2026"]!.ins, 9600);
});
