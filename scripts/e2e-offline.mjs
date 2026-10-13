#!/usr/bin/env node
/**
 * Manual end-to-end check of offline mode in the iPhone browser engine,
 * phone-sized (390×844 @2x), against a running production build with two profiles:
 *
 *   APP_USERS=user1,user2 USER_USER1_PASSWORD=… USER_USER2_PASSWORD=… DATA_DIR=$(mktemp -d) PORT=8090 node .output/server/index.mjs
 *   BASE_URL=http://127.0.0.1:8090 USER1_PASSWORD=… USER2_PASSWORD=… SHOTS_DIR=… node scripts/e2e-offline.mjs
 *
 * Signs in, goes offline, adds / edits / completes tasks and sets a reminder,
 * reloads the app with no network (it must open from the device), comes back
 * online and checks that the server got everything. Then signs out and in as
 * the second profile, which must not see the first one's local copy.
 * That engine in the test browser blocks even service-worker answers while
 * `setOffline(true)`, so the «reload without network» step makes the server
 * unreachable instead (STOP_SERVER / START_SERVER shell commands), which is
 * what a phone without signal sees as well.
 * Not part of `npm test` (needs a browser + server).
 */
import { execSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { request, webkit } from "playwright";

const BASE = process.env.BASE_URL ?? "http://127.0.0.1:8090";
const USER1 = process.env.USER1_PASSWORD ?? "";
const USER2 = process.env.USER2_PASSWORD ?? "";
const SHOTS = process.env.SHOTS_DIR ?? "";
const ADD = 'input[placeholder="Созвон завтра в 10"] >> visible=true';
const STOP = process.env.STOP_SERVER ?? "";
const START = process.env.START_SERVER ?? "";
const tag = String(Date.now() % 100000);

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

async function login(page, user, password) {
  await page.goto(`${BASE}/`);
  // Wait for hydration: a submit before it is a plain form post.
  await page.waitForLoadState("networkidle");
  await page.getByLabel("Логин").fill(user);
  await page.fill("#password", password);
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
  await page.getByRole("button", { name: "Закрыть", exact: true }).click();
}

async function openSettings(page) {
  const menu = page.locator('button[aria-label="Открыть меню"]');
  if (await menu.isVisible()) await menu.click();
  await page.locator('button[aria-label="Настройки"] >> visible=true').first().click();
}

async function serverTasks(user, password) {
  const api = await request.newContext({ baseURL: BASE, extraHTTPHeaders: { Origin: BASE } });
  await api.post("/api/login", { form: { login: user, password }, maxRedirects: 0 });
  const doc = await (await api.get("/api/sync")).json();
  await api.dispose();
  return doc.data.tasks;
}

const browser = await webkit.launch();
try {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale: "ru-RU", timezoneId: "Europe/Moscow" });
  const page = await context.newPage();
  const problems = [];
  page.on("pageerror", (error) => problems.push(`pageerror: ${error.message}`));

  await login(page, "user1", USER1);
  await synced(page);
  // The service worker installs and takes over this page.
  await page.waitForFunction(() => navigator.serviceWorker?.controller != null, null, { timeout: 20_000 }).catch(() => fail("service worker did not take control"));
  ok("service worker controls the page");

  const online = `Онлайн-задача ${tag}`;
  await addTask(page, online);
  await synced(page);

  await context.setOffline(true);
  await page.evaluate(() => window.dispatchEvent(new Event("offline")));
  const offline1 = `Хлеб без сети ${tag}`;
  const offline2 = `Молоко без сети ${tag}`;
  await addTask(page, offline1);
  await addTask(page, offline2);
  await page.getByTestId("offline-pill").waitFor({ timeout: 10_000 });
  const pill = await page.getByTestId("offline-pill").innerText();
  if (!/Нет сети · \d+ жд(ут|ёт) отправки/.test(pill)) fail(`pill text: ${pill}`);
  ok(`offline pill: «${pill.trim()}»`);
  await shot(page, "01-offline-pending");

  await page.getByRole("button", { name: "Что это значит" }).click();
  await shot(page, "02-offline-hint");
  await page.getByRole("button", { name: "Что это значит" }).click();

  // Edit offline: rename, set a reminder 15 minutes before, complete another one.
  await openTask(page, offline1);
  await page.getByLabel("Название").fill(`${offline1} (ржаной)`);
  await page.getByRole("button", { name: /^Напомнить/ }).click();
  await page.getByLabel("Напомнить", { exact: true }).fill("10:00");
  await page.getByLabel("Напомнить", { exact: true }).press("Enter").catch(() => undefined);
  await page.getByRole("radio", { name: "за 15 мин" }).click();
  await shot(page, "03-remind-lead-picker");
  await closeDetail(page);
  await page
    .getByText(online, { exact: true })
    .first()
    .locator('xpath=ancestor::*[.//button[@aria-label="Выполнить"]][1]')
    .getByRole("button", { name: "Выполнить", exact: true })
    .first()
    .click();
  await page.waitForTimeout(800);

  // Reload with no network: the app must open from the device with the offline edits.
  if (!STOP || !START) fail("set STOP_SERVER and START_SERVER");
  execSync(STOP, { stdio: "ignore" });
  await context.setOffline(false);
  await page.reload();
  await page.getByText(`${offline1} (ржаной)`, { exact: true }).first().waitFor({ timeout: 20_000 }).catch(() => fail("offline reload lost the local copy"));
  await page.getByTestId("offline-pill").waitFor({ timeout: 15_000 });
  ok("reload offline: app opened, local edits are there");
  await shot(page, "04-offline-reload");

  await page.waitForTimeout(1500);
  await shot(page, "04b-offline-reload-pending");

  execSync(START, { stdio: "ignore" });
  for (let i = 0; i < 40; i++) {
    const up = await fetch(`${BASE}/api/health`).then((r) => r.ok, () => false);
    if (up) break;
    await new Promise((r) => setTimeout(r, 250));
  }
  const before = await serverTasks("user1", USER1);
  if (before.some((t) => String(t.title).startsWith(offline2))) fail("server got offline data while offline?");
  ok("server has none of the offline changes yet");

  await page.evaluate(() => window.dispatchEvent(new Event("online")));
  await page.getByTestId("synced-pill").waitFor({ timeout: 30_000 }).catch(() => fail("no «Синхронизировано»"));
  await shot(page, "05-synced");
  await synced(page);
  const after = await serverTasks("user1", USER1);
  const renamed = after.find((t) => t.title === `${offline1} (ржаной)`);
  if (!renamed) fail("renamed offline task not on server");
  if (renamed.remindAt !== "10:00" || renamed.remindLead !== 15) fail(`reminder not synced: ${renamed.remindAt} / ${renamed.remindLead}`);
  if (!after.some((t) => t.title === offline2)) fail("second offline task not on server");
  const done = after.find((t) => t.title === online);
  if (!done?.done) fail("completed-offline task is not done on server");
  ok("back online: everything reached the server (new, renamed, reminder 15 min before, completed)");

  // Notifications settings.
  await openSettings(page);
  await page.getByText("Уведомления", { exact: true }).first().click();
  await page.getByTestId("notify-settings").waitFor();
  await page.waitForTimeout(500);
  await shot(page, "06-notify-settings");
  await page.keyboard.press("Escape");

  // The same screen as a browser tab on iPhone: the hint about the Home Screen.
  const iphone = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
    locale: "ru-RU",
    userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1",
  });
  const tab = await iphone.newPage();
  await login(tab, "user1", USER1);
  await openSettings(tab);
  await tab.getByText("Уведомления", { exact: true }).first().click();
  await tab.getByText("На iPhone уведомления работают только", { exact: false }).waitFor({ timeout: 10_000 }).catch(() => fail("no Home Screen hint on iPhone"));
  await tab.waitForTimeout(600); // let the sheet finish sliding in
  await shot(tab, "07-notify-settings-iphone-tab");
  ok("iPhone browser tab: Home Screen hint shown");
  await iphone.close();

  // Separation: sign out, sign in as the second profile on the same device.
  const keysBefore = await page.evaluate(async () => {
    const db = await new Promise((resolve, reject) => {
      const r = indexedDB.open("pora-local");
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
    return new Promise((resolve) => {
      const req = db.transaction("kv").objectStore("kv").getAllKeys();
      req.onsuccess = () => resolve(req.result.map(String));
    });
  });
  if (!keysBefore.some((k) => k.startsWith("user1:"))) fail(`no user1 partition: ${keysBefore}`);
  await page.goto(`${BASE}/`);
  await openSettings(page);
  await page.locator('[data-row="profile"]').click();
  await page.getByRole("button", { name: "Выйти из профиля", exact: true }).click();
  await page.waitForURL(/\/login/, { timeout: 15_000 });
  const keysAfter = await page.evaluate(async () => {
    const db = await new Promise((resolve) => {
      const r = indexedDB.open("pora-local");
      r.onsuccess = () => resolve(r.result);
    });
    return new Promise((resolve) => {
      const req = db.transaction("kv").objectStore("kv").getAllKeys();
      req.onsuccess = () => resolve(req.result.map(String));
    });
  });
  if (keysAfter.some((k) => k.startsWith("user1:"))) fail(`user1 copy left after sign-out: ${keysAfter}`);
  ok("sign-out wiped user1's local copy");
  await page.getByLabel("Логин").fill("user2");
  await page.fill("#password", USER2);
  await page.click("button[type=submit]");
  await page.waitForURL(`${BASE}/`, { timeout: 15_000 });
  await synced(page);
  if (await page.getByText(offline2, { exact: true }).first().isVisible().catch(() => false)) fail("user2 sees user1's task");
  ok("user2 does not see user1's data");

  if (problems.length) fail(problems.join("\n"));
  ok("all offline checks passed");
} finally {
  await browser.close();
}
