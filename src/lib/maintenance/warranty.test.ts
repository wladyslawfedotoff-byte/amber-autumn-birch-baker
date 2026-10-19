import assert from "node:assert/strict";
import test from "node:test";
import { addPart, createAsset, patchAsset, removePart, summarize, updatePart } from "./ops.ts";
import { ageText, investedByYear, leadWarranty, techSummary, totalInvested, warrantyBadge, warrantyState, warrantyText, warrantyUntil } from "./warranty.ts";

const TODAY = "2026-10-19";

test("warrantyUntil: a date wins; months count from the purchase date and clamp the day", () => {
  assert.equal(warrantyUntil({ boughtAt: "2023-11-18", warrantyMonths: 36 }), "2026-11-18");
  assert.equal(warrantyUntil({ boughtAt: "2024-01-31", warrantyMonths: 1 }), "2024-02-29");
  assert.equal(warrantyUntil({ boughtAt: "2024-01-31", warrantyMonths: 12, warrantyUntil: "2025-05-05" }), "2025-05-05");
  assert.equal(warrantyUntil({ warrantyMonths: 12 }), null, "months without a purchase date mean nothing");
  assert.equal(warrantyUntil({ boughtAt: "2024-01-31", warrantyMonths: 0 }), null);
  assert.equal(warrantyUntil({ warrantyUntil: "31.12.2026" }), null);
});

test("warrantyState: ok / soon (≤ N days, last day included) / expired / none", () => {
  assert.deepEqual(warrantyState({ warrantyUntil: "2026-11-18" }, TODAY), { status: "soon", until: "2026-11-18", daysLeft: 30 });
  assert.equal(warrantyState({ warrantyUntil: "2026-11-19" }, TODAY).status, "ok");
  assert.equal(warrantyState({ warrantyUntil: "2026-10-19" }, TODAY).status, "soon", "ends today = still valid");
  assert.equal(warrantyState({ warrantyUntil: "2026-10-18" }, TODAY).status, "expired");
  assert.equal(warrantyState({}, TODAY).status, "none");
  assert.equal(warrantyState({ warrantyUntil: "2026-12-30" }, TODAY, 60).status, "ok");
  assert.equal(warrantyState({ warrantyUntil: "2026-12-18" }, TODAY, 60).status, "soon", "configurable threshold");
});

test("warranty words", () => {
  assert.equal(warrantyText(warrantyState({ warrantyUntil: "2026-11-18" }, TODAY)), "заканчивается через 30 дн.");
  assert.equal(warrantyText(warrantyState({ warrantyUntil: "2027-02-12" }, TODAY)), "действует до 12 февраля 2027");
  assert.equal(warrantyText(warrantyState({}, TODAY)), "без гарантии");
  assert.equal(warrantyBadge(warrantyState({ warrantyUntil: "2026-11-18" }, TODAY)), "гарантия 30 дн.");
  assert.equal(warrantyBadge(warrantyState({ warrantyUntil: "2025-01-01" }, TODAY)), "истекла");
  assert.equal(warrantyText(warrantyState({ warrantyUntil: TODAY }, TODAY)), "заканчивается сегодня");
});

test("ageText", () => {
  assert.equal(ageText("2023-03-12", TODAY), "3 г. 7 мес.");
  assert.equal(ageText("2021-10-19", TODAY), "5 г.");
  assert.equal(ageText("2026-10-01", TODAY), "меньше месяца");
  assert.equal(ageText("2026-05-20", TODAY), "4 мес.");
  assert.equal(ageText("2027-01-01", TODAY), "");
  assert.equal(ageText(null, TODAY), "");
});

function pc() {
  let a = createAsset({ name: "Домашний ПК", kind: "device" }, "pc", 1, TODAY)!;
  const add = (name: string, extra: object) => {
    a = addPart(a, { name, ...extra }, `p-${name}`)!.asset;
  };
  add("Видеокарта", { boughtAt: "2023-11-18", price: 58900, warrantyMonths: 36 });
  add("Процессор", { boughtAt: "2023-03-12", price: 24600, warrantyMonths: 36 });
  add("Диск", { boughtAt: "2025-08-21", price: "9 800", warrantyUntil: "2030-08-21" });
  add("Кулер", {});
  return a;
}

test("parts: name required, junk dropped, optional fields; a PC is a card with parts", () => {
  const a = pc();
  assert.equal(a.parts!.length, 4);
  assert.equal(addPart(a, { name: "  " }, "x"), null);
  const cooler = a.parts!.find((p) => p.name === "Кулер")!;
  assert.equal(cooler.price, null);
  assert.equal(cooler.warrantyUntil, null);
  const disk = a.parts!.find((p) => p.name === "Диск")!;
  assert.equal(disk.price, 9800);
  assert.equal(disk.warrantyMonths, null, "a date and months are alternatives");
  const car = createAsset({ name: "Кроссовер", kind: "car" }, "c", 1, TODAY)!;
  assert.equal(addPart(car, { name: "Колесо" }, "x"), null, "no components on a car");
});

