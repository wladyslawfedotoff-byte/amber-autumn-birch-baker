#!/usr/bin/env node
/**
 * Manual end-to-end check of profiles, shared/assigned tasks, subtasks,
 * «Дублировать», the «Выбранные даты» repeat and the in-app password change,
 * with separate browsers for two users against a running production server
 * started with two profiles:
 *
 *   APP_USERS=vlad,zhena USER_VLAD_PASSWORD=… USER_ZHENA_PASSWORD=… DATA_DIR=$(mktemp -d) PORT=8092 node .output/server/index.mjs
 *   BASE_URL=http://127.0.0.1:8092 VLAD_PASSWORD=… ZHENA_PASSWORD=… node scripts/e2e-profiles.mjs
 *
 * Optional: CHROME_PATH=/usr/bin/google-chrome, SHOTS_DIR=$(mktemp -d).
 * Exits non-zero on failure. Not part of `npm test` (needs a browser + server).
 */
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "playwright";

const BASE = process.env.BASE_URL ?? "http://127.0.0.1:8092";
const VLAD = process.env.VLAD_PASSWORD ?? "";
const ZHENA = process.env.ZHENA_PASSWORD ?? "";
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
  if (!VLAD || !ZHENA) fail("set VLAD_PASSWORD and ZHENA_PASSWORD");
  const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || undefined });
  const problems = [];
  try {
    const vladCtx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const zhenaCtx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    const vlad = await vladCtx.newPage();
    const zhena = await zhenaCtx.newPage();
    watch(vlad, "vlad", problems);
    watch(zhena, "zhena", problems);

    // Login page: «Пора — время делать», login field, wrong password message.
    await vlad.goto(`${BASE}/login`);
    if (!(await vlad.getByText("время делать").first().isVisible())) fail("login page: no tagline");
    await vlad.getByLabel("Логин").fill("vlad");
    await vlad.fill("#password", "definitely-wrong-password");
    await vlad.click("button[type=submit]");
    await vlad.waitForURL(/e=wrong/);
    if (!(await vlad.getByText("Неверный логин или пароль.").isVisible())) fail("no wrong-login message");
    if ((await vlad.getByLabel("Логин").inputValue()) !== "vlad") fail("login not kept after a failed attempt");
    await shot(vlad, "01-login");
    await login(vlad, "vlad", VLAD, "vlad");
    await login(zhena, "zhena", ZHENA, "zhena");
    await synced(vlad);
    await synced(zhena);
    ok("both profiles signed in (login field, tagline, wrong-password message)");

    // 1. Isolation.
    const secret = `Влад: подарок-сюрприз ${tag}`;
    await addTask(vlad, secret);
    await synced(vlad);
    await syncNow(zhena);
    const zDoc = await serverDoc(zhena);
    if (zDoc.user !== "zhena") fail(`zhena's /api/sync answered for ${zDoc.user}`);
    if (JSON.stringify(zDoc).includes(secret)) fail("zhena received vlad's private task");
    if (await zhena.getByText(secret).count()) fail("zhena sees vlad's private task");
    ok("private tasks are isolated (UI and /api/sync)");

    // 2. Shared + assigned task with subtasks, completion syncs back.
    const shared = `Купить подарок маме ${tag}`;
    await addTask(vlad, `${shared} сегодня`);
    await openTask(vlad, shared);
    await vlad.getByLabel("Новая подзадача").fill("Выбрать открытку");
    await vlad.getByLabel("Новая подзадача").press("Enter");
    await vlad.getByLabel("Новая подзадача").fill("Упаковать");
    await vlad.getByRole("button", { name: "Добавить подзадачу" }).click();
    await vlad.getByRole("button", { name: "Женя", exact: true }).last().click(); // «Назначить» → Женя
    await shot(vlad, "02-assign");
    await closeDetail(vlad);
    await synced(vlad);
    await waitText(zhena, shared, "zhena (assigned task in Today)");
    await zhena.getByRole("button", { name: new RegExp(`Подзадачи «${shared}»: 0 из 2`) }).waitFor({ timeout: 10_000 }).catch(() => fail("zhena: no 0/2 subtask counter"));
    await zhena.getByRole("button", { name: "Отметить: Выбрать открытку" }).first().click();
    await shot(zhena, "03-zhena-today");
    await openView(zhena, "Общие");
    await waitText(zhena, shared, "zhena «Общие»");
    await shot(zhena, "04-zhena-shared");
    await zhena.getByRole("button", { name: "Выполнить" }).first().click();
    await synced(zhena);
    await syncNow(vlad);
    await openView(vlad, "Готово"); // finished tasks live in «Готово»
    await waitText(vlad, "выполнил(а) Женя", "vlad (completion by zhena)");
    const vDoc = await serverDoc(vlad);
    const task = vDoc.data.tasks.find((t) => t.title === shared);
    if (!task?.done || task.completedBy !== "zhena") fail(`server task: done=${task?.done} completedBy=${task?.completedBy}`);
    const subs = task.subtasks ?? [];
    if (subs.length !== 2 || !subs.find((s) => s.title === "Выбрать открытку")?.done) fail(`subtasks on vlad's side: ${JSON.stringify(subs)}`);
    await shot(vlad, "05-vlad-done-by-zhena");
    ok("assigned task reached zhena (Today + «Общие»), her subtask tick and completion came back with «выполнил(а) Женя»");

    // 3. «Выбранные даты».
    const dated = `Полить цветы ${tag}`;
    const d0 = await isoDay(vlad, 1);
    const d1 = await isoDay(vlad, 3);
    await openView(vlad, "Входящие");
    await addTask(vlad, dated);
    await openTask(vlad, dated);
    await vlad.getByLabel("Повтор").selectOption("dates");
    const picker = vlad.getByTestId("date-multi-picker");
    await picker.waitFor();
    const label = (iso) => vlad.evaluate((v) => new Date(`${v}T12:00:00`).toLocaleDateString("ru-RU", { day: "numeric", month: "long", year: "numeric" }).replace(" г.", ""), iso);
    for (const iso of [d0, d1]) {
      const name = await label(iso);
      let button = picker.getByRole("button", { name, exact: true });
      if (!(await button.count())) {
        await picker.getByRole("button", { name: "Следующий месяц" }).click();
        button = picker.getByRole("button", { name, exact: true });
      }
      if ((await button.getAttribute("aria-pressed")) !== "true") await button.click();
    }
    await shot(vlad, "06-dates-picker");
    await closeDetail(vlad);
    await synced(vlad);
    let doc = await serverDoc(vlad);
    let t = doc.data.tasks.find((x) => x.title === dated);
    const chosen = [...(t?.repeatDates ?? [])].sort();
    if (t?.repeat !== "dates" || !chosen.includes(d0) || !chosen.includes(d1)) fail(`repeatDates: ${JSON.stringify(t)}`);
    const todayIso = await isoDay(vlad, 0);
    const firstFuture = chosen.find((iso) => iso >= todayIso);
    if (t.due !== firstFuture) fail(`due ${t.due}, expected the first chosen date ${firstFuture}`);
    await openView(vlad, "7 дней");
    await waitText(vlad, dated, "vlad «7 дней» (chosen dates)");
    await vlad.getByRole("button", { name: "Выполнить" }).first().waitFor();
    // tick the occurrence → moves to the next chosen date
    await vlad.locator(".card-lift", { hasText: dated }).first().getByRole("button", { name: "Выполнить" }).click();
    await synced(vlad);
    doc = await serverDoc(vlad);
    t = doc.data.tasks.find((x) => x.title === dated);
    const after = chosen.find((iso) => iso > firstFuture);
    if (after ? t.due !== after || t.done : !t.done) fail(`after tick: due=${t.due} done=${t.done}, expected ${after ?? "done"}`);
    ok(`«Выбранные даты» ${chosen.join(", ")}: shown in «7 дней», tick moved it to ${after ?? "done"}`);

    // 4. «Дублировать на дату…»
    await openView(vlad, "Все");
    await openTask(vlad, dated);
    await vlad.getByRole("button", { name: "Дублировать на дату…" }).click();
    const copyDate = await isoDay(vlad, 10);
    await vlad.getByLabel("Дата копии").fill(copyDate);
    await vlad.getByRole("button", { name: /Создать копию/ }).click();
    await vlad.waitForTimeout(300);
    await closeDetail(vlad);
    await synced(vlad);
    doc = await serverDoc(vlad);
    const copies = doc.data.tasks.filter((x) => x.title === dated);
    if (copies.length !== 2 || !copies.some((x) => x.due === copyDate && !x.repeat)) fail(`duplicate: ${JSON.stringify(copies.map((x) => [x.id, x.due, x.repeat]))}`);
    ok(`«Дублировать на дату…» created a copy on ${copyDate}`);

    // 5. Password change: another device of zhena is signed out, vlad is not.
    const zhena2Ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const zhena2 = await zhena2Ctx.newPage();
    watch(zhena2, "zhena2", problems);
    await login(zhena2, "zhena", ZHENA, "zhena2");
    const NEW = `новый пароль жени ${tag}`;
    await openView(zhena, "Настройки");
    await zhena.getByRole("button", { name: "Сменить пароль" }).click();
    await zhena.getByLabel("Текущий пароль").fill(ZHENA);
    await zhena.getByLabel("Новый пароль", { exact: true }).fill(NEW);
    await zhena.getByLabel("Новый пароль ещё раз").fill(NEW);
    await shot(zhena, "07-password");
    await zhena.getByRole("button", { name: "Сохранить пароль" }).click();
    await zhena.waitForTimeout(1500);
    if ((await zhena.evaluate(async () => (await fetch("/api/sync")).status)) !== 200) fail("the device that changed the password lost its session");
    if ((await zhena2.evaluate(async () => (await fetch("/api/sync")).status)) !== 401) fail("zhena's other device is still signed in");
    if ((await vlad.evaluate(async () => (await fetch("/api/sync")).status)) !== 200) fail("vlad was signed out by zhena's password change");
    await zhena2.goto(`${BASE}/`);
    await zhena2.waitForURL(/\/login/);
    if ((await zhena2.getByLabel("Логин").inputValue()) !== "zhena") fail("the login is not remembered on the device");
    await zhena2.fill("#password", ZHENA);
    await zhena2.click("button[type=submit]");
    await zhena2.waitForURL(/e=wrong/);
    await zhena2.fill("#password", NEW);
    await zhena2.click("button[type=submit]");
    await zhena2.waitForURL(`${BASE}/`);
    ok("password change: other device of zhena signed out, old password rejected, new works, vlad unaffected, login remembered");

    // 6. Sign out from the sidebar.
    await vlad.getByRole("button", { name: /Выйти из профиля/ }).first().click();
    await vlad.waitForURL(/\/login/);
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
