import { webkit } from "playwright";
const BASE = "http://127.0.0.1:8091", OUT = "/workspace/pora-shots/1.13-real";
const b = await webkit.launch();
const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, locale: "ru-RU", timezoneId: "Europe/Moscow", serviceWorkers: "block" });
await ctx.route(/^https:\/\/(?!fonts\.)/, (r) => r.abort());
const page = await ctx.newPage();
page.on("pageerror", (e) => console.error("pageerror:", e.message));
await page.goto(`${BASE}/`);
await page.getByLabel("Логин").fill("user1");
await page.fill("#password", "shot-pass-local-123456");
await page.click("button[type=submit]");
await page.getByRole("button", { name: "Добавить задачу", exact: true }).waitFor();
await page.waitForTimeout(800); await page.screenshot({ path: "/tmp/dbg.png" });
const shot = async (n) => { await page.waitForTimeout(700); await page.screenshot({ path: `${OUT}/${n}.png` }); console.log("shot", n); };
let menuShot = false;
const go = async (name) => {
  if (name === "settings") {
    await page.getByRole("button", { name: "Открыть меню" }).click();
    await page.getByRole("button", { name: /Настройки/ }).first().click();
    return;
  }
  const tab = page.locator("nav[aria-label=Разделы] > *:not(div) button, [role=tablist] button").filter({ hasText: name });
  const bottom = page.getByRole("button", { name }).filter({ visible: true });
  if (await bottom.count()) { await bottom.last().click({ force: true }); return; }
  await page.getByRole("button", { name: "Открыть меню" }).click();
  await page.waitForTimeout(400);
  if (!menuShot) { await shot("00-menu-counters"); menuShot = true; }
  await page.getByRole("button", { name }).filter({ visible: true }).first().click({ force: true });
};
await go(/Привычки/); await shot("01-habits-empty");
await go(/Даты/); await shot("02-dates-empty");
await go(/Помощник/);
await page.getByRole("button", { name: "Понятно, начать" }).click();
await page.waitForTimeout(1500);
await shot("03-assistant-empty");
await go("settings"); await shot("04-settings-list");
await page.locator('[data-row=quickadd]').click();
await page.getByRole("button", { name: "Новый ключ" }).click();
await shot("05-quick-add");
await page.getByRole("button", { name: "Проверить" }).click();
await page.keyboard.press("Escape");
await go(/Входящ/); await shot("06-inbox-from-iphone");
await b.close();
