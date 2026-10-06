#!/usr/bin/env node
/**
 * Manual end-to-end check of profiles, shared/assigned tasks, subtasks,
 * «Дублировать», the «Выбранные даты» repeat and the in-app password change,
 * with separate browsers for two users against a running production server
 * started with two profiles:
 *
 *   APP_USERS=user1,user2 USER_USER1_PASSWORD=… USER_USER2_PASSWORD=… DATA_DIR=$(mktemp -d) PORT=8092 node .output/server/index.mjs
 *   BASE_URL=http://127.0.0.1:8092 USER1_PASSWORD=… USER2_PASSWORD=… node scripts/e2e-profiles.mjs
 *
 * Optional: CHROME_PATH=/usr/bin/google-chrome, SHOTS_DIR=$(mktemp -d).
 * Exits non-zero on failure. Not part of `npm test` (needs a browser + server).
 */
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "playwright";

const BASE = process.env.BASE_URL ?? "http://127.0.0.1:8092";
const USER1 = process.env.USER1_PASSWORD ?? "";
const USER2 = process.env.USER2_PASSWORD ?? "";
const SHOTS = process.env.SHOTS_DIR ?? "";
const ADD = 'input[placeholder="Созвон завтра в 10"]';
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

function watch(page, label, problems) {
  page.on("pageerror", (error) => problems.push(`${label} pageerror: ${error.message}`));
  page.on("console", (msg) => {
    if (msg.type() === "error") problems.push(`${label} console: ${msg.text()}`);
  });
}

async function login(page, user, password, label) {
  await page.goto(`${BASE}/`);
  if (!page.url().includes("/login")) fail(`${label}: expected /login, got ${page.url()}`);
  await page.getByLabel("Логин").waitFor().catch(() => fail(`${label}: no «Логин» field in profiles mode`));
  await page.getByLabel("Логин").fill(user);
  await page.fill("#password", password);
  await page.click("button[type=submit]");
  await page.waitForURL(`${BASE}/`, { timeout: 15_000 }).catch(() => fail(`${label}: login failed (${page.url()})`));
  await page.waitForSelector(ADD);
}

async function synced(page) {
  await page.waitForFunction(() => {
    const meta = JSON.parse(localStorage.getItem("pora-server-sync") || "{}");
    return meta.lastSyncAt && !meta.dirty;
  }, null, { timeout: 25_000 });
}

async function serverDoc(page) {
  return page.evaluate(async () => (await fetch("/api/sync", { cache: "no-store" })).json());
}

async function syncNow(page) {
  // focus → pull; the 15 s poll does the same, this only speeds the test up
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await page.waitForTimeout(400);
  await synced(page);
}

async function openView(page, label) {
  const menu = page.locator('button[aria-label="Открыть меню"]');
  if (await menu.isVisible()) await menu.click();
  await page.locator(`text="${label}" >> visible=true`).first().click();
}

async function addTask(page, title) {
  await page.fill(ADD, title);
  await page.press(ADD, "Enter");
}

async function openTask(page, title) {
  await page.getByText(title, { exact: true }).first().click();
  await page.getByLabel("Название").waitFor();
}

async function closeDetail(page) {
  await page.getByRole("button", { name: "Закрыть", exact: true }).click();
}

async function waitText(page, text, label, timeout = 30_000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (await page.getByText(text, { exact: false }).first().isVisible().catch(() => false)) return;
    await page.evaluate(() => window.dispatchEvent(new Event("focus")));
    await page.waitForTimeout(1000);
  }
  fail(`${label}: never showed "${text}"`);
}

async function isoDay(page, ahead) {
  return page.evaluate((n) => {
    const d = new Date();
    d.setDate(d.getDate() + n);
    const pad = (x) => String(x).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  }, ahead);
}

