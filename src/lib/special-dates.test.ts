import assert from "node:assert/strict";
import test from "node:test";
import type { Milestone } from "./planner-types";
import {
  ageLabel,
  countLabel,
  daysLeftLabel,
  iconOf,
  inYear,
  kindMeta,
  leadDays,
  leadsLabel,
  nextOccurrence,
  occursOnDay,
  shortAge,
  showInTodayNow,
  showsAge,
  upcoming,
  yearsAt,
} from "./special-dates.ts";
import { collectReminders, localStamp } from "./reminders.ts";
import { plural } from "./plural.ts";

function item(fields: Partial<Milestone>): Milestone {
  return { id: "m", title: "Дата", date: "1991-10-23", yearly: true, kind: "birthday", ...fields };
}

test("Russian plurals", () => {
  const f = ["день", "дня", "дней"] as const;
  assert.deepEqual([1, 2, 5, 11, 12, 14, 21, 22, 25, 101, 111].map((n) => plural(n, f)), [
    "день", "дня", "дней", "дней", "дней", "дней", "день", "дня", "дней", "день", "дней",
  ]);
  assert.equal(daysLeftLabel(12), "через 12 дней");
  assert.equal(daysLeftLabel(21), "через 21 день");
  assert.equal(daysLeftLabel(3), "через 3 дня");
  assert.equal(daysLeftLabel(0), "сегодня");
  assert.equal(daysLeftLabel(1), "завтра");
});

test("next occurrence from the original date, age and anniversary", () => {
  const today = "2026-10-11";
  assert.equal(nextOccurrence("1991-10-23", true, today), "2026-10-23");
  assert.equal(nextOccurrence("1991-10-01", true, today), "2027-10-01");
  assert.equal(nextOccurrence("1991-10-11", true, today), today, "today counts");
  assert.equal(ageLabel(item({}), "2026-10-23", today), "исполнится 35");
  assert.equal(ageLabel(item({ date: "1991-10-11" }), today, today), "исполняется 35");
  assert.equal(ageLabel(item({ kind: "anniversary", date: "2016-10-23" }), "2026-10-23", today), "10 лет свадьбе");
  assert.equal(ageLabel(item({ kind: "anniversary", date: "2025-10-23" }), "2026-10-23", today), "1 год свадьбе");
  assert.equal(ageLabel(item({ kind: "other", date: "2024-10-23" }), "2026-10-23", today), "2 года");
  assert.equal(ageLabel(item({ noYear: true }), "2026-10-23", today), "", "year unknown → no age");
  assert.equal(yearsAt(item({ date: "2026-10-23" }), "2026-10-23"), null, "not after the original");
  const list = upcoming([item({ id: "late", date: "2000-12-01" }), item({ id: "soon", date: "2000-10-12" })], today);
  assert.deepEqual(list.map((row) => [row.item.id, row.days]), [["soon", 1], ["late", 51]]);
});

test("29 February: celebrated on 28 February in other years", () => {
  assert.equal(inYear("2000-02-29", 2027), "2027-02-28");
  assert.equal(inYear("2000-02-29", 2028), "2028-02-29");
  assert.equal(nextOccurrence("2000-02-29", true, "2026-10-11"), "2027-02-28");
  assert.equal(nextOccurrence("2000-02-29", true, "2027-03-01"), "2028-02-29");
  assert.ok(occursOnDay({ date: "2000-02-29", yearly: true }, "2027-02-28"));
  assert.ok(!occursOnDay({ date: "2000-02-29", yearly: true }, "2028-02-28"));
  assert.equal(ageLabel(item({ date: "2000-02-29" }), "2027-02-28", "2026-10-11"), "исполнится 27");
});

test("compact cards: short age, big number, countdown in the past", () => {
  const today = "2026-10-11";
  assert.equal(shortAge(item({ date: "1989-12-14" }), "2026-12-14"), "(37 л.)");
  assert.equal(shortAge(item({ date: "2025-06-01" }), "2026-06-01"), "(1 г.)");
  assert.equal(shortAge(item({ date: "1989-12-14", showAge: false }), "2026-12-14"), "", "«Показать возраст» off");
  assert.equal(shortAge(item({ kind: "holiday", date: "2000-12-31" }), "2026-12-31"), "", "holidays hide the age by default");
  assert.equal(shortAge(item({ kind: "holiday", date: "2000-12-31", showAge: true }), "2026-12-31"), "(26 л.)");
  assert.deepEqual(countLabel(64), { value: "64", caption: "дня до", past: false });
  assert.deepEqual(countLabel(81), { value: "81", caption: "день до", past: false });
  assert.deepEqual(countLabel(-387), { value: "387", caption: "дней назад", past: true });
  assert.equal(countLabel(0).value, "Сегодня!");
  // A one-time countdown: before → days to, after → days since; listed after the upcoming ones.
  const trip = item({ id: "trip", kind: "countdown", yearly: false, date: "2025-09-19" });
  const ny = item({ id: "ny", kind: "holiday", date: "2000-12-31" });
  const list = upcoming([trip, ny], today);
  assert.deepEqual(list.map((row) => [row.item.id, row.days]), [["ny", 81], ["trip", -387]]);
  assert.equal(ageLabel(trip, trip.date, today), "");
  assert.equal(kindMeta("countdown").yearly, false);
  assert.equal(iconOf({ kind: "countdown", icon: null }), "⏳");
  assert.equal(iconOf({ kind: "birthday", icon: "👶" }), "👶");
});

