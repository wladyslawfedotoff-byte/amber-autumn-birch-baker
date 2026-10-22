/**
 * runSyncOnce (1.15): conditional pull, upload of changed entities only,
 * fallbacks to the full upload, and two devices converging.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { emptyData, mergeData, sameData, type SyncData, type SyncEntity } from "./merge.ts";
import { applyPatch, partialDocument, readAfterHints, runSyncOnce, UserMismatch, type RemoteDoc, type SyncDeps, type SyncMeta } from "./engine.ts";

type Change = { collection: string; id: string; op: "put" | "delete" };

class Server {
  revision = 0;
  data: SyncData = emptyData();
  patchable = true;
  gets = 0;
  notModified = 0;
  puts = 0;
  patches = 0;
  bytesDown = 0;
  doc(): RemoteDoc {
    return { revision: this.revision, updatedAt: 0, serverNow: 0, cutoff: 0, data: structuredClone(this.data) };
  }
  write(next: SyncData) {
    if (!sameData(next, this.data)) {
      this.data = next;
      this.revision++;
    }
  }
}

class Device {
  meta: SyncMeta = { base: null, revision: null, dirty: false };
  local: SyncData = emptyData();
  journal: Change[] = [];
  seq = 0;
  /** Called in the middle of the next request (an edit while it is in flight). */
  duringRequest: (() => void) | null = null;
  mismatchOnce = false;
  readonly server: Server;
  constructor(server: Server) {
    this.server = server;
  }
  edit(task: SyncEntity) {
    // Like the app: an edit keeps the place, a new task goes on top.
    const has = this.local.tasks.some((t) => t.id === task.id);
    this.local = { ...this.local, tasks: has ? this.local.tasks.map((t) => (t.id === task.id ? task : t)) : [task, ...this.local.tasks] };
    this.journal.push({ collection: "tasks", id: task.id, op: "put" });
    this.seq++;
    this.meta.dirty = true;
  }
  remove(id: string, at: number) {
    this.local = { ...this.local, tasks: this.local.tasks.filter((t) => t.id !== id), tombstones: { ...this.local.tombstones, tasks: { ...this.local.tombstones.tasks, [id]: at } } };
    this.journal.push({ collection: "tasks", id, op: "delete" });
    this.seq++;
    this.meta.dirty = true;
  }
  private inFlight() {
    const hook = this.duringRequest;
    this.duringRequest = null;
    hook?.();
  }
  deps(): SyncDeps {
    const s = this.server;
    return {
      readMeta: () => ({ ...this.meta }),
      writeMeta: (patch) => {
        this.meta = { ...this.meta, ...patch };
      },
      editSeq: () => this.seq,
      get: async (known) => {
        s.gets++;
        this.inFlight();
        if (known !== null && known === s.revision) {
          s.notModified++;
          return null;
        }
        const doc = s.doc();
        s.bytesDown += JSON.stringify(doc).length;
        return doc;
      },
      put: async (base, body) => {
        s.puts++;
        if (this.mismatchOnce) {
          this.mismatchOnce = false;
          throw new UserMismatch();
        }
        this.inFlight();
        if (base !== s.revision) return { status: 409, doc: s.doc() };
        s.write(mergeData(JSON.parse(body) as SyncData, s.data));
        const doc = s.doc();
        s.bytesDown += JSON.stringify(doc).length;
        return { status: 200, doc };
      },
      patch: async (_base, body) => {
        if (!s.patchable) return null;
        s.patches++;
        this.inFlight();
        const prev = s.revision;
        const raw = JSON.parse(body) as SyncData;
        s.write(applyPatch(s.data, raw, readAfterHints(raw)));
        return { revision: s.revision, prevRevision: prev };
      },
      integrate: (doc) => {
        const remote = doc.data as SyncData;
        const merged = mergeData(this.local, remote);
        this.local = merged;
        const needsPush = !sameData(merged, remote);
        this.meta = { ...this.meta, base: doc.revision, revision: doc.revision, dirty: needsPush };
        return needsPush;
      },
      fullBody: () => JSON.stringify(this.local),
      partialBody: () => {
        const doc = partialDocument(this.local, this.journal);
        return doc ? JSON.stringify(doc) : null;
      },
      onUserMismatch: () => {
        this.meta = { base: null, revision: null, dirty: false };
      },
      forceFresh: () => false,
      now: () => 0,
    };
  }
  async sync(flags = { value: true }) {
    const result = await runSyncOnce(this.deps(), flags);
    if (result.settled && !this.meta.dirty) this.journal = [];
    return result;
  }
}

