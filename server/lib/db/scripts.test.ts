/**
 * The maintenance scripts on a 1.12 data folder (pora.db): reset-password,
 * restore-backup (from a JSON backup and from a database copy), export-json,
 * db-snapshot — run as separate processes next to a live store, like
 * `docker exec pora-app node scripts/…` does.
 */
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { stableStringify } from "../../../src/lib/sync/merge.ts";
import { SyncStore } from "../sync-store.ts";
import { loadUsersFile } from "../user-store.ts";
import { readStoredDoc } from "./doc-tables.ts";
import { parseStoredDoc } from "./legacy.ts";
import { closeStorage, storageFor } from "./storage.ts";
import { ACL, T0, buildLegacyFixture, edit, task } from "./test-fixture.ts";

const scripts = fileURLToPath(new URL("../../../scripts/", import.meta.url));
const TS = ["--experimental-strip-types", "--no-warnings"];

function run(dir: string, script: string, args: string[] = []): string {
  return execFileSync(process.execPath, [...TS, join(scripts, script), ...args], { env: { ...process.env, DATA_DIR: dir, APP_USERS: "user1,user2" }, encoding: "utf8" });
}

async function upgraded(): Promise<string> {
  const dir = mkdtempSync(join(tmpdir(), "pora-scripts-"));
  await buildLegacyFixture(dir, { tasks: 12 });
  assert.equal(storageFor(dir).mode, "sqlite");
  return dir;
}

function cleanup(dir: string): void {
  closeStorage(dir);
  rmSync(dir, { recursive: true, force: true });
}

test("reset-password.mjs on pora.db: removes the in-app password, bumps the epoch, the running server sees it at once", async () => {
  const dir = await upgraded();
  try {
    assert.ok(loadUsersFile(dir).users.user2?.passwordHash);
    const list = run(dir, "reset-password.mjs", ["--list"]);
    assert.match(list, /user2\s+пароль из приложения/);
    assert.match(run(dir, "reset-password.mjs", ["user2"]), /снова пароль из \.env/);
    const users = loadUsersFile(dir);
    assert.equal(users.users.user2?.passwordHash, undefined);
    assert.equal(users.users.user2?.epoch, 3);
    assert.equal(existsSync(join(dir, "users.json")), false, "no users.json is created");
  } finally {
    cleanup(dir);
  }
});

test("restore-backup.mjs on pora.db: restores a JSON backup inside one transaction; the live store reloads; a pre-restore copy is kept", async () => {
  const dir = await upgraded();
  try {
    const store = new SyncStore(dir, { backupIntervalMs: 0 });
    const before = await store.get();
    // Make a backup by writing (JSON snapshot of the state before), then delete things.
    const v = await store.getFor("user1", ACL);
    await store.putFor("user1", ACL, v.revision, edit(v.data, { tasks: (items) => items.slice(5) }, T0 + 900_000));
    const backups = readdirSync(join(dir, "backups")).filter((n) => n.startsWith("pora-")).sort().reverse();
    assert.equal(parseStoredDoc(readFileSync(join(dir, "backups", backups[0]!), "utf8")).revision, before.revision, "newest backup = state before the write");
    assert.equal(parseStoredDoc(readFileSync(join(dir, "backups", backups[0]!), "utf8")).data.tasks.length, before.data.tasks.length);
    const dry = run(dir, "restore-backup.mjs", [backups[0]!, "--dry-run"]);
    assert.match(dry, /--dry-run/);
    const out = run(dir, "restore-backup.mjs", [backups[0]!]);
    assert.match(out, /Готово: ревизия/);
    const after = await store.get();
    assert.ok(after.revision > before.revision + 1);
    assert.deepEqual(after.data.tasks.map((t) => t.id).sort(), before.data.tasks.map((t) => t.id).sort(), "deleted tasks are back");
    assert.ok(readdirSync(join(dir, "backups")).some((n) => n.endsWith("-pre-restore.json")));
    // Devices sync on (their base is now stale → 409 → merge).
    const conflict = await store.putFor("user1", ACL, v.revision, v.data);
    assert.equal(conflict.status, "conflict");
  } finally {
    cleanup(dir);
  }
});

test("db-snapshot.mjs + restore-backup.mjs from a database copy; export-json.mjs writes the 1.11 files", async () => {
  const dir = await upgraded();
  try {
    const store = new SyncStore(dir);
    assert.match(run(dir, "db-snapshot.mjs"), /Готово: .*backup\/pora-\d{4}-\d{2}-\d{2}\.db/);
    const copies = readdirSync(join(dir, "backup")).filter((n) => /^pora-\d{4}-\d{2}-\d{2}\.db$/.test(n));
    assert.equal(copies.length, 1);
    const v = await store.getFor("user1", ACL);
    await store.putFor("user1", ACL, v.revision, edit(v.data, { tasks: (items) => items.filter((t) => t.id !== "t0") }, T0 + 900_000));
    assert.equal((await store.get()).data.tasks.some((t) => t.id === "t0"), false);
    assert.match(run(dir, "restore-backup.mjs", [copies[0]!]), /Готово/);
    assert.equal((await store.get()).data.tasks.some((t) => t.id === "t0"), true, "restored from the .db copy");
    assert.match(run(dir, "restore-backup.mjs", ["--list"]), /Копии базы целиком/);
    // Export for a rollback.
    const target = join(dir, "export-test");
    const out = run(dir, "export-json.mjs", ["--to", target]);
    assert.match(out, /pora\.json/);
    const exported = parseStoredDoc(readFileSync(join(target, "pora.json"), "utf8"));
    const storage = storageFor(dir);
    assert.equal(storage.mode, "sqlite");
    if (storage.mode === "sqlite") assert.equal(stableStringify(exported), stableStringify(readStoredDoc(storage.db)));
    assert.ok(existsSync(join(target, "users.json")) && existsSync(join(target, "attachments", "meta.json")) && existsSync(join(target, "assistant", "user1.json")));
    const again = spawnSync(process.execPath, [...TS, join(scripts, "export-json.mjs"), "--to", target], { env: { ...process.env, DATA_DIR: dir }, encoding: "utf8" });
    assert.equal(again.status, 1, "never overwrites an existing folder");
    // The live store keeps working afterwards.
    const v2 = await store.getFor("user2", ACL);
    const res = await store.putFor("user2", ACL, v2.revision, edit(v2.data, { tasks: (items) => [task("late", 1), ...items] }, T0 + 950_000));
    assert.equal(res.status, "ok");
  } finally {
    cleanup(dir);
  }
});

test("scripts on a 1.11 folder (no pora.db yet) keep their JSON behaviour", async () => {
  const dir = mkdtempSync(join(tmpdir(), "pora-scripts-json-"));
  try {
    await buildLegacyFixture(dir, { tasks: 3 });
    assert.match(run(dir, "reset-password.mjs", ["user2"]), /снова пароль из \.env/);
    assert.equal(JSON.parse(readFileSync(join(dir, "users.json"), "utf8")).users.user2.passwordHash, undefined);
    assert.equal(existsSync(join(dir, "pora.db")), false, "scripts never create the database");
    const fail = spawnSync(process.execPath, [...TS, join(scripts, "export-json.mjs")], { env: { ...process.env, DATA_DIR: dir }, encoding: "utf8" });
    assert.equal(fail.status, 1);
  } finally {
    cleanup(dir);
  }
});
