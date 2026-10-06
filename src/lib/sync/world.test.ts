import assert from "node:assert/strict";
import test from "node:test";
import { emptyData, mergeData, pruneTombstones, sameData, stampCollection, type SyncData, type SyncEntity } from "./merge.ts";
import { applyPut, viewFor, type AclConfig, type WorldDoc } from "./world.ts";

const CFG: AclConfig = { owner: "user1", users: ["user1", "user2"] };
const T0 = 1_750_000_000_000;

function task(id: string, fields: Record<string, unknown> = {}, updatedAt = T0): SyncEntity {
  return { id, title: id, notes: "", listId: null, done: false, priority: 0, due: null, tags: [], subtasks: [], createdAt: T0, completedAt: null, updatedAt, ...fields };
}

function world(data: Partial<SyncData>, revision = 7): WorldDoc {
  return { revision, updatedAt: T0, data: { ...emptyData(), ...data }, users: {} };
}

const ids = (data: SyncData, key: "tasks" | "lists" = "tasks") => data[key].map((item) => item.id).sort();

/** One device: edit locally (stamped like the app does), then sync like server-sync.ts integrate(). */
class Device {
  data: SyncData = emptyData();
  base = 0;
  readonly login: string;
  constructor(login: string) {
    this.login = login;
  }
  edit(change: (tasks: SyncEntity[]) => SyncEntity[], now: number, key: "tasks" | "lists" = "tasks"): void {
    const next = change(this.data[key].map((item) => ({ ...item })));
    const stamped = stampCollection(this.data[key], next, this.data.tombstones[key], now, key);
    this.data = { ...this.data, [key]: stamped.items, tombstones: { ...this.data.tombstones, [key]: stamped.tombs } };
  }
  /** Returns the number of PUTs needed to settle. */
  sync(server: { doc: WorldDoc }, now: number, cfg = CFG): number {
    let puts = 0;
    for (let round = 0; round < 6; round++) {
      const view = viewFor(server.doc, this.login, cfg, now);
      const cutoff = now - 30 * 86_400_000;
      const merged = mergeData(this.data, view.data, { cutoff });
      this.data = merged;
      this.base = view.revision;
      if (sameData(pruneTombstones(merged, cutoff), pruneTombstones(view.data, cutoff))) return puts;
      puts++;
      server.doc = applyPut(server.doc, this.login, merged, cfg, now + round).doc;
    }
    throw new Error(`${this.login}: sync does not settle`);
  }
}

test("migration: a single-user pora.json becomes APP_OWNER's data, nothing rewritten", () => {
  const old = world({
    tasks: [task("t1"), task("t2", { done: true })],
    lists: [{ id: "l1", name: "Дом", updatedAt: T0 }],
    tombstones: { lists: {}, tasks: { gone: T0 - 5 }, habits: {}, milestones: {}, projects: {} },
    settings: { workStart: "08:00", workEnd: "17:00", updatedAt: T0 },
  });
  const user1 = viewFor(old, "user1", CFG, T0 + 1);
  assert.equal(user1.revision, 7, "the owner's devices keep their revision: no forced re-download");
  assert.deepEqual(ids(user1.data), ["t1", "t2"]);
  assert.equal(user1.data.tasks[0]!.owner, undefined, "entities are not rewritten");
  assert.equal(user1.data.tombstones.tasks.gone, T0 - 5);
  assert.equal(user1.data.settings.workStart, "08:00");
  const user2 = viewFor(old, "user2", CFG, T0 + 1);
  assert.equal(user2.revision, 1);
  assert.deepEqual(user2.data.tasks, []);
  assert.deepEqual(user2.data.lists, []);
  // With another APP_OWNER the same file belongs to that user.
  assert.deepEqual(ids(viewFor(old, "user2", { owner: "user2", users: ["user1", "user2"] }, T0).data), ["t1", "t2"]);
});