const task = (id: string, title: string, at: number): SyncEntity => ({ id, title, done: false, updatedAt: at });

test("first sync downloads, an idle sync is a 304 without the document", async () => {
  const server = new Server();
  server.write({ ...emptyData(), tasks: [task("a", "Купить хлеб", 1)] });
  const phone = new Device(server);
  const first = await phone.sync();
  assert.equal(first.pulled, true);
  assert.equal(phone.local.tasks.length, 1);
  const idle = await phone.sync();
  assert.deepEqual([idle.settled, idle.pulled, idle.notModified], [true, false, 1]);
  assert.equal(server.puts + server.patches, 0, "nothing uploaded");
});

test("an edit goes up as a PATCH with only that entity", async () => {
  const server = new Server();
  server.write({ ...emptyData(), tasks: Array.from({ length: 300 }, (_, i) => task(`t${i}`, `Задача ${i}`, 1)) });
  const phone = new Device(server);
  await phone.sync();
  phone.edit(task("t7", "Задача 7 — готово", 5));
  let sent = "";
  const deps = phone.deps();
  const patch = deps.patch;
  deps.patch = async (base, body) => {
    sent = body;
    return patch(base, body);
  };
  const result = await runSyncOnce(deps);
  assert.equal(result.pushed, "patch");
  assert.equal(result.settled, true);
  assert.equal(server.puts, 0);
  assert.equal((JSON.parse(sent) as SyncData).tasks.length, 1, "one task, not 300");
  assert.equal(server.data.tasks.find((t) => t.id === "t7")?.title, "Задача 7 — готово");
  assert.equal(phone.meta.revision, server.revision);
  assert.equal(phone.meta.dirty, false);
});

test("two devices edit different tasks: the second PATCH pulls once and both converge", async () => {
  const server = new Server();
  server.write({ ...emptyData(), tasks: [task("a", "A", 1), task("b", "B", 1)] });
  const phone = new Device(server);
  const laptop = new Device(server);
  await phone.sync();
  await laptop.sync();
  phone.edit(task("a", "A с телефона", 10));
  laptop.edit(task("b", "B с компьютера", 11));
  await phone.sync();
  const second = await laptop.sync();
  assert.equal(second.pulled, true, "laptop saw that somebody else wrote");
  await phone.sync();
  assert.ok(sameData(phone.local, server.data));
  assert.ok(sameData(laptop.local, server.data));
  assert.deepEqual(server.data.tasks.map((t) => t.title).sort(), ["A с телефона", "B с компьютера"]);
});

test("a delete travels as a tombstone in the PATCH", async () => {
  const server = new Server();
  server.write({ ...emptyData(), tasks: [task("a", "A", 1), task("b", "B", 1)] });
  const phone = new Device(server);
  await phone.sync();
  phone.remove("a", 50);
  const result = await phone.sync();
  assert.equal(result.pushed, "patch");
  assert.deepEqual(server.data.tasks.map((t) => t.id), ["b"]);
  assert.equal(server.data.tombstones.tasks.a, 50);
});

test("an edit while the PATCH is in flight is not lost", async () => {
  const server = new Server();
  server.write({ ...emptyData(), tasks: [task("a", "A", 1)] });
  const phone = new Device(server);
  await phone.sync();
  phone.edit(task("a", "A1", 10));
  phone.duringRequest = () => phone.edit(task("c", "C", 11));
  const first = await phone.sync();
  assert.equal(first.settled, true, "the run continued and uploaded the second edit too");
  assert.deepEqual(server.data.tasks.map((t) => t.id).sort(), ["a", "c"]);
  assert.equal(phone.meta.dirty, false);
});

