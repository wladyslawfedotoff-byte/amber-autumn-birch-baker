import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { emptyData } from "../../../src/lib/sync/merge.ts";
import { runCleanup } from "./cleanup.ts";
import { AttachStore } from "./store.ts";

const DAY = 24 * 60 * 60 * 1000;

async function withStore(fn: (store: AttachStore) => Promise<void>) {
  const root = await mkdtemp(join(tmpdir(), "pora-clean-"));
  try {
    await fn(new AttachStore(root));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

const put = (store: AttachStore, id: string, parent: string, now: number) =>
  store.put({ owner: "user1", parent: { kind: "task", id: parent }, name: `${id}.jpg`, mime: "image/jpeg", bytes: new Uint8Array([1]), id, now });

test("deleted task: marked, then removed after the grace period; referenced files stay", async () => {
  await withStore(async (store) => {
    const t0 = 1_000 * DAY;
    await put(store, "keepkeep01", "alive", t0);
    await put(store, "subphoto01", "alive", t0);
    await put(store, "gonegone01", "deleted", t0);
    const data = emptyData();
    data.tasks = [{ id: "alive", attachments: [{ id: "keepkeep01" }], subtasks: [{ id: "s", afterId: "subphoto01" }] }];
    const opts = { store, data, graceMs: 30 * DAY };

    const r1 = await runCleanup({ ...opts, now: t0 + 2 * DAY });
    assert.equal(r1.marked, 1);
    assert.equal(r1.removed, 0);
    const r2 = await runCleanup({ ...opts, now: t0 + 10 * DAY });
    assert.equal(r2.removed, 0);
    const r3 = await runCleanup({ ...opts, now: t0 + 40 * DAY });
    assert.equal(r3.removed, 1);
    assert.equal(await store.get("gonegone01"), null);
    assert.ok(await store.readBytes("keepkeep01"));
    assert.ok(await store.readBytes("subphoto01"));
    // idempotent
    const r4 = await runCleanup({ ...opts, now: t0 + 41 * DAY });
    assert.equal(r4.removed, 0);
  });
});

test("restored task un-marks its files; young uploads and empty data are left alone", async () => {
  await withStore(async (store) => {
    const t0 = 1_000 * DAY;
    await put(store, "backback01", "restored", t0);
    await put(store, "freshfresh", "notsynced", t0 + 5 * DAY);
    const gone = emptyData();
    gone.tasks = [{ id: "other" }];
    await runCleanup({ store, data: gone, now: t0 + 5 * DAY + 1000, graceMs: 30 * DAY });
    assert.ok((await store.get("backback01"))?.orphanSince);
    assert.equal((await store.get("freshfresh"))?.orphanSince, undefined);
    const back = emptyData();
    back.tasks = [{ id: "restored", attachments: [{ id: "backback01" }] }];
    const r = await runCleanup({ store, data: back, now: t0 + 6 * DAY, graceMs: 30 * DAY });
    assert.equal(r.unmarked, 1);
    const empty = await runCleanup({ store, data: emptyData(), now: t0 + 100 * DAY, graceMs: 0 });
    assert.equal(empty.removed, 0);
    assert.ok(await store.get("backback01"));
  });
});
