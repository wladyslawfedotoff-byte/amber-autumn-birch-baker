import assert from "node:assert/strict";
import { test } from "node:test";
import { isChunkError, mayReload } from "./stale-chunks.ts";

test("chunk errors of all browsers are recognised", () => {
  assert.ok(isChunkError(new TypeError("Failed to fetch dynamically imported module: /assets/view-abc.js")));
  assert.ok(isChunkError(new TypeError("Importing a module script failed.")));
  assert.ok(isChunkError(new TypeError("error loading dynamically imported module: /assets/x.js")));
  assert.ok(!isChunkError(new Error("Нет связи с сервером.")));
  assert.ok(!isChunkError(null));
});

test("reload only once per 30 s", () => {
  assert.ok(mayReload(null, 1_000));
  assert.ok(!mayReload(1_000, 20_000));
  assert.ok(mayReload(1_000, 40_000));
  assert.ok(mayReload(50_000, 1_000), "clock went back");
  assert.ok(mayReload(Number.NaN, 1_000));
});
