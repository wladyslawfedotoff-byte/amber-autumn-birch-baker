import assert from "node:assert/strict";
import test from "node:test";
import { emptyData, mergeData, pruneTombstones, sameData, stampCollection, type SyncData, type SyncEntity } from "./merge.ts";
import { applyPut, viewFor, type AclConfig, type WorldDoc } from "./world.ts";

const CFG: AclConfig = { owner: "vlad", users: ["vlad", "zhena"] };
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
  const vlad = viewFor(old, "vlad", CFG, T0 + 1);
  assert.equal(vlad.revision, 7, "the owner's devices keep their revision: no forced re-download");
  assert.deepEqual(ids(vlad.data), ["t1", "t2"]);
  assert.equal(vlad.data.tasks[0]!.owner, undefined, "entities are not rewritten");
  assert.equal(vlad.data.tombstones.tasks.gone, T0 - 5);
  assert.equal(vlad.data.settings.workStart, "08:00");
  const zhena = viewFor(old, "zhena", CFG, T0 + 1);
  assert.equal(zhena.revision, 1);
  assert.deepEqual(zhena.data.tasks, []);
  assert.deepEqual(zhena.data.lists, []);
  // With another APP_OWNER the same file belongs to that user.
  assert.deepEqual(ids(viewFor(old, "zhena", { owner: "zhena", users: ["vlad", "zhena"] }, T0).data), ["t1", "t2"]);
});

test("ACL: B can neither read nor change nor delete A's private items via sync", () => {
  const server = { doc: world({ tasks: [task("secret", { owner: "vlad", title: "Подарок для Жени" })] }) };
  assert.deepEqual(viewFor(server.doc, "zhena", CFG, T0).data.tasks, [], "not readable");
  const forged = emptyData();
  forged.tasks = [task("secret", { owner: "zhena", title: "взломано", members: ["zhena"] }, T0 + 10_000)];
  const res = applyPut(server.doc, "zhena", forged, CFG, T0 + 20_000);
  assert.equal(res.denied, 1);
  const vladView = viewFor(res.doc, "vlad", CFG, T0 + 20_000);
  assert.equal(vladView.data.tasks[0]!.title, "Подарок для Жени", "not modifiable");
  assert.equal(vladView.data.tasks[0]!.owner, "vlad");
  assert.equal(vladView.revision, 7, "vlad's view did not change");
  const zhenaView = viewFor(res.doc, "zhena", CFG, T0 + 20_000);
  assert.deepEqual(zhenaView.data.tasks, [], "still not readable");
  assert.ok(zhenaView.data.tombstones.tasks.secret! >= T0 + 10_000, "her device drops the forged copy");
  const del = emptyData();
  del.tombstones.tasks.secret = T0 + 99_999;
  const res2 = applyPut(res.doc, "zhena", del, CFG, T0 + 30_000);
  assert.deepEqual(ids(viewFor(res2.doc, "vlad", CFG, T0 + 30_000).data), ["secret"], "not deletable");
  // Legacy entities without owner belong to APP_OWNER, so they are private too.
  const legacy = world({ tasks: [task("old")] });
  assert.deepEqual(viewFor(legacy, "zhena", CFG, T0).data.tasks, []);
});

test("new entities belong to the sender; owner cannot be changed later", () => {
  const server = { doc: world({}) };
  const zhena = new Device("zhena");
  zhena.edit((tasks) => [task("z1", { title: "Купить молоко" }), ...tasks], T0 + 1);
  assert.equal(zhena.sync(server, T0 + 2), 1);
  assert.equal(server.doc.data.tasks[0]!.owner, "zhena");
  assert.equal(zhena.data.tasks[0]!.owner, "zhena", "the device learns the owner without another push");
  assert.deepEqual(viewFor(server.doc, "vlad", CFG, T0 + 3).data.tasks, [], "private by default");
  // Claiming another owner = sharing with them, never giving it away.
  const claim = emptyData();
  claim.tasks = [task("z2", { owner: "vlad" }, T0 + 5)];
  const res = applyPut(server.doc, "zhena", claim, CFG, T0 + 6).doc;
  const z2 = res.data.tasks.find((t) => t.id === "z2")!;
  assert.equal(z2.owner, "zhena");
  assert.deepEqual(z2.members, ["vlad"]);
  // Trying to take over an existing shared task.
  const shared = world({ tasks: [task("s", { owner: "vlad", members: ["zhena"] })] });
  const take = emptyData();
  take.tasks = [task("s", { owner: "zhena", members: ["zhena"], title: "моё" }, T0 + 100)];
  const after = applyPut(shared, "zhena", take, CFG, T0 + 200).doc.data.tasks[0]!;
  assert.equal(after.owner, "vlad");
  assert.equal(after.title, "моё", "editing a shared task is allowed");
});

