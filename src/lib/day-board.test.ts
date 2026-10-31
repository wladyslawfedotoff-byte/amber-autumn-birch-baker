import assert from "node:assert/strict";
import test from "node:test";
import { freeWindows, placeSpans, riders, taskSpan, type Span } from "./day-board.ts";
import type { Task } from "./planner-types";

const h = (x: number) => x * 60;
function span(id: string, start: number, end: number, extra: Partial<Span> = {}): Span {
  return { id, title: id, start, end, done: false, assumed: false, ...extra };
}
const byId = (list: ReturnType<typeof placeSpans>) => new Map(list.map((p) => [p.id, p]));

test("without a host every overlap is a conflict (as before)", () => {
  const p = byId(placeSpans([span("shift", h(9), h(18)), span("a", h(10), h(11))]));
  assert.equal(p.get("shift")!.clash, true);
  assert.equal(p.get("a")!.clash, true);
  assert.equal(p.get("a")!.inside, undefined);
});

test("a task fully inside a host sits on top of it and is not a conflict", () => {
  const p = byId(placeSpans([span("shift", h(9), h(18), { host: true }), span("a", h(10), h(11)), span("b", h(14), h(14.5))]));
  assert.equal(p.get("shift")!.clash, false);
  assert.equal(p.get("a")!.clash, false);
  assert.equal(p.get("b")!.clash, false);
  assert.deepEqual(p.get("a")!.inside, { id: "shift", title: "shift", lane: 0, lanes: 1 });
  assert.equal(p.get("shift")!.lanes, 1);
});

test("edges count as inside: 9:00–18:00 holds 9:00–10:00 and 17:00–18:00", () => {
  const p = byId(placeSpans([span("shift", h(9), h(18), { host: true }), span("a", h(9), h(10)), span("b", h(17), h(18))]));
  assert.equal(p.get("a")!.clash, false);
  assert.equal(p.get("b")!.clash, false);
});

test("a task that sticks out past the host stays an ordinary block and a conflict", () => {
  const p = byId(placeSpans([span("shift", h(9), h(18), { host: true }), span("late", h(17.5), h(18.5))]));
  assert.equal(p.get("late")!.inside, undefined);
  assert.equal(p.get("late")!.clash, true);
  assert.equal(p.get("shift")!.clash, true);
  assert.equal(p.get("shift")!.lanes, 2);
});

test("two tasks inside the host that overlap each other are a conflict, side by side", () => {
  const p = byId(placeSpans([span("shift", h(9), h(18), { host: true }), span("a", h(10), h(11)), span("b", h(10.5), h(11.5)), span("c", h(15), h(16))]));
  assert.equal(p.get("a")!.clash, true);
  assert.equal(p.get("b")!.clash, true);
  assert.equal(p.get("c")!.clash, false);
  assert.equal(p.get("a")!.lanes, 2);
  assert.notEqual(p.get("a")!.lane, p.get("b")!.lane);
  assert.equal(p.get("shift")!.clash, false);
});

test("a task inside the host crossed by a sticking-out block is a conflict", () => {
  const p = byId(placeSpans([span("shift", h(9), h(18), { host: true }), span("a", h(17), h(18)), span("late", h(17.5), h(19))]));
  assert.equal(p.get("a")!.clash, true);
  assert.equal(p.get("late")!.clash, true);
});

test("overlap of two ordinary blocks outside the host is still a conflict", () => {
  const p = byId(placeSpans([span("shift", h(9), h(18), { host: true }), span("x", h(19), h(20)), span("y", h(19), h(19.5))]));
  assert.equal(p.get("x")!.clash, true);
  assert.equal(p.get("y")!.clash, true);
  assert.equal(p.get("shift")!.clash, false);
});

test("two hosts: the task belongs to the shorter one; hosts overlapping each other clash", () => {
  const p = byId(placeSpans([span("day", h(8), h(20), { host: true }), span("shift", h(9), h(18), { host: true }), span("a", h(10), h(11))]));
  assert.equal(p.get("a")!.inside!.id, "shift");
  assert.equal(p.get("day")!.clash, true);
});

test("riders: open tasks inside the host move with it; done ones and others stay", () => {
  const spans = [span("shift", h(9), h(18), { host: true }), span("a", h(10), h(11)), span("d", h(12), h(13), { done: true }), span("out", h(17), h(19))];
  assert.deepEqual(riders(spans, "shift").map((s) => s.id), ["a"]);
  assert.deepEqual(riders(spans, "a"), []);
});

test("free windows: a host is room for work, its own tasks still take time", () => {
  const gaps = freeWindows(h(9), h(18), [span("shift", h(9), h(18), { host: true }), span("a", h(10), h(11))]);
  assert.deepEqual(gaps, [{ start: h(9), end: h(10) }, { start: h(11), end: h(18) }]);
});

test("taskSpan: host only with a real start and end", () => {
  const base = { id: "t", title: "Смена", notes: "", listId: null, done: false, priority: 0, due: "2026-11-02", tags: [], subtasks: [], createdAt: 0, completedAt: null } as Task;
  assert.equal(taskSpan({ ...base, startAt: "09:00", endAt: "18:00", host: true })!.host, true);
  assert.equal(taskSpan({ ...base, startAt: "09:00", endAt: null, host: true })!.host, undefined);
  assert.equal(taskSpan({ ...base, startAt: "09:00", endAt: "18:00" })!.host, undefined);
});
