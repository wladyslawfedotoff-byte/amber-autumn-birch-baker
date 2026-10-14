import assert from "node:assert/strict";
import test from "node:test";
import {
  emptyQueue,
  enqueue,
  isFatal,
  markFailed,
  nextReady,
  parseQueue,
  pendingFor,
  pendingUploads,
  remove,
  retryDelay,
} from "./queue.ts";

const base = { parentKind: "task" as const, parentId: "t1", name: "photo.jpg", mime: "image/jpeg", size: 1000 };

test("enqueue, dedupe, remove", () => {
  let q = enqueue(emptyQueue(), { ...base, id: "a1aaaaaa", createdAt: 1 });
  q = enqueue(q, { ...base, id: "a1aaaaaa", createdAt: 2 });
  q = enqueue(q, { ...base, id: "b2bbbbbb", createdAt: 3, parentId: "t2" });
  assert.equal(pendingUploads(q), 2);
  assert.equal(pendingFor(q, "task", "t1").length, 1);
  q = remove(q, "a1aaaaaa");
  assert.deepEqual(q.items.map((i) => i.id), ["b2bbbbbb"]);
});

test("failed item waits; next ready is oldest", () => {
  let q = enqueue(emptyQueue(), { ...base, id: "a1aaaaaa", createdAt: 10 });
  q = enqueue(q, { ...base, id: "b2bbbbbb", createdAt: 5 });
  assert.equal(nextReady(q, 0)?.id, "b2bbbbbb");
  q = markFailed(q, "b2bbbbbb", 1000, "offline", () => 0.5);
  assert.equal(nextReady(q, 1000)?.id, "a1aaaaaa");
  assert.equal(q.items.find((i) => i.id === "b2bbbbbb")?.retryAt, 1000 + retryDelay(1, () => 0.5));
  assert.equal(nextReady(q, 1000 + 60_000)?.id, "b2bbbbbb");
});

test("survives restart and drops garbage", () => {
  const q = enqueue(emptyQueue(), { ...base, id: "a1aaaaaa", createdAt: 1 });
  assert.deepEqual(parseQueue(JSON.parse(JSON.stringify(q))), q);
  assert.deepEqual(parseQueue({ items: [{ id: 1 }, null, { ...base }] }).items, []);
  assert.deepEqual(parseQueue("nope"), emptyQueue());
});

test("fatal errors are not retried", () => {
  assert.equal(isFatal("bad_type"), true);
  assert.equal(isFatal("too_large"), true);
  assert.equal(isFatal("offline"), false);
  assert.equal(isFatal("not_found"), false); // task may not have synced yet
});
