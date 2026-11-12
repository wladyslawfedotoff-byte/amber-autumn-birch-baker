/** «Ключи помощника» with one profile (APP_PASSWORD): the whole-document store path. */
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const dir = mkdtempSync(join(tmpdir(), "pora-helper-single-"));
process.env.DATA_DIR = dir;
delete process.env.APP_USERS;
process.env.APP_PASSWORD = "single-password-123456";
process.env.SESSION_SECRET = "y".repeat(48);

const { resetAuthCaches, getAuthConfig } = await import("../auth.ts");
resetAuthCaches();
const { storageFor } = await import("../db/storage.ts");
storageFor(dir);
const { createHelperKey } = await import("./keys.ts");
const { getStore } = await import("../sync-store.ts");
const { emptyData } = await import("../../../src/lib/sync/merge.ts");
const { default: route } = await import("../../routes/api/helper/[...].ts");

type Ev = Parameters<typeof route>[0];
const ev = (method: string, path: string, key: string, body?: unknown): Ev => {
  const url = new URL(`http://localhost${path}`);
  const headers: Record<string, string> = { authorization: `Bearer ${key}`, "x-real-ip": "10.0.0.1" };
  return { url, req: new Request(url, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) }) as Ev["req"], res: { headers: new Headers() }, context: {} };
};

test("one profile: create, list only own, complete a repeating task moves its date", async () => {
  const config = getAuthConfig();
  assert.ok("owner" in config);
  const doc = await getStore().get();
  await getStore().put(doc.revision, { ...emptyData(), tasks: [{ id: "u1", title: "Своё", notes: "", listId: null, done: false, priority: 0, due: null, tags: [], subtasks: [], createdAt: 1, completedAt: null, updatedAt: 1 }] });
  const made = createHelperKey(config.owner, "Бот");
  assert.ok("token" in made);
  const res = await route(ev("POST", "/api/helper/tasks", made.token, { title: "Оплатить", due: "2026-11-20" }));
  assert.equal(res.status, 201);
  const { item } = (await res.json()) as { item: { id: string } };
  const list = (await (await route(ev("GET", "/api/helper/tasks", made.token))).json()) as { items: { title: string }[] };
  assert.deepEqual(list.items.map((t) => t.title), ["Оплатить"]);
  const all = (await getStore().get()).data.tasks;
  assert.equal(all.length, 2);
  assert.equal(all.find((t) => t.id === item.id)!.owner, undefined, "no owner field with one profile");

  // The user makes it weekly; «complete» moves it to the next week like the tick in the app.
  const cur = await getStore().get();
  await getStore().put(cur.revision, { ...cur.data, tasks: cur.data.tasks.map((t) => (t.id === item.id ? { ...t, repeat: "week", updatedAt: Date.now() + 5 } : t)) });
  const done = (await (await route(ev("POST", `/api/helper/tasks/${item.id}/complete`, made.token))).json()) as { item: { done: boolean; due: string } };
  assert.equal(done.item.done, false);
  assert.notEqual(done.item.due, "2026-11-20");
  const back = (await (await route(ev("POST", `/api/helper/tasks/${item.id}/reopen`, made.token))).json()) as { item: { due: string } };
  assert.equal(back.item.due, "2026-11-20", "reopen undoes the tick");
});
