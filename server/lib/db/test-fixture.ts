/**
 * Tests only: a realistic DATA_DIR of 1.11 — two profiles with shared items,
 * every collection and every list-valued field (subtasks, attachments,
 * links, contacts, habit log/checks, milestone items, project contacts,
 * maintenance rules/log/pains/readings/fill-ups/parts …), per-field stamps
 * produced by the real client stamping (stampCollection) and the real server
 * merge (SyncStore.putFor on the JSON backend), tombstones, per-user
 * settings, users.json, push.json, attachments/meta.json + files, assistant
 * documents and usage counters.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { COLLECTIONS, stampCollection, type Collection, type SyncData, type SyncEntity } from "../../../src/lib/sync/merge.ts";
import type { AclConfig } from "../../../src/lib/sync/world.ts";
import { SyncStore } from "../sync-store.ts";
import { closeStorage, forceJsonStorage } from "./storage.ts";

export const ACL: AclConfig = { owner: "user1", users: ["user1", "user2"] };
export const T0 = 1_760_000_000_000;

type Edit = Partial<Record<Collection, (items: SyncEntity[]) => SyncEntity[]>>;

/** Like the app: change local data, stamp what changed. */
export function edit(data: SyncData, change: Edit, now: number): SyncData {
  let out = data;
  for (const key of COLLECTIONS) {
    const fn = change[key];
    if (!fn) continue;
    const next = fn(structuredClone(out[key]));
    const stamped = stampCollection(out[key], next, out.tombstones[key], now, key);
    out = { ...out, [key]: stamped.items, tombstones: { ...out.tombstones, [key]: stamped.tombs } };
  }
  return out;
}

const att = (id: string, extra: Record<string, unknown> = {}) => ({ id, name: `${id}.jpg`, mime: "image/jpeg", size: 1234, createdAt: T0, takenAt: T0 - 5000, ...extra });

export function task(id: string, i: number, extra: Record<string, unknown> = {}): SyncEntity {
  return {
    id,
    title: `Задача ${i} «кавычки» \\ и эмодзи 🚗`,
    notes: i % 3 ? "" : "Многострочная\nзаметка",
    listId: i % 2 ? "l-home" : "l-work",
    done: i % 5 === 0,
    priority: i % 4,
    due: i % 2 ? `2026-10-${String((i % 28) + 1).padStart(2, "0")}` : null,
    tags: i % 3 ? ["дом", `t${i % 4}`] : [],
    subtasks: i % 4 ? [{ id: `${id}-s1`, title: "Шаг 1", done: true }, { id: `${id}-s2`, title: "Шаг 2", done: false, afterId: `${id}-s1` }] : [],
    createdAt: T0 + i,
    completedAt: i % 5 === 0 ? T0 + 1000 : null,
    ...(i % 6 === 0 ? { repeat: "dates", repeatDates: ["2026-11-01", "2026-12-01"] } : {}),
    ...(i % 7 === 0 ? { attachments: [att(`a${id}`)], links: [{ id: `${id}-k`, url: "https://example.org/x?a=1&b=2", title: "Ссылка" }], contacts: [{ id: `${id}-c`, name: "Мастер", phone: "+7 900 000-00-00" }] } : {}),
    ...(i % 9 === 0 ? { remindAt: "09:30", remindLead: 15, important: true, color: "red", dependsOn: null, startAt: "09:00", endAt: "18:00", host: true } : {}),
    ...extra,
  };
}

export function asset(id: string, extra: Record<string, unknown> = {}): SyncEntity {
  return {
    id,
    name: "Машина",
    kind: "car",
    plate: "А001АА77",
    km: 120500,
    kmAt: "2026-10-01",
    notes: "",
    createdAt: T0,
    rules: [{ id: `${id}-r1`, title: "Масло", everyKm: 10000, everyMonths: 12, lastKm: 110000, lastDate: "2026-01-10" }],
    log: [{ id: `${id}-g1`, title: "Замена масла", date: "2026-01-10", km: 110000, cost: 5400.5, place: "Сервис", ruleIds: [`${id}-r1`] }, { id: `${id}-g2`, title: "ОСАГО", date: "2026-03-01", cat: "ins", cost: 9000 }],
    pains: [{ id: `${id}-p1`, text: "Стук справа", createdAt: T0, solvedAt: null, planKm: 125000 }],
    readings: [{ id: `${id}-m1`, date: "2026-10-01", km: 120500 }],
    attachments: [att(`b${id}`, { entryId: `${id}-g1` })],
    links: [{ id: `${id}-l1`, url: "https://example.org/manual", entryId: `${id}-g1` }],
    contacts: [{ id: `${id}-c1`, name: "Сервис", phone: "+7 495 000-00-00" }],
    fuel: [
      { id: `${id}-f1`, date: "2026-09-01", liters: 40.25, sum: 2415.3, km: 119800, full: true, place: "АЗС" },
      { id: `${id}-f2`, date: "2026-09-20", liters: 35, sum: 2100, km: 120300, full: false },
    ],
    parts: [{ id: `${id}-q1`, name: "Аккумулятор", boughtAt: "2025-11-01", price: 9000, warrantyMonths: 24, warrantyUntil: "2027-11-01", serial: "SN-1" }],
    kmRemind: true,
    ...extra,
  };
}

