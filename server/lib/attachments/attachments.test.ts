import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { attachConfig, isAllowedMime } from "./config.ts";
import { resolveInside, safeDisplayName, validAttachId } from "./names.ts";
import { AttachStore } from "./store.ts";

test("config: ATTACH_MAX_MB and mime allowlist", () => {
  assert.equal(attachConfig({}).maxBytes, 25 * 1024 * 1024);
  assert.equal(attachConfig({ ATTACH_MAX_MB: "10" }).maxBytes, 10 * 1024 * 1024);
  assert.equal(attachConfig({ ATTACH_MAX_MB: "999" }).maxBytes, 25 * 1024 * 1024); // capped default
  assert.equal(isAllowedMime("image/jpeg"), true);
  assert.equal(isAllowedMime("image/jpeg; charset=binary"), true);
  assert.equal(isAllowedMime("application/pdf"), true);
  assert.equal(isAllowedMime("text/html"), false);
  assert.equal(isAllowedMime("application/x-msdownload"), false);
});

test("ids and names refuse path traversal", () => {
  assert.equal(validAttachId("abc12345"), true);
  assert.equal(validAttachId("../etc/passwd"), false);
  assert.equal(validAttachId(".."), false);
  assert.equal(validAttachId("a/b"), false);
  assert.equal(validAttachId(""), false);
  assert.equal(safeDisplayName("../../etc/passwd"), "etcpasswd");
  assert.equal(safeDisplayName("фото до.jpg"), "фото до.jpg");
  assert.equal(safeDisplayName(""), "файл");
  const dir = "/data/attachments/files";
  assert.equal(resolveInside(dir, "deadbeefdeadbeef"), join(dir, "deadbeefdeadbeef"));
  assert.equal(resolveInside(dir, "../pora.json"), null);
  assert.equal(resolveInside(dir, "dead/beef"), null);
});

test("store: put, get, ACL parent, remove; traversal ids rejected", async () => {
  const root = await mkdtemp(join(tmpdir(), "pora-attach-"));
  try {
    const store = new AttachStore(root);
    const meta = await store.put({
      owner: "user1",
      parent: { kind: "task", id: "task-1" },
      name: "scan.pdf",
      mime: "application/pdf",
      bytes: new Uint8Array([1, 2, 3, 4]),
      id: "f1f1f1f1f1f1f1f1",
    });
    assert.equal(meta.size, 4);
    assert.equal((await store.get(meta.id))?.name, "scan.pdf");
    assert.equal((await store.listFor({ kind: "task", id: "task-1" })).length, 1);
    assert.equal((await store.listFor({ kind: "task", id: "other" })).length, 0);
    const bytes = await store.readBytes(meta.id);
    assert.deepEqual([...bytes!], [1, 2, 3, 4]);
    assert.equal(store.filePath("../x"), null);
    assert.equal(await store.get("../pora.json"), null);
    await store.remove(meta.id);
    assert.equal(await store.get(meta.id), null);
    assert.equal(await store.readBytes(meta.id), null);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
