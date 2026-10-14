import assert from "node:assert/strict";
import test from "node:test";
import { dropIndex, placeItem } from "./reorder.ts";

const ids = (list: { id: string }[]) => list.map((x) => x.id).join("");
const abc = [{ id: "a" }, { id: "b" }, { id: "c" }, { id: "d" }];

test("placeItem moves down, up, clamps, ignores unknown", () => {
  assert.equal(ids(placeItem(abc, "a", 2)), "bcad");
  assert.equal(ids(placeItem(abc, "d", 0)), "dabc");
  assert.equal(ids(placeItem(abc, "b", 99)), "acdb");
  assert.equal(ids(placeItem(abc, "b", -5)), "bacd");
  assert.equal(ids(placeItem(abc, "z", 1)), "abcd");
  assert.equal(ids(abc), "abcd");
});

test("dropIndex by row midpoints", () => {
  const rects = [0, 44, 88, 132].map((top) => ({ top, height: 44 }));
  assert.equal(dropIndex(10, rects), 0);
  assert.equal(dropIndex(30, rects), 1);
  assert.equal(dropIndex(100, rects), 2);
  assert.equal(dropIndex(500, rects), 3);
  assert.equal(dropIndex(5, []), 0);
});
