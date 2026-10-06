import assert from "node:assert/strict";
import test from "node:test";
import {
  dropStaleItems,
  emptyData,
  mergeData,
  restampData,
  restoreDocument,
  normalizeData,
  pruneTombstones,
  sameData,
  stampCollection,
  TOMBSTONE_TTL_MS,
  type SyncData,
  type SyncEntity,
} from "./merge.ts";

function doc(patch: Partial<SyncData> = {}): SyncData {
  return { ...emptyData(), ...patch };
}

const task = (id: string, updatedAt?: number, title = id): SyncEntity => ({ id, title, ...(updatedAt === undefined ? {} : { updatedAt }) });

test("newer updatedAt wins per entity, both sides keep their own new entities", () => {
  const phone = doc({ tasks: [task("a", 200, "a-phone"), task("p", 150)] });
  const computer = doc({ tasks: [task("a", 100, "a-computer"), task("c", 120)] });
  const merged = mergeData(phone, computer);
  assert.deepEqual(
    merged.tasks.map((t) => [t.id, t.title]),
    [
      ["a", "a-phone"],
      ["p", "p"],
      ["c", "c"],
    ],
  );
});

test("merge is commutative in content and idempotent", () => {
  const a = doc({ tasks: [task("x", 5, "x-a"), task("y", 1)], tombstones: { ...emptyData().tombstones, tasks: { z: 9 } } });
  const b = doc({ tasks: [task("x", 5, "x-b"), task("z", 3)] });
  const ab = mergeData(a, b);
  const ba = mergeData(b, a);
  const byId = (d: SyncData) => [...d.tasks].sort((p, q) => p.id.localeCompare(q.id));
  assert.deepEqual(byId(ab), byId(ba));
  assert.deepEqual(ab.tombstones, ba.tombstones);
  assert.ok(sameData(mergeData(ab, ab), ab));
});

test("missing updatedAt (old data) counts as 0 and loses to any stamped edit", () => {
  const legacy = doc({ tasks: [task("t", undefined, "old")] });
  const edited = doc({ tasks: [task("t", 1, "new")] });
  assert.equal(mergeData(legacy, edited).tasks[0]!.title, "new");
});

test("tombstone beats older edits, a later edit resurrects", () => {
  const deleted = doc({ tombstones: { ...emptyData().tombstones, tasks: { t: 500 } } });
  const older = doc({ tasks: [task("t", 400)] });
  const newer = doc({ tasks: [task("t", 600, "edited after delete")] });
  const m1 = mergeData(older, deleted);
  assert.equal(m1.tasks.length, 0);
  assert.equal(m1.tombstones.tasks.t, 500);
  const m2 = mergeData(newer, deleted);
  assert.equal(m2.tasks[0]!.title, "edited after delete");
  assert.equal(m2.tombstones.tasks.t, undefined);
  // equal stamps: the delete wins
  assert.equal(mergeData(doc({ tasks: [task("t", 500)] }), deleted).tasks.length, 0);
});

test("tombstones older than the cutoff are pruned", () => {
  const now = 100 * 24 * 3600 * 1000;
  const d = doc({ tombstones: { ...emptyData().tombstones, lists: { old: now - TOMBSTONE_TTL_MS - 1, fresh: now - 1000 } } });
  const merged = mergeData(d, emptyData(), { cutoff: now - TOMBSTONE_TTL_MS });
  assert.deepEqual(Object.keys(merged.tombstones.lists), ["fresh"]);
  assert.deepEqual(Object.keys(pruneTombstones(d, now - TOMBSTONE_TTL_MS).tombstones.lists), ["fresh"]);
});

test("a task added on top on another device lands on top after merge", () => {
  const local = doc({ tasks: [task("b", 1), task("c", 1)] });
  const remote = doc({ tasks: [task("new", 5), task("b", 1), task("c", 1)] });
  assert.deepEqual(
    mergeData(local, remote).tasks.map((t) => t.id),
    ["new", "b", "c"],
  );
});

