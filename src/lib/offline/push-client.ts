/**
 * Reminders on this device via Web Push. On iPhone this works only in the
 * app added to the Home Screen (iOS 16.4+), not in a Safari tab.
 */
import { swSupported } from "./sw-client";

export type PushState =
  | { kind: "unsupported"; reason: "browser" | "ios-tab" | "ios-old" }
  | { kind: "server-off" }
  | { kind: "denied" }
  | { kind: "off" }
  | { kind: "on" };

export function isIos(): boolean {
  if (typeof navigator === "undefined") return false;
  return /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
}

export function isStandalone(): boolean {
  if (typeof window === "undefined") return false;
  return window.matchMedia?.("(display-mode: standalone)").matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;
}

function pushApiAvailable(): boolean {
  return swSupported() && typeof window !== "undefined" && "PushManager" in window && typeof Notification !== "undefined";
}

async function api<T>(path: string, body?: unknown): Promise<T> {
  const response = await fetch(`/api/push/${path}`, {
    method: body === undefined ? "GET" : "POST",
    credentials: "same-origin",
    cache: "no-store",
    headers: { Accept: "application/json", ...(body === undefined ? {} : { "Content-Type": "application/json" }) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = (await response.json().catch(() => null)) as (T & { message?: string }) | null;
  if (!response.ok) throw new Error(json?.message ?? `Ошибка сервера (${response.status}).`);
  return json as T;
}

function keyBytes(base64url: string): Uint8Array<ArrayBuffer> {
  const pad = "=".repeat((4 - (base64url.length % 4)) % 4);
  const raw = atob((base64url + pad).replace(/-/g, "+").replace(/_/g, "/"));
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

async function registration(): Promise<ServiceWorkerRegistration | null> {
  if (!swSupported()) return null;
  return (await navigator.serviceWorker.getRegistration("/")) ?? null;
}

let serverKey: Promise<string | null> | null = null;
function publicKey(): Promise<string | null> {
  serverKey ??= api<{ enabled: boolean; publicKey?: string }>("key")
    .then((r) => (r.enabled && r.publicKey ? r.publicKey : null))
    .catch((error) => {
      serverKey = null;
      throw error;
    });
  return serverKey;
}

export async function pushState(): Promise<PushState> {
  if (!pushApiAvailable()) {
    if (isIos() && !isStandalone()) return { kind: "unsupported", reason: "ios-tab" };
    return { kind: "unsupported", reason: isIos() ? "ios-old" : "browser" };
  }
  if (!(await publicKey())) return { kind: "server-off" };
  if (Notification.permission === "denied") return { kind: "denied" };
  const sub = await (await registration())?.pushManager.getSubscription();
  return sub && Notification.permission === "granted" ? { kind: "on" } : { kind: "off" };
}

function timeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "Europe/Moscow";
  } catch {
    return "Europe/Moscow";
  }
}

async function register(sub: PushSubscription): Promise<void> {
  await api("subscribe", { subscription: sub.toJSON(), tz: timeZone() });
}

/** Must be called from a tap (iOS asks for permission only then). */
export async function enablePush(): Promise<void> {
  const permission = await Notification.requestPermission();
  if (permission !== "granted") throw new Error(permission === "denied" ? "Уведомления запрещены в настройках." : "Разрешение не получено.");
  const key = await publicKey();
  if (!key) throw new Error("Уведомления на сервере не настроены.");
  const reg = (await registration()) ?? (await navigator.serviceWorker.ready);
  let sub = await reg.pushManager.getSubscription();
  // A subscription made with another server key cannot be used.
  const current = sub?.options.applicationServerKey;
  if (sub && current && btoa(String.fromCharCode(...new Uint8Array(current))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "") !== key) {
    await sub.unsubscribe().catch(() => undefined);
    sub = null;
  }
  sub ??= await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(key) });
  await register(sub);
}

export async function disablePush(): Promise<void> {
  const sub = await (await registration())?.pushManager.getSubscription();
  if (!sub) return;
  await api("unsubscribe", { endpoint: sub.endpoint }).catch(() => undefined);
  await sub.unsubscribe().catch(() => undefined);
}

export async function testPush(): Promise<number> {
  const result = await api<{ delivered: number }>("test", {});
  return result.delivered;
}

/** On start: tell the server about this device again (another profile may have used it). */
export async function refreshPushSubscription(): Promise<void> {
  if (!pushApiAvailable() || Notification.permission !== "granted") return;
  const sub = await (await registration())?.pushManager.getSubscription();
  if (sub && (await publicKey().catch(() => null))) await register(sub).catch(() => undefined);
}

/** «Выйти»: this device stops getting the user's reminders. */
export async function forgetPushOnLogout(): Promise<void> {
  if (!pushApiAvailable()) return;
  await disablePush().catch(() => undefined);
}
