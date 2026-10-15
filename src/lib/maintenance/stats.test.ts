import assert from "node:assert/strict";
import test from "node:test";
import { kmPerMonth, money, spendByYear } from "./stats.ts";

test("kmPerMonth: measured months are exact, skipped months are estimated and say «за N мес.»", () => {
  const rows = kmPerMonth([
    { date: "2026-03-10", km: 70000 },
    { date: "2026-04-14", km: 71000 },
    { date: "2026-05-20", km: 72500 },
    { date: "2026-08-20", km: 75700 },
    { date: "2026-09-25", km: 76900 },
  ]);
  const by = Object.fromEntries(rows.map((r) => [r.month, r]));
  assert.equal(by["2026-04"]!.estimated, false);
  assert.equal(by["2026-04"]!.spanMonths, 1);
  assert.ok(by["2026-04"]!.km > 0);
  // June and July have no reading: spread over 3 months with August
  assert.equal(by["2026-06"]!.estimated, true);
  assert.equal(by["2026-07"]!.estimated, true);
  assert.equal(by["2026-08"]!.estimated, false);
  assert.equal(by["2026-06"]!.spanMonths, 3);
  assert.equal(by["2026-08"]!.spanMonths, 3);
  const spread = by["2026-06"]!.km + by["2026-07"]!.km + by["2026-08"]!.km;
  assert.ok(Math.abs(spread - (75700 - 72500)) < 500, `three months add up to the real distance, got ${spread}`);
  assert.ok(Math.abs(by["2026-06"]!.km - by["2026-07"]!.km) < 400, "spread evenly");
});

test("kmPerMonth: fewer than two readings or junk gives nothing; a same-day pair is ordered by km", () => {
  assert.deepEqual(kmPerMonth([]), []);
  assert.deepEqual(kmPerMonth([{ date: "2026-03-10", km: 1 }]), []);
  assert.deepEqual(kmPerMonth([{ date: "bad", km: 1 }, { date: "2026-03-10", km: 2 }]), []);
  const rows = kmPerMonth([
    { date: "2026-03-31", km: 100 },
    { date: "2026-04-30", km: 600 },
  ]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0]!.km, 500);
});

test("spendByYear sums costs per year of the entry and ignores empty or invalid ones", () => {
  const out = spendByYear([
    { date: "2026-03-10", cost: 2000 },
    { date: "2026-10-01", cost: 6400 },
    { date: "2025-12-31", cost: 100 },
    { date: "2026-01-01", cost: null },
    { date: "garbage", cost: 5 },
  ]);
  assert.deepEqual(out, { "2026": 8400, "2025": 100 });
  assert.equal(money(6400), "6 400 ₽");
});