test("settings: last writer wins by updatedAt", () => {
  const a = doc({ settings: { workStart: "08:00", workEnd: "17:00", updatedAt: 10 } });
  const b = doc({ settings: { workStart: "10:00", workEnd: "19:00", updatedAt: 20 } });
  assert.equal(mergeData(a, b).settings.workStart, "10:00");
  assert.equal(mergeData(b, a).settings.workStart, "10:00");
});

test("stampCollection stamps changed/new entities and tombstones removed ones", () => {
  const a = { id: "a", title: "A", updatedAt: 10 };
  const b = { id: "b", title: "B", updatedAt: 10 };
  type Row = { id: string; title: string; updatedAt?: number };
  const prev: Row[] = [a, b];
  const next: Row[] = [{ ...a, title: "A2" }, { id: "c", title: "C" }];
  const { items, tombs } = stampCollection(prev, next, {}, 1000);
  assert.deepEqual(
    items.map((i) => [i.id, i.updatedAt]),
    [
      ["a", 1000],
      ["c", 1000],
    ],
  );
  assert.deepEqual(tombs, { b: 1000 });
});

test("stampCollection keeps the stamp for content-identical copies and survives a clock behind", () => {
  const a = { id: "a", title: "A", updatedAt: 5000 };
  const same = stampCollection([a], [{ ...a }], {}, 9000);
  assert.equal(same.items[0]!.updatedAt, 5000);
  const behind = stampCollection([a], [{ ...a, title: "B" }], {}, 10);
  assert.equal(behind.items[0]!.updatedAt, 5001, "local edit must beat the version it edited");
  const untouched = stampCollection([a], [a], { x: 1 }, 10);
  assert.equal(untouched.items[0], a);
});

test("normalizeData accepts the legacy WebDAV/backup format and rejects junk", () => {
  const legacy = normalizeData({ updatedAt: 1, lists: [{ id: "l", name: "L" }], tasks: [{ id: "t", title: "T" }], workStart: "08:30" });
  assert.equal(legacy.ok, true);
  if (legacy.ok) {
    assert.equal(legacy.data.settings.workStart, "08:30");
    assert.equal(legacy.data.settings.updatedAt, 0);
    assert.equal(legacy.data.tasks.length, 1);
  }
  assert.equal(normalizeData(null).ok, false);
  assert.equal(normalizeData({ tasks: "x" }).ok, false);
  assert.equal(normalizeData({ tasks: [{ title: "no id" }] }).ok, false);
  assert.equal(normalizeData({ foo: 1 }).ok, false);
});

/* ---------------- field-level merge ---------------- */

type Doc = SyncData;
const DAY = 24 * 3600 * 1000;

/** One device: edits go through stampCollection like planner-store does. */
function edit(d: Doc, key: "tasks" | "habits", now: number, fn: (items: SyncEntity[]) => SyncEntity[]): Doc {
  const stamped = stampCollection(d[key], fn(structuredClone(d[key])), d.tombstones[key], now, key);
  return { ...d, [key]: stamped.items, tombstones: { ...d.tombstones, [key]: stamped.tombs } };
}

function converge(a: Doc, b: Doc): [Doc, Doc] {
  const server = mergeData(a, b);
  return [mergeData(a, server), mergeData(b, server)];
}

const strip = (e: SyncEntity | undefined) => {
  if (!e) return e;
  const { updatedAt: _u, _b, _f, _s, _d, ...rest } = e as Record<string, unknown>;
  return rest;
};

test("two devices tick different habit days offline: both checks survive; untick propagates", () => {
  const base = doc({ habits: [{ id: "h", name: "Бег", checks: ["2026-10-01"], updatedAt: 100 }] });
  const phone = edit(base, "habits", 1000, (hs) => hs.map((h) => ({ ...h, checks: [...(h.checks as string[]), "2026-10-05"] })));
  const laptop = edit(base, "habits", 1001, (hs) =>
    hs.map((h) => ({ ...h, checks: [...(h.checks as string[]).filter((c) => c !== "2026-10-01"), "2026-10-06"] })),
  );
  const [p, l] = converge(phone, laptop);
  assert.deepEqual([...(p.habits[0]!.checks as string[])].sort(), ["2026-10-05", "2026-10-06"]);
  assert.ok(sameData(p, mergeData(l, p)));
  assert.deepEqual([...(l.habits[0]!.checks as string[])].sort(), ["2026-10-05", "2026-10-06"]);
  // later untick on the phone wins over the laptop's older tick
  const p2 = edit(p, "habits", 2000, (hs) => hs.map((h) => ({ ...h, checks: (h.checks as string[]).filter((c) => c !== "2026-10-06") })));
  const [p3, l3] = converge(p2, l);
  assert.deepEqual(p3.habits[0]!.checks, ["2026-10-05"]);
  assert.deepEqual(l3.habits[0]!.checks, ["2026-10-05"]);
});

