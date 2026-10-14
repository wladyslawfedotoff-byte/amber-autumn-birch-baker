#!/usr/bin/env node
/**
 * Manual end-to-end check of 1.9.1 (files, links and contacts on a task) in
 * the iPhone browser engine (390×844 @2x) against a running production build:
 *
 *   APP_USERS=user1 USER_USER1_PASSWORD=… DATA_DIR=$(mktemp -d) PORT=8091 node .output/server/index.mjs
 *   BASE_URL=http://127.0.0.1:8091 USER1_PASSWORD=… FILES_DIR=… SHOTS_DIR=… node scripts/e2e-task-objects.mjs
 *
 * FILES_DIR needs site.jpg, akt.pdf and santehnik.vcf. The page-title
 * suggestion is answered by a stub here (a sandbox has no public DNS).
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
const addIn = (page, sheet) => page.getByRole("dialog", { name: sheet }).getByRole("button", { name: "Добавить", exact: true }).first();
const ok = (message) => console.log(`OK: ${message}`);
async function shot(page, name, full = false) {
  if (!SHOTS) return;
  mkdirSync(SHOTS, { recursive: true });
  await page.screenshot({ path: join(SHOTS, `${name}.png`), fullPage: full });
}

const browser = await webkit.launch();
try {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, locale: "ru-RU", timezoneId: "Europe/Moscow", serviceWorkers: "block" });
  const page = await context.newPage();
  page.on("pageerror", (error) => console.error("pageerror:", error.message));
  await page.route(/\/api\/link-title/, (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ title: "Смета на отделку — этап 2" }) }));
  await page.goto(`${BASE}/`);
  await page.getByLabel("Логин").fill("user1");
  await page.fill("#password", USER1);
  await page.click("button[type=submit]");
  await page.waitForURL(`${BASE}/`, { timeout: 15_000 });
  const fab = page.getByRole("button", { name: "Добавить задачу", exact: true });
  await fab.waitFor();

  const title = "Приёмка этапа: стены";
  if (await fab.isVisible()) await fab.click();
  await page.fill(ADD, title);
  await page.press(ADD, "Enter");
  await page.keyboard.press("Escape");
  await page.getByText(title, { exact: true }).first().click();
  await page.getByLabel("Название").waitFor();
  for (const step of ["Подписать акт", "Убрать мусор"]) {
    await page.getByLabel("Новая подзадача").fill(step);
    await page.getByRole("button", { name: "Добавить подзадачу" }).click();
  }
  if (await page.getByText("Фото до / после").count()) fail("before/after toggle still shown");
  if (await page.getByText(/Дата на фото/).count()) fail("«Дата на фото» still shown");
  if (await page.getByTestId("object-strip").count()) fail("empty strip shown");
  await page.getByTestId("object-add").waitFor();
  ok("empty task: only «＋ Файл · Ссылка · Контакт», no before/after, no stamp");
  await shot(page, "01-empty-task");

  await page.getByLabel("Добавить файл").setInputFiles([join(FILES, "site.jpg"), join(FILES, "akt.pdf")]);
  await page.waitForFunction(() => !document.querySelector('[data-testid="attach-pending"]'), null, { timeout: 20_000 });
  await page.getByTestId("object-photo").waitFor();
  await page.getByTestId("object-file").waitFor();
  await page.waitForFunction(() => !document.querySelector('[data-testid="task-objects"]')?.textContent?.includes("на телефоне"), null, { timeout: 20_000 });
  ok("photo + PDF in the strip");

  await page.getByRole("button", { name: "Ссылка", exact: true }).click();
  const url = page.getByLabel("Адрес ссылки");
  await url.fill("javascript:alert(1)");
  if (!(await addIn(page, "Ссылка").isDisabled())) fail("javascript: accepted");
  await url.fill("https://docs.example.ru/smeta");
  await page.getByTestId("title-suggestion").waitFor({ timeout: 5000 });
  await shot(page, "03-link-sheet");
  await page.getByTestId("title-suggestion").click();
  await addIn(page, "Ссылка").click();
  const link = page.getByTestId("object-link").locator("a");
  if ((await link.getAttribute("target")) !== "_blank" || !(await link.getAttribute("rel"))?.includes("noopener")) fail("link target/rel");
  ok("link: http(s) only, title suggestion, opens in new tab with noopener");

  await page.getByRole("button", { name: "Контакт", exact: true }).click();
  await page.getByLabel("Имя").fill("Прораб");
  await page.getByLabel("Телефон").fill("+7 900 000-00-00");
  await shot(page, "04-contact-sheet");
  await addIn(page, "Контакт").click();
  await page.getByRole("button", { name: "Контакт", exact: true }).click();
  await page.getByLabel("Карточка контакта").setInputFiles(join(FILES, "santehnik.vcf"));
  await page.waitForFunction(() => document.querySelector('input[aria-label="Телефон"]')?.value === "+7 900 111-22-33");
  await addIn(page, "Контакт").click();
  const tel = await page.getByRole("link", { name: "Позвонить: Сантехник" }).getAttribute("href");
  const sms = await page.getByRole("link", { name: "Написать: Сантехник" }).getAttribute("href");
  if (tel !== "tel:+79001112233" || sms !== "sms:+79001112233") fail(`tel/sms ${tel} ${sms}`);
  ok("contacts: manual + .vcf, tel:/sms: buttons");
  await page.getByTestId("task-objects").scrollIntoViewIfNeeded();
  await shot(page, "02-filled-task");

  await page.getByRole("button", { name: "Закрыть", exact: true }).first().click();
  await page.getByTestId("objects-badge").first().waitFor();
  const badge = await page.getByTestId("objects-badge").first().textContent();
  if (badge?.trim() !== "5") fail(`badge ${badge}`);
  ok("paperclip on the task row: 5");
  await shot(page, "05-list-paperclip");

  // Offline: add a link, it survives a reload and reaches the server when back.
  await context.setOffline(true);
  await page.getByText(title, { exact: true }).first().click();
  await page.getByRole("button", { name: "Ссылка", exact: true }).click();
  await page.getByLabel("Адрес ссылки").fill("example.org/plan");
  await addIn(page, "Ссылка").click();
  await page.getByText("example.org").first().waitFor();
  await shot(page, "06-offline-link");
  await context.setOffline(false);
  await page.waitForFunction(() => {
    const meta = JSON.parse(localStorage.getItem("pora-server-sync") || "{}");
    return meta.lastSyncAt && !meta.dirty;
  }, null, { timeout: 30_000 });
  const server = await page.evaluate(async () => (await (await fetch("/api/sync")).json()));
  const task = (server.data ?? server).tasks.find((t) => t.title === "Приёмка этапа: стены");
  if (task?.links?.length !== 2 || task?.contacts?.length !== 2) fail(`server copy: ${JSON.stringify({ l: task?.links, c: task?.contacts })}`);
  ok("offline link synced; server has 2 links, 2 contacts");
} finally {
  await browser.close();
}
