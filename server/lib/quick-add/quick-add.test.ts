import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { resetAuthCaches } from "../auth.ts";
import { closeStorage, sqliteOf, storageFor } from "../db/storage.ts";
import { bumpUserEpoch, resetUserStoreCache, setUserPassword } from "../user-store.ts";
import { allowQuickAdd, PER_MINUTE, resetQuickAddLimit } from "./limit.ts";
import { createToken, listTokens, revokeAllTokens, revokeToken, verifyToken } from "./tokens.ts";

function setup(): string {
  const dir = mkdtempSync(join(tmpdir(), "pora-qa-"));
  process.env.DATA_DIR = dir;
  process.env.APP_USERS = "user1,user2";
  process.env.USER_USER1_PASSWORD = "user1-password-123456";
  process.env.USER_USER2_PASSWORD = "user2-password-123456";
  resetAuthCaches();
  resetUserStoreCache();
  storageFor(dir);
  return dir;
}

function done(dir: string): void {
  closeStorage(dir);
  rmSync(dir, { recursive: true, force: true });
}

test("quick add keys: shown once, hash only, verify, revoke", () => {
  const dir = setup();
  try {
    const made = createToken("user1", "iPhone", 1000, dir);
    assert.ok("token" in made);
    const { token, item } = made;
    assert.match(token, /^pora_[A-Za-z0-9_-]{12}\.[A-Za-z0-9_-]{43}$/);
    const row = sqliteOf(dir)!.db.prepare("SELECT * FROM quick_tokens WHERE id = ?").get(item.id) as Record<string, unknown>;
    assert.ok(!JSON.stringify(row).includes(token.split(".")[1]!), "the secret is not stored");
    assert.deepEqual(verifyToken(token, 2000, dir), { login: "user1", id: item.id });
    assert.equal(listTokens("user1", dir)[0]!.lastUsedAt, 2000);
    assert.equal(verifyToken(token.slice(0, -1) + (token.endsWith("A") ? "B" : "A"), 2000, dir), null, "wrong secret");
    assert.equal(verifyToken("pora_bad", 2000, dir), null);
    assert.equal(listTokens("user2", dir).length, 0, "other profile sees nothing");
    assert.equal(revokeToken("user2", item.id, 3000, dir), false, "other profile cannot revoke");
    assert.equal(revokeToken("user1", item.id, 3000, dir), true);
    assert.equal(verifyToken(token, 4000, dir), null, "revoked");
  } finally {
    done(dir);
  }
});

test("quick add keys: password change and «выйти везде» end every key", () => {
  const dir = setup();
  try {
    const a = createToken("user1", "A", 1, dir);
    const b = createToken("user2", "B", 1, dir);
    assert.ok("token" in a && "token" in b);
    bumpUserEpoch("user1", dir);
    assert.equal(verifyToken(a.token, 2, dir), null, "epoch bump");
    assert.ok(verifyToken(b.token, 2, dir), "other profile keeps its key");
    const c = createToken("user2", "C", 3, dir);
    assert.ok("token" in c);
    setUserPassword("user2", "a-new-long-password-42", 4, dir);
    assert.equal(verifyToken(c.token, 5, dir), null, "password change");
    assert.equal(revokeAllTokens("user2", 6, dir) >= 0, true);
  } finally {
    done(dir);
  }
});

test("quick add: 30 per key per minute", () => {
  resetQuickAddLimit();
  for (let i = 0; i < PER_MINUTE; i++) assert.equal(allowQuickAdd("k", 1000 + i), true);
  assert.equal(allowQuickAdd("k", 1100), false);
  assert.equal(allowQuickAdd("other", 1100), true);
  assert.equal(allowQuickAdd("k", 62_000), true, "window passed");
});