test("two devices edit different subtasks and add/delete subtasks concurrently", () => {
  const base = doc({
    tasks: [
      {
        id: "t",
        title: "Ремонт",
        subtasks: [
          { id: "s1", title: "Купить краску", done: false },
          { id: "s2", title: "Позвать мастера", done: false },
          { id: "s3", title: "Старое", done: false },
        ],
        updatedAt: 100,
      },
    ],
  });
  type Sub = { id: string; title: string; done: boolean };
  const subs = (t: SyncEntity) => t.subtasks as Sub[];
  const phone = edit(base, "tasks", 1000, (ts) =>
    ts.map((t) => ({ ...t, subtasks: subs(t).map((s) => (s.id === "s1" ? { ...s, done: true } : s)).filter((s) => s.id !== "s3") })),
  );
  const laptop = edit(base, "tasks", 1001, (ts) =>
    ts.map((t) => ({
      ...t,
      subtasks: [...subs(t).map((s) => (s.id === "s2" ? { ...s, title: "Позвать мастера в субботу" } : s)), { id: "s4", title: "Новая", done: false }],
    })),
  );
  const [p, l] = converge(phone, laptop);
  const view = (d: Doc) => subs(d.tasks[0]!).map((s) => [s.id, s.title, s.done]);
  assert.deepEqual(view(p), [
    ["s1", "Купить краску", true],
    ["s2", "Позвать мастера в субботу", false],
    ["s4", "Новая", false],
  ]);
  assert.deepEqual(view(l), view(p));
  // same subtask, same field: newest wins
  const a = edit(p, "tasks", 3000, (ts) => ts.map((t) => ({ ...t, subtasks: subs(t).map((s) => (s.id === "s4" ? { ...s, title: "A" } : s)) })));
  const b = edit(p, "tasks", 3005, (ts) => ts.map((t) => ({ ...t, subtasks: subs(t).map((s) => (s.id === "s4" ? { ...s, title: "B" } : s)) })));
  const [a2, b2] = converge(a, b);
  assert.equal(subs(a2.tasks[0]!).find((s) => s.id === "s4")!.title, "B");
  assert.deepEqual(view(a2), view(b2));
});

test("concurrent edits of different task fields both survive; same field → newest wins", () => {
  const base = doc({ tasks: [{ id: "t", title: "Отчёт", notes: "", due: null, priority: 0, tags: ["work"], updatedAt: 100 }] });
  const phone = edit(base, "tasks", 1000, (ts) => ts.map((t) => ({ ...t, due: "2026-10-07", tags: ["work", "срочно"] })));
  const laptop = edit(base, "tasks", 1010, (ts) => ts.map((t) => ({ ...t, notes: "черновик готов", priority: 2 })));
  const [p, l] = converge(phone, laptop);
  assert.deepEqual(strip(p.tasks[0]), { id: "t", title: "Отчёт", notes: "черновик готов", due: "2026-10-07", priority: 2, tags: ["work", "срочно"] });
  assert.deepEqual(strip(l.tasks[0]), strip(p.tasks[0]));
  // commutative: same content whichever side is primary
  assert.deepEqual(strip(mergeData(phone, laptop).tasks[0]), strip(mergeData(laptop, phone).tasks[0]));
  // same field: the later edit wins regardless of merge order
  const x = edit(p, "tasks", 2000, (ts) => ts.map((t) => ({ ...t, title: "Отчёт v1" })));
  const y = edit(p, "tasks", 2001, (ts) => ts.map((t) => ({ ...t, title: "Отчёт v2" })));
  assert.equal(mergeData(x, y).tasks[0]!.title, "Отчёт v2");
  assert.equal(mergeData(y, x).tasks[0]!.title, "Отчёт v2");
});

