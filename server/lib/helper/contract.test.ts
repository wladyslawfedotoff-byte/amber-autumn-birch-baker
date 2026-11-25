/** Helper API contract (1.27): docs/HELPER-API.md and the route agree with contract.ts; validation texts are pinned. */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  COMMENT_MAX,
  COMMENT_VIEW_FIELDS,
  ENDPOINTS,
  ERRORS,
  InputError,
  LIST_NAME_MAX,
  LIST_VIEW_FIELDS,
  MAX_BODY,
  NOTES_MAX,
  TASK_VIEW_FIELDS,
  TITLE_MAX,
  parseComment,
  parseFields,
  parseListName,
} from "./contract.ts";

const root = new URL("../../../", import.meta.url);
const doc = readFileSync(new URL("docs/HELPER-API.md", root), "utf8");
const route = readFileSync(new URL("server/routes/api/helper/[...].ts", root), "utf8");

/** Table rows of «Запросы»: `METHOD /api/helper/...` → the whole row. */
function docRows(): Map<string, string> {
  const rows = new Map<string, string>();
  for (const line of doc.split("\n")) {
    const m = /^\| `(GET|POST|PATCH|DELETE) \/api\/helper(\/[^`]*)`/.exec(line);
    if (m) rows.set(`${m[1]} ${m[2]!.replace(/<id>/g, ":id")}`, line);
  }
  return rows;
}

const fails = (fn: () => unknown, message: string) =>
  assert.throws(fn, (error: unknown) => error instanceof InputError && error.message === message, message);

test("docs list exactly the contract's endpoints", () => {
  const documented = [...docRows().keys()].sort();
  const contract = ENDPOINTS.map((e) => `${e.method} ${e.path}`).sort();
  assert.deepEqual(documented, contract);
});

test("every body field of an endpoint is named in its docs row", () => {
  const rows = docRows();
  for (const endpoint of ENDPOINTS) {
    const row = rows.get(`${endpoint.method} ${endpoint.path}`)!;
    for (const field of Object.keys(endpoint.body?.fields ?? {})) {
      assert.ok(row.includes(`"${field}"`) || row.includes(`\`${field}\``), `${endpoint.method} ${endpoint.path}: no «${field}» in docs`);
    }
    if (endpoint.status === 201) assert.ok(row.includes("201"), `${endpoint.method} ${endpoint.path}: docs should say 201`);
  }
});

test("docs task and list examples have the contract's answer fields", () => {
  const block = /```json\n([\s\S]*?)\n```/.exec(doc)![1]!;
  const task = JSON.parse(block.replace(/"…"/g, '"x"')) as Record<string, unknown>;
  assert.deepEqual(Object.keys(task), [...TASK_VIEW_FIELDS]);
  const comment = (task.comments as Record<string, unknown>[])[0]!;
  for (const key of Object.keys(comment)) assert.ok((COMMENT_VIEW_FIELDS as readonly string[]).includes(key), key);
  const listRow = docRows().get("GET /lists")!;
  assert.deepEqual([...listRow.matchAll(/"(\w+)"/g)].map((m) => m[1]).filter((k) => k !== "items"), [...LIST_VIEW_FIELDS]);
});

test("docs state the contract's limits", () => {
  for (const text of [`Название — до ${TITLE_MAX}`, `заметка — до ${NOTES_MAX}`, `отчёт — до ${COMMENT_MAX}`, `списка — до ${LIST_NAME_MAX}`, `${MAX_BODY / 1024} КБ`]) {
    assert.ok(doc.includes(text), text);
  }
});