test("assignment: an assigned task appears for the assignee; completion syncs back with who did it", () => {
  const server = { doc: world({}) };
  const vlad = new Device("vlad");
  const zhena = new Device("zhena");
  vlad.edit((tasks) => [task("a1", { title: "Записать к врачу", due: "2026-10-07", assignee: "zhena" }), ...tasks], T0 + 1);
  vlad.sync(server, T0 + 2);
  zhena.sync(server, T0 + 3);
  assert.deepEqual(ids(zhena.data), ["a1"]);
  const vladRev = viewFor(server.doc, "vlad", CFG, T0 + 3).revision;
  zhena.edit((tasks) => tasks.map((t) => (t.id === "a1" ? { ...t, done: true, completedAt: T0 + 10 } : t)), T0 + 10);
  zhena.sync(server, T0 + 11);
  const forVlad = viewFor(server.doc, "vlad", CFG, T0 + 12);
  assert.ok(forVlad.revision > vladRev, "vlad's revision moves, his devices pull");
  vlad.sync(server, T0 + 12);
  const a1 = vlad.data.tasks.find((t) => t.id === "a1")!;
  assert.equal(a1.done, true);
  assert.equal(a1.completedBy, "zhena", "«выполнил(а) zhena»");
  assert.equal(a1.updatedBy, "zhena");
  // Unassigning hides it again (and her devices drop it).
  vlad.edit((tasks) => tasks.map((t) => (t.id === "a1" ? { ...t, assignee: null } : t)), T0 + 20);
  vlad.sync(server, T0 + 21);
  zhena.sync(server, T0 + 22);
  assert.deepEqual(zhena.data.tasks, []);
});

test("shared task: concurrent edits of different fields both survive; views converge", () => {
  const server = { doc: world({}) };
  const vlad = new Device("vlad");
  const zhena = new Device("zhena");
  vlad.edit((tasks) => [task("s1", { title: "Отпуск", members: ["zhena"] }), ...tasks], T0 + 1);
  vlad.sync(server, T0 + 2);
  zhena.sync(server, T0 + 3);
  vlad.edit((tasks) => tasks.map((t) => ({ ...t, title: "Отпуск в мае" })), T0 + 10);
  zhena.edit((tasks) => tasks.map((t) => ({ ...t, notes: "билеты до 1 марта", tags: ["семья"] })), T0 + 11);
  vlad.sync(server, T0 + 12);
  zhena.sync(server, T0 + 13);
  vlad.sync(server, T0 + 14);
  for (const device of [vlad, zhena]) {
    const s1 = device.data.tasks[0]!;
    assert.equal(s1.title, "Отпуск в мае");
    assert.equal(s1.notes, "билеты до 1 марта");
    assert.deepEqual(s1.tags, ["семья"]);
    assert.equal(s1.owner, "vlad");
  }
  assert.equal(vlad.sync(server, T0 + 15), 0, "settled");
  assert.equal(zhena.sync(server, T0 + 16), 0, "settled");
});

test("shared list: its tasks are visible to members; nobody can push tasks into a private list", () => {
  const server = {
    doc: world({
      lists: [
        { id: "shop", name: "Покупки", owner: "vlad", members: ["zhena"], updatedAt: T0 },
        { id: "mine", name: "Личное", owner: "vlad", updatedAt: T0 },
      ],
      tasks: [task("milk", { owner: "vlad", listId: "shop" }), task("diary", { owner: "vlad", listId: "mine" })],
    }),
  };
  const zhena = new Device("zhena");
  zhena.sync(server, T0 + 1);
  assert.deepEqual(ids(zhena.data, "lists"), ["shop"]);
  assert.deepEqual(ids(zhena.data), ["milk"]);
  zhena.edit((tasks) => [task("bread", { listId: "shop" }), task("spy", { listId: "mine" }), ...tasks], T0 + 5);
  zhena.sync(server, T0 + 6);
  const vlad = viewFor(server.doc, "vlad", CFG, T0 + 7).data;
  assert.ok(ids(vlad).includes("bread"), "added to the shared list → vlad sees it");
  assert.ok(!ids(vlad).includes("spy"), "a task aimed at vlad's private list stays zhena's own");
  // Unsharing the list: its tasks disappear from zhena's view (tombstoned there).
  const v = new Device("vlad");
  v.sync(server, T0 + 8);
  v.edit((lists) => lists.map((l) => (l.id === "shop" ? { ...l, members: [] } : l)), T0 + 9, "lists");
  v.sync(server, T0 + 10);
  zhena.sync(server, T0 + 11);
  assert.deepEqual(ids(zhena.data, "lists"), []);
  assert.deepEqual(ids(zhena.data), ["bread", "spy"], "vlad's milk is gone; her own tasks stay hers");
});

