import assert from "node:assert/strict";
import { createDecipheriv, createECDH, createPublicKey, hkdfSync, randomBytes, verify } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { readPushConfig } from "./config.ts";
import { dueReminders, leadLabel, zonedTime } from "./schedule.ts";
import { runTick, type PushMessage } from "./scheduler.ts";
import { PushStore, type StoredSub } from "./store.ts";
import { b64u, encryptPayload, fromB64u, generateVapidKeys, validVapidKeys, vapidAuthorization, type SendResult } from "./webpush.ts";

function device() {
  const ecdh = createECDH("prime256v1");
  ecdh.generateKeys();
  const auth = randomBytes(16);
  return { ecdh, auth, keys: { p256dh: b64u(ecdh.getPublicKey()), auth: b64u(auth) } };
}

/** What a browser does with an «aes128gcm» push message (RFC 8291). */
function decrypt(body: Buffer, ua: ReturnType<typeof device>): string {
  const salt = body.subarray(0, 16);
  const idlen = body.readUInt8(20);
  const asPublic = body.subarray(21, 21 + idlen);
  const data = body.subarray(21 + idlen);
  const shared = ua.ecdh.computeSecret(asPublic);
  const info = Buffer.concat([Buffer.from("WebPush: info\0"), ua.ecdh.getPublicKey(), asPublic]);
  const ikm = Buffer.from(hkdfSync("sha256", shared, ua.auth, info, 32));
  const cek = Buffer.from(hkdfSync("sha256", ikm, salt, Buffer.from("Content-Encoding: aes128gcm\0"), 16));
  const nonce = Buffer.from(hkdfSync("sha256", ikm, salt, Buffer.from("Content-Encoding: nonce\0"), 12));
  const decipher = createDecipheriv("aes-128-gcm", cek, nonce);
  decipher.setAuthTag(data.subarray(data.length - 16));
  const plain = Buffer.concat([decipher.update(data.subarray(0, data.length - 16)), decipher.final()]);
  assert.equal(plain[plain.length - 1], 2, "last-record delimiter");
  return plain.subarray(0, plain.length - 1).toString("utf8");
}

test("payload encryption round-trips like a browser decrypts it", () => {
  const ua = device();
  const text = JSON.stringify({ title: "Позвонить", body: "Сейчас · 10:00" });
  assert.equal(decrypt(encryptPayload(Buffer.from(text), ua.keys), ua), text);
});

test("VAPID token is a valid ES256 signature for the endpoint origin", () => {
  const keys = generateVapidKeys();
  assert.ok(validVapidKeys(keys.publicKey, keys.privateKey));
  const header = vapidAuthorization("https://push.example.net/send/abc", { ...keys, contact: "mailto:admin@example.org" }, 1_000_000);
  const [, token, k] = /^vapid t=([^,]+), k=(.+)$/.exec(header)!;
  assert.equal(k, keys.publicKey);
  const [h, c, s] = token!.split(".");
  const claims = JSON.parse(fromB64u(c!).toString()) as { aud: string; exp: number; sub: string };
  assert.equal(claims.aud, "https://push.example.net");
  assert.equal(claims.sub, "mailto:admin@example.org");
  const pub = fromB64u(keys.publicKey);
  const key = createPublicKey({ key: { kty: "EC", crv: "P-256", x: b64u(pub.subarray(1, 33)), y: b64u(pub.subarray(33)) }, format: "jwk" });
  assert.ok(verify("sha256", Buffer.from(`${h}.${c}`), { key, dsaEncoding: "ieee-p1363" }, fromB64u(s!)));
});

