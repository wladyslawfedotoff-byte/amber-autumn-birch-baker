/**
 * POST /api/quick-add as a route: key checks, per-IP bad-key limit (no global
 * lock), malformed keys not counted, a form body lands in «Входящие».
 */
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const dir = mkdtempSync(join(tmpdir(), "pora-qa-route-"));
process.env.DATA_DIR = dir;
process.env.APP_USERS = "user1,user2";
process.env.USER_USER1_PASSWORD = "user1-password-123456";
process.env.USER_USER2_PASSWORD = "user2-password-123456";
process.env.SESSION_SECRET = "x".repeat(48);

const { resetAuthCaches } = await import("../auth.ts");
resetAuthCaches();
const { storageFor } = await import("../db/storage.ts");
storageFor(dir);
const { createToken } = await import("./tokens.ts");
const { BAD_KEYS_PER_IP, resetQuickAddLimit } = await import("./limit.ts");
const { getStore } = await import("../sync-store.ts");
const { aclFor } = await import("../sync-access.ts");
const { principalForLogin } = await import("../principal.ts");
const { default: route } = await import("../../routes/api/quick-add.post.ts");

type Ev = Parameters<typeof route>[0];

function event(key: string | null, ip: string, body: BodyInit, type?: string): Ev {
  const url = new URL("http://localhost/api/quick-add");
  const headers: Record<string, string> = { "x-real-ip": ip };
  if (key !== null) headers.authorization = `Bearer ${key}`;
  if (type) headers["content-type"] = type;
  return { url, req: new Request(url, { method: "POST", body, headers }) as Ev["req"], res: { headers: new Headers() }, context: {} };
}

const made = createToken("user1", "iPhone", Date.now(), dir);
assert.ok("token" in made);
const key = made.token;
const wrong = key.slice(0, -1) + (key.endsWith("A") ? "B" : "A");

test("no key / malformed key: 401, malformed keys are not counted", async () => {
  resetQuickAddLimit();
  assert.equal((await route(event(null, "10.0.0.1", "x"))).status, 401);
  for (let i = 0; i < BAD_KEYS_PER_IP + 5; i++) assert.equal((await route(event("garbage", "10.0.0.1", "x"))).status, 401);
  const ok = await route(event(key, "10.0.0.1", "text=%D0%9C%D0%BE%D0%BB%D0%BE%D0%BA%D0%BE", "application/x-www-form-urlencoded"));
  assert.equal(ok.status, 201, "the same IP still works after junk");
});

test("wrong keys lock only that IP, others keep working", async () => {
  resetQuickAddLimit();
  for (let i = 0; i < BAD_KEYS_PER_IP; i++) assert.equal((await route(event(wrong, "10.0.0.2", "x"))).status, 401);
  assert.equal((await route(event(key, "10.0.0.2", "Хлеб", "text/plain"))).status, 429, "this IP is locked");
  assert.equal((await route(event(key, "10.0.0.3", "Хлеб", "text/plain"))).status, 201, "another IP is not");
});

test("added items reach «Входящие» with via phone", async () => {
  const user = principalForLogin("user1")!;
  const data = (await getStore().getFor("user1", aclFor(user)!)).data;
  const titles = data.tasks.filter((t) => t.via === "phone").map((t) => t.title);
  assert.ok(titles.includes("Молоко"), JSON.stringify(titles));
  assert.ok(titles.includes("Хлеб"));
});
