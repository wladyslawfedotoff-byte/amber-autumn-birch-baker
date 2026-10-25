import { test } from "node:test";
import assert from "node:assert/strict";
import { rootSizeFor, TEXT_SIZE_SCRIPT } from "./text-size.ts";

test("default iOS size keeps the 16px root", () => assert.equal(rootSizeFor(17), 16));
test("larger settings scale, capped", () => {
  assert.equal(rootSizeFor(19), 18);
  assert.equal(rootSizeFor(23), 21.75);
  assert.equal(rootSizeFor(53), 22);
  assert.equal(rootSizeFor(14), 14);
  assert.equal(rootSizeFor(0), 16);
});
test("inline script parses", () => assert.doesNotThrow(() => new Function(TEXT_SIZE_SCRIPT)));