test("backward compatible: legacy entities still use whole-entity last-writer-wins", () => {
  const edited = edit(doc({ tasks: [{ id: "t", title: "A", notes: "n", updatedAt: 100 }] }), "tasks", 1000, (ts) =>
    ts.map((t) => ({ ...t, notes: "new notes" })),
  );
  // an old app version (no field stamps) edits the title later and keeps the stale metadata
  const old = { ...edited.tasks[0]!, title: "B", notes: "n", updatedAt: 2000 };
  const merged = mergeData(edited, doc({ tasks: [old] }));
  assert.equal(merged.tasks[0]!.title, "B");
  assert.equal(merged.tasks[0]!.notes, "n", "legacy edit wins as a whole");
  // two legacy copies merge exactly as before
  const legacy = mergeData(doc({ tasks: [task("a", 200, "new")] }), doc({ tasks: [task("a", 100, "old")] }));
  assert.deepEqual(legacy.tasks[0], { id: "a", title: "new", updatedAt: 200 });
});

test("merge stays idempotent and commutative with field metadata", () => {
  const base = doc({ tasks: [{ id: "t", title: "T", tags: [], subtasks: [{ id: "s", title: "S", done: false }], updatedAt: 1 }] });
  const a = edit(base, "tasks", 50, (ts) => ts.map((t) => ({ ...t, title: "T2", tags: ["x"] })));
  const b = edit(base, "tasks", 60, (ts) => ts.map((t) => ({ ...t, subtasks: [] })));
  const ab = mergeData(a, b);
  const ba = mergeData(b, a);
  assert.deepEqual(ab.tasks, ba.tasks);
  assert.ok(sameData(mergeData(ab, ab), ab));
  assert.ok(sameData(mergeData(ab, a), ab));
  assert.deepEqual(strip(ab.tasks[0]), { id: "t", title: "T2", tags: ["x"], subtasks: [] });
});

test("laptop offline for 31 days: items deleted elsewhere (tombstones pruned) do not come back", () => {
  const now = 1000 * DAY;
  const cutoff = now - TOMBSTONE_TTL_MS;
  const lastSync = now - 31 * DAY;
  const laptop = doc({
    tasks: [
      task("kept", now - 40 * DAY),
      task("deleted-on-phone", now - 40 * DAY),
      task("created-offline", now - 31 * DAY + 3600_000),
      task("old-offline-edit", now - 20 * DAY),
    ],
  });
  // server: "deleted-on-phone" was deleted 31 days ago, its tombstone is already pruned
  const server = doc({ tasks: [task("kept", now - 40 * DAY)] });
  const local = dropStaleItems(laptop, server, cutoff, lastSync);
  assert.deepEqual(
    local.tasks.map((t) => t.id),
    ["kept", "created-offline", "old-offline-edit"],
  );
  assert.deepEqual(
    mergeData(local, server, { cutoff }).tasks.map((t) => t.id),
    ["kept", "created-offline", "old-offline-edit"],
  );
  // never synced before → nothing dropped
  assert.equal(dropStaleItems(laptop, server, cutoff, null), laptop);
});

