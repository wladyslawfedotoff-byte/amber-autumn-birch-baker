import assert from "node:assert/strict";
import test from "node:test";
import { parseQuick } from "./quick-add.ts";

const today = "2026-10-05";

test("date and time leave the title", () => {
  assert.deepEqual(parseQuick("созвон завтра в 10", today), {
    title: "созвон",
    due: "2026-10-06",
    startAt: "10:00",
    endAt: null,
    tags: [],
  });
});

test("afternoon guess and morning hint", () => {
  assert.equal(parseQuick("ужин в 7 вечера", today).startAt, "19:00");
  assert.equal(parseQuick("в 3 купить билет", today).startAt, "15:00");
  assert.equal(parseQuick("зарядка в 7 утра", today).startAt, "07:00");
});

test("range and weekday", () => {
  const parsed = parseQuick("встреча в пятницу с 9 до 11", today);
  assert.equal(parsed.title, "встреча");
  assert.equal(parsed.due, "2026-10-09");
  assert.equal(parsed.startAt, "09:00");
  assert.equal(parsed.endAt, "11:00");
});

test("plain title stays plain", () => {
  assert.deepEqual(parseQuick("купить молоко", today), {
    title: "купить молоко",
    due: null,
    startAt: null,
    endAt: null,
    tags: [],
  });
});

test("#теги: уходят из названия в теги, без повторов и в нижнем регистре", () => {
  const parsed = parseQuick("Купить молоко завтра в 18:30 #Дом #дом #срочно-сегодня", today);
  assert.equal(parsed.title, "Купить молоко");
  assert.deepEqual(parsed.tags, ["дом", "срочно-сегодня"]);
  assert.equal(parsed.due, "2026-10-06");
  assert.equal(parsed.startAt, "18:30");
  assert.deepEqual(parseQuick("Позвонить #1 в банк", today).tags, [], "#1 — не тег");
});
