/**
 * Lists of a helper key (1.26): only own lists are visible and usable, the
 * same name returns the existing list, listId is checked, nothing is deleted,
 * renames and moves are logged, limits hold, edits merge like sync.
 */
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const dir = mkdtempSync(join(tmpdir(), "pora-helper-lists-"));
process.env.DATA_DIR = dir;
process.env.APP_USERS = "user1,user2";
process.env.USER_USER1_PASSWORD = "user1-password-123456";
process.env.USER_USER2_PASSWORD = "user2-password-123456";
process.env.SESSION_SECRET = "x".repeat(48);

const { resetAuthCaches } = await import("../auth.ts");
resetAuthCaches();
const { storageFor } = await import("../db/storage.ts");
storageFor(dir);
const keys = await import("./keys.ts");
const limits = await import("./limit.ts");
const { MAX_OWN_LISTS } = await import("./tasks.ts");
const { getStore } = await import("../sync-store.ts");
const { aclFor } = await import("../sync-access.ts");
const { principalForLogin } = await import("../principal.ts");
const { emptyData } = await import("../../../src/lib/sync/merge.ts");
const { default: route } = await import("../../routes/api/helper/[...].ts");
const { default: syncGet } = await import("../../routes/api/sync.get.ts");

type Ev = Parameters<typeof route>[0];
function event(method: string, path: string, key: string | null, body?: unknown, login?: string): Ev {
  const url = new URL(`http://localhost${path}`);
  const headers: Record<string, string> = { "x-real-ip": "10.0.0.5" };
  if (key) headers.authorization = `Bearer ${key}`;
  return { url, req: new Request(url, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) }) as Ev["req"], res: { headers: new Headers() }, context: login ? { poraUser: login } : {} };
}
const call = async (method: string, path: string, key: string, body?: unknown) => {
  const res = await route(event(method, path, key, body));
  return { status: res.status, body: (await res.json().catch(() => ({}))) as Record<string, any> };
};

const acl = aclFor(principalForLogin("user1")!)!;
const data = async (login = "user1") => (await getStore().getFor(login, aclFor(principalForLogin(login)!)!)).data;
async function edit(change: (d: Awaited<ReturnType<typeof data>>) => Awaited<ReturnType<typeof data>>) {
  const view = await getStore().getFor("user1", acl);
  const res = await getStore().putFor("user1", acl, view.revision, change(view.data));
  assert.equal(res.status, "ok");
}

// The user's own list and project: never visible to the key.
await edit(() => ({ ...emptyData(), lists: [{ id: "l1", name: "Работа", owner: "user1", updatedAt: 1 }], projects: [{ id: "p1", title: "Ремонт", owner: "user1", stages: [], updatedAt: 1 }], tasks: [] }));

const a = keys.createHelperKey("user1", "Оркестратор");
const b = keys.createHelperKey("user1", "Другой");
assert.ok("token" in a && "token" in b);
const A = a.token;
const B = b.token;
let listA = "";
let listB = "";

test("create a list: regular list with the author stamp; the same name returns it", async () => {
  limits.resetHelperLimits();
  const made = await call("POST", "/api/helper/lists", A, { name: "  Дела бота " });
  assert.equal(made.status, 201, JSON.stringify(made.body));
  listA = made.body.item.id;
  assert.equal(made.body.item.name, "Дела бота");
  const stored = (await data()).lists.find((l) => l.id === listA)!;
  assert.deepEqual(stored.helper, { keyId: a.item.id, name: "Оркестратор" });
  assert.equal(stored.owner, "user1");

  const again = await call("POST", "/api/helper/lists", A, { name: "ДЕЛА БОТА" });
  assert.equal(again.status, 200);
  assert.equal(again.body.item.id, listA);
  assert.equal((await data()).lists.filter((l) => l.helper).length, 1, "no duplicate");

  const other = await call("POST", "/api/helper/lists", B, { name: "Дела бота" });
  assert.equal(other.status, 201, "another key gets its own list");
  listB = other.body.item.id;
  assert.notEqual(listB, listA);
});

