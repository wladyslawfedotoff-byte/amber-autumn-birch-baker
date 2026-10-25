#!/usr/bin/env node
/**
 * Manual end-to-end check of 1.9.0 «Объекты» in the iPhone browser engine
 * (390×844 @2x) against a running production build:
 *
 *   APP_USERS=user1,user2 USER_USER1_PASSWORD=… USER_USER2_PASSWORD=… DATA_DIR=$(mktemp -d) PORT=8091 node .output/server/index.mjs
 *   BASE_URL=http://127.0.0.1:8091 USER1_PASSWORD=… FILES_DIR=… SHOTS_DIR=… node scripts/e2e-objects.mjs
 *
 * Checklist (order, drag), files (photo + PDF) under «Подробнее», a blocked
 * task hidden from «Сегодня», project contacts, and an upload made offline
 * that reaches the server after the connection returns. (The before/after
 * photos, EXIF dates and the date stamp left the task card in 1.9.1; HEIC
 * conversion is covered by server/lib/attachments/heic.test.ts.)
 * FILES_DIR needs site.jpg, smeta.pdf and offline.jpg.
 * Not part of `npm test` (needs a browser + server).
 */
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { webkit } from "playwright";

const BASE = process.env.BASE_URL ?? "http://127.0.0.1:8091";
const USER1 = process.env.USER1_PASSWORD ?? "";
const FILES = process.env.FILES_DIR ?? "/tmp/e2e19";
const SHOTS = process.env.SHOTS_DIR ?? "";
const ADD = 'input[placeholder="Созвон завтра в 10"] >> visible=true';

function fail(message) {
  console.error(`FAIL: ${message}`);
  process.exitCode = 1;
  throw new Error(message);
}
const ok = (message) => console.log(`OK: ${message}`);

async function shot(page, name) {
  if (!SHOTS) return;
  mkdirSync(SHOTS, { recursive: true });
  await page.screenshot({ path: join(SHOTS, `${name}.png`) });
}

async function login(page) {
  await page.goto(`${BASE}/`);
  await page.waitForLoadState("networkidle");
  await page.getByLabel("Логин").fill("user1");
  await page.fill("#password", USER1);
  await page.click("button[type=submit]");
  await page.waitForURL(`${BASE}/`, { timeout: 15_000 });
  await page.getByRole("button", { name: "Добавить задачу", exact: true }).waitFor();
}

async function synced(page, timeout = 30_000) {
  await page.waitForFunction(() => {
    const meta = JSON.parse(localStorage.getItem("pora-server-sync") || "{}");
    return meta.lastSyncAt && !meta.dirty;
  }, null, { timeout });
}

async function addTask(page, title) {
  const fab = page.getByRole("button", { name: "Добавить задачу", exact: true });
  const phone = await fab.isVisible();
  if (phone) await fab.click();
  await page.fill(ADD, title);
  await page.press(ADD, "Enter");
  if (phone) await page.keyboard.press("Escape");
}

async function openTask(page, title) {
  await page.getByText(title, { exact: true }).first().click();
  await page.getByLabel("Название").waitFor();
}

/** Files, dependencies and links sit under «Подробнее» in the task card. */
async function openMore(page) {
  const more = page.getByRole("button", { name: /^Подробнее/ });
  if ((await more.getAttribute("aria-expanded")) !== "true") await more.click();
}

async function closeDetail(page) {
  await page.locator("aside.sheet").getByRole("button", { name: /^(Закрыть|Готово)$/ }).first().click();
}

async function serverFiles(page, kind, id) {
  return page.evaluate(async ([k, i]) => {
    const res = await fetch(`/api/attachments?parentKind=${k}&parentId=${encodeURIComponent(i)}`);
    return res.ok ? (await res.json()).items.length : -res.status;
  }, [kind, id]);
}

async function taskId(page, title) {
  return page.evaluate(async (t) => {
    const doc = await (await fetch("/api/sync")).json();
    return doc.data.tasks.find((task) => task.title === t)?.id ?? null;
  }, title);
}

/** Wait until the server lists `count` files for the task (uploads run in the background). */
async function serverHas(page, title, count, timeout = 30_000) {
  const until = Date.now() + timeout;
  let n = 0;
  while (Date.now() < until) {
    const id = await taskId(page, title);
    n = id ? await serverFiles(page, "task", id) : 0;
    if (n === count) return;
    await page.waitForTimeout(500);
  }
  fail(`server has ${n} files for «${title}», expected ${count}`);
}

