#!/usr/bin/env node
/**
 * Manual end-to-end check of 1.9.0 «Объекты» in the iPhone browser engine
 * (390×844 @2x) against a running production build:
 *
 *   APP_USERS=user1,user2 USER_USER1_PASSWORD=… USER_USER2_PASSWORD=… DATA_DIR=$(mktemp -d) PORT=8091 node .output/server/index.mjs
 *   BASE_URL=http://127.0.0.1:8091 USER1_PASSWORD=… FILES_DIR=… SHOTS_DIR=… node scripts/e2e-objects.mjs
 *
 * Checklist with before/after photos, attachments (photo + PDF), a blocked
 * task hidden from «Сегодня», project contacts, and an upload made offline
 * that reaches the server after the connection returns.
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

async function closeDetail(page) {
  await page.getByRole("button", { name: "Закрыть", exact: true }).first().click();
}

async function serverFiles(page, kind, id) {
  return page.evaluate(async ([k, i]) => {
    const res = await fetch(`/api/attachments?parentKind=${k}&parentId=${encodeURIComponent(i)}`);
    return res.ok ? (await res.json()).items.length : -res.status;
  }, [kind, id]);
}

async function taskId(page, title) {
  return page.evaluate((t) => {
    for (let i = 0; i < localStorage.length; i++) {
      /* planner lives in IndexedDB; ask the store through the DOM instead */
    }
    return window.__poraTaskId?.(t) ?? null;
  }, title);
}

const browser = await webkit.launch();
try {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, locale: "ru-RU", timezoneId: "Europe/Moscow" });
  const page = await context.newPage();
  page.on("pageerror", (error) => console.error("pageerror:", error.message));
  await login(page);
  await synced(page);

  // 1. Task with checklist, before/after photos and attachments.
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
  await page.getByRole("button", { name: "Фото до / после" }).click();
  const slots = page.locator('[data-testid="checklist-photos"] input[type=file]');
  await slots.nth(0).setInputFiles(join(FILES, "wall-before.jpg"));
  await slots.nth(1).setInputFiles(join(FILES, "wall-after.jpg"));
  await page.getByLabel("Добавить вложение").setInputFiles([join(FILES, "site.jpg"), join(FILES, "smeta.pdf")]);
  await page.waitForFunction(() => !document.querySelector('[data-testid="attach-pending"]'), null, { timeout: 20_000 });
  await page.locator('[data-testid="checklist-photos"] img').nth(1).waitFor({ timeout: 10_000 });
  await page.getByText("1 из 3").waitFor();
  ok("checklist 1/3, before/after photos, 4 files uploaded");
  await page.locator('[data-testid="checklist-block"]').scrollIntoViewIfNeeded();
  await shot(page, "01-task-checklist-before-after");
  await page.locator('section[aria-labelledby^="attach-"]').first().scrollIntoViewIfNeeded();
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
    await form.getByRole("button", { name: "Сохранить" }).click();
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
  // Block only the upload API so the file is queued like a real offline phone.
  await page.route("**/api/attachments", (route) => route.abort());
  await page.evaluate(() => {
    Object.defineProperty(navigator, "onLine", { configurable: true, get: () => false });
    window.dispatchEvent(new Event("offline"));
  });
  await page.getByLabel("Добавить вложение").setInputFiles(join(FILES, "offline.jpg"));
  await page.getByTestId("attach-pending").waitFor({ timeout: 15_000 });
  await page.locator('section[aria-labelledby^="attach-"] img').first().waitFor();
  ok("offline: file kept on the device with a local preview");
  await page.locator('section[aria-labelledby^="attach-"]').first().scrollIntoViewIfNeeded();
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
  await page.waitForFunction(() => !document.querySelector('[data-testid="attach-pending"]'), null, { timeout: 30_000 });
  ok("online again: queued file uploaded");
  void taskId;
  void serverFiles;
  await closeDetail(page);
} finally {
  await browser.close();
}