test("config: push is off without keys, with broken keys or without contact", () => {
  const keys = generateVapidKeys();
  assert.equal(readPushConfig({}).enabled, false);
  assert.deepEqual(readPushConfig({ PUSH_VAPID_PUBLIC_KEY: keys.publicKey, PUSH_VAPID_PRIVATE_KEY: "x" }), { enabled: false, reason: "keys_invalid", timeZone: "Europe/Moscow" });
  assert.equal(readPushConfig({ PUSH_VAPID_PUBLIC_KEY: keys.publicKey, PUSH_VAPID_PRIVATE_KEY: keys.privateKey }).enabled, false);
  const on = readPushConfig({ PUSH_VAPID_PUBLIC_KEY: keys.publicKey, PUSH_VAPID_PRIVATE_KEY: keys.privateKey, PUSH_CONTACT: "mailto:a@b.c", APP_TIMEZONE: "Asia/Yekaterinburg" });
  assert.equal(on.enabled, true);
  assert.equal(on.timeZone, "Asia/Yekaterinburg");
});

test("wall-clock time in a time zone", () => {
  assert.equal(zonedTime("2026-10-13", "10:00", "Europe/Moscow"), Date.UTC(2026, 9, 13, 7, 0));
  assert.equal(zonedTime("2026-01-05", "09:30", "Europe/Berlin"), Date.UTC(2026, 0, 5, 8, 30));
  assert.equal(zonedTime("2026-07-05", "09:30", "Europe/Berlin"), Date.UTC(2026, 6, 5, 7, 30));
});

const T10 = Date.UTC(2026, 9, 13, 7, 0); // 10:00 Moscow
const task = { id: "t1", title: "Позвонить", due: "2026-10-13", remindAt: "10:00" };

test("due reminders: time, leads, done, assignee, grace", () => {
  const at = (tasks: object[], now: number) => dueReminders({ tasks: tasks as never, login: "user1", now, tz: "Europe/Moscow" });
  assert.equal(at([task], T10 - 1000).length, 0);
  assert.equal(at([task], T10)[0]!.key, "t1|2026-10-13T10:00|0");
  assert.equal(at([{ ...task, remindLead: 15 }], T10 - 15 * 60_000)[0]!.body, "Через 15 мин · в 10:00");
  assert.equal(at([{ ...task, remindLead: 1440 }], T10 - 86_400_000).length, 1);
  assert.equal(at([{ ...task, remindLead: 7 }], T10)[0]!.key, "t1|2026-10-13T10:00|0", "unknown lead = at the time");
  assert.equal(at([{ ...task, done: true }], T10).length, 0);
  assert.equal(at([{ ...task, assignee: "user2" }], T10).length, 0);
  assert.equal(at([{ ...task, assignee: "user1" }], T10).length, 1);
  assert.equal(at([task], T10 + 3 * 3600_000).length, 0, "too old after a long outage");
  assert.equal(at([{ ...task, remindAt: "25:00" }], T10).length, 0);
  assert.equal(leadLabel(60, "10:00"), "Через час · в 10:00");
});

function harness(dir: string, results: (sub: StoredSub) => SendResult) {
  const sent: { endpoint: string; message: PushMessage }[] = [];
  let now = T10 + 5_000;
  let tasks: object[] = [task];
  const store = new PushStore(join(dir, "push.json"), { dataDir: dir });
  const deps = {
    store,
    vapid: { ...generateVapidKeys(), contact: "mailto:a@b.c" },
    defaultTimeZone: "Europe/Moscow",
    loadTasks: async (login: string) => (login === "user1" ? (tasks as never) : []),
    send: async (sub: StoredSub, message: PushMessage) => {
      sent.push({ endpoint: sub.endpoint, message });
      return results(sub);
    },
    now: () => now,
  };
  return {
    deps,
    store,
    sent,
    setNow: (value: number) => (now = value),
    setTasks: (value: object[]) => (tasks = value),
  };
}

const sub = (endpoint: string): StoredSub => ({ endpoint, keys: device().keys, tz: "Europe/Moscow", createdAt: 1 });