test("updatePart / removePart: edit in place, files and links go with the part", () => {
  let a = pc();
  a = updatePart(a, "p-Видеокарта", { name: "Видеокарта", boughtAt: "2023-11-18", price: 60000, warrantyMonths: 24 })!;
  assert.equal(a.parts![0]!.price, 60000);
  assert.equal(warrantyUntil({ ...a.parts![0]! }), "2025-11-18");
  assert.equal(updatePart(a, "ghost", { name: "x" }), null);
  a = { ...a, attachments: [{ id: "f", entryId: "p-Видеокарта" } as never, { id: "g" } as never], links: [{ id: "l", url: "https://example.ru", entryId: "p-Видеокарта" }] };
  const gone = removePart(a, "p-Видеокарта");
  assert.equal(gone.parts!.length, 3);
  assert.deepEqual(gone.attachments!.map((x) => x.id), ["g"]);
  assert.equal(gone.links!.length, 0);
});

test("invested: card price + parts by their year; a part without a date takes the card's year; totals", () => {
  let a = pc();
  assert.deepEqual(investedByYear(a), { "2023": 83500, "2025": 9800 });
  a = patchAsset(a, { price: 5000, boughtAt: "2024-01-10" });
  a = updatePart(a, "p-Кулер", { name: "Кулер", price: 2000 })!;
  assert.deepEqual(investedByYear(a), { "2024": 7000, "2023": 83500, "2025": 9800 });
  assert.equal(totalInvested(a), 100300);
});

test("leadWarranty: the one ending soonest among the active ones; summarize flags a soon warranty", () => {
  const a = pc();
  const lead = leadWarranty(a, TODAY)!;
  assert.equal(lead.subject.part!.name, "Видеокарта");
  assert.equal(lead.state.status, "soon");
  assert.equal(summarize(a, TODAY).status, "soon");
  const quiet = pc();
  assert.equal(summarize(quiet, "2025-01-01").status, "ok");
  assert.equal(leadWarranty(createAsset({ name: "Дрель", kind: "device" }, "d", 1, TODAY)!, TODAY), null);
  // all expired → the latest that ended
  const old = leadWarranty(a, "2031-01-01")!;
  assert.equal(old.state.status, "expired");
});

test("patchAsset (tech): price, warranty, serial, reminder days; cleared = explicit empty; cars ignore them", () => {
  let a = createAsset({ name: "Монитор", kind: "device", boughtAt: "2024-02-12", price: "24 900", warrantyMonths: 36, serial: " SN-1 " }, "m", 1, TODAY)!;
  assert.equal(a.price, 24900);
  assert.equal(a.warrantyMonths, 36);
  assert.equal(a.serial, "SN-1");
  a = patchAsset(a, { warrantyMonths: "", price: "", warnDays: 14 });
  assert.equal(a.warrantyMonths, null);
  assert.equal(a.price, null);
  assert.equal(a.warnDays, 14);
  const car = patchAsset(createAsset({ name: "Кроссовер", kind: "car" }, "c", 1, TODAY)!, { price: 5, warrantyMonths: 12 });
  assert.equal(car.price, undefined);
});

test("techSummary: warranties by group, invested per year, ages; cars are not part of it", () => {
  const monitor = createAsset({ name: "Монитор", kind: "device", boughtAt: "2024-02-12", price: 24900, warrantyMonths: 36 }, "m", 1, TODAY)!;
  const boiler = createAsset({ name: "Котёл", kind: "other", boughtAt: "2021-05-01", price: 58000 }, "b", 1, TODAY)!;
  const car = createAsset({ name: "Кроссовер", kind: "car", boughtAt: "2022-01-01" }, "c", 1, TODAY)!;
  const s = techSummary([pc(), monitor, boiler, car], TODAY);
  assert.equal(s.invested, 83500 + 9800 + 24900 + 58000);
  assert.deepEqual(s.byYear.map(([y]) => y), ["2021", "2023", "2024", "2025"]);
  assert.equal(s.soon.length, 1);
  assert.equal(s.soon[0]!.subject.part!.name, "Видеокарта");
  assert.ok(s.active.some((r) => r.assetName === "Монитор"));
  assert.ok(s.expired.some((r) => r.subject.part?.name === "Процессор"));
  assert.ok(!s.items.some((i) => i.asset.kind === "car"));
  assert.equal(s.items[0]!.asset.name, "Домашний ПК", "most expensive first");
  assert.equal(s.items.find((i) => i.asset.name === "Котёл")!.age, "5 г. 5 мес.");
});