test("an older server without PATCH: falls back to the full upload", async () => {
  const server = new Server();
  server.patchable = false;
  const phone = new Device(server);
  await phone.sync();
  phone.edit(task("x", "X", 3));
  const flags = { value: true };
  const result = await phone.sync(flags);
  assert.equal(result.pushed, "put");
  assert.equal(flags.value, false, "remembered for this session");
  assert.equal(server.data.tasks.length, 1);
});

test("`full` flag (unjournalled local entities) forces a PUT, then clears", async () => {
  const server = new Server();
  const phone = new Device(server);
  await phone.sync();
  phone.local = { ...phone.local, tasks: [task("legacy", "Из старой версии", 2)] };
  phone.meta = { ...phone.meta, dirty: true, full: true };
  const result = await phone.sync();
  assert.equal(result.pushed, "put");
  assert.equal(phone.meta.full, false);
  assert.equal(server.data.tasks[0]?.id, "legacy");
});

test("a pull that finds local entities the server lacks marks the next upload as full", async () => {
  const server = new Server();
  const phone = new Device(server);
  await phone.sync();
  phone.local = { ...phone.local, tasks: [task("orphan", "Без записи в журнале", 2)] };
  server.write({ ...emptyData(), tasks: [task("other", "С другого устройства", 3)] });
  const result = await phone.sync();
  assert.equal(result.pushed, "put");
  assert.equal(server.data.tasks.length, 2);
});

test("the first upload of a device is a full one (no base yet)", async () => {
  const server = new Server();
  const phone = new Device(server);
  phone.edit(task("n", "Новая", 1));
  const result = await phone.sync();
  assert.equal(result.pushed, "put");
  assert.equal(server.patches, 0);
});

test("user mismatch on a full upload resets and retries as a fresh device", async () => {
  const server = new Server();
  server.write({ ...emptyData(), tasks: [task("theirs", "Чужая", 1)] });
  const phone = new Device(server);
  phone.meta = { base: 0, revision: 0, dirty: true, full: true };
  phone.mismatchOnce = true;
  await phone.sync();
  assert.equal(phone.meta.base, server.revision);
});

test("partialDocument: only journalled entities and their tombstones", () => {
  const local: SyncData = { ...emptyData(), tasks: [task("a", "A", 1), task("b", "B", 1)], tombstones: { ...emptyData().tombstones, tasks: { gone: 9 } } };
  const doc = partialDocument(local, [
    { collection: "tasks", id: "b", op: "put" },
    { collection: "tasks", id: "gone", op: "delete" },
    { collection: "settings", id: "settings", op: "put" },
  ])!;
  assert.deepEqual(doc.tasks.map((t) => t.id), ["b"]);
  assert.deepEqual(doc.tombstones.tasks, { gone: 9 });
  assert.equal(partialDocument(local, []), null);
});

test("new tasks keep the device's order on the server (no extra full upload later)", async () => {
  const server = new Server();
  server.write({ ...emptyData(), tasks: [task("a", "A", 1), task("b", "B", 1)] });
  const phone = new Device(server);
  const laptop = new Device(server);
  await phone.sync();
  await laptop.sync();
  phone.edit(task("n1", "Новая 1", 5));
  phone.edit(task("n2", "Новая 2", 6));
  await phone.sync();
  assert.deepEqual(server.data.tasks.map((t) => t.id), phone.local.tasks.map((t) => t.id));
  laptop.edit(task("b", "B2", 7));
  const r = await laptop.sync();
  assert.notEqual(r.pushed, "put");
  await phone.sync();
  assert.ok(sameData(phone.local, server.data));
  assert.ok(sameData(laptop.local, server.data));
  assert.equal(server.puts, 0, "no full upload at all");
});
