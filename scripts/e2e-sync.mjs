#!/usr/bin/env node
/**
 * Manual end-to-end check of login + server sync with two browsers
 * ("phone" and "computer") against a running production server:
 *
 *   DATA_DIR=/tmp/pora-data APP_PASSWORD=test-password-123 PORT=8090 node .output/server/index.mjs
 *   BASE_URL=http://127.0.0.1:8090 APP_PASSWORD=test-password-123 node scripts/e2e-sync.mjs
 *
 * Optional: CHROME_PATH=/usr/bin/google-chrome, SHOTS_DIR=/tmp/pora-shots.
 * Exits non-zero on failure. Not part of `npm test` (needs a browser + server).
 */
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "playwright";

const BASE = process.env.BASE_URL ?? "http://127.0.0.1:8090";
const PASSWORD = process.env.APP_PASSWORD ?? "";
const SHOTS = process.env.SHOTS_DIR ?? "";
const ADD = 'input[placeholder="Созвон завтра в 10"]';

function fail(message) {
  console.error(`FAIL: ${message}`);
  process.exitCode = 1;
  throw new Error(message);
}

async function shot(page, name) {
  if (!SHOTS) return;
  mkdirSync(SHOTS, { recursive: true });
  await page.screenshot({ path: join(SHOTS, `${name}.png`) });
}

function watch(page, label, problems) {
  page.on("pageerror", (error) => problems.push(`${label} pageerror: ${error.message}`));
  page.on("console", (msg) => {
    if (msg.type() === "error") problems.push(`${label} console: ${msg.text()}`);
  });
}

async function login(page, label) {
  await page.goto(`${BASE}/`);
  if (!page.url().includes("/login")) fail(`${label}: expected redirect to /login, got ${page.url()}`);
  await shot(page, `${label}-login`);
  await page.fill("#password", "wrong-password");
  await page.click("button[type=submit]");
  await page.waitForURL(/\/login\?e=wrong/);
  if (!(await page.getByText("Неверный пароль.").isVisible())) fail(`${label}: no wrong-password message`);
  await page.fill("#password", PASSWORD);
  await page.click("button[type=submit]");
  await page.waitForURL(`${BASE}/`);
  await page.waitForSelector(ADD);
}

async function syncedOnce(page) {
  await page.waitForFunction(() => {
    const raw = localStorage.getItem("pora-server-sync");
    if (!raw) return false;
    const meta = JSON.parse(raw);
    return meta.lastSyncAt && !meta.dirty;
  }, null, { timeout: 20_000 });
}

async function addTask(page, title) {
  await page.fill(ADD, title);
  await page.press(ADD, "Enter");
}

async function waitForText(page, text, label) {
  try {
    await page.getByText(text, { exact: false }).first().waitFor({ timeout: 25_000 });
  } catch {
    fail(`${label} never showed "${text}"`);
  }
}

async function serverDoc(page) {
  return page.evaluate(async () => (await fetch("/api/sync", { cache: "no-store" })).json());
}

async function main() {
  if (!PASSWORD) fail("set APP_PASSWORD");
  const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || undefined });
  const problems = [];
  try {
    const computer = await (await browser.newContext({ viewport: { width: 1280, height: 860 } })).newPage();
    const phoneCtx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    const phone = await phoneCtx.newPage();
    watch(computer, "computer", problems);
    watch(phone, "phone", problems);

    await login(computer, "computer");
    await syncedOnce(computer);
    await login(phone, "phone");
    await syncedOnce(phone);
    const before = (await serverDoc(phone)).data.tasks.length;

    // Both devices add a task at the same moment.
    await Promise.all([addTask(phone, "Телефон: купить хлеб"), addTask(computer, "Компьютер: позвонить")]);
    // The phone's task must not vanish a few seconds later (the original bug).
    await phone.waitForTimeout(5000);
    await waitForText(phone, "Телефон: купить хлеб", "phone (after 5 s)");
    await waitForText(computer, "Телефон: купить хлеб", "computer");
    await waitForText(phone, "Компьютер: позвонить", "phone");

    // Add and close immediately: the pagehide keepalive flush must deliver it.
    await addTask(phone, "Телефон: закрыл сразу");
    await phone.close({ runBeforeUnload: true });
    await waitForText(computer, "Телефон: закрыл сразу", "computer (after phone closed)");

    // A reloaded phone keeps everything.
    const phone2 = await phoneCtx.newPage();
    watch(phone2, "phone2", problems);
    await phone2.goto(`${BASE}/`);
    await phone2.waitForSelector(ADD);
    for (const title of ["Телефон: купить хлеб", "Компьютер: позвонить", "Телефон: закрыл сразу"]) {
      await waitForText(phone2, title, "phone after reload");
    }
    await syncedOnce(phone2);
    await syncedOnce(computer);
    const after = await serverDoc(computer);
    if (after.data.tasks.length !== before + 3) fail(`server has ${after.data.tasks.length} tasks, expected ${before + 3}`);

    // Settings → «Подключение».
    await phone2.click('button[aria-label="Открыть меню"]');
    await phone2.locator('text="Настройки" >> visible=true').first().click();
    await phone2.getByText("Подключение", { exact: true }).waitFor();
    await phone2.getByText("Онлайн", { exact: true }).waitFor({ timeout: 20_000 });
    await shot(phone2, "phone-settings");
    await shot(computer, "computer-today");

    // Logout from the phone.
    await phone2.getByRole("button", { name: "Выйти" }).click();
    await phone2.waitForURL(/\/login/);
    const status = await phone2.evaluate(async () => (await fetch("/api/sync")).status);
    if (status !== 401) fail(`after logout /api/sync answered ${status}`);

    // 409 (sync conflict → merge + retry) and 401 (the post-logout probe) are
    // expected protocol answers that Chrome still prints as resource errors.
    const expected = /status of (409|401) \(\)|fonts\.(googleapis|gstatic)\.com|ERR_NAME_NOT_RESOLVED|ERR_INTERNET_DISCONNECTED/;
    const real = problems.filter((p) => !expected.test(p));
    if (real.length) fail(`browser errors:\n${real.join("\n")}`);
    console.log(`OK: two clients converged (server revision ${after.revision}, ${after.data.tasks.length} tasks), no console errors.`);
    if (problems.length !== real.length) console.log(`(ignored ${problems.length - real.length} expected 409/401/font network messages)`);
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  if (!process.exitCode) console.error(error);
  process.exitCode = 1;
});
