import assert from "node:assert/strict";
import test from "node:test";
import { RETRY_MAX_MS, acknowledge, diffChanges, emptyOutbox, failed, parseOutbox, pendingCount, record, retryDelay } from "./outbox.ts";

const t = (id: string, updatedAt: number, title = id) => ({ id, updatedAt, title });

test("diff: new, edited, deleted entities and settings", () => {
  const a = t("a", 1);
  const b = t("b", 1);
  const prev = { tasks: [a, b], lists: [], settingsUpdatedAt: 5 };
  const next = { tasks: [a, t("b", 2, "b2"), t("c", 3)], lists: [], settingsUpdatedAt: 6 };
  assert.deepEqual(diffChanges(prev, next), [
    { collection: "tasks", id: "b", op: "put" },
    { collection: "tasks", id: "c", op: "put" },
    { collection: "settings", id: "settings", op: "put" },
  ]);
  assert.deepEqual(diffChanges({ tasks: [a, b] }, { tasks: [b] }), [{ collection: "tasks", id: "a", op: "delete" }]);
  const same = [a];
  assert.deepEqual(diffChanges({ tasks: same }, { tasks: same }), []);
});

test("record keeps one entry per entity with the newest change", () => {
  let box = record(emptyOutbox(), [{ collection: "tasks", id: "a", op: "put" }], 10);
  box = record(box, [{ collection: "tasks", id: "b", op: "put" }], 11);
  box = record(box, [{ collection: "tasks", id: "a", op: "delete" }], 12);
  assert.equal(pendingCount(box), 2);
  assert.deepEqual(
    box.entries.map((e) => [e.id, e.op, e.seq]),
    [
      ["b", "put", 2],
      ["a", "delete", 3],
    ],
  );
});

test("an upload acknowledges only what it carried; later edits stay queued", () => {
  let box = record(emptyOutbox(), [{ collection: "tasks", id: "a", op: "put" }], 1);
  const carried = box.seq; // upload starts here
  box = record(box, [{ collection: "tasks", id: "b", op: "put" }], 2); // edit while in flight
  box = failed(box, 100, () => 0.5);
  box = acknowledge(box, carried);
  assert.deepEqual(box.entries.map((e) => e.id), ["b"]);
  assert.equal(box.attempts, 0);
  assert.equal(box.retryAt, null);
});

test("an entity edited again during the upload is not acknowledged", () => {
  let box = record(emptyOutbox(), [{ collection: "tasks", id: "a", op: "put" }], 1);
  const carried = box.seq;
  box = record(box, [{ collection: "tasks", id: "a", op: "put" }], 2);
  assert.equal(pendingCount(acknowledge(box, carried)), 1);
});

test("retry delay grows and is capped", () => {
  const mid = () => 0.5;
  assert.equal(retryDelay(1, mid), 2_000);
  assert.equal(retryDelay(2, mid), 4_000);
  assert.equal(retryDelay(5, mid), 32_000);
  assert.equal(retryDelay(30, mid), RETRY_MAX_MS);
  assert.ok(retryDelay(1, () => 0) >= 1_600 && retryDelay(1, () => 1) <= 2_400);
  let box = emptyOutbox();
  box = failed(box, 1000, mid);
  box = failed(box, 1000, mid);
  assert.equal(box.attempts, 2);
  assert.equal(box.retryAt, 5_000);
});

test("survives a restart (JSON round trip) and ignores garbage", () => {
  let box = record(emptyOutbox(), [{ collection: "tasks", id: "a", op: "put" }, { collection: "habits", id: "h", op: "delete" }], 7);
  box = failed(box, 50, () => 0.5);
  const restored = parseOutbox(JSON.parse(JSON.stringify(box)));
  assert.deepEqual(restored, box);
  assert.deepEqual(parseOutbox(null), emptyOutbox());
  assert.deepEqual(parseOutbox({ entries: [{ id: 1 }, null] }).entries, []);
  // The sequence never goes back, so new entries always sort after old ones.
  assert.equal(parseOutbox({ seq: 0, entries: [{ collection: "tasks", id: "x", op: "put", at: 1, seq: 9 }] }).seq, 9);
});
