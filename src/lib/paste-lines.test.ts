import { test } from "node:test";
import assert from "node:assert/strict";
import { pastedLines } from "./paste-lines.ts";

test("multi-line paste → one task per line, markers dropped", () => {
  assert.deepEqual(pastedLines("Купить хлеб\n\n- Позвонить в банк\r\n• Отправить счёт\n1. Оплатить интернет\n[ ] Полить цветы\n[x] Вынести мусор  "), [
    "Купить хлеб",
    "Позвонить в банк",
    "Отправить счёт",
    "Оплатить интернет",
    "Полить цветы",
    "Вынести мусор",
  ]);
  assert.deepEqual(pastedLines("Созвон завтра в 10"), ["Созвон завтра в 10"]);
  assert.equal(pastedLines(Array.from({ length: 50 }, (_, i) => `Дело ${i}`).join("\n")).length, 30);
});
