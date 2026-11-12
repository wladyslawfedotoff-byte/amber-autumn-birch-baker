/**
 * «Ключи помощника» (1.25): a key sees and changes only its own tasks, cannot
 * delete, cannot reach any other endpoint; revoked keys fail; limits; log.
 */
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const dir = mkdtempSync(join(tmpdir(), "pora-helper-"));
process.env.DATA_DIR = dir;
process.env.APP_USERS = "user1,user2";
process.env.USER_USER1_PASSWORD = "user1-password-123456";
process.env.USER_USER2_PASSWORD = "user2-password-123456";
process.env.SESSION_SECRET = "x".repeat(48);

const { resetAuthCaches } = await import("../auth.ts");
resetAuthCaches();
const { storageFor, sqliteOf } = await import("../db/storage.ts");
storageFor(dir);
const keys = await import("./keys.ts");
const limits = await import("./limit.ts");
const { createToken } = await import("../quick-add/tokens.ts");
const { getStore } = await import("../sync-store.ts");
const { aclFor } = await import("../sync-access.ts");
const { principalForLogin } = await import("../principal.ts");
const { emptyData } = await import("../../../src/lib/sync/merge.ts");
const { default: route } = await import("../../routes/api/helper/[...].ts");
const { default: keysRoute } = await import("../../routes/api/helper-keys/[...].ts");
const { default: quickAdd } = await import("../../routes/api/quick-add.post.ts");
const { default: auth } = await import("../../middleware/01.auth.ts");
const { sessionCookie } = await import("../session-cookie.ts");

type Ev = Parameters<typeof route>[0];

function event(method: string, path: string, opts: { key?: string | null; body?: unknown; ip?: string; login?: string; cookie?: string } = {}): Ev {
  const url = new URL(`http://localhost${path}`);
  const headers: Record<string, string> = { "x-real-ip": opts.ip ?? "10.0.0.9" };
  if (opts.key) headers.authorization = `Bearer ${opts.key}`;
  if (opts.cookie) headers.cookie = opts.cookie;
  if (opts.body !== undefined) headers["content-type"] = "application/json";
  const body = opts.body === undefined ? undefined : typeof opts.body === "string" ? opts.body : JSON.stringify(opts.body);
  return { url, req: new Request(url, { method, body, headers }) as Ev["req"], res: { headers: new Headers() }, context: opts.login ? { poraUser: opts.login } : {} };
}

const call = async (method: string, path: string, opts: Parameters<typeof event>[2] = {}) => {
  const res = await route(event(method, path, opts));
  return { status: res.status, body: (await res.json().catch(() => ({}))) as Record<string, any> };
};

const user1 = principalForLogin("user1")!;
const acl = aclFor(user1)!;
async function userTasks(login = "user1") {
  const u = principalForLogin(login)!;
  return (await getStore().getFor(login, aclFor(u)!)).data.tasks;
}

// The user's own data: a task, a project and a list the key must never see.
{
  const view = await getStore().getFor("user1", acl);
  const seed = { ...emptyData(), tasks: [{ id: "mine", title: "Личное дело", notes: "секрет", listId: "l1", done: false, priority: 0, due: null, tags: [], subtasks: [], createdAt: 1, completedAt: null, owner: "user1", updatedAt: 1 }], lists: [{ id: "l1", name: "Дом", owner: "user1", updatedAt: 1 }], projects: [{ id: "p1", title: "Ремонт", owner: "user1", stages: [], updatedAt: 1 }] };
  const put = await getStore().putFor("user1", acl, view.revision, seed);
  assert.equal(put.status, "ok");
}

const madeA = keys.createHelperKey("user1", "Оркестратор");
const madeB = keys.createHelperKey("user1", "Второй");
assert.ok("token" in madeA && "token" in madeB);
const A = madeA.token;
const B = madeB.token;

