import assert from "node:assert/strict";
import test from "node:test";
import { isBlocked, safeDependsOn, wouldCycle } from "./task-deps.ts";

const tasks = [
  { id: "a", done: false, dependsOn: null as string | null },
  { id: "b", done: false, dependsOn: "a" },
  { id: "c", done: true, dependsOn: "a" },
];

test("blocked while prereq is open", () => {
  assert.equal(isBlocked(tasks[1]!, tasks), true);
  assert.equal(isBlocked({ done: false, dependsOn: "a" }, [{ id: "a", done: true }]), false);
  assert.equal(isBlocked({ done: false, dependsOn: "missing" }, tasks), false);
});

test("cycle detection", () => {
  assert.equal(wouldCycle("a", "b", tasks), true); // b → a → b
  // c depends on a; a → c would cycle
  assert.equal(wouldCycle("a", "c", tasks), true);
  assert.equal(wouldCycle("a", "a", tasks), true);
  assert.equal(wouldCycle("b", null, tasks), false);
  const chain = [
    { id: "1", dependsOn: null as string | null },
    { id: "2", dependsOn: "1" },
    { id: "3", dependsOn: "2" },
  ];
  assert.equal(wouldCycle("1", "3", chain), true);
  assert.equal(wouldCycle("3", "1", chain), false); // already 3→2→1
  assert.equal(safeDependsOn("1", "3", chain), null);
  assert.equal(safeDependsOn("3", "x", chain), null);
  assert.equal(safeDependsOn("a", "b", [{ id: "a", dependsOn: null }, { id: "b", dependsOn: null }]), "b");
});
