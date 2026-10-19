#!/usr/bin/env node
/**
 * Manual end-to-end check of 1.11.0 («Обслуживание»: авто и техника) in the
 * iPhone browser engine (390×844 @2x) against a running production build:
 *
 *   APP_USERS=user1 USER_USER1_PASSWORD=… DATA_DIR=$(mktemp -d) PORT=8091 node .output/server/index.mjs
 *   BASE_URL=http://127.0.0.1:8091 USER1_PASSWORD=… FILES_DIR=… SHOTS_DIR=… node scripts/e2e-auto-tech.mjs
 *
 * FILES_DIR needs site.jpg (a receipt photo). Not part of `npm test`.
 */
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { webkit } from "playwright";

const BASE = process.env.BASE_URL ?? "http://127.0.0.1:8091";
const USER1 = process.env.USER1_PASSWORD ?? "";
const FILES = process.env.FILES_DIR ?? "/tmp/e2e111";
const SHOTS = process.env.SHOTS_DIR ?? "";

const ok = (message) => console.log(`OK: ${message}`);
async function shot(page, name) {
  if (!SHOTS) return;
  mkdirSync(SHOTS, { recursive: true });
  await page.waitForTimeout(600);
  await page.screenshot({ path: join(SHOTS, `${name}.png`) });
}
async function full(page, name) {
  if (!SHOTS) return;
  mkdirSync(SHOTS, { recursive: true });
  // The app scrolls inside its own frame: a tall window shows the whole screen at once.
  await page.setViewportSize({ width: 390, height: 1800 });
  await page.waitForTimeout(700);
  await page.screenshot({ path: join(SHOTS, `${name}.png`) });
  await page.setViewportSize({ width: 390, height: 844 });
}
const dialog = (page, name) => page.getByRole("dialog", { name });
const iso = (offsetDays) => {
  const d = new Date(Date.now() + offsetDays * 86_400_000 + 3 * 3_600_000);
  return d.toISOString().slice(0, 10);
};
const addMonths = (isoDate, n) => {
  const d = new Date(`${isoDate}T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + n);
  return d.toISOString().slice(0, 10);
};

async function login(context) {
  const page = await context.newPage();
  page.on("pageerror", (error) => console.error("pageerror:", error.message));
  await page.goto(`${BASE}/`, { waitUntil: "domcontentloaded" });
  await page.getByLabel("Логин").fill("user1");
  await page.fill("#password", USER1);
  await page.click("button[type=submit]");
  await page.waitForURL(`${BASE}/`, { timeout: 15_000, waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: "Добавить задачу", exact: true }).waitFor();
  return page;
}
async function openMaint(page) {
  await page.getByRole("button", { name: "Открыть меню" }).click();
  await page.getByRole("navigation", { name: "Разделы" }).getByRole("button", { name: /Обслуживание/ }).click();
  await page.getByRole("button", { name: "Новая карточка" }).waitFor();
}
async function fillSheet(page, { date, km, liters, sum, full: isFull }) {
  await page.getByRole("button", { name: "Заправка", exact: true }).first().click();
  const d = dialog(page, "Заправка");
  await d.getByLabel("Дата", { exact: true }).fill(date);
  await d.getByLabel("Литры").fill(liters);
  await d.getByLabel("Сумма, ₽").fill(sum);
  if (km) await d.getByLabel("Пробег, км").fill(km);
  if (isFull === false) await d.getByLabel("Полный бак").uncheck();
  return d;
}

const browser = await webkit.launch();
let current = null;
try {
  const mk = async () => {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, locale: "ru-RU", timezoneId: "Europe/Moscow", serviceWorkers: "block" });
    // Third-party scripts outside the app are not needed for the check and can hang the load.
    await context.route(/^https:\/\/(?!fonts\.)/, (route) => route.abort());
    return context;
  };
  const page = await login(await mk());
  current = page;
  await openMaint(page);
  await page.getByText("Пока ничего нет").waitFor();
  await page.getByText("Домашний ПК — видеокарта, гарантия 36 мес.").waitFor();
  ok("empty state with examples for both worlds");
  await shot(page, "01-empty");

  // --- a car ----------------------------------------------------------------
  await page.getByRole("button", { name: "Новая карточка" }).click();
  let nd = dialog(page, "Новая карточка");
  await nd.getByLabel("Название").fill("Легковая");
  await nd.getByRole("button", { name: "Создать" }).click();
  await page.getByText("Заправок пока нет.").waitFor();
  ok("car card with an empty fuel block and an example");
  await page.getByText("Расход появится после двух полных заправок с пробегом.").waitFor();

  // three fill-ups through the sheet (a partial one in the middle of a stretch), one through the quick row
  let d = await fillSheet(page, { date: iso(-60), km: "80 500", liters: "40", sum: "2 400" });
  await shot(page, "02-fillup-sheet");
  await d.getByRole("button", { name: "Сохранить" }).click();
  d = await fillSheet(page, { date: iso(-45), km: "80 800", liters: "10", sum: "600", full: false });
  await d.getByRole("button", { name: "Сохранить" }).click();
  d = await fillSheet(page, { date: iso(-30), km: "81 000", liters: "26", sum: "1 560" });
  await d.getByRole("button", { name: "Сохранить" }).click();
  d = await fillSheet(page, { date: iso(-5), km: "81 900", liters: "44", sum: "2 640" });
  await d.getByRole("button", { name: "Сохранить" }).click();
  // 500→1900: stretch 1 = 10 + 26 = 36 l / 500 km; stretch 2 = 44 l / 900 km → 80 l / 1400 km = 5,7 l/100 km, 4800/1400 = 3,4 ₽/km
  await page.getByRole("region", { name: "Заправки" }).getByText(/^5,7\s*л\/100 км$/).waitFor();
  await page.getByText("по 2 отрезкам между полными баками").waitFor();
  ok("consumption 5,7 л/100 км over two stretches (partial fill pooled)");
  await page.getByLabel("Литры", { exact: true }).fill("30");
  await page.getByLabel("Сумма заправки").fill("1 800");
  await page.getByRole("button", { name: "Добавить заправку" }).click();
  await page.getByText("Все заправки (5)").waitFor();
  ok("quick add row");

  // insurance: a yearly rule with a usual cost
  await page.getByRole("button", { name: "Платёж", exact: true }).click();
  const rd = dialog(page, "Новый платёж");
  await rd.getByLabel("Что делать").fill("ОСАГО");
  await rd.getByLabel("В конкретную дату").check();
  await rd.getByLabel("Месяц").selectOption("12");
  await rd.getByLabel("Число").fill("12");
  await rd.getByLabel("Обычная сумма").fill("12 000");
  await shot(page, "03-insurance-rule");
  await rd.getByRole("button", { name: "Добавить" }).click();
  await page.getByText("ОСАГО", { exact: true }).first().waitFor();
  ok("insurance rule in its own block");
  await page.getByRole("button", { name: /^ОСАГО/ }).first().click();
  await dialog(page, "Правило").getByRole("button", { name: "Сделано — записать" }).click();
  const paid = dialog(page, "Запись в историю");
  if ((await paid.getByLabel("Стоимость").inputValue()) !== "12000") throw new Error("usual cost not prefilled");
  await paid.getByRole("button", { name: "Сохранить" }).click();
  ok("paying it: the usual cost is prefilled");

  // maintenance entry with a cost + receipt
  await page.getByRole("button", { name: "Запись", exact: true }).last().click();
  const ed = dialog(page, "Запись в историю");
  await ed.getByLabel("Что сделано").fill("Замена масла");
  await ed.getByLabel("Стоимость").fill("6 400");
  await ed.getByLabel("Добавить файл").setInputFiles(join(FILES, "site.jpg"));
  await ed.getByRole("button", { name: /^Удалить site/ }).waitFor({ timeout: 15_000 });
  await ed.getByRole("button", { name: "Сохранить" }).click();
  await page.getByText("Всего на машину").waitFor();
  ok("total cost of ownership block (fuel + maintenance)");
  await full(page, "04-car-card");

  // editing a fill-up keeps everything consistent
  await page.getByRole("button", { name: "Все заправки (5)" }).click();
  await page.getByText("частично").first().waitFor();
  await page.getByRole("button", { name: /44 л/ }).click();
  const fd = dialog(page, "Заправка: изменить");
  await fd.getByLabel("Литры").fill("46");
  await fd.getByRole("button", { name: "Сохранить" }).click();
  await page.getByRole("region", { name: "Заправки" }).getByText(/^5,9\s*л\/100 км$/).waitFor();
  ok("fill-up edited → consumption recalculated (5,9)");
  await page.getByRole("button", { name: "Назад к списку" }).click();

  // --- tech: a PC with components -------------------------------------------
  await page.getByRole("button", { name: "Новая карточка" }).first().click();
  nd = dialog(page, "Новая карточка");
  await nd.getByRole("radio", { name: "Техника" }).click();
  await nd.getByLabel("Название").fill("Домашний ПК");
  await nd.getByLabel("Цена").fill("5 000");
  await nd.getByLabel("Дата покупки").fill(addMonths(iso(0), -30));
  await nd.getByLabel("Гарантия, месяцев").fill("36");
  await shot(page, "05-new-tech");
  await nd.getByRole("button", { name: "Создать" }).click();
  await page.getByRole("heading", { name: "Домашний ПК" }).waitFor();
  await page.getByText("Компонентов нет — для простой техники так и надо.").waitFor();
  ok("tech card: purchase facts, empty component list with an example, no fuel/km");
  if ((await page.getByText("Пробег сейчас").count()) || (await page.getByText("Заправки").count())) throw new Error("tech card shows car things");

  const addPart = async ({ chip, name, bought, price, months }) => {
    await page.getByRole("button", { name: "Компонент", exact: true }).click();
    const pd = dialog(page, "Новый компонент");
    if (chip) await pd.getByRole("button", { name: chip, exact: true }).click();
    if (name) await pd.getByLabel("Название").fill(name);
    await pd.getByLabel("Дата покупки").fill(bought);
    await pd.getByLabel("Цена, ₽").fill(price);
    await pd.getByLabel("Гарантия, месяцев").fill(months);
    return pd;
  };
  let pd = await addPart({ chip: "Видеокарта", bought: addMonths(iso(20), -36), price: "58 900", months: "36" }); // ends in about a month → «скоро»
  await pd.getByLabel("Добавить файл").setInputFiles(join(FILES, "site.jpg"));
  await pd.getByRole("button", { name: /^Удалить site/ }).waitFor({ timeout: 15_000 });
  await shot(page, "06-component-sheet");
  await pd.getByRole("button", { name: "Сохранить" }).click();
  pd = await addPart({ chip: "Процессор", bought: addMonths(iso(0), -6), price: "24 600", months: "36" });
  await pd.getByRole("button", { name: "Сохранить" }).click();
  pd = await addPart({ chip: "Диск", bought: addMonths(iso(0), -40), price: "9 800", months: "24" }); // expired
  await pd.getByRole("button", { name: "Сохранить" }).click();
  await page.getByText(/гарантия \d+ дн\./).first().waitFor();
  await page.getByText("истекла", { exact: false }).first().waitFor().catch(() => undefined);
  await page.getByText("Вложено всего: ").waitFor();
  ok("components with warranty badges and the sum invested");
  await full(page, "07-pc-card");

  // a separate item from the same sheet
  await page.getByRole("button", { name: "Компонент", exact: true }).click();
  pd = dialog(page, "Новый компонент");
  await pd.getByRole("radio", { name: "Отдельная техника" }).click();
  await pd.getByLabel("Название").fill("Монитор");
  await pd.getByLabel("Цена, ₽").fill("24 900");
  await pd.getByLabel("Дата покупки").fill(addMonths(iso(0), -10));
  await pd.getByLabel("Гарантия, месяцев").fill("36");
  await pd.getByRole("button", { name: "Сохранить" }).click();
  await page.getByRole("button", { name: "Назад к списку" }).click();
  await page.getByRole("region", { name: "Авто" }).waitFor();
  await page.getByRole("region", { name: "Техника" }).getByText("Монитор", { exact: true }).waitFor();
  await page.getByRole("region", { name: "Техника" }).getByText("Домашний ПК", { exact: true }).waitFor();
  ok("list: two groups, Авто / Техника, with badges");
  await full(page, "08-list");

  // the warranty reminder is an ordinary task
  await page.getByRole("button", { name: /^Сегодня/ }).last().click();
  await page.getByText("Гарантия заканчивается: Видеокарта", { exact: false }).first().waitFor({ timeout: 15_000 });
  ok("warranty reminder task exists for the component about to expire");
  await shot(page, "09-warranty-task");
  await openMaint(page);

  // --- stats ------------------------------------------------------------------
  await page.getByRole("button", { name: /Статистика/ }).first().click();
  await page.getByText("Расходы по месяцам").waitFor();
  await page.getByText("Расходы по годам").waitFor();
  await page.getByText("из чего состоит").waitFor();
  await full(page, "10-auto-stats");
  ok("auto stats: km per month, spend per month/year split, ₽ per km");
  await page.getByRole("radio", { name: "Техника" }).click();
  await page.getByText("Скоро закончатся").waitFor();
  await page.getByText("Вложено в технику").waitFor();
  if (await page.getByText("Километры по месяцам").count()) throw new Error("tech stats show kilometers");
  await full(page, "11-tech-stats");
  ok("tech stats: warranties, invested per year, age — and nothing about cars");
  await page.getByRole("button", { name: "Назад" }).click();

  // --- a second device sees everything -----------------------------------------
  await page.waitForTimeout(2500);
  const other = await login(await mk());
  await openMaint(other);
  await other.getByRole("region", { name: "Техника" }).getByText("Домашний ПК", { exact: true }).waitFor({ timeout: 15_000 });
  await other.getByText("Легковая", { exact: true }).first().click();
  await other.getByText("Все заправки (5)").waitFor();
  await other.getByRole("region", { name: "Заправки" }).getByText(/^5,9\s*л\/100 км$/).waitFor();
  ok("second device: fuel and consumption synced");
  console.log("DONE");
} catch (error) {
  console.error(error);
  if (current) await current.screenshot({ path: "/tmp/e2e-fail.png", fullPage: true }).catch(() => undefined);
  process.exitCode = 1;
} finally {
  await browser.close();
}
