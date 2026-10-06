import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { verifyPasswordHash } from "./password-hash.mjs";

const here = fileURLToPath(new URL(".", import.meta.url));

test("reset-password.mjs removes the in-app password and bumps the epoch", () => {
  const dir = mkdtempSync(join(tmpdir(), "pora-reset-"));
  try {
    writeFileSync(join(dir, "users.json"), JSON.stringify({ v: 1, users: { user2: { passwordHash: "scrypt:1024:8:1:c2FsdHNhbHQ:aGFzaGhhc2hoYXNoaGFzaA", changedAt: 1, epoch: 2 } } }));
    const out = execFileSync(process.execPath, [join(here, "reset-password.mjs"), "user2"], {
      env: { ...process.env, DATA_DIR: dir, APP_USERS: "user1,user2" },
      encoding: "utf8",
    });
    assert.match(out, /снова пароль из \.env/);
    const file = JSON.parse(readFileSync(join(dir, "users.json"), "utf8"));
    assert.equal(file.users.user2.passwordHash, undefined);
    assert.equal(file.users.user2.epoch, 3);
    assert.equal(statSync(join(dir, "users.json")).mode & 0o777, 0o600);
    const list = execFileSync(process.execPath, [join(here, "reset-password.mjs"), "--list"], {
      env: { ...process.env, DATA_DIR: dir, APP_USERS: "user1,user2" },
      encoding: "utf8",
    });
    assert.match(list, /user1\s+пароль из \.env/);
    const bad = spawnSync(process.execPath, [join(here, "reset-password.mjs"), "Не Логин"], { env: { ...process.env, DATA_DIR: dir }, encoding: "utf8" });
    assert.equal(bad.status, 1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("hash-password.mjs <login> prints a ready USER_<LOGIN>_PASSWORD_HASH line", () => {
  const out = execFileSync(process.execPath, [join(here, "hash-password.mjs"), "my-son"], { input: "длинная фраза для сына", encoding: "utf8" });
  const match = /^USER_MY_SON_PASSWORD_HASH=(scrypt:\S+)\n$/.exec(out);
  assert.ok(match, out);
  assert.equal(verifyPasswordHash("длинная фраза для сына", match[1]), true);
  const bare = execFileSync(process.execPath, [join(here, "hash-password.mjs")], { input: "длинная фраза для сына", encoding: "utf8" });
  assert.match(bare, /^scrypt:/);
  const short = spawnSync(process.execPath, [join(here, "hash-password.mjs"), "user1"], { input: "short", encoding: "utf8" });
  assert.equal(short.status, 1);
});
