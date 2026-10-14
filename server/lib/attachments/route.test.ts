/**
 * /api/attachments end to end against a temp DATA_DIR with two profiles:
 * auth required, ACL by parent (owner / member), path traversal, mime/size.
 */
import assert from "node:assert/strict";
import { mkdtempSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const dir = mkdtempSync(join(tmpdir(), "pora-attach-route-"));
process.env.DATA_DIR = dir;
process.env.APP_USERS = "user1,user2,user3";
process.env.USER_USER1_PASSWORD = "user1-password-123456";
process.env.USER_USER2_PASSWORD = "user2-password-123456";
process.env.USER_USER3_PASSWORD = "user3-password-123456";
process.env.ATTACH_MAX_MB = "1";
process.env.SESSION_SECRET = "x".repeat(48);

const { resetAuthCaches } = await import("../auth.ts");
resetAuthCaches();
const { getStore } = await import("../sync-store.ts");
const { aclFor } = await import("../sync-access.ts");
const { principalForLogin } = await import("../principal.ts");
const { default: api } = await import("../../routes/api/attachments/[...].ts");
const { emptyData } = await import("../../../src/lib/sync/merge.ts");

type Ev = Parameters<typeof api>[0];

function event(method: string, path: string, login: string | null, body?: BodyInit, headers: Record<string, string> = {}): Ev {
  const url = new URL(`http://localhost${path}`);
  return {
    url,
    req: new Request(url, { method, body, headers }) as Ev["req"],
    res: { headers: new Headers() },
    context: login ? { poraUser: login } : {},
  };
}

function form(parts: Record<string, string | Blob>, fileName = "photo.jpg"): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(parts)) {
    if (value instanceof Blob) data.set(key, value, fileName);
    else data.set(key, value);
  }
  return data;
}

const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 16, 0x4a, 0x46, 0x49, 0x46]);

test("setup: user1 owns a private task and a task shared with user2", async () => {
  const user1 = principalForLogin("user1")!;
  const acl = aclFor(user1)!;
  const data = emptyData();
  const now = Date.now();
  data.tasks = [
    { id: "private-task", title: "Личное", done: false, updatedAt: now },
    { id: "shared-task", title: "Общее", done: false, members: ["user2"], updatedAt: now },
  ];
  const current = await getStore().getFor("user1", acl);
  const result = await getStore().putFor("user1", acl, current.revision, data);
  assert.equal(result.status, "ok");
});

test("401 without a session", async () => {
  // principalOf falls back to nothing when no login is in context.
  const res = await api(event("GET", "/api/attachments/abcdef12", null));
  assert.equal(res.status, 401);
});

test("upload, read by owner and member; stranger gets 403", async () => {
  const blob = new Blob([JPEG], { type: "image/jpeg" });
  const up = await api(event("POST", "/api/attachments", "user1", form({ file: blob, parentKind: "task", parentId: "shared-task", id: "aaaabbbbccccdddd" })));
  assert.equal(up.status, 201);
  const ok1 = await api(event("GET", "/api/attachments/aaaabbbbccccdddd", "user1"));
  assert.equal(ok1.status, 200);
  assert.equal(ok1.headers.get("content-type"), "image/jpeg");
  assert.equal(ok1.headers.get("x-content-type-options"), "nosniff");
  const ok2 = await api(event("GET", "/api/attachments/aaaabbbbccccdddd", "user2"));
  assert.equal(ok2.status, 200);
  const denied = await api(event("GET", "/api/attachments/aaaabbbbccccdddd", "user3"));
  assert.notEqual(denied.status, 200);
  assert.ok(denied.status === 403 || denied.status === 404);
});

test("cannot upload to someone else's private task", async () => {
  const blob = new Blob([JPEG], { type: "image/jpeg" });
  const res = await api(event("POST", "/api/attachments", "user2", form({ file: blob, parentKind: "task", parentId: "private-task" })));
  assert.ok(res.status === 403 || res.status === 404, `got ${res.status}`);
});

test("path traversal ids are rejected and nothing escapes the folder", async () => {
  for (const id of ["..%2Fpora.json", "..", "%2E%2E%2Fusers.json", "a"]) {
    const res = await api(event("GET", `/api/attachments/${id}`, "user1"));
    assert.ok(res.status === 400 || res.status === 404, `${id}: ${res.status}`);
  }
  const blob = new Blob([JPEG], { type: "image/jpeg" });
  const res = await api(event("POST", "/api/attachments", "user1", form({ file: blob, parentKind: "task", parentId: "shared-task", id: "../../evil" }, "../../evil.jpg")));
  assert.equal(res.status, 201);
  const body = (await res.json()) as { item: { id: string; name: string } };
  assert.notEqual(body.item.id, "../../evil");
  assert.ok(!body.item.name.includes("/"));
  assert.deepEqual(readdirSync(dir).filter((name) => name.startsWith("evil")), []);
});

test("mime allowlist, content sniffing and size limit", async () => {
  const html = new Blob(["<script>alert(1)</script>"], { type: "text/html" });
  const r1 = await api(event("POST", "/api/attachments", "user1", form({ file: html, parentKind: "task", parentId: "shared-task" }, "x.html")));
  assert.equal(r1.status, 415);
  const fake = new Blob(["<html>not an image</html>"], { type: "image/jpeg" });
  const r2 = await api(event("POST", "/api/attachments", "user1", form({ file: fake, parentKind: "task", parentId: "shared-task" })));
  assert.equal(r2.status, 415);
  const big = new Blob([JPEG, new Uint8Array(1024 * 1024 + 10)], { type: "image/jpeg" });
  const r3 = await api(event("POST", "/api/attachments", "user1", form({ file: big, parentKind: "task", parentId: "shared-task" })));
  assert.equal(r3.status, 413);
});

test("delete: stranger cannot, member can", async () => {
  const r1 = await api(event("DELETE", "/api/attachments/aaaabbbbccccdddd", "user3"));
  assert.ok(r1.status === 403 || r1.status === 404);
  const r2 = await api(event("DELETE", "/api/attachments/aaaabbbbccccdddd", "user2"));
  assert.equal(r2.status, 200);
  const r3 = await api(event("GET", "/api/attachments/aaaabbbbccccdddd", "user1"));
  assert.equal(r3.status, 404);
});