test("devices get the new list through sync; another profile does not", async () => {
  const res = await syncGet(event("GET", "/api/sync", null, undefined, "user1"));
  const doc = (await res.json()) as { data: { lists: { id: string }[] } };
  assert.ok(doc.data.lists.some((l) => l.id === listA));
  assert.ok(!(await data("user2")).lists.some((l) => l.id === listA));
});

test("GET /lists shows only own lists", async () => {
  const res = await call("GET", "/api/helper/lists", A);
  assert.deepEqual(res.body.items.map((l: { id: string }) => l.id), [listA]);
  const text = JSON.stringify(res.body);
  for (const secret of ["Работа", "Ремонт", "l1", "p1", listB]) assert.ok(!text.includes(secret), secret);
});

test("list name validation", async () => {
  limits.resetHelperLimits();
  for (const body of [{}, { name: "" }, { name: "   " }, { name: "x".repeat(61) }, { name: "ok", helper: {} }, { name: 5 }]) {
    assert.equal((await call("POST", "/api/helper/lists", A, body)).status, 400, JSON.stringify(body));
  }
});

test("listId in tasks: own list ok, foreign / unknown → 404 and nothing written", async () => {
  limits.resetHelperLimits();
  const ok = await call("POST", "/api/helper/tasks", A, { title: "В список", listId: listA });
  assert.equal(ok.status, 201);
  assert.equal(ok.body.item.listId, listA);
  const before = (await data()).tasks.length;
  for (const listId of ["l1", listB, "no-such-list", "p1"]) {
    const res = await call("POST", "/api/helper/tasks", A, { title: "чужой список", listId });
    assert.equal(res.status, 404, listId);
    assert.equal(res.body.message, (await call("GET", "/api/helper/tasks/no-such-task", A)).body.message, "same answer as an unknown task");
  }
  assert.equal((await data()).tasks.length, before);

  const id = ok.body.item.id;
  for (const listId of ["l1", listB]) {
    assert.equal((await call("PATCH", `/api/helper/tasks/${id}`, A, { listId })).status, 404);
  }
  assert.equal((await data()).tasks.find((t) => t.id === id)!.listId, listA, "unchanged");
  const back = await call("PATCH", `/api/helper/tasks/${id}`, A, { listId: null });
  assert.equal(back.body.item.listId, null, "null → «Входящие»");
  const moved = await call("PATCH", `/api/helper/tasks/${id}`, A, { listId: listA, title: "В список (2)" });
  assert.equal(moved.body.item.listId, listA);
});

test("the user moves the task into his own list or project: listId null, nothing revealed", async () => {
  const id = (await call("GET", "/api/helper/tasks", A)).body.items[0].id as string;
  const t = Date.now() + 50;
  await edit((d) => ({ ...d, tasks: d.tasks.map((x) => (x.id === id ? { ...x, listId: "l1", projectId: "p1", _f: { ...(x._f as object), listId: t, projectId: t }, updatedAt: t } : x)) }));
  const res = await call("GET", `/api/helper/tasks/${id}`, A);
  assert.equal(res.status, 200);
  assert.equal(res.body.item.listId, null);
  assert.ok(!JSON.stringify(res.body).includes("l1") && !JSON.stringify(res.body).includes("p1"));
});

test("rename own list; foreign → 404; a name taken by another own list → 409", async () => {
  limits.resetHelperLimits();
  const res = await call("PATCH", `/api/helper/lists/${listA}`, A, { name: "Поручения" });
  assert.equal(res.status, 200);
  assert.equal((await data()).lists.find((l) => l.id === listA)!.name, "Поручения");
  assert.equal((await call("PATCH", "/api/helper/lists/l1", A, { name: "взлом" })).status, 404);
  assert.equal((await call("PATCH", `/api/helper/lists/${listB}`, A, { name: "взлом" })).status, 404);
  assert.equal((await data()).lists.find((l) => l.id === "l1")!.name, "Работа");
  const second = await call("POST", "/api/helper/lists", A, { name: "Покупки" });
  assert.equal((await call("PATCH", `/api/helper/lists/${second.body.item.id}`, A, { name: " поручения " })).status, 409);
});

