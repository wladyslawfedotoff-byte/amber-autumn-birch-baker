#!/usr/bin/env node
/**
 * Manual end-to-end check of 1.13.0 «Быстрое добавление» against a running
 * production build (iPhone browser engine, 390×844 @2x):
 *
 *   APP_USERS=user1 USER_USER1_PASSWORD=… DATA_DIR=$(mktemp -d) PORT=8091 node .output/server/index.mjs
 *   BASE_URL=http://127.0.0.1:8091 USER1_PASSWORD=… SHOTS_DIR=… node scripts/e2e-quick-add.mjs
 *
 * Covers: no key / wrong key → 401, text, link (title from the page), photo
 * (multipart, attachment rules), 4 KB cap, 30/min limit, revoked key → 401,
 * the task with «📱 с iPhone» on a second device (sync keeps `via`). Not part of `npm test`.
 */
import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { webkit } from "playwright";

const BASE = process.env.BASE_URL ?? "http://127.0.0.1:8091";
const USER1 = process.env.USER1_PASSWORD ?? "";
const SHOTS = process.env.SHOTS_DIR ?? "";
const ok = (message) => console.log(`OK: ${message}`);
// 1×1 JPEG.
const JPEG = Buffer.from(
  "/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=",
  "base64",
);

async function shot(page, name) {
  if (!SHOTS) return;
  mkdirSync(SHOTS, { recursive: true });
  await page.waitForTimeout(700);
  await page.screenshot({ path: join(SHOTS, `${name}.png`) });
}

async function device(browser) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, locale: "ru-RU", timezoneId: "Europe/Moscow", serviceWorkers: "block" });
  await context.route(/^https:\/\/(?!fonts\.)/, (route) => route.abort());
  const page = await context.newPage();
  page.on("pageerror", (error) => console.error("pageerror:", error.message));
  await page.goto(`${BASE}/`, { waitUntil: "domcontentloaded" });
  await page.getByLabel("Логин").fill("user1");
  await page.fill("#password", USER1);
  await page.click("button[type=submit]");
  await page.getByRole("button", { name: "Добавить задачу", exact: true }).waitFor();
  return { context, page };
}

const add = (key, body, type = "application/json") =>
  fetch(`${BASE}/api/quick-add`, {
    method: "POST",
    headers: { ...(key ? { authorization: `Bearer ${key}` } : {}), ...(type ? { "content-type": type } : {}) },
    body: type === "application/json" ? JSON.stringify(body) : body,
  });

async function openInbox(page) {
  await page.getByRole("button", { name: "Открыть меню" }).click();
  await page.waitForTimeout(400);
  await page.getByRole("button", { name: /Входящ/ }).filter({ visible: true }).first().click({ force: true });
}