test("keys: shown once, only the hash is stored, format differs from phone keys", () => {
  assert.match(A, /^porah_[A-Za-z0-9_-]{12}\.[A-Za-z0-9_-]{43}$/);
  const row = sqliteOf(dir)!.db.prepare("SELECT * FROM helper_keys WHERE id = ?").get(madeA.item.id);
  assert.ok(!JSON.stringify(row).includes(A.split(".")[1]!), "the secret is not stored");
  assert.deepEqual(keys.listHelperKeys("user1").map((k) => k.name), ["Оркестратор", "Второй"]);
  assert.deepEqual(keys.listHelperKeys("user2"), []);
});

test("create lands in «Входящие» with the author stamp; list shows only own tasks", async () => {
  limits.resetHelperLimits();
  const made = await call("POST", "/api/helper/tasks", { key: A, body: { title: "  Позвонить в сервис ", notes: "строка 1\nстрока 2", due: "2026-11-20", startAt: "10:00" } });
  assert.equal(made.status, 201, JSON.stringify(made.body));
  assert.equal(made.body.item.title, "Позвонить в сервис");
  const other = await call("POST", "/api/helper/tasks", { key: B, body: { title: "От второго" } });
  assert.equal(other.status, 201);

  const stored = (await userTasks()).find((t) => t.id === made.body.item.id)!;
  assert.deepEqual(stored.helper, { keyId: madeA.item.id, name: "Оркестратор" });
  assert.equal(stored.listId, null);
  assert.equal(stored.owner, "user1");

  const list = await call("GET", "/api/helper/tasks", { key: A });
  assert.equal(list.status, 200);
  assert.deepEqual(list.body.items.map((t: { title: string }) => t.title), ["Позвонить в сервис"]);
  const text = JSON.stringify(list.body);
  for (const secret of ["Личное дело", "секрет", "Ремонт", "Дом", "От второго", "l1", "p1"]) assert.ok(!text.includes(secret), secret);
  assert.equal(list.body.items[0].listId, undefined);
  assert.equal(list.body.items[0].owner, undefined);
});

test("someone else's task → 404 for read, update, complete, comment", async () => {
  limits.resetHelperLimits();
  const otherId = (await userTasks()).find((t) => t.title === "От второго")!.id;
  for (const id of ["mine", otherId, "no-such-task"]) {
    assert.equal((await call("GET", `/api/helper/tasks/${id}`, { key: A })).status, 404);
    assert.equal((await call("PATCH", `/api/helper/tasks/${id}`, { key: A, body: { title: "взлом" } })).status, 404);
    assert.equal((await call("POST", `/api/helper/tasks/${id}/complete`, { key: A })).status, 404);
    assert.equal((await call("POST", `/api/helper/tasks/${id}/comments`, { key: A, body: { text: "x" } })).status, 404);
  }
  const mine = (await userTasks()).find((t) => t.id === "mine")!;
  assert.equal(mine.title, "Личное дело");
  assert.equal(mine.done, false);
  assert.equal(mine.helperNotes, undefined);
});

test("no delete at all, not even an own task", async () => {
  const own = (await call("GET", "/api/helper/tasks", { key: A })).body.items[0].id;
  for (const path of [`/api/helper/tasks/${own}`, "/api/helper/tasks", `/api/helper/tasks/mine`]) {
    const res = await call("DELETE", path, { key: A });
    assert.equal(res.status, 405, path);
  }
  assert.ok((await userTasks()).some((t) => t.id === own));
  assert.ok(keys.auditLog("user1", madeA.item.id).some((e) => e.action === "denied" && e.summary === "удаление запрещено"), "attempt is logged");
});