/**
 * Build the folder with the JSON backend (1.11 code paths) and leave it
 * unforced, so the next storageFor(dir) sees a 1.11 folder to import.
 */
export async function buildLegacyFixture(dir: string, options: { tasks?: number } = {}): Promise<void> {
  const count = options.tasks ?? 40;
  mkdirSync(dir, { recursive: true });
  forceJsonStorage(dir);
  try {
    // Deterministic server clock: two fixtures built apart are byte-identical.
    let serverNow = T0 + 10_000_000;
    const store = new SyncStore(dir, { backupIntervalMs: 0, now: () => (serverNow += 3) });
    let now = T0;
    // user1: lists, tasks, habits, dates, projects, a car; shares some with user2.
    let v1 = await store.getFor("user1", ACL);
    let d1 = edit(
      v1.data,
      {
        lists: () => [
          { id: "l-home", name: "Дом" },
          { id: "l-work", name: "Работа", members: ["user2"] },
        ],
        tasks: () => Array.from({ length: count }, (_, i) => task(`t${i}`, i, i % 10 === 1 ? { members: ["user2"], assignee: "user2" } : {})),
        habits: () => [
          { id: "h1", name: "Зарядка", section: "morning", freq: { kind: "weekdays", days: [1, 3, 5] }, checks: ["2026-10-01", "2026-10-03"], log: [{ id: "2026-10-02", status: "skip", note: "болел" }], createdAt: T0 },
          { id: "h2", name: "Чтение", section: "evening", freq: { kind: "daily" }, checks: [], log: [], createdAt: T0, members: ["user2"] },
        ],
        milestones: () => [{ id: "m1", title: "День рождения", kind: "birthday", date: "1990-05-12", items: [{ id: "m1-i1", kind: "gift", title: "Книга", done: false }], members: ["user2"] }],
        projects: () => [
          {
            id: "p1",
            title: "Ремонт",
            stages: [{ id: "st1", title: "Черновая", cards: [{ id: "c1", title: "Стены" }] }],
            contacts: [{ id: "p1-c1", name: "Прораб", role: "бригадир", phone: "+7 999 111-22-33", email: "foreman@example.org" }],
            attachments: [att("cproj1")],
            members: ["user2"],
          },
        ],
        assets: () => [asset("car1", { members: ["user2"] }), { id: "dev1", name: "Чайник", kind: "device", notes: "", createdAt: T0, rules: [], log: [], pains: [], readings: [], warrantyMonths: 12, warrantyUntil: "2026-12-01", price: 3990 }],
      },
      (now += 1000),
    );
    d1 = { ...d1, settings: { workStart: "08:30", workEnd: "17:30", archiveDays: 14, updatedAt: (now += 1000) } };
    let r1 = await store.putFor("user1", ACL, v1.revision, d1);
    if (r1.status !== "ok") throw new Error("fixture: user1 put failed");
    // user1 edits again: per-field stamps (_f / _s / _d) appear.
    v1 = await store.getFor("user1", ACL);
    d1 = edit(
      v1.data,
      {
        tasks: (items) =>
          items
            .filter((t) => t.id !== "t3" && t.id !== "t4")
            .map((t, i) => (i % 3 === 0 ? { ...t, title: `${t.title} (изм.)`, tags: [...((t.tags as string[]) ?? []), "новый"] } : t)),
        habits: (items) => items.map((h) => (h.id === "h1" ? { ...h, checks: ["2026-10-03", "2026-10-05"] } : h)),
        assets: (items) => items.map((a) => (a.id === "car1" ? { ...a, km: 121000, fuel: [...(a.fuel as object[]), { id: "car1-f3", date: "2026-10-10", liters: 20, sum: 1200, km: 121000 }] } : a)),
      },
      (now += 1000),
    );
    r1 = await store.putFor("user1", ACL, v1.revision, d1);
    if (r1.status !== "ok") throw new Error("fixture: user1 edit failed");
    // user2: own tasks + edits a shared one; deletes one of hers.
    let v2 = await store.getFor("user2", ACL);
    let d2 = edit(
      v2.data,
      {
        tasks: (items) => [
          { id: "u2-1", title: "Её задача", notes: "", listId: null, done: false, priority: 1, due: "2026-10-20", tags: ["её"], subtasks: [], createdAt: now, completedAt: null },
          { id: "u2-2", title: "Удалю", notes: "", listId: null, done: false, priority: 0, due: null, tags: [], subtasks: [], createdAt: now, completedAt: null },
          ...items.map((t) => (t.id === "t1" ? { ...t, done: true, completedBy: "user2" } : t)),
        ],
        assets: (items) => [...items, asset("car2")],
      },
      (now += 1000),
    );
    d2 = { ...d2, settings: { workStart: "10:00", workEnd: "19:00", updatedAt: (now += 1000) } };
    let r2 = await store.putFor("user2", ACL, v2.revision, d2);
    if (r2.status !== "ok") throw new Error("fixture: user2 put failed");
    v2 = await store.getFor("user2", ACL);
    d2 = edit(v2.data, { tasks: (items) => items.filter((t) => t.id !== "u2-2") }, (now += 1000));
    r2 = await store.putFor("user2", ACL, v2.revision, d2);
    if (r2.status !== "ok") throw new Error("fixture: user2 delete failed");
  } finally {
    closeStorage(dir);
  }
  writeFileSync(
    join(dir, "users.json"),
    `${JSON.stringify({ v: 1, users: { user1: { epoch: 3 }, user2: { passwordHash: "scrypt:16384:8:1:c2FsdHNhbHQ:aGFzaGhhc2hoYXNoaGFzaA", changedAt: T0 + 50, epoch: 2 } } }, null, 2)}\n`,
    { mode: 0o600 },
  );
  writeFileSync(
    join(dir, "push.json"),
    JSON.stringify({
      v: 1,
      subs: {
        user1: [
          { endpoint: "https://push.example.net/a", keys: { p256dh: "BPk1", auth: "au1" }, tz: "Europe/Moscow", createdAt: T0 },
          { endpoint: "https://push.example.net/b", keys: { p256dh: "BPk2", auth: "au2" }, tz: "Europe/Moscow", createdAt: T0 + 1 },
        ],
        user2: [{ endpoint: "https://push.example.net/c", keys: { p256dh: "BPk3", auth: "au3" }, tz: "Asia/Yekaterinburg", createdAt: T0 + 2 }],
      },
      sent: { "user1|t5@2026-10-06T09:30": T0 + 100, "user2|u2-1@2026-10-20T09:00": T0 + 200 },
    }),
  );
  const attachDir = join(dir, "attachments", "files");
  mkdirSync(attachDir, { recursive: true });
  const meta: Record<string, unknown> = {};
  for (const [id, owner, kind, parent] of [
    ["at0", "user1", "task", "t0"],
    ["bcar1", "user1", "asset", "car1"],
    ["cproj1", "user1", "project", "p1"],
    ["dorphan", "user2", "task", "gone"],
  ] as const) {
    const fileId = `${id}${"0".repeat(16 - id.length)}`.replace(/[^0-9a-z]/g, "0");
    writeFileSync(join(attachDir, fileId), `bytes of ${id}`);
    meta[fileId] = { id: fileId, owner, parent: { kind, id: parent }, name: `${id}.jpg`, mime: "image/jpeg", size: 10 + id.length, createdAt: T0, ...(id === "dorphan" ? { orphanSince: T0 + 10 } : { takenAt: T0 - 1 }) };
  }
  writeFileSync(join(dir, "attachments", "meta.json"), JSON.stringify({ v: 1, items: meta }));
  mkdirSync(join(dir, "assistant"), { recursive: true });
  for (const login of ["user1", "user2"]) {
    writeFileSync(
      join(dir, "assistant", `${login}.json`),
      JSON.stringify({
        v: 1,
        login,
        settings: { allowCloud: login === "user1", allowPaid: false, consent: { cloud: T0 } },
        conversations: [{ id: `c-${login}`, title: "Вопрос", createdAt: T0, updatedAt: T0, messages: [{ id: "m1", role: "user", text: "Привет", at: T0 }, { id: "m2", role: "assistant", text: "Здравствуйте", at: T0 + 1, proposal: { id: "pr1", items: [{ op: "create", kind: "task", title: "X" }], status: "pending" } }] }],
        queue: login === "user2" ? [{ id: "q1", conversationId: "c-user2", messageId: "m1", nextAt: T0 + 60000 }] : [],
        notices: [],
      }),
    );
  }
  writeFileSync(join(dir, "assistant-usage.json"), JSON.stringify({ month: "2026-10", tokens: { "cloud-model": 1234, local: 5 } }));
}
