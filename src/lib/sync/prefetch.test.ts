import assert from "node:assert/strict";
import { test } from "node:test";
import { isFresh, needsFirstCopy, PREFETCH_SCRIPT } from "./prefetch.ts";

test("first copy is prefetched only on a device without a synced copy", () => {
  assert.equal(needsFirstCopy(null), true);
  assert.equal(needsFirstCopy("not json"), true);
  assert.equal(needsFirstCopy(JSON.stringify({ base: null, dirty: true })), true);
  assert.equal(needsFirstCopy(JSON.stringify({ base: 12, revision: 12 })), false);
  assert.equal(needsFirstCopy(JSON.stringify({ base: 0 })), false);
});

test("a stale or future prefetch is ignored", () => {
  assert.equal(isFresh({ t0: 1_000 }, 2_000), true);
  assert.equal(isFresh({ t0: 1_000 }, 40_000), false);
  assert.equal(isFresh({ t0: 5_000 }, 1_000), false);
  assert.equal(isFresh(null, 1_000), false);
});

test("the inline script asks only the app's own sync endpoint", () => {
  assert.match(PREFETCH_SCRIPT, /fetch\("\/api\/sync"/);
  assert.doesNotMatch(PREFETCH_SCRIPT, /https?:/);
  assert.match(PREFETCH_SCRIPT, /typeof b\.base==="number"/);
});
