// Text contrast of the design tokens (1.20): every text colour on every
// background it sits on, light and dark. Fails below 4.5:1.
// Run: node scripts/contrast.mjs
import { readFileSync } from "node:fs";

const css = readFileSync(new URL("../src/tokens.css", import.meta.url), "utf8");
function block(selector) {
  const at = css.indexOf(`${selector} {`);
  const body = css.slice(at, css.indexOf("}", at));
  return Object.fromEntries([...body.matchAll(/--([\w-]+):\s*(#[0-9a-fA-F]{6})/g)].map((m) => [m[1], m[2]]));
}
const light = block(":root");
const themes = { light, dark: { ...light, ...block(':root[data-theme="dark"]') } };
const lum = (hex) => {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
export const ratio = (a, b) => {
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
};
const TEXT = ["fg", "muted", "subtle", "accent", "danger", "warn", "ok", "info", "link"];
const BACK = ["bg", "surface", "elevated"];
let bad = 0;
for (const [name, t] of Object.entries(themes)) {
  for (const fg of TEXT) {
    const cells = BACK.map((bg) => {
      const r = ratio(t[fg], t[bg]);
      if (r < 4.5) bad++;
      return `${bg} ${r.toFixed(2)}${r < 4.5 ? " ✗" : ""}`;
    });
    console.log(`${name.padEnd(5)} ${fg.padEnd(8)} ${t[fg]}  ${cells.join("  ")}`);
  }
}
if (bad) {
  console.error(`${bad} pair(s) below 4.5:1`);
  process.exitCode = 1;
}