test("unshare → tombstone in that view; share again → comes back on the device", () => {
  const server = { doc: world({}) };
  const vlad = new Device("vlad");
  const zhena = new Device("zhena");
  vlad.edit((tasks) => [task("x", { members: ["zhena"] }), ...tasks], T0 + 1);
  vlad.sync(server, T0 + 2);
  zhena.sync(server, T0 + 3);
  assert.deepEqual(ids(zhena.data), ["x"]);
  vlad.edit((tasks) => tasks.map((t) => ({ ...t, members: [] })), T0 + 4);
  vlad.sync(server, T0 + 5);
  zhena.sync(server, T0 + 6);
  assert.deepEqual(zhena.data.tasks, []);
  // vlad's clock is behind the server: the re-share stamp is older than her tombstone.
  vlad.edit((tasks) => tasks.map((t) => ({ ...t, members: ["zhena"] })), T0 + 4.5);
  vlad.sync(server, T0 + 7);
  zhena.sync(server, T0 + 8);
  assert.deepEqual(ids(zhena.data), ["x"], "the entity was touched (aclAt) so it beats the tombstone");
  assert.equal(zhena.sync(server, T0 + 9), 0);
});

test("deleting: a participant leaves, the owner deletes for everyone", () => {
  const server = { doc: world({}) };
  const vlad = new Device("vlad");
  const zhena = new Device("zhena");
  vlad.edit((tasks) => [task("d", { members: ["zhena"] }), ...tasks], T0 + 1);
  vlad.sync(server, T0 + 2);
  zhena.sync(server, T0 + 3);
  zhena.edit(() => [], T0 + 4);
  zhena.sync(server, T0 + 5);
  vlad.sync(server, T0 + 6);
  assert.deepEqual(ids(vlad.data), ["d"], "still there for the owner");
  assert.deepEqual(vlad.data.tasks[0]!.members, []);
  assert.deepEqual(zhena.data.tasks, []);
  vlad.edit((tasks) => tasks.map((t) => ({ ...t, members: ["zhena"] })), T0 + 7);
  vlad.sync(server, T0 + 8);
  zhena.sync(server, T0 + 9);
  assert.deepEqual(ids(zhena.data), ["d"]);
  vlad.edit(() => [], T0 + 10);
  vlad.sync(server, T0 + 11);
  zhena.sync(server, T0 + 12);
  assert.deepEqual(zhena.data.tasks, []);
  assert.deepEqual(server.doc.data.tasks, []);
  assert.ok(server.doc.data.tombstones.tasks.d);
});

test("per-user revisions and settings: a private edit does not disturb the other profile", () => {
  const server = { doc: world({}) };
  const vlad = new Device("vlad");
  const zhena = new Device("zhena");
  zhena.sync(server, T0);
  const before = viewFor(server.doc, "zhena", CFG, T0).revision;
  vlad.edit((tasks) => [task("p"), ...tasks], T0 + 1);
  vlad.data = { ...vlad.data, settings: { workStart: "07:00", workEnd: "15:00", updatedAt: T0 + 1 } };
  vlad.sync(server, T0 + 2);
  const zv = viewFor(server.doc, "zhena", CFG, T0 + 3);
  assert.equal(zv.revision, before, "zhena's ETag unchanged");
  assert.equal(zv.data.settings.workStart, "09:00");
  assert.equal(viewFor(server.doc, "vlad", CFG, T0 + 3).data.settings.workStart, "07:00");
});

test("custom-dates repeat («Выбранные даты») merges per date across profiles", () => {
  const server = { doc: world({}) };
  const vlad = new Device("vlad");
  const zhena = new Device("zhena");
  vlad.edit((tasks) => [task("r", { repeat: "dates", repeatDates: ["2026-10-07", "2026-11-03"], due: "2026-10-07", members: ["zhena"] }), ...tasks], T0 + 1);
  vlad.sync(server, T0 + 2);
  zhena.sync(server, T0 + 3);
  vlad.edit((tasks) => tasks.map((t) => ({ ...t, repeatDates: [...(t.repeatDates as string[]), "2026-12-24"] })), T0 + 10);
  zhena.edit((tasks) => tasks.map((t) => ({ ...t, repeatDates: (t.repeatDates as string[]).filter((d) => d !== "2026-11-03").concat("2027-01-15") })), T0 + 11);
  vlad.sync(server, T0 + 12);
  zhena.sync(server, T0 + 13);
  vlad.sync(server, T0 + 14);
  for (const device of [vlad, zhena]) {
    assert.deepEqual([...(device.data.tasks[0]!.repeatDates as string[])].sort(), ["2026-10-07", "2026-12-24", "2027-01-15"]);
  }
});
