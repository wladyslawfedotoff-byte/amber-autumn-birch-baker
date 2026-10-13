import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { renderServiceWorker } from "./sw-plugin.mjs";

const template = readFileSync(new URL("./sw-template.js", import.meta.url), "utf8");

test("service worker gets the version, a build id and the hashed files", () => {
  const sw = renderServiceWorker(template, { version: "1.8.0", files: ["assets/index-A.js", "assets/styles-B.css", "assets/index-A.js.map", "assets/index-A.js"] });
  assert.match(sw, /const VERSION = "1\.8\.0-[0-9a-f]{10}";/);
  assert.ok(sw.includes('const PRECACHE = ["/assets/index-A.js","/assets/styles-B.css"];'));
  assert.ok(!sw.includes("__PRECACHE__") && !sw.includes("__VERSION__"));
});

test("a different build gives a different service worker (so browsers update)", () => {
  const a = renderServiceWorker(template, { version: "1.8.0", files: ["assets/index-A.js"] });
  const b = renderServiceWorker(template, { version: "1.8.0", files: ["assets/index-C.js"] });
  assert.notEqual(a, b);
});

test("never caches data, sign-in or the worker itself", () => {
  assert.ok(template.includes('url.pathname.startsWith("/api/")'));
  assert.ok(template.includes('url.pathname === "/login"'));
  assert.ok(template.includes("!response.redirected"));
});
