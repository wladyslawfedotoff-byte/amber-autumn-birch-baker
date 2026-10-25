// App icons from the SVG sources in public/ (1.19): PNGs for the manifest and
// the iOS home screen, plus favicon.ico (16/32/48, PNG frames).
// Run: node scripts/make-icons.mjs, then node --experimental-strip-types scripts/make-splash.mjs
import { chromium } from "playwright";
import { readFileSync, writeFileSync } from "node:fs";

const pub = (path) => new URL(`../public/${path}`, import.meta.url).pathname;
const svg = (path) => readFileSync(pub(path), "utf8");
const jobs = [
  ["icons/icon.svg", 192, "icons/icon-192.png"],
  ["icons/icon.svg", 512, "icons/icon-512.png"],
  ["icons/icon-maskable.svg", 192, "icons/icon-maskable-192.png"],
  ["icons/icon-maskable.svg", 512, "icons/icon-maskable-512.png"],
  ...[180, 167, 152, 120].map((size) => ["icons/icon.svg", size, `icons/apple-touch-icon-${size}.png`]),
  ["icons/icon.svg", 180, "apple-touch-icon.png"],
];

// PW_CHROME=/path/to/chrome to use an installed browser.
const browser = await chromium.launch(process.env.PW_CHROME ? { executablePath: process.env.PW_CHROME } : {});
async function render(source, size, transparent = false) {
  const page = await browser.newPage({ viewport: { width: size, height: size } });
  await page.setContent(`<html><body style="margin:0;background:transparent">${svg(source).replace("<svg ", `<svg width="${size}" height="${size}" style="display:block" `)}</body></html>`);
  const png = await page.screenshot({ omitBackground: transparent });
  await page.close();
  return png;
}
for (const [source, size, out] of jobs) writeFileSync(pub(out), await render(source, size));

// favicon.ico: header + directory + PNG images.
const frames = [];
for (const size of [16, 32, 48]) frames.push({ size, png: await render("favicon.svg", size, true) });
const head = Buffer.alloc(6 + 16 * frames.length);
head.writeUInt16LE(0, 0);
head.writeUInt16LE(1, 2);
head.writeUInt16LE(frames.length, 4);
let offset = head.length;
frames.forEach(({ size, png }, i) => {
  const at = 6 + 16 * i;
  head.writeUInt8(size, at);
  head.writeUInt8(size, at + 1);
  head.writeUInt16LE(1, at + 4);
  head.writeUInt16LE(32, at + 6);
  head.writeUInt32LE(png.length, at + 8);
  head.writeUInt32LE(offset, at + 12);
  offset += png.length;
});
writeFileSync(pub("favicon.ico"), Buffer.concat([head, ...frames.map((f) => f.png)]));
await browser.close();
