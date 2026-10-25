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
const TEXT = ["fg", "muted", "subtle", "accent-ink", "danger", "warn", "ok", "info"];
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
// Пары «текст на заливке» и элементы интерфейса (1.20).
// pressed = brightness(0.9) у кнопки; disabled = muted на line.
const dim = (hex, k) => "#" + [1, 3, 5].map((i) => Math.round(parseInt(hex.slice(i, i + 2), 16) * k).toString(16).padStart(2, "0")).join("");
for (const [name, t] of Object.entries(themes)) {
  const pairs = [
    ["accent-fg on accent", t["accent-fg"], t.accent, 4.5],
    ["accent-fg on accent pressed", t["accent-fg"], dim(t.accent, 0.9), 4.5],
    ["muted on line (disabled)", t.muted, t.line, 3],
    ["accent fill vs bg (UI)", t.accent, t.bg, 3],
    ["accent fill vs elevated (UI)", t.accent, t.elevated, 3],
  ];
  for (const [label, a, b, min] of pairs) {
    const r = ratio(a, b);
    if (r < min) bad++;
    console.log(`${name.padEnd(5)} ${label.padEnd(30)} ${r.toFixed(2)} (min ${min})${r < min ? " ✗" : ""}`);
  }
}
if (bad) {
  console.error(`${bad} pair(s) below 4.5:1`);
  process.exitCode = 1;
}