const browser = await webkit.launch();
try {
  const a = await device(browser);

  // Keys from «Настройки → Быстрое добавление».
  await a.page.getByRole("button", { name: "Открыть меню" }).click();
  await a.page.getByRole("button", { name: /Настройки/ }).first().click({ force: true });
  await a.page.locator("[data-row=quickadd]").getByText("Нет устройств").waitFor();
  ok("settings row: «Нет устройств»");
  await a.page.locator("[data-row=quickadd]").click();
  await a.page.getByRole("button", { name: "Новый ключ" }).click();
  const key = (await a.page.locator(".font-mono.select-all").textContent())?.trim() ?? "";
  assert.match(key, /^pora_[A-Za-z0-9_-]{12}\.[A-Za-z0-9_-]{43}$/);
  ok("key shown once in the sheet");
  await a.page.getByRole("button", { name: "Проверить" }).click();
  await a.page.getByText(/появилась задача/).waitFor();
  ok("«Проверить»: real add through the session");
  await shot(a.page, "01-quick-add-sheet");

  assert.equal((await add(null, { text: "x" })).status, 401);
  assert.equal((await add("pora_AAAAAAAAAAAA.AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA", { text: "x" })).status, 401);
  ok("no key / wrong key → 401");

  let res = await add(key, { text: "Купить фильтр для котла\nмодель как в прошлый раз" });
  assert.equal(res.status, 201, await res.text());
  ok("text → 201");
  res = await add(key, { url: "https://example.com/" });
  assert.equal(res.status, 201);
  const linkTitle = (await res.json()).title;
  ok(`url → 201, title «${linkTitle}»`);
  const form = new FormData();
  form.set("file", new Blob([JPEG], { type: "image/jpeg" }), "IMG_0001.jpg");
  res = await add(key, form, null);
  assert.equal(res.status, 201, await res.clone().text());
  ok("photo (multipart) → 201");
  // The shortcut's «Форма» without a file: application/x-www-form-urlencoded.
  res = await add(key, "text=" + encodeURIComponent("Вх https://example.com/page"), "application/x-www-form-urlencoded");
  assert.equal(res.status, 201, await res.clone().text());
  assert.equal((await res.json()).title, "Вх");
  res = await add(key, "text=%D0%92%D1%85IMG_6150", "application/x-www-form-urlencoded");
  assert.equal((await res.json()).title, "ВхIMG_6150");
  res = await add(key, "url=" + encodeURIComponent("https://example.org/"), "application/x-www-form-urlencoded");
  assert.equal(res.status, 201);
  ok("url-encoded form: text with a link, a file name only, a url field");
  // As iOS sends a shared photo: other field names, image/heic type, no extension, the name as text.
  const ios = new FormData();
  ios.set("Text", "IMG_6150");
  ios.set("Photo", new Blob([JPEG], { type: "image/heic" }), "IMG_6150");
  res = await add(key, ios, null);
  assert.equal(res.status, 201, await res.clone().text());
  assert.match((await res.json()).title, /^Фото /);
  ok("iOS-style multipart photo → «Фото …» with the file attached");
  const bad = new FormData();
  bad.set("file", new Blob([Buffer.from("#!/bin/sh\necho hi\n")], { type: "image/jpeg" }), "x.jpg");
  assert.equal((await add(key, bad, null)).status, 415);
  ok("not an image by content → 415");
  assert.equal((await add(key, { text: "я".repeat(3000) })).status, 413);
  ok("text over 4 KB → 413");

  // Second device sees the tasks with the «с iPhone» mark (via survives sync).
  const b = await device(browser);
  await openInbox(b.page);
  await b.page.getByText("Купить фильтр для котла").waitFor();
  assert.ok((await b.page.getByText("📱 с iPhone").count()) >= 3);
  const synced = await b.page.evaluate(async () => (await (await fetch("/api/sync")).json()).data.tasks.filter((t) => t.via === "phone").length);
  assert.ok(synced >= 8, `via on the server: ${synced}`);
  const tasks = await b.page.evaluate(async () => (await (await fetch("/api/sync")).json()).data.tasks);
  const vx = tasks.find((t) => t.title === "Вх");
  assert.equal(vx?.links?.[0]?.url, "https://example.com/page", "link stored from url-encoded text");
  assert.ok(!tasks.some((t) => /^text=/.test(t.title)), "no raw form body as a title");
  const photo = tasks.find((t) => /^Фото /.test(t.title) && t.attachments?.length);
  assert.ok(photo, "photo task has the attachment");
  ok(`second device: ${synced} tasks with via=phone`);
  await a.page.keyboard.press("Escape");
  await a.page.waitForTimeout(400);
  await openInbox(a.page);
  await a.page.getByText("Купить фильтр для котла").waitFor();
  await shot(a.page, "02-inbox-from-iphone");

  let limited = false;
  for (let i = 0; i < 31 && !limited; i++) limited = (await add(key, { text: `лимит ${i}` })).status === 429;
  assert.ok(limited);
  ok("31st add in a minute → 429");

  const items = await a.page.evaluate(async () => (await (await fetch("/api/quick-tokens")).json()).items);
  const del = await a.page.evaluate(async (id) => (await fetch(`/api/quick-tokens/${id}`, { method: "DELETE" })).status, items[0].id);
  assert.equal(del, 200);
  assert.equal((await add(key, { text: "после отзыва" })).status, 401);
  ok("revoked key → 401");
  await b.context.close();
  await a.context.close();
} finally {
  await browser.close();
}
console.log("e2e quick-add: all checks passed");
