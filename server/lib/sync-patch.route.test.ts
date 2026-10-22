/**
 * 1.15 sync routes: PATCH /api/sync merges only the changed entities and
 * answers without the document; GET answers 304 for a known revision (also
 * when a proxy turned the tag into W/"…").
 */
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const dir = mkdtempSync(join(tmpdir(), "pora-sync-patch-"));
process.env.DATA_DIR = dir;
process.env.APP_USERS = "user1,user2";
process.env.USER_USER1_PASSWORD = "user1-password-123456";
process.env.USER_USER2_PASSWORD = "user2-password-123456";
process.env.SESSION_SECRET = "x".repeat(48);

const { resetAuthCaches } = await import("./auth.ts");
resetAuthCaches();
const { storageFor } = await import("./db/storage.ts");
storageFor(dir);
const { default: patchRoute } = await import("../routes/api/sync.patch.ts");
const { default: getRoute } = await import("../routes/api/sync.get.ts");
const { default: putRoute } = await import("../routes/api/sync.put.ts");
const { emptyData } = await import("../../src/lib/sync/merge.ts");

type Ev = Parameters<typeof patchRoute>[0];

function event(method: string, headers: Record<string, string> = {}, body?: string, login = "user1"): Ev {
  const url = new URL("http://localhost/api/sync");
  return { url, req: new Request(url, { method, body, headers }) as Ev["req"], res: { headers: new Headers() }, context: { poraUser: login } };
}

const task = (id: string, title: string, at: number) => ({ id, title, notes: "", listId: null, done: false, priority: 0, due: null, tags: [], subtasks: [], createdAt: 1, completedAt: null, updatedAt: at });

test("PATCH merges changed tasks, answers with revisions only", async () => {
  const seed = { ...emptyData(), tasks: [task("a", "A", 1), task("b", "B", 1)] };
  const start = (await (await getRoute(event("GET"))).json()) as { revision: number };
  const put = await putRoute(event("PUT", { "if-match": `"${start.revision}"`, "content-type": "application/json" }, JSON.stringify(seed)));
  assert.equal(put.status, 200);
  const base = ((await put.json()) as { revision: number }).revision;

  const change = { ...emptyData(), tasks: [task("b", "B — готово", 50)] };
  const res = await patchRoute(event("PATCH", { "if-match": `"${base}"`, "content-type": "application/json" }, JSON.stringify(change)));
  assert.equal(res.status, 200);
  const body = (await res.json()) as Record<string, unknown>;
  assert.equal(body.prevRevision, base);
  assert.equal(body.revision, base + 1);
  assert.equal("data" in body, false, "no document in the answer");

  const doc = (await (await getRoute(event("GET"))).json()) as { data: { tasks: { id: string; title: string }[] } };
  assert.deepEqual(doc.data.tasks.map((t) => [t.id, t.title]), [["a", "A"], ["b", "B — готово"]]);
});

test("PATCH from a device with an old base still merges; prevRevision tells it to pull", async () => {
  const head = (await (await getRoute(event("GET"))).json()) as { revision: number };
  const change = { ...emptyData(), tasks: [task("c", "Новая", 60)], after: { tasks: { c: null } } };
  const res = await patchRoute(event("PATCH", { "if-match": `"${head.revision - 1}"`, "content-type": "application/json" }, JSON.stringify(change)));
  const body = (await res.json()) as { revision: number; prevRevision: number };
  assert.equal(body.prevRevision, head.revision);
  const doc = (await (await getRoute(event("GET"))).json()) as { data: { tasks: { id: string }[] } };
  assert.equal(doc.data.tasks[0]?.id, "c", "placed where the device has it (on top)");
});

test("PATCH with a tombstone deletes; a bad body is refused", async () => {
  const change = { ...emptyData(), tombstones: { ...emptyData().tombstones, tasks: { a: Date.now() + 60_000 } } };
  assert.equal((await patchRoute(event("PATCH", { "if-match": '"1"', "content-type": "application/json" }, JSON.stringify(change)))).status, 200);
  const doc = (await (await getRoute(event("GET"))).json()) as { data: { tasks: { id: string }[] } };
  assert.equal(doc.data.tasks.some((t) => t.id === "a"), false);
  assert.equal((await patchRoute(event("PATCH", { "content-type": "application/json" }, "{nope"))).status, 400);
  assert.equal((await patchRoute(event("PATCH", { "content-type": "application/json" }, JSON.stringify({ tasks: 5 })))).status, 400);
});

test("PATCH: another profile's device copy is refused (412)", async () => {
  const res = await patchRoute(event("PATCH", { "x-pora-user": "user2", "content-type": "application/json" }, JSON.stringify(emptyData())));
  assert.equal(res.status, 412);
});

test("GET with the known revision: 304, also for a weak tag", async () => {
  const first = await getRoute(event("GET"));
  const tag = first.headers.get("etag")!;
  assert.equal((await getRoute(event("GET", { "if-none-match": tag }))).status, 304);
  assert.equal((await getRoute(event("GET", { "if-none-match": `W/${tag}` }))).status, 304);
  assert.equal((await getRoute(event("GET", { "if-none-match": '"0"' }))).status, 200);
});
