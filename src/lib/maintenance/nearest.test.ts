import assert from "node:assert/strict";
import test from "node:test";
import { nearestByCard } from "./nearest.ts";
import { shortMaintTitle } from "./short-title.ts";
import type { Asset, Task } from "../planner-types.ts";

const asset = (id: string, name: string) => ({ id, name, kind: "device", rules: [], log: [], pains: [], readings: [], createdAt: 0, updatedAt: 0 }) as unknown as Asset;
const task = (id: string, title: string, due: string | null, maint?: string, done = false) =>
  ({ id, title, notes: "", listId: null, done, priority: 0, due, tags: [], subtasks: [], createdAt: 0, completedAt: null, ...(maint ? { maint } : {}) }) as Task;

const assets = [asset("car", "Кроссовер"), asset("pc", "Домашний ПК"), asset("boiler", "Котёл")];
const tasks = [
  task("t1", "ОСАГО — Кроссовер", "2026-11-28", "car/r2"),
  task("t2", "Обновите пробег — Кроссовер", "2026-11-01", "car/km"),
  task("t3", "Гарантия заканчивается: SSD 2 ТБ — Домашний ПК", "2026-10-27", "pc/warr:p2"),
  task("t4", "Сервисное обслуживание — Котёл", "2026-10-23", "boiler/r3"),
  task("t5", "Сервисное обслуживание — Котёл", "2026-10-20", "boiler/r3", true),
  task("t6", "Купить молоко", null),
  task("t7", "Старое — Удалённое", "2026-10-21", "gone/r1"),
];

test("nearest: grouped by card, groups by nearest date, done and orphan tasks skipped", () => {
  const groups = nearestByCard(tasks, assets);
  assert.deepEqual(groups.map((g) => g.asset.name), ["Котёл", "Домашний ПК", "Кроссовер"]);
  assert.deepEqual(groups[2]!.tasks.map((t) => t.id), ["t2", "t1"]);
  assert.equal(groups[0]!.tasks.length, 1);
});

test("short titles: card name dropped, long prefixes shortened", () => {
  const short = (id: string) => shortMaintTitle(tasks.find((t) => t.id === id)!, assets);
  assert.equal(short("t1"), "ОСАГО");
  assert.equal(short("t2"), "Пробег");
  assert.equal(short("t3"), "Гарантия: SSD 2 ТБ");
  assert.equal(short("t4"), "Сервис");
  assert.equal(short("t6"), "Купить молоко");
  assert.equal(short("t7"), "Старое — Удалённое", "unknown card keeps the title");
});

