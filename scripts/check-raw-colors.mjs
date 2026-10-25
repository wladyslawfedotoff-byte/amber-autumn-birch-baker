// Design-token guard (1.20): raw colours (#hex, rgb(), hsl()) are allowed only
// in src/tokens.css and src/lib/design/tokens.ts. Everything else uses tokens.
// Run: node scripts/check-raw-colors.mjs (part of `npm run lint`).
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const root = new URL("..", import.meta.url).pathname;
const ALLOWED = new Set(["src/tokens.css", "src/lib/design/tokens.ts", "src/routeTree.gen.ts"]);
const RAW = /(?<![\w&/-])#[0-9a-fA-F]{3,8}\b(?![\w-])|\b(?:rgba?|hsla?)\(/g;

function* files(dir) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) yield* files(path);
    else if (/\.(tsx?|css)$/.test(name) && !/\.test\.tsx?$/.test(name)) yield path;
  }
}

let found = 0;
for (const path of files(join(root, "src"))) {
  const rel = relative(root, path);
  if (ALLOWED.has(rel)) continue;
  readFileSync(path, "utf8").split("\n").forEach((line, i) => {
    if (line.trim().startsWith("//") || line.trim().startsWith("*")) return;
    for (const m of line.matchAll(RAW)) {
      found++;
      console.error(`${rel}:${i + 1}: raw colour ${m[0]} — use a token (src/tokens.css / src/lib/design/tokens.ts)`);
    }
  });
}
if (found) process.exitCode = 1;
else console.log("raw colours: none outside the tokens");