test("update, complete, reopen and comment change only that task and are stamped for merge", async () => {
  limits.resetHelperLimits();
  const id = (await call("GET", "/api/helper/tasks", { key: A })).body.items[0].id as string;
  const upd = await call("PATCH", `/api/helper/tasks/${id}`, { key: A, body: { title: "Позвонить в сервис до обеда", endAt: "11:00" } });
  assert.equal(upd.status, 200);
  assert.equal(upd.body.item.endAt, "11:00");
  const done = await call("POST", `/api/helper/tasks/${id}/complete`, { key: A });
  assert.equal(done.body.item.done, true);
  assert.equal(typeof done.body.item.completedAt, "number");
  const again = await call("POST", `/api/helper/tasks/${id}/complete`, { key: A });
  assert.equal(again.status, 200, "completing twice is harmless");
  const note = await call("POST", `/api/helper/tasks/${id}/comments`, { key: A, body: { text: "Записал на пятницу", result: "ok" } });
  assert.equal(note.status, 201);
  assert.equal(note.body.item.comments.at(-1).result, "ok");
  const reopened = await call("POST", `/api/helper/tasks/${id}/reopen`, { key: A });
  assert.equal(reopened.body.item.done, false);

  const stored = (await userTasks()).find((t) => t.id === id)!;
  assert.ok(stored._f && typeof stored._f === "object", "per-field stamps (merge like a sync PATCH)");
  assert.equal(stored.title, "Позвонить в сервис до обеда");
  assert.equal((stored.helperNotes as unknown[]).length, 1);
});

test("a device edit of another field at the same time survives the helper edit", async () => {
  limits.resetHelperLimits();
  const id = (await call("POST", "/api/helper/tasks", { key: A, body: { title: "Слияние" } })).body.item.id as string;
  // The user moves it into a project and changes the priority on a device.
  const view = await getStore().getFor("user1", acl);
  const tasks = view.data.tasks.map((t) => (t.id === id ? { ...t, projectId: "p1", priority: 2, _f: { ...(t._f as object), projectId: Date.now() + 5, priority: Date.now() + 5 }, updatedAt: Date.now() + 5 } : t));
  assert.equal((await getStore().putFor("user1", acl, view.revision, { ...view.data, tasks })).status, "ok");
  const upd = await call("PATCH", `/api/helper/tasks/${id}`, { key: A, body: { notes: "из бота" } });
  assert.equal(upd.status, 200, "still visible to the key inside a project");
  const stored = (await userTasks()).find((t) => t.id === id)!;
  assert.equal(stored.projectId, "p1");
  assert.equal(stored.priority, 2);
  assert.equal(stored.notes, "из бота");
  assert.equal(upd.body.item.projectId, undefined, "project is not shown to the key");
});

test("the user deletes a helper task → the key gets 404", async () => {
  limits.resetHelperLimits();
  const id = (await call("POST", "/api/helper/tasks", { key: A, body: { title: "Удалю сам" } })).body.item.id as string;
  const view = await getStore().getFor("user1", acl);
  const tasks = view.data.tasks.filter((t) => t.id !== id);
  const tombstones = { ...view.data.tombstones, tasks: { ...view.data.tombstones.tasks, [id]: Date.now() + 10_000 } };
  assert.equal((await getStore().putFor("user1", acl, view.revision, { ...view.data, tasks, tombstones })).status, "ok");
  assert.equal((await call("GET", `/api/helper/tasks/${id}`, { key: A })).status, 404);
  assert.equal((await call("PATCH", `/api/helper/tasks/${id}`, { key: A, body: { title: "назад" } })).status, 404);
});

test("validation: sizes, dates, times, unknown fields", async () => {
  limits.resetHelperLimits();
  const bad = [
    {},
    { title: "" },
    { title: "x".repeat(201) },
    { title: "ok", notes: "x".repeat(4001) },
    { title: "ok", due: "2026-02-30" },
    { title: "ok", startAt: "25:00", due: "2026-11-20" },
    { title: "ok", startAt: "10:00" },
    { title: "ok", listId: "l1" },
    { title: "ok", helper: { keyId: "x" } },
    { title: "ok", done: true },
  ];
  for (const body of bad) assert.equal((await call("POST", "/api/helper/tasks", { key: A, body })).status, 400, JSON.stringify(body).slice(0, 80));
  assert.equal((await call("POST", "/api/helper/tasks", { key: A, body: "{not json" })).status, 400);
  assert.equal((await call("POST", "/api/helper/tasks", { key: A, body: JSON.stringify({ title: "x", notes: "y".repeat(20_000) }) })).status, 400, "body over 16 KB");
  const id = (await call("GET", "/api/helper/tasks", { key: A })).body.items[0].id;
  assert.equal((await call("POST", `/api/helper/tasks/${id}/comments`, { key: A, body: { text: "", result: "maybe" } })).status, 400);
  assert.equal((await call("POST", `/api/helper/tasks/${id}/comments`, { key: A, body: { text: "x".repeat(1001) } })).status, 400);
});