async function main() {
  if (!USER1 || !USER2) fail("set USER1_PASSWORD and USER2_PASSWORD");
  const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || undefined });
  const problems = [];
  try {
    const user1Ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const user2Ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    const user1 = await user1Ctx.newPage();
    const user2 = await user2Ctx.newPage();
    watch(user1, "user1", problems);
    watch(user2, "user2", problems);

    // Login page: «Пора — время делать», login field, wrong password message.
    await user1.goto(`${BASE}/login`);
    if (!(await user1.getByText("время делать").first().isVisible())) fail("login page: no tagline");
    await user1.getByLabel("Логин").fill("user1");
    await user1.fill("#password", "definitely-wrong-password");
    await user1.click("button[type=submit]");
    await user1.waitForURL(/e=wrong/);
    if (!(await user1.getByText("Неверный логин или пароль.").isVisible())) fail("no wrong-login message");
    if ((await user1.getByLabel("Логин").inputValue()) !== "user1") fail("login not kept after a failed attempt");
    await shot(user1, "01-login");
    await login(user1, "user1", USER1, "user1");
    await login(user2, "user2", USER2, "user2");
    await synced(user1);
    await synced(user2);
    ok("both profiles signed in (login field, tagline, wrong-password message)");

    // 1. Isolation.
    const secret = `Пользователь 1: подарок-сюрприз ${tag}`;
    await addTask(user1, secret);
    await synced(user1);
    await syncNow(user2);
    const zDoc = await serverDoc(user2);
    if (zDoc.user !== "user2") fail(`user2's /api/sync answered for ${zDoc.user}`);
    if (JSON.stringify(zDoc).includes(secret)) fail("user2 received user1's private task");
    if (await user2.getByText(secret).count()) fail("user2 sees user1's private task");
    ok("private tasks are isolated (UI and /api/sync)");

    // 2. Shared + assigned task with subtasks, completion syncs back.
    const shared = `Купить подарок маме ${tag}`;
    await addTask(user1, `${shared} сегодня`);
    await openTask(user1, shared);
    await user1.getByLabel("Новая подзадача").fill("Выбрать открытку");
    await user1.getByLabel("Новая подзадача").press("Enter");
    await user1.getByLabel("Новая подзадача").fill("Упаковать");
    await user1.getByRole("button", { name: "Добавить подзадачу" }).click();
    await user1.getByRole("button", { name: "Пользователь 2", exact: true }).last().click(); // «Назначить» → Пользователь 2
    await shot(user1, "02-assign");
    await closeDetail(user1);
    await synced(user1);
    await waitText(user2, shared, "user2 (assigned task in Today)");
    await user2.getByRole("button", { name: new RegExp(`Подзадачи «${shared}»: 0 из 2`) }).waitFor({ timeout: 10_000 }).catch(() => fail("user2: no 0/2 subtask counter"));
    await user2.getByRole("button", { name: "Отметить: Выбрать открытку" }).first().click();
    await shot(user2, "03-user2-today");
    await openView(user2, "Общие");
    await waitText(user2, shared, "user2 «Общие»");
    await shot(user2, "04-user2-shared");
    await user2.getByRole("button", { name: "Выполнить" }).first().click();
    await synced(user2);
    await syncNow(user1);
    await openView(user1, "Готово"); // finished tasks live in «Готово»
    await waitText(user1, "выполнил(а) Пользователь 2", "user1 (completion by user2)");
    const vDoc = await serverDoc(user1);
    const task = vDoc.data.tasks.find((t) => t.title === shared);
    if (!task?.done || task.completedBy !== "user2") fail(`server task: done=${task?.done} completedBy=${task?.completedBy}`);
    const subs = task.subtasks ?? [];
    if (subs.length !== 2 || !subs.find((s) => s.title === "Выбрать открытку")?.done) fail(`subtasks on user1's side: ${JSON.stringify(subs)}`);
    await shot(user1, "05-user1-done-by-user2");
    ok("assigned task reached user2 (Today + «Общие»), her subtask tick and completion came back with «выполнил(а) Пользователь 2»");

    // 3. «Выбранные даты».
    const dated = `Полить цветы ${tag}`;
    const d0 = await isoDay(user1, 1);
    const d1 = await isoDay(user1, 3);
    await openView(user1, "Входящие");
    await addTask(user1, dated);
    await openTask(user1, dated);
    await user1.getByLabel("Повтор").selectOption("dates");
    const picker = user1.getByTestId("date-multi-picker");
    await picker.waitFor();
    const label = (iso) => user1.evaluate((v) => new Date(`${v}T12:00:00`).toLocaleDateString("ru-RU", { day: "numeric", month: "long", year: "numeric" }).replace(" г.", ""), iso);
    for (const iso of [d0, d1]) {
      const name = await label(iso);
      let button = picker.getByRole("button", { name, exact: true });
      if (!(await button.count())) {
        await picker.getByRole("button", { name: "Следующий месяц" }).click();
        button = picker.getByRole("button", { name, exact: true });
      }
      if ((await button.getAttribute("aria-pressed")) !== "true") await button.click();
    }
    await shot(user1, "06-dates-picker");
    await closeDetail(user1);
    await synced(user1);
    let doc = await serverDoc(user1);
    let t = doc.data.tasks.find((x) => x.title === dated);
    const chosen = [...(t?.repeatDates ?? [])].sort();
    if (t?.repeat !== "dates" || !chosen.includes(d0) || !chosen.includes(d1)) fail(`repeatDates: ${JSON.stringify(t)}`);
    const todayIso = await isoDay(user1, 0);
    const firstFuture = chosen.find((iso) => iso >= todayIso);
    if (t.due !== firstFuture) fail(`due ${t.due}, expected the first chosen date ${firstFuture}`);
    await openView(user1, "7 дней");
    await waitText(user1, dated, "user1 «7 дней» (chosen dates)");
    await user1.getByRole("button", { name: "Выполнить" }).first().waitFor();
    // tick the occurrence → moves to the next chosen date
    await user1.locator(".card-lift", { hasText: dated }).first().getByRole("button", { name: "Выполнить" }).click();
    await synced(user1);
    doc = await serverDoc(user1);
    t = doc.data.tasks.find((x) => x.title === dated);
    const after = chosen.find((iso) => iso > firstFuture);
    if (after ? t.due !== after || t.done : !t.done) fail(`after tick: due=${t.due} done=${t.done}, expected ${after ?? "done"}`);
    ok(`«Выбранные даты» ${chosen.join(", ")}: shown in «7 дней», tick moved it to ${after ?? "done"}`);

    // 4. «Дублировать на дату…»
    await openView(user1, "Все");
    await openTask(user1, dated);
    await user1.getByRole("button", { name: "Дублировать на дату…" }).click();
    const copyDate = await isoDay(user1, 10);
    await user1.getByLabel("Дата копии").fill(copyDate);
    await user1.getByRole("button", { name: /Создать копию/ }).click();
    await user1.waitForTimeout(300);
    await closeDetail(user1);
    await synced(user1);
    doc = await serverDoc(user1);
    const copies = doc.data.tasks.filter((x) => x.title === dated);
    if (copies.length !== 2 || !copies.some((x) => x.due === copyDate && !x.repeat)) fail(`duplicate: ${JSON.stringify(copies.map((x) => [x.id, x.due, x.repeat]))}`);
    ok(`«Дублировать на дату…» created a copy on ${copyDate}`);

    // 5. Password change: another device of user2 is signed out, user1 is not.
    const user2bCtx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const user2b = await user2bCtx.newPage();
    watch(user2b, "user2b", problems);
    await login(user2b, "user2", USER2, "user2b");
    const NEW = `новый пароль пользователя 2 ${tag}`;
    await openView(user2, "Настройки");
    await user2.getByRole("button", { name: "Сменить пароль" }).click();
    await user2.getByLabel("Текущий пароль").fill(USER2);
    await user2.getByLabel("Новый пароль", { exact: true }).fill(NEW);
    await user2.getByLabel("Новый пароль ещё раз").fill(NEW);
    await shot(user2, "07-password");
    await user2.getByRole("button", { name: "Сохранить пароль" }).click();
    await user2.waitForTimeout(1500);
    if ((await user2.evaluate(async () => (await fetch("/api/sync")).status)) !== 200) fail("the device that changed the password lost its session");
    if ((await user2b.evaluate(async () => (await fetch("/api/sync")).status)) !== 401) fail("user2's other device is still signed in");
    if ((await user1.evaluate(async () => (await fetch("/api/sync")).status)) !== 200) fail("user1 was signed out by user2's password change");
    await user2b.goto(`${BASE}/`);
    await user2b.waitForURL(/\/login/);
    if ((await user2b.getByLabel("Логин").inputValue()) !== "user2") fail("the login is not remembered on the device");
    await user2b.fill("#password", USER2);
    await user2b.click("button[type=submit]");
    await user2b.waitForURL(/e=wrong/);
    await user2b.fill("#password", NEW);
    await user2b.click("button[type=submit]");
    await user2b.waitForURL(`${BASE}/`);
    ok("password change: other device of user2 signed out, old password rejected, new works, user1 unaffected, login remembered");

    // 6. Sign out from the sidebar.
    await user1.getByRole("button", { name: /Выйти из профиля/ }).first().click();
    await user1.waitForURL(/\/login/);
    ok("«Выйти» in the sidebar");

    const expected = /status of (409|401|403) \(\)|fonts\.(googleapis|gstatic)\.com|ERR_NAME_NOT_RESOLVED|ERR_INTERNET_DISCONNECTED/;
    const real = problems.filter((p) => !expected.test(p));
    if (real.length) fail(`browser errors:\n${real.join("\n")}`);
    console.log("ALL OK");
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  if (!process.exitCode) console.error(error);
  process.exitCode = 1;
});
