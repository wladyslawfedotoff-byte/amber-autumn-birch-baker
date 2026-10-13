import assert from "node:assert/strict";
import test from "node:test";
import { localStorageKv, memoryKv, scopeOf, scopedKey, wipeScope, writeQueue } from "./local-db.ts";

test("partition names: a login, or «_» for unknown / unsafe values", () => {
  assert.equal(scopeOf("user1"), "user1");
  assert.equal(scopeOf(null), "_");
  assert.equal(scopeOf(""), "_");
  assert.equal(scopeOf("../user2"), "_");
  assert.equal(scopeOf("User1"), "_");
});

test("two profiles on one device never read each other's copy; sign-out wipes only one", async () => {
  const kv = memoryKv();
  await kv.set(scopedKey("user1", "srok-planner"), '{"tasks":["mine"]}');
  await kv.set(scopedKey("user1", "outbox"), "{}");
  await kv.set(scopedKey("user2", "srok-planner"), '{"tasks":["wife"]}');
  assert.equal(await kv.get(scopedKey("user2", "srok-planner")), '{"tasks":["wife"]}');
  assert.equal(await kv.get(scopedKey("user2", "outbox")), null);
  await wipeScope(kv, "user1");
  assert.deepEqual((await kv.keys()).sort(), ["user2:srok-planner"]);
  // A login that is a prefix of another one is not touched.
  await kv.set("user10:srok-planner", "x");
  await wipeScope(kv, "user1");
  assert.ok((await kv.keys()).includes("user10:srok-planner"));
});

test("write queue: ordered, newest value wins, deletes", async () => {
  const kv = memoryKv();
  const writes: string[] = [];
  const spy = { ...kv, set: async (key: string, value: string) => (writes.push(value), kv.set(key, value)) };
  const queue = writeQueue(spy);
  void queue.write("k", "1");
  void queue.write("k", "2");
  void queue.write("k", "3");
  await queue.idle();
  assert.equal(await kv.get("k"), "3");
  assert.ok(writes.length <= 2, `coalesced: ${writes.join(",")}`);
  void queue.write("k", null);
  await queue.idle();
  assert.equal(await kv.get("k"), null);
});

test("a failing write does not stop later ones", async () => {
  const kv = memoryKv();
  let fail = true;
  const flaky = {
    ...kv,
    set: async (key: string, value: string) => {
      if (fail) {
        fail = false;
        throw new Error("quota");
      }
      return kv.set(key, value);
    },
  };
  const queue = writeQueue(flaky);
  await queue.write("a", "1");
  await queue.write("a", "2");
  assert.equal(await kv.get("a"), "2");
});

test("localStorage fallback keeps the same per-user keys", async () => {
  const map = new Map<string, string>();
  const store = {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
    get length() {
      return map.size;
    },
    key: (i: number) => [...map.keys()][i] ?? null,
    clear: () => map.clear(),
  } as Storage;
  // Object.keys(localStorage) lists stored keys in browsers; emulate that.
  const proxy = new Proxy(store, { ownKeys: () => [...map.keys()], getOwnPropertyDescriptor: () => ({ enumerable: true, configurable: true }) });
  const kv = localStorageKv(proxy);
  await kv.set("user1:outbox", "a");
  await kv.set("user2:outbox", "b");
  await wipeScope(kv, "user2");
  assert.deepEqual(await kv.keys(), ["user1:outbox"]);
});
