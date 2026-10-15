#!/usr/bin/env node
/**
 * Manual end-to-end check of 1.10.0 («Обслуживание») in the iPhone browser
 * engine (390×844 @2x) against a running production build:
 *
 *   APP_USERS=user1 USER_USER1_PASSWORD=… DATA_DIR=$(mktemp -d) PORT=8091 node .output/server/index.mjs
 *   BASE_URL=http://127.0.0.1:8091 USER1_PASSWORD=… FILES_DIR=… SHOTS_DIR=… node scripts/e2e-maintenance.mjs
 *
 * FILES_DIR needs site.jpg (a receipt photo). Not part of `npm test`.
 */
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { webkit } from "playwright";

const BASE = process.env.BASE_URL ?? "http://127.0.0.1:8091";
const USER1 = process.env.USER1_PASSWORD ?? "";
const FILES = process.env.FILES_DIR ?? "/tmp/e2e19";
const SHOTS = process.env.SHOTS_DIR ?? "";

function fail(message) {
  console.error(`FAIL: ${message}`);
  process.exitCode = 1;
  throw new Error(message);
}
const ok = (message) => console.log(`OK: ${message}`);
async function shot(page, name) {
  if (!SHOTS) return;
  mkdirSync(SHOTS, { recursive: true });
  await page.waitForTimeout(600); // sheets slide in
  await page.screenshot({ path: join(SHOTS, `${name}.png`) });
}
const dialog = (page, name) => page.getByRole("dialog", { name });

async function login(context) {
  const page = await context.newPage();
  page.on("pageerror", (error) => console.error("pageerror:", error.message));
  await page.goto(`${BASE}/`);
  await page.getByLabel("Логин").fill("user1");
  await page.fill("#password", USER1);
  await page.click("button[type=submit]");
  await page.waitForURL(`${BASE}/`, { timeout: 15_000 });
  await page.getByRole("button", { name: "Добавить задачу", exact: true }).waitFor();
  return page;
}
async function openMaint(page) {
  await page.getByRole("button", { name: "Открыть меню" }).click();
  await page.getByRole("navigation", { name: "Разделы" }).getByRole("button", { name: /Обслуживание/ }).click();
  await page.getByRole("button", { name: "Новая карточка" }).waitFor();
}
async function openToday(page) {
  await page.getByRole("button", { name: /^Сегодня/ }).last().click();
}
async function addEntry(page, { title, date, km, cost, place }) {
  await page.getByRole("button", { name: "Запись", exact: true }).last().click();
  const d = dialog(page, "Запись в историю");
  await d.getByLabel("Что сделано").fill(title);
  await d.getByLabel("Дата", { exact: true }).fill(date);
  if (km) await d.getByLabel("Пробег, км").fill(km);
  if (cost) await d.getByLabel("Стоимость").fill(cost);
  if (place) await d.getByLabel("Где").fill(place);
  return d;
}

