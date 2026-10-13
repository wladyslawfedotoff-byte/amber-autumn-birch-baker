/**
 * Reminders on the phone (Web Push). Requires a session (01.auth); every
 * subscription belongs to the signed-in user.
 *
 *   GET  /api/push/key          { enabled, publicKey? }
 *   POST /api/push/subscribe    { subscription: { endpoint, keys: { p256dh, auth } }, tz }
 *   POST /api/push/unsubscribe  { endpoint }
 *   POST /api/push/test         sends «Проверка» to this user's devices
 */
import { json, readBodyLimited, type ServerEvent } from "../../../lib/http.ts";
import { log } from "../../../lib/log.ts";
import { principalOf } from "../../../lib/principal.ts";
import { DEFAULT_TIME_ZONE, validTimeZone } from "../../../lib/push/schedule.ts";
import { deliver } from "../../../lib/push/scheduler.ts";
import { pushConfig, pushStore, sendTo, tasksFor } from "../../../lib/push/service.ts";
import { plausibleEndpoint } from "../../../lib/push/endpoint.ts";
import { fromB64u } from "../../../lib/push/webpush.ts";

async function body(event: ServerEvent): Promise<Record<string, unknown> | null> {
  try {
    const value = JSON.parse(await readBodyLimited(event.req, 8 * 1024)) as unknown;
    return value && typeof value === "object" ? (value as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

export default async function pushApi(event: ServerEvent): Promise<Response> {
  const user = principalOf(event);
  if (!user) return json(401, { error: "unauthorized" });
  const method = event.req.method.toUpperCase();
  const head = event.url.pathname.replace(/^\/api\/push\/?/, "").split("/")[0] ?? "";
  const config = pushConfig();

  if (head === "key" && method === "GET") {
    return json(200, config.enabled ? { enabled: true, publicKey: config.vapid.publicKey } : { enabled: false });
  }
  if (!config.enabled) return json(404, { error: "push_off", message: "Уведомления на сервере не настроены." });
  if (method !== "POST") return json(405, { error: "method_not_allowed" });

  if (head === "subscribe") {
    const b = await body(event);
    const sub = b?.subscription as { endpoint?: unknown; keys?: { p256dh?: unknown; auth?: unknown } } | undefined;
    const p256dh = sub?.keys?.p256dh;
    const auth = sub?.keys?.auth;
    if (!plausibleEndpoint(sub?.endpoint) || typeof p256dh !== "string" || typeof auth !== "string" || fromB64u(p256dh).length !== 65 || fromB64u(auth).length < 16) {
      return json(400, { error: "bad_subscription" });
    }
    const tz = validTimeZone(b?.tz) ? (b!.tz as string) : config.timeZone || DEFAULT_TIME_ZONE;
    await pushStore().subscribe(user.login, { endpoint: sub!.endpoint as string, keys: { p256dh, auth }, tz, createdAt: Date.now() });
    log("info", "push.subscribed", { user: user.login, tz });
    return json(200, { ok: true });
  }

  if (head === "unsubscribe") {
    const b = await body(event);
    if (typeof b?.endpoint !== "string") return json(400, { error: "bad_request" });
    return json(200, { ok: await pushStore().unsubscribe(user.login, b.endpoint) });
  }

  if (head === "test") {
    const subs = await pushStore().subsOf(user.login);
    if (!subs.length) return json(409, { error: "no_devices", message: "Сначала включите уведомления на этом устройстве." });
    const vapid = config.vapid;
    const result = await deliver(
      { store: pushStore(), vapid, defaultTimeZone: config.timeZone, loadTasks: tasksFor, send: (s, m) => sendTo(vapid, s, m) },
      user.login,
      subs,
      { title: "Пора", body: "Проверка: уведомления работают.", tag: "test", url: "/", test: true },
    );
    return json(200, { delivered: result.delivered, devices: subs.length });
  }

  return json(404, { error: "not_found" });
}