test("only Bearer helper keys: no key, session, phone key, garbage → 401", async () => {
  limits.resetHelperLimits();
  const phone = createToken("user1", "iPhone");
  assert.ok("token" in phone);
  assert.equal((await call("GET", "/api/helper/tasks")).status, 401);
  assert.equal((await call("GET", "/api/helper/tasks", { login: "user1" })).status, 401, "a session is not accepted");
  assert.equal((await call("GET", "/api/helper/tasks", { key: phone.token })).status, 401, "phone key");
  assert.equal((await call("GET", "/api/helper/tasks", { key: "garbage" })).status, 401);
});

test("helper keys do not work anywhere else (middleware + quick add + key management)", async () => {
  for (const [method, path] of [
    ["GET", "/api/sync"],
    ["PATCH", "/api/sync"],
    ["PUT", "/api/sync"],
    ["GET", "/api/me"],
    ["POST", "/api/assistant/chat"],
    ["GET", "/api/attachments/x"],
    ["POST", "/api/attachments"],
    ["GET", "/api/helper-keys"],
    ["POST", "/api/helper-keys"],
    ["GET", "/api/quick-tokens"],
    ["POST", "/api/password"],
    ["POST", "/api/logout-all"],
    ["GET", "/"],
    ["GET", "/_serverFn/x"],
  ] as const) {
    const res = auth(event(method, path, { key: A, body: method === "GET" ? undefined : {} }));
    assert.ok(res instanceof Response, `${method} ${path} must not pass`);
    assert.ok([401, 403, 302].includes(res.status), `${method} ${path}: ${res.status}`);
  }
  assert.equal(auth(event("GET", "/api/helper/tasks", { key: A })), undefined, "the helper API itself passes to the route");
  // The login form is public, but a helper key is no password.
  // Quick add refuses the helper key (different format).
  const qa = await quickAdd(event("POST", "/api/quick-add", { key: A, body: { text: "x" } }) as never);
  assert.equal(qa.status, 401);
  // Key management needs a session; the helper key alone gets 401.
  assert.equal((await keysRoute(event("GET", "/api/helper-keys", { key: A }))).status, 401);
  // A session on a helper path without a Bearer header: middleware asks for login as usual.
  const cookie = sessionCookie(event("GET", "/"), { login: "user1" }).split(";")[0]!;
  assert.equal(auth(event("GET", "/api/helper/tasks", { cookie })), undefined);
  assert.equal((await call("GET", "/api/helper/tasks", { cookie })).status, 401, "but the route still needs the key");
});

test("rate limits: creates per hour, bad keys per IP (only that IP)", async () => {
  limits.resetHelperLimits();
  const fresh = keys.createHelperKey("user2", "Лимит");
  assert.ok("token" in fresh);
  for (let i = 0; i < limits.CREATES_PER_HOUR; i++) assert.equal((await call("POST", "/api/helper/tasks", { key: fresh.token, body: { title: `Т${i}` } })).status, 201);
  const over = await call("POST", "/api/helper/tasks", { key: fresh.token, body: { title: "лишняя" } });
  assert.equal(over.status, 429);
  assert.equal((await call("GET", "/api/helper/tasks", { key: fresh.token })).status, 200, "reading still works");
  assert.equal((await call("POST", "/api/helper/tasks", { key: A, body: { title: "другой ключ" } })).status, 201, "other keys are not affected");

  limits.resetHelperLimits();
  const wrong = A.slice(0, -1) + (A.endsWith("A") ? "B" : "A");
  for (let i = 0; i < limits.BAD_KEYS_PER_IP; i++) assert.equal((await call("GET", "/api/helper/tasks", { key: wrong, ip: "10.1.1.1" })).status, 401);
  assert.equal((await call("GET", "/api/helper/tasks", { key: A, ip: "10.1.1.1" })).status, 429, "this IP is locked");
  assert.equal((await call("GET", "/api/helper/tasks", { key: A, ip: "10.1.1.2" })).status, 200, "another IP is not");
  // user2's tasks are not user1's
  assert.ok(!(await userTasks("user1")).some((t) => t.title === "Т0"));
});