const browser = await webkit.launch();
try {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, locale: "ru-RU", timezoneId: "Europe/Moscow" });
  const page = await context.newPage();
  page.on("pageerror", (error) => console.error("pageerror:", error.message));
  await login(page);
  await synced(page);

  // 1. Task with a checklist and files (photo + PDF) under «Подробнее».
  const main = "Приёмка этапа: стены";
  await addTask(page, main);
  await openTask(page, main);
  for (const step of ["Проверить ровность", "Убрать мусор", "Подписать акт"]) {
    await page.getByLabel("Новая подзадача").fill(step);
    await page.getByRole("button", { name: "Добавить подзадачу" }).click();
  }
  const block = page.getByTestId("checklist-block");
  await block.getByRole("button", { name: "Отметить: Проверить ровность" }).click();
  await block.getByRole("button", { name: "Выше" }).nth(2).click(); // «Подписать акт» up one
  await openMore(page);
  await page.getByLabel("Добавить файл").setInputFiles([join(FILES, "site.jpg"), join(FILES, "smeta.pdf")]);
  await page.waitForFunction(() => !document.querySelector('[data-testid="attach-pending"]'), null, { timeout: 20_000 });
  await page.getByTestId("object-photo").first().waitFor({ timeout: 10_000 });
  await page.getByTestId("object-file").first().waitFor({ timeout: 10_000 });
  await page.getByText("1 из 3").waitFor();
  await serverHas(page, main, 2);
  ok("checklist 1/3, 2 files uploaded (server lists both)");

  // 1b. Drag the first checklist item to the end by its handle (pointer events, like a finger).
  const rowTitles = () => block.locator("[data-sub-row] button[aria-pressed] span:last-child").allTextContents();
  const before = await rowTitles();
  await block.scrollIntoViewIfNeeded();
  const handle = block.getByRole("button", { name: `Перетащить «${before[0]}»` });
  const lastRow = block.locator("[data-sub-row]").nth(before.length - 1);
  const h = await handle.boundingBox();
  const l = await lastRow.boundingBox();
  await page.mouse.move(h.x + h.width / 2, h.y + h.height / 2);
  await page.mouse.down();
  for (let i = 1; i <= 8; i++) await page.mouse.move(h.x + h.width / 2, h.y + ((l.y + l.height - 4 - h.y) * i) / 8);
  await shot(page, "08-checklist-dragging");
  await page.mouse.up();
  const after = await rowTitles();
  if (after[after.length - 1] !== before[0] || after.length !== before.length) fail(`drag order: ${before} → ${after}`);
  ok(`checklist drag: ${before.join(" / ")} → ${after.join(" / ")}`);

  await page.getByTestId("task-objects").scrollIntoViewIfNeeded();
  await shot(page, "02-task-attachments");
  await page.getByRole("button", { name: "site.jpg", exact: true }).click();
  const box = page.getByRole("dialog", { name: "site.jpg" });
  await box.locator("img").waitFor();
  await shot(page, "03-lightbox");
  await box.click({ position: { x: 10, y: 10 } });
  await box.waitFor({ state: "detached" });
  await closeDetail(page);
  await page.getByText(/1\/3/).first().waitFor();
  ok("row shows 1/3 and paperclip");

  // 2. Blocked task.
  const blocked = "Покрасить стены";
  await addTask(page, blocked);
  await openTask(page, blocked);
  await openMore(page);
  const select = page.getByLabel("Ждёт дело");
  await select.selectOption({ label: main });
  await closeDetail(page);
  await page.waitForTimeout(300);
  if (await page.getByText(blocked, { exact: true }).isVisible()) fail("blocked task still in Сегодня");
  await page.getByTestId("blocked-toggle").waitFor();
  ok("blocked task hidden from Сегодня");
  await page.getByTestId("blocked-toggle").click();
  await page.getByTestId("blocked-badge").first().waitFor();
  await shot(page, "04-blocked-task");
  // cycle refused: the main task cannot wait for the blocked one
  await openTask(page, main);
  await openMore(page);
  const opts = await page.getByLabel("Ждёт дело").locator("option").allTextContents();
  if (opts.includes(blocked)) fail("cycle option offered");
  ok("cycle option not offered");
  await closeDetail(page);
  await page.getByRole("button", { name: "Выполнить" }).first().waitFor();
  // complete prerequisite → dependent becomes active
  await page.getByTestId("blocked-toggle").click(); // hide again
  const mainRow = page.locator(".task-row").filter({ has: page.getByText(main, { exact: true }) });
  await mainRow.getByRole("button", { name: "Выполнить" }).click();
  await page.getByText(blocked, { exact: true }).waitFor({ timeout: 5_000 });
  ok("dependent appears after prerequisite is done");

  // 3. Project contacts.
  await page.getByRole("button", { name: "Открыть меню" }).click();
  await page.getByRole("tab", { name: "Проекты" }).click();
  await page.getByRole("button", { name: "Новый проект" }).click();
  await page.getByPlaceholder("Название проекта").fill("Объект на Лесной");
  await page.getByPlaceholder("Название проекта").press("Enter");
  await page.getByRole("button", { name: "Добавить контакт" }).waitFor({ timeout: 10_000 });
  await page.getByLabel("Название проекта").waitFor({ timeout: 10_000 });
  async function addContact(name, role, phone, email) {
    await page.getByRole("button", { name: "Добавить контакт" }).click();
    const form = page.locator("form").filter({ has: page.getByPlaceholder("Имя — например, Пользователь 1") });
    await form.getByPlaceholder("Имя — например, Пользователь 1").fill(name);
    await form.getByPlaceholder("Роль").fill(role);
    await form.getByPlaceholder("Телефон").fill(phone);
    if (email) await form.getByPlaceholder("Почта").fill(email);
    await form.getByRole("button", { name: "Готово" }).click();
  }
  await addContact("Пользователь 1", "заказчик", "+7 900 000-00-01", "user1@example.com");
  await addContact("Пользователь 2", "поставщик", "+7 900 000-00-02", "");
  const tel = await page.locator('a[href^="tel:"]').first().getAttribute("href");
  if (tel !== "tel:+7900000-00-01") fail(`tel link: ${tel}`);
  ok("contacts with tel/sms/mailto");
  await page.getByTestId("project-contacts").scrollIntoViewIfNeeded();
  await shot(page, "05-project-contacts");

  // 4. Offline upload.
  await page.goto(`${BASE}/`);
  await page.getByRole("button", { name: "Добавить задачу", exact: true }).waitFor();
  const off = "Фото с объекта без сети";
  await addTask(page, off);
  await synced(page);
  await openTask(page, off);
  await openMore(page);
  // Block only the upload API so the file is queued like a real offline phone.
  await page.route("**/api/attachments", (route) => route.abort());
  await page.evaluate(() => {
    Object.defineProperty(navigator, "onLine", { configurable: true, get: () => false });
    window.dispatchEvent(new Event("offline"));
  });
  await page.getByLabel("Добавить файл").setInputFiles(join(FILES, "offline.jpg"));
  await page.getByTestId("attach-pending").waitFor({ timeout: 15_000 });
  await page.getByTestId("object-photo").locator("img").first().waitFor();
  ok("offline: file kept on the device with a local preview");
  await page.getByTestId("task-objects").scrollIntoViewIfNeeded();
  await shot(page, "06-offline-upload-pending");
  await closeDetail(page);
  await shot(page, "07-offline-pill");
  await page.unroute("**/api/attachments");
  await page.evaluate(() => {
    Object.defineProperty(navigator, "onLine", { configurable: true, get: () => true });
    window.dispatchEvent(new Event("online"));
  });
  await page.waitForFunction(() => !document.querySelector('[data-testid="upload-pending-pill"]') && !document.querySelector('[data-testid="offline-pill"]'), null, { timeout: 40_000 });
  await openTask(page, off);
  await openMore(page);
  await page.waitForFunction(() => !document.querySelector('[data-testid="attach-pending"]'), null, { timeout: 30_000 });
  await serverHas(page, off, 1);
  await serverHas(page, main, 2);
  ok("online again: queued file uploaded (server lists it; the first task still has 2)");
  await closeDetail(page);
} finally {
  await browser.close();
}