const browser = await webkit.launch();
try {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, locale: "ru-RU", timezoneId: "Europe/Moscow", serviceWorkers: "block" });
  const page = await login(context);

  await openMaint(page);
  await page.getByText("Пока ничего нет").waitFor();
  ok("empty state with examples");
  await shot(page, "01-empty");

  // --- a car -------------------------------------------------------------
  await page.getByRole("button", { name: "Новая карточка" }).click();
  const nd = dialog(page, "Новая карточка");
  await nd.getByLabel("Название").fill("Легковая");
  await nd.getByLabel("Номер").fill("а000бб");
  await nd.getByLabel("Пробег, км").fill("80 000");
  await shot(page, "02-new-card");
  await nd.getByRole("button", { name: "Создать" }).click();
  await page.getByRole("heading", { name: "Легковая" }).waitFor();
  if (!(await page.getByText("Номер А000ББ").count())) fail("plate not upper-cased");
  ok("car created, plate normalised");

  await page.getByRole("button", { name: "Правило", exact: true }).click();
  const rd = dialog(page, "Новое правило");
  await rd.getByLabel("Что делать").fill("Замена масла");
  await rd.getByLabel("Каждые", { exact: true }).fill("10000");
  await rd.getByLabel("или каждые").fill("12");
  await rd.getByLabel("Дата", { exact: true }).fill("2026-06-02");
  await rd.getByLabel("Пробег", { exact: true }).fill("74200");
  await shot(page, "03-rule-sheet");
  await rd.getByRole("button", { name: "Добавить" }).click();
  await page.getByText("каждые 10 000 км или каждые 12 мес. — что раньше").waitFor();
  // 74 200 + 10 000 = 84 200 → 80 000 now: 4 200 km left, not soon yet
  if (await page.getByText("скоро", { exact: true }).count()) fail("rule is «скоро» too early");
  ok("rule: counted from the last time (74 200 + 10 000), not soon yet");

  // mileage near the limit → «скоро» + a task is made
  await page.getByRole("button", { name: "Изменить" }).click();
  await dialog(page, "Пробег").getByLabel("Пробег, км").fill("83800");
  await dialog(page, "Пробег").getByRole("button", { name: "Сохранить" }).click();
  await page.getByText(/~?400 км/).first().waitFor();
  ok("mileage 83 800 → «скоро» (400 km left)");

  await page.getByLabel("Напоминать обновить пробег").check();

  // pain
  await page.getByRole("button", { name: "Записать", exact: true }).click();
  await page.getByLabel("Что болит").fill("Стук спереди на кочках");
  await page.getByRole("button", { name: "Ок", exact: true }).click();
  await page.getByText("Стук спереди на кочках").waitFor();
  ok("«Что болит» added");

  // history entries (past ones feed the stats)
  for (const e of [
    { title: "Шиномонтаж", date: "2026-03-10", km: "70000", cost: "2000" },
    { title: "Диагностика", date: "2026-04-14", km: "71000" },
    { title: "Замена колодок", date: "2026-05-20", km: "72500", cost: "5400", place: "Сервис у дома" },
    { title: "Мойка и химчистка", date: "2026-09-05", km: "79000", cost: "1500" },
  ]) {
    const d = await addEntry(page, e);
    await d.getByRole("button", { name: "Сохранить" }).click();
    await page.getByText(e.title, { exact: true }).waitFor();
  }
  const d = await addEntry(page, { title: "Замена масла и фильтра", date: "2026-10-14", km: "83900", cost: "6400", place: "Сервис у дома" });
  await d.getByLabel("Добавить вложение").setInputFiles(join(FILES, "site.jpg"));
  await page.waitForFunction(() => !document.querySelector('[data-testid="attach-pending"]'), null, { timeout: 20_000 });
  const reset = d.getByRole("checkbox", { name: /Замена масла/ });
  if (!(await reset.isChecked())) fail("rule not preselected from the title");
  await shot(page, "04-log-sheet");
  await d.getByRole("button", { name: "Сохранить" }).click();
  await page.getByText("Замена масла и фильтра", { exact: true }).waitFor();
  await page.getByText(/через 10 000 км|10 000 км/).first().waitFor();
  ok("service entry with a receipt photo resets the rule (next in 10 000 km)");
  await page.getByRole("heading", { name: "Легковая" }).scrollIntoViewIfNeeded();
  await shot(page, "05-card-top");
  await page.getByText(/^История\s*\??$/).first().scrollIntoViewIfNeeded();
  await shot(page, "05-card-history");

  // entry detail shows the file
  await page.getByText("Замена масла и фильтра", { exact: true }).click();
  await dialog(page, "Замена масла и фильтра").getByTestId("object-photo").or(dialog(page, "Замена масла и фильтра").getByRole("button", { name: /site/ })).first().waitFor();
  await shot(page, "06-entry");
  await dialog(page, "Замена масла и фильтра").getByRole("button", { name: "Закрыть" }).click();

  // --- consumable + device ------------------------------------------------
  await page.getByRole("button", { name: "Назад к списку" }).click();
  await page.getByRole("button", { name: "Новая карточка" }).click();
  const cd = dialog(page, "Новая карточка");
  await cd.getByRole("radio", { name: "Расходник" }).click();
  await cd.getByLabel("Название").fill("Фильтр воды");
  await cd.getByLabel("Менять раз в").fill("6");
  await cd.getByLabel("Заменён").fill("2026-03-20");
  await shot(page, "07-new-consumable");
  await cd.getByRole("button", { name: "Создать" }).click();
  await page.getByRole("heading", { name: "Фильтр воды" }).waitFor();
  await page.getByText(/просрочено/).first().waitFor();
  ok("consumable: every 6 months since 20 Mar → overdue");
  await page.getByRole("button", { name: "Назад к списку" }).click();
  await page.getByRole("button", { name: "Новая карточка" }).click();
  const dd = dialog(page, "Новая карточка");
  await dd.getByRole("radio", { name: "Техника" }).click();
  await dd.getByLabel("Название").fill("Пылесос");
  await dd.getByLabel("Модель").fill("Беспроводной");
  await dd.getByRole("button", { name: "Создать" }).click();
  await page.getByRole("button", { name: "Назад к списку" }).click();
  await page.getByText("Нужно внимание").waitFor();
  const order = await page.locator("main li button, li button").allInnerTexts();
  const first = order.findIndex((t) => t.includes("Фильтр воды"));
  const second = order.findIndex((t) => t.includes("Легковая"));
  const third = order.findIndex((t) => t.includes("Пылесос"));
  if (!(first >= 0 && first < second && second < third)) fail(`urgency order wrong: ${order.map((t) => t.split("\n")[0]).join(" | ")}`);
  ok("list sorted by urgency: overdue → soon/ok");
  await shot(page, "08-list");

  // --- reminder tasks -------------------------------------------------------
  await openToday(page);
  await page.getByText("Фильтр воды", { exact: false }).first().waitFor({ timeout: 10_000 });
  ok("overdue rule became an ordinary task in «Сегодня»");
  await shot(page, "09-today-reminder");

  // --- stats ----------------------------------------------------------------
  await openMaint(page);
  await page.getByRole("button", { name: /Статистика/ }).first().click();
  await page.getByText("Километры по месяцам").waitFor();
  await page.getByRole("img", { name: /Километры по месяцам/ }).waitFor();
  await shot(page, "10-stats");
  ok("stats: hatched months with «за N мес.»");
  await page.getByRole("button", { name: "Назад" }).click();

  // --- persistence + a second device ---------------------------------------
  await page.waitForTimeout(2500);
  const other = await login(await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, locale: "ru-RU", timezoneId: "Europe/Moscow", serviceWorkers: "block" }));
  await openMaint(other);
  await other.getByText("Легковая", { exact: true }).first().waitFor({ timeout: 15_000 });
  await other.getByText("Фильтр воды", { exact: true }).first().waitFor();
  ok("second device sees the cards (sync)");
  await other.getByText("Легковая", { exact: true }).first().click();
  await other.getByText("Замена масла и фильтра", { exact: true }).waitFor();
  await other.getByText("Стук спереди на кочках").waitFor();
  ok("history and «Что болит» synced");

  // menu / navigation
  await page.getByRole("button", { name: "Открыть меню" }).click();
  await shot(page, "11-menu");
  console.log("DONE");
} catch (error) {
  console.error(error);
  process.exitCode = 1;
} finally {
  await browser.close();
}
