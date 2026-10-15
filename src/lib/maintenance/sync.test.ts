import assert from "node:assert/strict";
import test from "node:test";
import { COLLECTIONS, emptyData, mergeData, normalizeData, stampCollection, type SyncData, type SyncEntity } from "../sync/merge.ts";
import { applyPut, viewFor, type AclConfig, type WorldDoc } from "../sync/world.ts";
import { addPain, buildRule, createAsset, logService, removeEntry, setMileage } from "./ops.ts";
import type { Asset } from "../planner-types.ts";

const TODAY = "2026-10-14";
const T0 = 1_800_000_000_000;

function base(): Asset {
  const a = createAsset({ name: "Легковая", kind: "car", km: 80000 }, "a1", T0, TODAY)!;
  const b = buildRule(a, { title: "Замена масла", everyKm: 10000, lastDoneAt: "2026-06-02", lastDoneKm: 74200 }, { rule: "r1", entry: "e1" }, TODAY)!;
  return { ...a, rules: [b.rule], log: [b.entry!] };
}

/** A device edits the card locally and stamps it the way the app does. */
function edit(data: SyncData, change: (a: Asset) => Asset, now: number): SyncData {
  const next = (data.assets as unknown as Asset[]).map((a) => change({ ...a }));
  const stamped = stampCollection(data.assets, next as unknown as SyncEntity[], data.tombstones.assets, now, "assets");
  return { ...data, assets: stamped.items, tombstones: { ...data.tombstones, assets: stamped.tombs } };
}

function seeded(): SyncData {
  const first = stampCollection([], [base() as unknown as SyncEntity], {}, T0, "assets");
  return { ...emptyData(), assets: first.items };
}

const asset = (d: SyncData) => d.assets[0] as unknown as Asset;

test("assets are a synced collection", () => {
  assert.ok((COLLECTIONS as readonly string[]).includes("assets"));
  const old = normalizeData({ tasks: [], lists: [], projects: [] });
  assert.ok(old.ok);
  assert.deepEqual(old.ok ? old.data.assets : null, [], "an old document without assets becomes an empty collection");
});

test("two devices add different log entries, rules and pains offline: nothing is lost", () => {
  const start = seeded();
  const phone = edit(start, (a) => logService(a, { title: "Шиномонтаж", date: "2026-10-10", km: 83000, cost: 2000 }, { entry: "e-phone", reading: "rd-p" }, TODAY)!.asset, T0 + 10);
  const tablet = edit(start, (a) => addPain(setMileage(a, 83500, TODAY, "rd-t")!, "Стук", "p-tab", T0 + 20)!, T0 + 20);
  const merged = mergeData(phone, tablet);
  const a = asset(merged);
  assert.deepEqual(a.log.map((e) => e.id).sort(), ["e-phone", "e1"]);
  assert.equal(a.pains.length, 1);
  assert.equal(a.km, 83500);
  assert.deepEqual(a.readings.map((r) => r.id).sort(), ["rd-p", "rd-t"]);
  // commutative
  assert.deepEqual(asset(mergeData(tablet, phone)).log.map((e) => e.id).sort(), ["e-phone", "e1"]);
});

test("same entry edited on one device and deleted on another: the delete wins over older edits, the other entries stay", () => {
  const start = seeded();
  const a1 = edit(start, (a) => logService(a, { title: "Колодки", date: "2026-10-01", cost: 5000 }, { entry: "e2", reading: "r" }, TODAY)!.asset, T0 + 5);
  const phone = edit(a1, (a) => removeEntry(a, "e2"), T0 + 50);
  const tablet = edit(a1, (a) => ({ ...a, log: a.log.map((e) => (e.id === "e2" ? { ...e, note: "заметка" } : e)) }), T0 + 30);
  const merged = asset(mergeData(phone, tablet));
  assert.deepEqual(merged.log.map((e) => e.id), ["e1"]);
});

test("whole card deleted on one device stays deleted after merge", () => {
  const start = seeded();
  const stamped = stampCollection(start.assets, [], start.tombstones.assets, T0 + 9, "assets");
  const deleted = { ...start, assets: stamped.items, tombstones: { ...start.tombstones, assets: stamped.tombs } };
  const other = edit(start, (a) => ({ ...a, notes: "старое" }), T0 + 4);
  assert.equal(mergeData(deleted, other).assets.length, 0);
});

const CFG: AclConfig = { owner: "user1", users: ["user1", "user2"] };

function world(data: SyncData): WorldDoc {
  return { revision: 1, updatedAt: T0, data, users: {} };
}

test("sharing: a card is visible to its members only (existing owner/members model)", () => {
  const mine = { ...base(), owner: "user1" } as unknown as SyncEntity;
  const shared = { ...base(), id: "a2", owner: "user1", members: ["user2"] } as unknown as SyncEntity;
  const stamped = stampCollection([], [mine, shared], {}, T0, "assets");
  const doc = world({ ...emptyData(), assets: stamped.items });
  const forUser2 = viewFor(doc, "user2", CFG, T0 + 1).data.assets.map((a) => a.id);
  assert.deepEqual(forUser2, ["a2"]);
  const forUser1 = viewFor(doc, "user1", CFG, T0 + 1).data.assets.map((a) => a.id).sort();
  assert.deepEqual(forUser1, ["a1", "a2"]);
});

test("sharing: a member can add to the card but a stranger's edit of a private card is refused", () => {
  const shared = { ...base(), id: "a2", owner: "user1", members: ["user2"] } as unknown as SyncEntity;
  const priv = { ...base(), id: "a1", owner: "user1" } as unknown as SyncEntity;
  const stamped = stampCollection([], [priv, shared], {}, T0, "assets");
  const doc = world({ ...emptyData(), assets: stamped.items });
  // user2 sends what it sees, with a new log entry on the shared card and a vandalised private one it should not even have
  const seen = viewFor(doc, "user2", CFG, T0 + 1).data;
  const edited = edit(seen, (a) => logService(a, { title: "Мойка", date: TODAY, cost: 500 }, { entry: "e-u2", reading: "r" }, TODAY)!.asset, T0 + 100);
  const out = applyPut(doc, "user2", edited, CFG, T0 + 101).doc;
  const a2 = out.data.assets.find((a) => a.id === "a2") as unknown as Asset;
  assert.ok(a2.log.some((e) => e.id === "e-u2"));
  assert.ok(out.data.assets.some((a) => a.id === "a1"), "private card kept");
  const a1 = out.data.assets.find((a) => a.id === "a1") as unknown as Asset;
  assert.equal(a1.log.length, 1);
});