test("several reminders and «show in Today»", () => {
  const today = "2026-10-11";
  assert.deepEqual(leadDays({ reminders: [3, 0, 3, 99] }), [0, 3]);
  assert.deepEqual(leadDays({ remindDays: 7 }), [7], "legacy single lead");
  assert.equal(leadsLabel({ reminders: [0, 3], remindAt: "09:00" }), "в день, за 3 дня в 09:00");
  assert.equal(leadsLabel({ reminders: [0], remindAt: null }), "Нет");
  const bday = item({ date: "1991-10-14", showInToday: 3 });
  assert.equal(showInTodayNow(bday, today)?.days, 3);
  assert.equal(showInTodayNow(item({ date: "1991-10-14" }), today), null, "default: only on the day");
  assert.equal(showInTodayNow(item({ date: "1991-10-11" }), today)?.days, 0);
  assert.equal(showInTodayNow(item({ date: "1991-10-11", showInToday: null }), today), null, "«Не показывать»");

  const at = (t: string) => localStamp(today, t);
  const hits = collectReminders({
    tasks: [],
    milestones: [item({ id: "a", date: "1991-10-14", remindAt: "09:00", reminders: [0, 3] }), item({ id: "b", date: "1991-10-12", remindAt: "09:00", remindDays: 1 })],
    remindAck: {},
    now: at("10:00"),
  });
  assert.deepEqual(hits.map((h) => [h.key, h.status]), [["date:a:3", "due"], ["date:b", "due"]]);
  const tomorrow = collectReminders({ tasks: [], milestones: [item({ id: "a", date: "1991-10-12", remindAt: "09:00", reminders: [0, 1] })], remindAck: { "date:a:1": `${today}T09:00` }, now: at("10:00") });
  assert.deepEqual(tomorrow.map((h) => [h.key, h.status]), [["date:a", "later"]], "the day-before one acknowledged, the on-the-day one tomorrow");
});

test("migration: an old date (no new fields) keeps its behaviour", () => {
  const old = item({ kind: "other", date: "2024-10-23", remindAt: "09:00", remindDays: 2 });
  assert.equal(ageLabel(old, "2026-10-23", "2026-10-11"), "2 года");
  assert.deepEqual(leadDays(old), [2]);
  assert.equal(showsAge(item({})), true);
  assert.equal(showsAge(item({ noYear: true, showAge: true })), false, "year unknown wins");
});

test("sync: new date fields merge per field; ACL keeps a private date private", async () => {
  const { emptyData, mergeData, stampCollection } = await import("./sync/merge.ts");
  const { applyPut, viewFor } = await import("./sync/world.ts");
  const T0 = 1_791_700_000_000;
  type E = import("./sync/merge.ts").SyncEntity;
  const base = { ...emptyData(), milestones: [{ ...item({ id: "m1", owner: "user1", remindAt: "09:00", remindDays: 0 }), updatedAt: T0 } as unknown as E] };
  const edit = (patch: Partial<Milestone>, now: number) => {
    const next = base.milestones.map((m) => ({ ...m, ...patch }) as E);
    const r = stampCollection(base.milestones, next, {}, now, "milestones");
    return { ...base, milestones: r.items };
  };
  const phone = edit({ reminders: [0, 3], showInToday: 3 }, T0 + 10);
  const laptop = edit({ icon: "👶", color: "grape", showAge: false }, T0 + 20);
  for (const merged of [mergeData(phone, laptop), mergeData(laptop, phone)]) {
    const m = merged.milestones[0] as unknown as Milestone;
    assert.deepEqual([m.reminders, m.showInToday, m.icon, m.color, m.showAge], [[0, 3], 3, "👶", "grape", false]);
  }
  const cfg = { owner: "user1", users: ["user1", "user2"] };
  const doc = { revision: 1, updatedAt: T0, data: mergeData(phone, laptop), users: {} };
  assert.equal(viewFor(doc, "user2", cfg, T0).data.milestones.length, 0);
  const forged = { ...emptyData(), milestones: [{ ...item({ id: "m1", owner: "user2", title: "чужое" }), updatedAt: T0 + 99 } as unknown as E] };
  const after = applyPut(doc, "user2", forged, cfg, T0 + 100).doc;
  assert.equal((viewFor(after, "user1", cfg, T0 + 101).data.milestones[0] as unknown as Milestone).title, "Дата");
});