test("ACL: B can neither read nor change nor delete A's private items via sync", () => {
  const server = { doc: world({ tasks: [task("secret", { owner: "user1", title: "Подарок для Пользователя 2" })] }) };
  assert.deepEqual(viewFor(server.doc, "user2", CFG, T0).data.tasks, [], "not readable");
  const forged = emptyData();
  forged.tasks = [task("secret", { owner: "user2", title: "взломано", members: ["user2"] }, T0 + 10_000)];
  const res = applyPut(server.doc, "user2", forged, CFG, T0 + 20_000);
  assert.equal(res.denied, 1);
  const user1View = viewFor(res.doc, "user1", CFG, T0 + 20_000);
  assert.equal(user1View.data.tasks[0]!.title, "Подарок для Пользователя 2", "not modifiable");
  assert.equal(user1View.data.tasks[0]!.owner, "user1");
  assert.equal(user1View.revision, 7, "user1's view did not change");
  const user2View = viewFor(res.doc, "user2", CFG, T0 + 20_000);
  assert.deepEqual(user2View.data.tasks, [], "still not readable");
  assert.ok(user2View.data.tombstones.tasks.secret! >= T0 + 10_000, "her device drops the forged copy");
  const del = emptyData();
  del.tombstones.tasks.secret = T0 + 99_999;
  const res2 = applyPut(res.doc, "user2", del, CFG, T0 + 30_000);
  assert.deepEqual(ids(viewFor(res2.doc, "user1", CFG, T0 + 30_000).data), ["secret"], "not deletable");
  // Legacy entities without owner belong to APP_OWNER, so they are private too.
  const legacy = world({ tasks: [task("old")] });
  assert.deepEqual(viewFor(legacy, "user2", CFG, T0).data.tasks, []);
});

test("new entities belong to the sender; owner cannot be changed later", () => {
  const server = { doc: world({}) };
  const user2 = new Device("user2");
  user2.edit((tasks) => [task("z1", { title: "Купить молоко" }), ...tasks], T0 + 1);
  assert.equal(user2.sync(server, T0 + 2), 1);
  assert.equal(server.doc.data.tasks[0]!.owner, "user2");
  assert.equal(user2.data.tasks[0]!.owner, "user2", "the device learns the owner without another push");
  assert.deepEqual(viewFor(server.doc, "user1", CFG, T0 + 3).data.tasks, [], "private by default");
  // Claiming another owner = sharing with them, never giving it away.
  const claim = emptyData();
  claim.tasks = [task("z2", { owner: "user1" }, T0 + 5)];
  const res = applyPut(server.doc, "user2", claim, CFG, T0 + 6).doc;
  const z2 = res.data.tasks.find((t) => t.id === "z2")!;
  assert.equal(z2.owner, "user2");
  assert.deepEqual(z2.members, ["user1"]);
  // Trying to take over an existing shared task.
  const shared = world({ tasks: [task("s", { owner: "user1", members: ["user2"] })] });
  const take = emptyData();
  take.tasks = [task("s", { owner: "user2", members: ["user2"], title: "моё" }, T0 + 100)];
  const after = applyPut(shared, "user2", take, CFG, T0 + 200).doc.data.tasks[0]!;
  assert.equal(after.owner, "user1");
  assert.equal(after.title, "моё", "editing a shared task is allowed");
});

test("assignment: an assigned task appears for the assignee; completion syncs back with who did it", () => {
  const server = { doc: world({}) };
  const user1 = new Device("user1");
  const user2 = new Device("user2");
  user1.edit((tasks) => [task("a1", { title: "Записать к врачу", due: "2026-10-07", assignee: "user2" }), ...tasks], T0 + 1);
  user1.sync(server, T0 + 2);
  user2.sync(server, T0 + 3);
  assert.deepEqual(ids(user2.data), ["a1"]);
  const user1Rev = viewFor(server.doc, "user1", CFG, T0 + 3).revision;
  user2.edit((tasks) => tasks.map((t) => (t.id === "a1" ? { ...t, done: true, completedAt: T0 + 10 } : t)), T0 + 10);
  user2.sync(server, T0 + 11);
  const forUser1 = viewFor(server.doc, "user1", CFG, T0 + 12);
  assert.ok(forUser1.revision > user1Rev, "user1's revision moves, his devices pull");
  user1.sync(server, T0 + 12);
  const a1 = user1.data.tasks.find((t) => t.id === "a1")!;
  assert.equal(a1.done, true);
  assert.equal(a1.completedBy, "user2", "«выполнил(а) user2»");
  assert.equal(a1.updatedBy, "user2");
  // Unassigning hides it again (and her devices drop it).
  user1.edit((tasks) => tasks.map((t) => (t.id === "a1" ? { ...t, assignee: null } : t)), T0 + 20);
  user1.sync(server, T0 + 21);
  user2.sync(server, T0 + 22);
  assert.deepEqual(user2.data.tasks, []);
});

