import assert from "node:assert/strict";
import test from "node:test";
import { BANNED, findBanned, hashWord } from "./brand-check.mjs";

test("hashes are 16 hex chars and the list is not empty", () => {
  assert.match(hashWord("Пора"), /^[0-9a-f]{16}$/);
  assert.ok(BANNED.size > 5);
});

test("ordinary words pass", () => {
  assert.deepEqual(findBanned("const task = addTask({ title: 'Купить хлеб' }); // sync, patch, gzip"), []);
});

test("a banned word is found case-insensitively with its line", () => {
  const word = [..."kcitkcit"].reverse().join("");
  const hits = findBanned(`first line\nlike ${word.toUpperCase()} does`);
  assert.equal(hits.length, 1);
  assert.equal(hits[0].line, 2);
});
