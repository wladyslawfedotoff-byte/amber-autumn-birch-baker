import assert from "node:assert/strict";
import test from "node:test";
import { FILE_NAME } from "../../routes/api/quick-add.post.ts";
import { parseQuickBody, splitInput } from "./parse.ts";

const req = (body: BodyInit, type?: string) => new Request("http://x/api/quick-add", { method: "POST", body, headers: type ? { "content-type": type } : {} });
const MAX = 1024 * 1024;

test("url-encoded form from the phone shortcut", async () => {
  const body = "text=" + encodeURIComponent("Вх https://ya.ru/search?q=1");
  const parsed = await parseQuickBody(req(body, "application/x-www-form-urlencoded; charset=utf-8"), MAX);
  assert.ok(!("status" in parsed));
  assert.equal(parsed.text, "Вх https://ya.ru/search?q=1");
  assert.deepEqual(splitInput(parsed.text, parsed.url), { title: "Вх", notes: "", url: "https://ya.ru/search?q=1" });
  const glued = await parseQuickBody(req("text=%D0%92%D1%85https%3A%2F%2Fya.ru", "application/x-www-form-urlencoded"), MAX);
  assert.ok(!("status" in glued));
  assert.deepEqual(splitInput(glued.text, glued.url), { title: "Вх", notes: "", url: "https://ya.ru" });
  const named = await parseQuickBody(req("URL=https%3A%2F%2Fa.ru&Text=%D1%87%D0%B8%D1%82%D0%B0%D1%82%D1%8C", "application/x-www-form-urlencoded"), MAX);
  assert.ok(!("status" in named));
  assert.deepEqual([named.text, named.url], ["читать", "https://a.ru"]);
  const unnamed = await parseQuickBody(req("%D0%92%D0%B2%D0%BE%D0%B4=%D0%BA%D1%83%D0%BF%D0%B8%D1%82%D1%8C", "application/x-www-form-urlencoded"), MAX);
  assert.ok(!("status" in unnamed));
  assert.equal(unnamed.text, "купить", "an unknown field name still counts as text");
  const typeless = await parseQuickBody(req("text=%D0%BC%D0%BE%D0%BB%D0%BE%D0%BA%D0%BE"), MAX);
  assert.ok(!("status" in typeless));
  assert.equal(typeless.text, "молоко", "form without a content type");
});

test("plain text, JSON and the 4 KB read cap", async () => {
  const plain = await parseQuickBody(req("Купить хлеб\nи молоко", "text/plain"), MAX);
  assert.ok(!("status" in plain));
  assert.deepEqual(splitInput(plain.text, plain.url), { title: "Купить хлеб", notes: "и молоко", url: "" });
  const json = await parseQuickBody(req(JSON.stringify({ url: "https://b.ru" }), "application/json"), MAX);
  assert.ok(!("status" in json));
  assert.equal(json.url, "https://b.ru");
  const big = await parseQuickBody(req("text=" + "%D1%8F".repeat(5000), "application/x-www-form-urlencoded"), MAX);
  assert.ok("status" in big && big.status === 413);
  assert.deepEqual(splitInput("Смотри https://c.ru/x).", ""), { title: "Смотри", notes: "", url: "https://c.ru/x" });
});

test("multipart as iOS sends it: HEIC, odd names, one file", async () => {
  const form = new FormData();
  form.set("Text", "IMG_6150");
  form.set("Photo", new File([new Uint8Array([1, 2, 3])], "IMG_6150", { type: "image/heic" }));
  const parsed = await parseQuickBody(req(form), MAX);
  assert.ok(!("status" in parsed));
  assert.equal(parsed.text, "IMG_6150");
  assert.equal(parsed.file?.name, "IMG_6150");
  assert.equal(parsed.file?.type, "image/heic");
  const two = new FormData();
  two.append("file", new File([new Uint8Array([1])], "a.jpg"));
  two.append("file", new File([new Uint8Array([2])], "b.jpg"));
  const res = await parseQuickBody(req(two), MAX);
  assert.ok("status" in res && res.error === "too_many_files");
  const empty = new FormData();
  empty.set("file", new File([], "IMG_1.HEIC"));
  empty.set("text", "IMG_1.HEIC");
  const noData = await parseQuickBody(req(empty), MAX);
  assert.ok(!("status" in noData));
  assert.equal(noData.file, null, "a name without data is not a file");
});

test("camera file names are not titles", () => {
  for (const name of ["IMG_6150", "IMG_6150.HEIC", "PXL_20261021_120000123.jpg", "DSC01234", "Screenshot 2026-10-21 at 20.00.png"]) assert.match(name, FILE_NAME);
  for (const name of ["Купить фильтр", "Image of the day", "photo"]) assert.doesNotMatch(name, FILE_NAME);
});