test("shared task: concurrent edits of different fields both survive; views converge", () => {
  const server = { doc: world({}) };
  const user1 = new Device("user1");
  const user2 = new Device("user2");
  user1.edit((tasks) => [task("s1", { title: "Отпуск", members: ["user2"] }), ...tasks], T0 + 1);
  user1.sync(server, T0 + 2);
  user2.sync(server, T0 + 3);
  user1.edit((tasks) => tasks.map((t) => ({ ...t, title: "Отпуск в мае" })), T0 + 10);
  user2.edit((tasks) => tasks.map((t) => ({ ...t, notes: "билеты до 1 марта", tags: ["семья"] })), T0 + 11);
  user1.sync(server, T0 + 12);
  user2.sync(server, T0 + 13);
  user1.sync(server, T0 + 14);
  for (const device of [user1, user2]) {
    const s1 = device.data.tasks[0]!;
    assert.equal(s1.title, "Отпуск в мае");
    assert.equal(s1.notes, "билеты до 1 марта");
    assert.deepEqual(s1.tags, ["семья"]);
    assert.equal(s1.owner, "user1");
  }
  assert.equal(user1.sync(server, T0 + 15), 0, "settled");
  assert.equal(user2.sync(server, T0 + 16), 0, "settled");
});

test("shared list: its tasks are visible to members; nobody can push tasks into a private list", () => {
  const server = {
    doc: world({
      lists: [
        { id: "shop", name: "Покупки", owner: "user1", members: ["user2"], updatedAt: T0 },
        { id: "mine", name: "Личное", owner: "user1", updatedAt: T0 },
      ],
      tasks: [task("milk", { owner: "user1", listId: "shop" }), task("diary", { owner: "user1", listId: "mine" })],
    }),
  };
  const user2 = new Device("user2");
  user2.sync(server, T0 + 1);
  assert.deepEqual(ids(user2.data, "lists"), ["shop"]);
  assert.deepEqual(ids(user2.data), ["milk"]);
  user2.edit((tasks) => [task("bread", { listId: "shop" }), task("spy", { listId: "mine" }), ...tasks], T0 + 5);
  user2.sync(server, T0 + 6);
  const user1 = viewFor(server.doc, "user1", CFG, T0 + 7).data;
  assert.ok(ids(user1).includes("bread"), "added to the shared list → user1 sees it");
  assert.ok(!ids(user1).includes("spy"), "a task aimed at user1's private list stays user2's own");
  // Unsharing the list: its tasks disappear from user2's view (tombstoned there).
  const v = new Device("user1");
  v.sync(server, T0 + 8);
  v.edit((lists) => lists.map((l) => (l.id === "shop" ? { ...l, members: [] } : l)), T0 + 9, "lists");
  v.sync(server, T0 + 10);
  user2.sync(server, T0 + 11);
  assert.deepEqual(ids(user2.data, "lists"), []);
  assert.deepEqual(ids(user2.data), ["bread", "spy"], "user1's milk is gone; her own tasks stay hers");
});

test("unshare → tombstone in that view; share again → comes back on the device", () => {
  const server = { doc: world({}) };
  const user1 = new Device("user1");
  const user2 = new Device("user2");
  user1.edit((tasks) => [task("x", { members: ["user2"] }), ...tasks], T0 + 1);
  user1.sync(server, T0 + 2);
  user2.sync(server, T0 + 3);
  assert.deepEqual(ids(user2.data), ["x"]);
  user1.edit((tasks) => tasks.map((t) => ({ ...t, members: [] })), T0 + 4);
  user1.sync(server, T0 + 5);
  user2.sync(server, T0 + 6);
  assert.deepEqual(user2.data.tasks, []);
  // user1's clock is behind the server: the re-share stamp is older than her tombstone.
  user1.edit((tasks) => tasks.map((t) => ({ ...t, members: ["user2"] })), T0 + 4.5);
  user1.sync(server, T0 + 7);
  user2.sync(server, T0 + 8);
  assert.deepEqual(ids(user2.data), ["x"], "the entity was touched (aclAt) so it beats the tombstone");
  assert.equal(user2.sync(server, T0 + 9), 0);
});

test("deleting: a participant leaves, the owner deletes for everyone", () => {
  const server = { doc: world({}) };
  const user1 = new Device("user1");
  const user2 = new Device("user2");
  user1.edit((tasks) => [task("d", { members: ["user2"] }), ...tasks], T0 + 1);
  user1.sync(server, T0 + 2);
  user2.sync(server, T0 + 3);
  user2.edit(() => [], T0 + 4);
  user2.sync(server, T0 + 5);
  user1.sync(server, T0 + 6);
  assert.deepEqual(ids(user1.data), ["d"], "still there for the owner");
  assert.deepEqual(user1.data.tasks[0]!.members, []);
  assert.deepEqual(user2.data.tasks, []);
  user1.edit((tasks) => tasks.map((t) => ({ ...t, members: ["user2"] })), T0 + 7);
  user1.sync(server, T0 + 8);
  user2.sync(server, T0 + 9);
  assert.deepEqual(ids(user2.data), ["d"]);
  user1.edit(() => [], T0 + 10);
  user1.sync(server, T0 + 11);
  user2.sync(server, T0 + 12);
  assert.deepEqual(user2.data.tasks, []);
  assert.deepEqual(server.doc.data.tasks, []);
  assert.ok(server.doc.data.tombstones.tasks.d);
});