test("restoreDocument: backup wins on every device copy, restored ids lose tombstones, --replace tombstones the rest", () => {
  const now = 10_000;
  const current = doc({
    tasks: [
      { id: "a", title: "A broken", tags: ["x", "junk"], updatedAt: 9000, _b: 100, _f: { title: 9000 }, _s: { tags: { junk: 9000 } } },
      { id: "c", title: "C new", updatedAt: 9500 },
    ],
    tombstones: { ...emptyData().tombstones, tasks: { b: 8000, z: 7000 } },
  });
  const backup = doc({ tasks: [{ id: "a", title: "A good", tags: ["x"], updatedAt: 50 }, task("b", 40, "B good")] });
  const restored = restoreDocument(current, backup, { now });
  assert.deepEqual(
    restored.tasks.map((t) => [t.id, t.title, t.updatedAt]),
    [
      ["a", "A good", now],
      ["b", "B good", now],
      ["c", "C new", 9500],
    ],
  );
  assert.deepEqual(restored.tombstones.tasks, { z: 7000 });
  // a device that still holds the broken copy converges on the restored one
  const device = mergeData(current, restored);
  assert.deepEqual(strip(device.tasks.find((t) => t.id === "a")), { id: "a", title: "A good", tags: ["x"] });
  assert.equal(device.tasks.find((t) => t.id === "b")!.title, "B good");
  const replaced = restoreDocument(current, backup, { now, replace: true });
  assert.deepEqual(replaced.tasks.map((t) => t.id), ["a", "b"]);
  assert.equal(replaced.tombstones.tasks.c, now);
  assert.deepEqual(mergeData(current, replaced).tasks.map((t) => t.id), ["a", "b"]);
  // restampData (manual import) gives every entity the same fresh stamp
  assert.ok(restampData(current, now).tasks.every((t) => t.updatedAt === now && t._f === undefined));
});

test("fuzz: random concurrent edits on three devices always converge to one document", () => {
  let seed = 42;
  const rnd = (n: number) => {
    seed = (seed * 1103515245 + 12345) % 2 ** 31;
    return seed % n;
  };
  for (let round = 0; round < 60; round++) {
    let clock = 1000;
    const start = doc({
      tasks: [
        { id: "t1", title: "a", tags: ["x"], subtasks: [{ id: "s1", title: "s", done: false }], updatedAt: 10 },
        { id: "t2", title: "b", tags: [], subtasks: [], updatedAt: 10 },
      ],
      habits: [{ id: "h", name: "h", checks: ["d1"], updatedAt: 10 }],
    });
    let devices = [start, start, start].map((d) => structuredClone(d));
    for (let step = 0; step < 12; step++) {
      const i = rnd(3);
      clock += 1 + rnd(3);
      const d = devices[i]!;
      const op = rnd(7);
      if (op === 0) devices[i] = edit(d, "tasks", clock, (ts) => ts.map((t) => (t.id === "t1" ? { ...t, title: `t${clock}` } : t)));
      else if (op === 1) devices[i] = edit(d, "tasks", clock, (ts) => ts.map((t) => ({ ...t, tags: rnd(2) ? [...(t.tags as string[]), `g${rnd(3)}`].filter((v, k, all) => all.indexOf(v) === k) : [] })));
      else if (op === 2)
        devices[i] = edit(d, "tasks", clock, (ts) =>
          ts.map((t) => (t.id === "t1" ? { ...t, subtasks: [...(t.subtasks as SyncEntity[]), { id: `s${clock}`, title: "n", done: false }] } : t)),
        );
      else if (op === 3)
        devices[i] = edit(d, "tasks", clock, (ts) => ts.map((t) => ({ ...t, subtasks: (t.subtasks as SyncEntity[]).filter(() => rnd(2) === 0).map((s) => ({ ...s, done: !s.done })) })));
      else if (op === 4) devices[i] = edit(d, "habits", clock, (hs) => hs.map((h) => ({ ...h, checks: rnd(2) ? [...(h.checks as string[]).filter((c) => c !== `d${rnd(3)}`)] : [...new Set([...(h.checks as string[]), `d${rnd(4)}`])] })));
      else if (op === 5) devices[i] = edit(d, "tasks", clock, (ts) => (rnd(3) === 0 ? ts.filter((t) => t.id !== "t2") : ts));
      else {
        // partial sync between two devices
        const j = (i + 1 + rnd(2)) % 3;
        const m = mergeData(devices[i]!, devices[j]!);
        devices[i] = mergeData(devices[i]!, m);
        devices[j] = mergeData(devices[j]!, m);
      }
    }
    // everyone syncs through a server, twice
    let server = emptyData();
    for (let pass = 0; pass < 2; pass++) {
      devices = devices.map((d) => {
        server = mergeData(d, server);
        return mergeData(d, server);
      });
    }
    for (const d of devices) assert.ok(sameData(d, server), `round ${round}: device differs from server`);
    assert.ok(sameData(mergeData(server, server), server));
  }
});
