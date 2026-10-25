// Launch screens for the Home Screen app (1.18): the app's own background
// (light / true black) with the icon in the middle.
// Run: node --experimental-strip-types scripts/make-splash.mjs
import { chromium } from "playwright";
import { readFileSync } from "node:fs";
import { SPLASH_SIZES } from "../src/lib/app-icons.ts";

const icon = readFileSync(new URL("../public/icons/icon.svg", import.meta.url), "utf8");
const themes = { light: "#f6f4ef", dark: "#000000" };
// PW_CHROME=/path/to/chrome to use an installed browser.
const browser = await chromium.launch(process.env.PW_CHROME ? { executablePath: process.env.PW_CHROME } : {});
for (const [w, h, r] of SPLASH_SIZES) {
  for (const [name, bg] of Object.entries(themes)) {
    const page = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: r });
    await page.setContent(`<html><body style="margin:0;background:${bg};display:flex;align-items:center;justify-content:center;height:100vh">
      <div style="width:108px;height:108px;border-radius:24px;overflow:hidden;box-shadow:0 0 0 0.5px rgba(0,0,0,.08)">${icon.replace("<svg ", '<svg width="108" height="108" ')}</div></body></html>`);
    await page.screenshot({ path: new URL(`../public/splash/${name}-${w}x${h}@${r}x.png`, import.meta.url).pathname });
    await page.close();
  }
}
await browser.close();