test("per-user revisions and settings: a private edit does not disturb the other profile", () => {
  const server = { doc: world({}) };
  const user1 = new Device("user1");
  const user2 = new Device("user2");
  user2.sync(server, T0);
  const before = viewFor(server.doc, "user2", CFG, T0).revision;
  user1.edit((tasks) => [task("p"), ...tasks], T0 + 1);
  user1.data = { ...user1.data, settings: { workStart: "07:00", workEnd: "15:00", updatedAt: T0 + 1 } };
  user1.sync(server, T0 + 2);
  const zv = viewFor(server.doc, "user2", CFG, T0 + 3);
  assert.equal(zv.revision, before, "user2's ETag unchanged");
  assert.equal(zv.data.settings.workStart, "09:00");
  assert.equal(viewFor(server.doc, "user1", CFG, T0 + 3).data.settings.workStart, "07:00");
});

test("custom-dates repeat («Выбранные даты») merges per date across profiles", () => {
  const server = { doc: world({}) };
  const user1 = new Device("user1");
  const user2 = new Device("user2");
  user1.edit((tasks) => [task("r", { repeat: "dates", repeatDates: ["2026-10-07", "2026-11-03"], due: "2026-10-07", members: ["user2"] }), ...tasks], T0 + 1);
  user1.sync(server, T0 + 2);
  user2.sync(server, T0 + 3);
  user1.edit((tasks) => tasks.map((t) => ({ ...t, repeatDates: [...(t.repeatDates as string[]), "2026-12-24"] })), T0 + 10);
  user2.edit((tasks) => tasks.map((t) => ({ ...t, repeatDates: (t.repeatDates as string[]).filter((d) => d !== "2026-11-03").concat("2027-01-15") })), T0 + 11);
  user1.sync(server, T0 + 12);
  user2.sync(server, T0 + 13);
  user1.sync(server, T0 + 14);
  for (const device of [user1, user2]) {
    assert.deepEqual([...(device.data.tasks[0]!.repeatDates as string[])].sort(), ["2026-10-07", "2026-12-24", "2027-01-15"]);
  }
});

test("subtasks: added on one device survive the server and reach the other device and the partner", () => {
  const server = { doc: world({}) };
  const phone = new Device("user1");
  const laptop = new Device("user1");
  const partner = new Device("user2");
  phone.edit(() => [task("trip", {}, T0 + 1)], T0 + 1);
  phone.sync(server, T0 + 2);
  laptop.sync(server, T0 + 3);
  // add two subtasks on the phone, one more on the laptop at the same time
  phone.edit((ts) => ts.map((t) => ({ ...t, subtasks: [{ id: "s1", title: "Билеты", done: false }, { id: "s2", title: "Отель", done: false }] })), T0 + 10);
  laptop.edit((ts) => ts.map((t) => ({ ...t, subtasks: [{ id: "s3", title: "Страховка", done: false }] })), T0 + 11);
  phone.sync(server, T0 + 12);
  laptop.sync(server, T0 + 13);
  phone.sync(server, T0 + 14);
  const titles = (d: Device) => ((d.data.tasks[0]!.subtasks as SyncEntity[]) ?? []).map((s) => s.title).sort();
  assert.deepEqual(titles(phone), ["Билеты", "Отель", "Страховка"]);
  assert.deepEqual(titles(laptop), ["Билеты", "Отель", "Страховка"]);
  // share with the partner: she sees the subtasks and ticks one, the owner gets it back
  phone.edit((ts) => ts.map((t) => ({ ...t, members: ["user2"] })), T0 + 20);
  phone.sync(server, T0 + 21);
  partner.sync(server, T0 + 22);
  assert.deepEqual(titles(partner), ["Билеты", "Отель", "Страховка"]);
  partner.edit((ts) => ts.map((t) => ({ ...t, subtasks: (t.subtasks as SyncEntity[]).map((s) => (s.id === "s1" ? { ...s, done: true } : s)) })), T0 + 30);
  partner.sync(server, T0 + 31);
  laptop.sync(server, T0 + 32);
  const s1 = (laptop.data.tasks[0]!.subtasks as SyncEntity[]).find((s) => s.id === "s1")!;
  assert.equal(s1.done, true);
  assert.equal((laptop.data.tasks[0]!.subtasks as SyncEntity[]).length, 3);
  // the stored world doc keeps them too (single-user / restore paths read it as is)
  assert.equal((server.doc.data.tasks[0]!.subtasks as SyncEntity[]).length, 3);
});
