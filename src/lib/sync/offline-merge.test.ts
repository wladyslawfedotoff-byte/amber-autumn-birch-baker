/**
 * Offline scenarios on top of the per-field merge: one phone edits without
 * network while another device keeps syncing; when the phone comes back its
 * copy is merged with the server's. Nothing may be lost and both orders must
 * give the same result.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { emptyData, mergeData, stampCollection, type SyncData, type SyncEntity } from "./merge.ts";

function doc(tasks: SyncEntity[], tombs: Record<string, number> = {}): SyncData {
  const base = emptyData();
  return { ...base, tasks, tombstones: { ...base.tombstones, tasks: tombs } };
}

/** A local edit as the app does it: stamps the changed fields. */
function edit(d: SyncData, next: SyncEntity[], now: number): SyncData {
  const result = stampCollection(d.tasks, next, d.tombstones.tasks, now, "tasks");
  return { ...d, tasks: result.items, tombstones: { ...d.tombstones, tasks: result.tombs } };
}

const base = doc(edit(doc([]), [{ id: "t", title: "Купить", notes: "", remindAt: null }], 100).tasks);
const sorted = (d: SyncData) => [...d.tasks].sort((a, b) => a.id.localeCompare(b.id)).map(({ id, title, notes, remindAt, remindLead }) => ({ id, title, notes, remindAt, remindLead }));

test("different fields edited offline and online both survive", () => {
  const t = base.tasks[0]!;
  const phone = edit(base, [{ ...t, title: "Купить хлеб", remindAt: "10:00", remindLead: 15 }], 1_000);
  const server = edit(base, [{ ...t, notes: "в пекарне" }], 2_000);
  const ab = mergeData(phone, server);
  assert.deepEqual(sorted(ab), [{ id: "t", title: "Купить хлеб", notes: "в пекарне", remindAt: "10:00", remindLead: 15 }]);
  assert.deepEqual(sorted(mergeData(server, phone)), sorted(ab));
});

test("the same field: the later edit wins, whichever side merges first", () => {
  const t = base.tasks[0]!;
  const phone = edit(base, [{ ...t, title: "с телефона" }], 3_000);
  const server = edit(base, [{ ...t, title: "с компьютера" }], 2_000);
  assert.equal(mergeData(phone, server).tasks[0]!.title, "с телефона");
  assert.equal(mergeData(server, phone).tasks[0]!.title, "с телефона");
});

test("equal stamps resolve the same way on every device", () => {
  const t = base.tasks[0]!;
  const a = edit(base, [{ ...t, title: "A" }], 5_000);
  const b = edit(base, [{ ...t, title: "B" }], 5_000);
  assert.equal(mergeData(a, b).tasks[0]!.title, mergeData(b, a).tasks[0]!.title);
});

test("deleted offline vs edited online: the later action wins", () => {
  const t = base.tasks[0]!;
  const deletedOffline = edit(base, [], 4_000);
  const editedBefore = edit(base, [{ ...t, notes: "раньше" }], 3_000);
  assert.equal(mergeData(deletedOffline, editedBefore).tasks.length, 0);
  const editedAfter = edit(base, [{ ...t, notes: "позже" }], 5_000);
  const merged = mergeData(deletedOffline, editedAfter);
  assert.equal(merged.tasks.length, 1, "an edit after the delete brings it back");
  assert.equal(merged.tasks[0]!.notes, "позже");
});

test("tasks created on both sides while apart are all kept", () => {
  const phone = edit(base, [...base.tasks, { id: "p1", title: "в метро" }, { id: "p2", title: "за городом" }], 1_000);
  const server = edit(base, [...base.tasks, { id: "s1", title: "на работе" }], 1_500);
  assert.deepEqual(
    mergeData(phone, server).tasks.map((t) => t.id).sort(),
    ["p1", "p2", "s1", "t"],
  );
});

test("completing offline and renaming online keep both", () => {
  const t = base.tasks[0]!;
  const phone = edit(base, [{ ...t, done: true, completedAt: 1_000 }], 1_000);
  const server = edit(base, [{ ...t, title: "Купить молоко" }], 1_200);
  const merged = mergeData(phone, server).tasks[0]!;
  assert.equal(merged.done, true);
  assert.equal(merged.title, "Купить молоко");
});