test("action log: create / update / complete / comment / denied, per key, via settings route", async () => {
  const log = keys.auditLog("user1", madeA.item.id);
  const actions = new Set(log.map((e) => e.action));
  for (const a of ["create", "update", "complete", "reopen", "comment", "denied"]) assert.ok(actions.has(a as never), a);
  assert.ok(log[0]!.at >= log.at(-1)!.at, "newest first");
  assert.ok(!keys.auditLog("user1", madeB.item.id).some((e) => e.summary.includes("Позвонить")), "per key");
  assert.deepEqual(keys.auditLog("user2", madeA.item.id), [], "another profile sees nothing");
  const res = await keysRoute(event("GET", `/api/helper-keys/${madeA.item.id}/log`, { login: "user1" }));
  assert.equal(res.status, 200);
  assert.ok(((await res.json()) as { items: unknown[] }).items.length > 0);
  assert.equal((await keysRoute(event("GET", `/api/helper-keys/${madeA.item.id}/log`, { login: "user2" }))).status, 404);
});

test("action log keeps 90 days", () => {
  const now = Date.now();
  keys.audit("oldkey12345a", "user1", "create", "t", "старое", now - keys.AUDIT_KEEP_MS - 1000);
  keys.audit("oldkey12345a", "user1", "create", "t", "новое", now);
  assert.deepEqual(keys.auditLog("user1", "oldkey12345a", 100, now).map((e) => e.summary), ["новое"]);
});

test("settings route: create (cap), list, revoke → the key stops working", async () => {
  limits.resetHelperLimits();
  const made = await keysRoute(event("POST", "/api/helper-keys", { login: "user1", body: { name: "Временный\u0007" } }));
  assert.equal(made.status, 201);
  const { token, item } = (await made.json()) as { token: string; item: { id: string; name: string } };
  assert.equal(item.name, "Временный");
  assert.equal((await call("GET", "/api/helper/me", { key: token })).body.name, "Временный");
  assert.equal((await keysRoute(event("DELETE", `/api/helper-keys/${item.id}`, { login: "user2" }))).status, 404, "not another profile's key");
  assert.equal((await keysRoute(event("DELETE", `/api/helper-keys/${item.id}`, { login: "user1" }))).status, 200);
  assert.equal((await call("GET", "/api/helper/tasks", { key: token })).status, 401, "revoked");
  while (keys.listHelperKeys("user1").length < keys.MAX_HELPER_KEYS) keys.createHelperKey("user1", "ещё");
  assert.equal((await keysRoute(event("POST", "/api/helper-keys", { login: "user1", body: { name: "лишний" } }))).status, 409);
});

test("«Выйти на всех устройствах» turns helper keys off", async () => {
  limits.resetHelperLimits();
  const { bumpUserEpoch } = await import("../user-store.ts");
  assert.equal((await call("GET", "/api/helper/me", { key: A })).status, 200);
  bumpUserEpoch("user1");
  assert.equal((await call("GET", "/api/helper/me", { key: A })).status, 401);
  assert.equal(keys.revokeAllHelperKeys("user1") >= 1, true);
  assert.deepEqual(keys.listHelperKeys("user1"), []);
});
