import test from "node:test";
import assert from "node:assert/strict";
import { groupHistory, localDay } from "./history.ts";

const at = (iso: string) => new Date(iso).getTime();

test("history: newest first, grouped by local day, searchable", () => {
  const items = [
    { id: "a", title: "План на неделю", updatedAt: at("2026-10-12T09:00:00") },
    { id: "b", title: "Смета по Еловой", updatedAt: at("2026-10-13T08:00:00") },
    { id: "c", title: "Покупки", updatedAt: at("2026-10-12T23:30:00") },
  ];
  const groups = groupHistory(items);
  assert.deepEqual(groups.map((g) => g.day), ["2026-10-13", "2026-10-12"]);
  assert.deepEqual(groups[1]!.items.map((i) => i.id), ["c", "a"]);
  assert.deepEqual(groupHistory(items, "смЕТ").flatMap((g) => g.items.map((i) => i.id)), ["b"]);
  assert.deepEqual(groupHistory(items, "нет такого"), []);
  assert.equal(localDay(at("2026-10-12T23:30:00")), "2026-10-12", "late evening stays on its local day");
});