test("every error the route answers is in the contract with the same status", () => {
  const found = [...route.matchAll(/json\((\d{3}), \{ error: "(\w+)"/g)];
  assert.ok(found.length >= 8);
  for (const [, status, code] of found) assert.equal(ERRORS[code as keyof typeof ERRORS], Number(status), code);
  for (const [code, status] of Object.entries(ERRORS)) assert.ok(route.includes(`json(${status}, { error: "${code}"`), code);
});

test("task body: fields, cleaning and nulls", () => {
  assert.deepEqual(parseFields({ title: "  Позвонить\u0007 ", notes: "a\r\nb\t", due: "2026-11-20", startAt: "10:00", endAt: null, listId: "L_1-x" }, true), {
    title: "Позвонить",
    notes: "a\nb",
    due: "2026-11-20",
    startAt: "10:00",
    endAt: null,
    listId: "L_1-x",
  });
  assert.deepEqual(parseFields({ due: null }, false), { due: null });
  assert.deepEqual(parseFields({ notes: "" }, false), { notes: "" });
});

test("task body: the API's error texts", () => {
  fails(() => parseFields([], true), "нужен JSON-объект");
  fails(() => parseFields(null, false), "нужен JSON-объект");
  fails(() => parseFields({ done: true }, false), "поле «done» менять нельзя");
  fails(() => parseFields({ title: "x", helper: {} }, true), "поле «helper» менять нельзя");
  fails(() => parseFields({}, true), "title: нужно название");
  fails(() => parseFields({ title: null }, false), "title: нужно название");
  fails(() => parseFields({ title: "   " }, false), "title: нужно название");
  fails(() => parseFields({ title: 5 }, true), "title: нужна строка");
  fails(() => parseFields({ title: "x".repeat(TITLE_MAX + 1) }, true), `title: не длиннее ${TITLE_MAX} символов`);
  fails(() => parseFields({ notes: null }, false), "notes: нужна строка");
  fails(() => parseFields({ due: "2026-02-30" }, false), "due: дата ГГГГ-ММ-ДД или null");
  fails(() => parseFields({ startAt: "24:00" }, false), "startAt: время ЧЧ:ММ или null");
  fails(() => parseFields({ endAt: 1000 }, false), "endAt: время ЧЧ:ММ или null");
  fails(() => parseFields({ listId: "a b" }, false), "listId: id своего списка или null");
  fails(() => parseFields({}, false), "нечего менять");
  // The first bad field in contract order is reported.
  fails(() => parseFields({ endAt: "x", title: "" }, false), "title: нужно название");
});

test("list body", () => {
  assert.equal(parseListName({ name: "  Сервер " }), "Сервер");
  fails(() => parseListName({}), "name: нужно название списка");
  fails(() => parseListName({ name: null }), "name: нужно название списка");
  fails(() => parseListName({ name: "x", id: "1" }), "поле «id» не поддерживается");
  fails(() => parseListName({ name: "x".repeat(LIST_NAME_MAX + 1) }), `name: не длиннее ${LIST_NAME_MAX} символов`);
});

test("comment body", () => {
  assert.deepEqual(parseComment({ text: " Готово ", result: "ok" }), { text: "Готово", result: "ok" });
  assert.deepEqual(parseComment({ result: "fail" }), { text: "", result: "fail" });
  assert.deepEqual(parseComment({ text: "x", result: null }), { text: "x" });
  fails(() => parseComment({}), "text: пустой комментарий");
  fails(() => parseComment({ text: null, result: null }), "text: пустой комментарий");
  fails(() => parseComment({ text: "x", result: "maybe" }), "result: ok, fail или нет");
  fails(() => parseComment({ text: "x", at: 1 }), "поле «at» не поддерживается");
  fails(() => parseComment({ text: "x".repeat(COMMENT_MAX + 1) }), `text: не длиннее ${COMMENT_MAX} символов`);
});

test("task and list views answer exactly the contract's fields", async () => {
  const { viewOf, listViewOf } = await import("./tasks.ts");
  assert.deepEqual(Object.keys(viewOf({ id: "t", updatedAt: 1 })), [...TASK_VIEW_FIELDS]);
  assert.deepEqual(Object.keys(listViewOf({ id: "l", updatedAt: 1 })), [...LIST_VIEW_FIELDS]);
});