test("scheduler sends once, even after a restart", async () => {
  const dir = mkdtempSync(join(tmpdir(), "pora-push-"));
  const h = harness(dir, () => ({ ok: true }));
  await h.store.subscribe("user1", sub("https://push.example.net/a"));
  await h.store.subscribe("user1", sub("https://push.example.net/b"));
  await runTick(h.deps);
  assert.equal(h.sent.length, 2, "both devices");
  assert.equal(h.sent[0]!.message.url, "/?task=t1");
  await runTick(h.deps);
  assert.equal(h.sent.length, 2, "no duplicate");
  // «Restart»: a fresh store on the same file.
  const again = harness(dir, () => ({ ok: true }));
  await runTick(again.deps);
  assert.equal(again.sent.length, 0, "no duplicate after restart");
  // Moving the time is a new reminder.
  again.setTasks([{ ...task, remindAt: "10:05" }]);
  again.setNow(T10 + 5 * 60_000 + 1);
  await runTick(again.deps);
  assert.equal(again.sent.length, 2);
});

test("scheduler retries temporary failures and drops dead devices", async () => {
  const dir = mkdtempSync(join(tmpdir(), "pora-push-"));
  let fail = true;
  const h = harness(dir, (s) => (s.endpoint.endsWith("/dead") ? { ok: false, gone: true, status: 410, retry: false } : fail ? { ok: false, gone: false, status: 503, retry: true } : { ok: true }));
  await h.store.subscribe("user1", sub("https://push.example.net/dead"));
  await h.store.subscribe("user1", sub("https://push.example.net/live"));
  await runTick(h.deps);
  assert.deepEqual((await h.store.subsOf("user1")).map((s) => s.endpoint), ["https://push.example.net/live"]);
  fail = false;
  await runTick(h.deps);
  assert.equal(h.sent.filter((s) => s.endpoint.endsWith("/live")).length, 2, "sent again after the failure");
  await runTick(h.deps);
  assert.equal(h.sent.filter((s) => s.endpoint.endsWith("/live")).length, 2);
});

test("subscriptions are per user; a device moves to whoever subscribed last", async () => {
  const dir = mkdtempSync(join(tmpdir(), "pora-push-"));
  const store = new PushStore(join(dir, "push.json"), { dataDir: dir });
  await store.subscribe("user1", sub("https://push.example.net/phone"));
  await store.subscribe("user2", sub("https://push.example.net/phone"));
  assert.equal((await store.subsOf("user1")).length, 0);
  assert.equal((await store.subsOf("user2")).length, 1);
  assert.equal(await store.unsubscribe("user1", "https://push.example.net/phone"), false, "cannot remove another user's device");
});

test("push endpoints: public HTTPS hosts only", async () => {
  const { isPublicAddress, plausibleEndpoint, resolvesPublic } = await import("./endpoint.ts");
  assert.ok(plausibleEndpoint("https://push.example.net/send/abc"));
  for (const bad of ["http://push.example.net/x", "https://localhost/x", "https://192.168.1.5/x", "https://[::1]/x", "https://nas.local/x", "https://router/x", "https://u:p@push.example.net/x", 5]) {
    assert.equal(plausibleEndpoint(bad), false, String(bad));
  }
  for (const ip of ["10.0.0.1", "127.0.0.1", "172.20.1.1", "192.168.0.10", "169.254.1.1", "100.64.0.1", "::1", "fd00::1", "fe80::1", "::ffff:192.168.1.1"]) assert.equal(isPublicAddress(ip), false, ip);
  for (const ip of ["8.8.8.8", "142.250.1.1", "2a00:1450::1"]) assert.ok(isPublicAddress(ip), ip);
  const fake = (address: string) => (async () => [{ address, family: 4 }]) as never;
  assert.equal(await resolvesPublic("https://push.example.net/a", fake("192.168.1.2")), false, "a public name pointing home is refused");
  assert.equal(await resolvesPublic("https://push.example.net/a", fake("8.8.4.4")), true);
});
