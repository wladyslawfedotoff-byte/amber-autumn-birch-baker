// `npm test` finds test files by pattern (1.27). This guards that no test file
// sits where the pattern does not look, so it would silently never run.
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const SKIP = new Set(["node_modules", ".git", "dist", ".output", ".nitro", ".graphicle", ".tanstack", "coverage"]);
const PATTERN = "'{src,server,scripts}/**/*.test.{ts,mjs}'";

function testFiles(dir) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (SKIP.has(entry.name)) continue;
    const path = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...testFiles(path));
    else if (/\.test\.[cm]?[jt]sx?$/.test(entry.name)) out.push(relative(root, path).split("\\").join("/"));
  }
  return out;
}

test("npm test runs tests by pattern, not by a hand-written list", () => {
  const script = JSON.parse(readFileSync(join(root, "package.json"), "utf8")).scripts.test;
  assert.ok(script.includes(PATTERN), script);
  assert.doesNotMatch(script, /\.test\.ts(?!})/);
});

test("every test file is inside the pattern", () => {
  const files = testFiles(root);
  assert.ok(files.length > 60, `found ${files.length}`);
  const outside = files.filter((f) => !/^(src|server|scripts)\/.+\.test\.(ts|mjs)$/.test(f));
  assert.deepEqual(outside, []);
});