test("no delete endpoints for lists or tasks (405), nothing removed", async () => {
  for (const path of ["/api/helper/lists", `/api/helper/lists/${listA}`, "/api/helper/lists/l1"]) {
    assert.equal((await call("DELETE", path, A)).status, 405, path);
  }
  assert.ok((await data()).lists.some((l) => l.id === listA));
  assert.ok((await data()).lists.some((l) => l.id === "l1"));
});

test("a device edit of the list at the same time survives the rename", async () => {
  limits.resetHelperLimits();
  const t = Date.now() + 100;
  await edit((d) => ({ ...d, lists: d.lists.map((l) => (l.id === listA ? { ...l, members: ["user2"], _f: { ...(l._f as object), members: t }, updatedAt: t } : l)) }));
  assert.equal((await call("PATCH", `/api/helper/lists/${listA}`, A, { name: "Поручения бота" })).status, 200);
  const list = (await data()).lists.find((l) => l.id === listA)!;
  assert.equal(list.name, "Поручения бота");
  assert.deepEqual(list.members, ["user2"]);
});

test("the user deletes a helper list in the app: API keeps working, nothing leaks", async () => {
  limits.resetHelperLimits();
  const made = await call("POST", "/api/helper/lists", A, { name: "Удалю" });
  const gone = made.body.item.id as string;
  const task = await call("POST", "/api/helper/tasks", A, { title: "В удаляемом", listId: gone });
  // An old device still points the task at the deleted list.
  await edit((d) => ({ ...d, lists: d.lists.filter((l) => l.id !== gone), tombstones: { ...d.tombstones, lists: { ...d.tombstones.lists, [gone]: Date.now() + 1000 } } }));
  assert.ok(!(await call("GET", "/api/helper/lists", A)).body.items.some((l: { id: string }) => l.id === gone));
  const read = await call("GET", `/api/helper/tasks/${task.body.item.id}`, A);
  assert.equal(read.status, 200);
  assert.equal(read.body.item.listId, null);
  assert.equal((await call("PATCH", `/api/helper/tasks/${task.body.item.id}`, A, { listId: gone })).status, 404);
  assert.equal((await call("GET", "/api/helper/tasks", A)).status, 200);
});

test("action log: list.create, list.rename, task.move (and refusals)", () => {
  const log = keys.auditLog("user1", a.item.id);
  const by = (action: string) => log.filter((e) => e.action === action);
  assert.ok(by("list.create").some((e) => e.summary === "Дела бота"));
  assert.ok(by("list.rename").some((e) => e.summary === "Дела бота → Поручения"));
  assert.ok(by("task.move").some((e) => e.summary.endsWith("→ Входящие")));
  assert.ok(by("task.move").some((e) => e.summary.endsWith("→ Дела бота")));
  assert.ok(by("denied").some((e) => e.summary.includes("список")));
  assert.ok(by("denied").some((e) => e.summary === "удаление списка запрещено"));
  assert.equal(by("list.create").filter((e) => e.summary === "Дела бота").length, 1, "the same-name call is not a new list");
});

test("limits: list creates per hour, lists per key", async () => {
  limits.resetHelperLimits();
  const fresh = keys.createHelperKey("user2", "Лимит");
  assert.ok("token" in fresh);
  for (let i = 0; i < limits.LIST_CREATES_PER_HOUR; i++) assert.equal((await call("POST", "/api/helper/lists", fresh.token, { name: `Список ${i}` })).status, 201);
  assert.equal((await call("POST", "/api/helper/lists", fresh.token, { name: "лишний" })).status, 429);
  assert.equal((await call("POST", "/api/helper/tasks", fresh.token, { title: "задачи не задеты" })).status, 201);
  for (let i = limits.LIST_CREATES_PER_HOUR; i < MAX_OWN_LISTS; i++) {
    if (i % limits.LIST_CREATES_PER_HOUR === 0) limits.resetHelperLimits();
    assert.equal((await call("POST", "/api/helper/lists", fresh.token, { name: `Список ${i}` })).status, 201);
  }
  limits.resetHelperLimits();
  assert.equal((await call("POST", "/api/helper/lists", fresh.token, { name: "тридцать первый" })).status, 409);
  assert.equal((await call("POST", "/api/helper/lists", fresh.token, { name: "список 0" })).status, 200, "an existing name still answers");
});
