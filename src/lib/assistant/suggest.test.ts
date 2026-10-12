import test from "node:test";
import assert from "node:assert/strict";
import { GENERAL, MAX_SUGGESTIONS, isLongText, suggestChips, type SuggestInput } from "./suggest.ts";

const base: SuggestInput = { overdue: 0, today: 2, inbox: 0, hour: 10, draft: "" };
const ids = (input: Partial<SuggestInput>) => suggestChips({ ...base, ...input }).map((chip) => chip.id);

test("suggestions: nothing special → the general chips", () => {
  assert.deepEqual(suggestChips(base), GENERAL);
});

test("suggestions: overdue first, with its count; the general overdue question is not repeated", () => {
  const chips = suggestChips({ ...base, overdue: 2 });
  assert.equal(chips[0]!.label, "Перенести просроченное (2)");
  assert.deepEqual(chips.map((chip) => chip.id), ["overdue", "plan", "steps"]);
});

test("suggestions: empty day with a full inbox", () => {
  assert.deepEqual(ids({ today: 0, inbox: 24 }).slice(0, 1), ["inbox"]);
  assert.equal(suggestChips({ ...base, today: 0, inbox: 24 })[0]!.label, "Разобрать входящие (24)");
  assert.equal(ids({ today: 1, inbox: 24 }).includes("inbox"), false, "only when today is empty");
  assert.equal(ids({ today: 0, inbox: 0 }).includes("inbox"), false);
});

test("suggestions: evening from 18:00", () => {
  assert.equal(ids({ hour: 17 }).includes("evening"), false);
  assert.equal(ids({ hour: 18 }).includes("evening"), true);
});

test("suggestions: long pasted text comes first and carries the text", () => {
  const text = "Купить краску\nПозвонить электрику\nЗаказать плитку";
  assert.equal(isLongText(text), true);
  assert.equal(isLongText("короткий вопрос"), false);
  assert.equal(isLongText("а".repeat(130)), true);
  const chips = suggestChips({ ...base, draft: text, overdue: 1 });
  assert.equal(chips[0]!.label, "Сделать из этого задачи");
  assert.ok(chips[0]!.ask.endsWith(text));
});

test("suggestions: opened from a project", () => {
  const chips = suggestChips({ ...base, project: "Лиственная 9" });
  assert.equal(chips[0]!.label, "Разбей проект на шаги");
  assert.ok(chips[0]!.ask.includes("«Лиственная 9»"));
  assert.equal(chips.some((chip) => chip.id === "steps"), false, "the general «шаги» chip is not repeated");
});

test("suggestions: never more than three", () => {
  const all = suggestChips({ overdue: 3, today: 0, inbox: 5, hour: 21, draft: "x".repeat(200), project: "Дом" });
  assert.equal(all.length, MAX_SUGGESTIONS);
  assert.deepEqual(all.map((chip) => chip.id), ["from-text", "project-steps", "overdue"]);
});
