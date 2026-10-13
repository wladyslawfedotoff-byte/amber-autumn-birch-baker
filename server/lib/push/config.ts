/**
 * Push settings, only from the environment (.env on the NAS):
 *   PUSH_VAPID_PUBLIC_KEY, PUSH_VAPID_PRIVATE_KEY, PUSH_CONTACT=mailto:…
 * Missing or broken keys switch push off; the rest of the app works as before.
 */
import { DEFAULT_TIME_ZONE, validTimeZone } from "./schedule.ts";
import { validVapidKeys, type VapidKeys } from "./webpush.ts";

export type PushConfig = { enabled: true; vapid: VapidKeys; timeZone: string } | { enabled: false; reason: string; timeZone: string };

export function readPushConfig(env: Record<string, string | undefined> = process.env): PushConfig {
  const tz = (env.APP_TIMEZONE ?? "").trim();
  const timeZone = validTimeZone(tz) ? tz : DEFAULT_TIME_ZONE;
  const publicKey = (env.PUSH_VAPID_PUBLIC_KEY ?? "").trim();
  const privateKey = (env.PUSH_VAPID_PRIVATE_KEY ?? "").trim();
  const contact = (env.PUSH_CONTACT ?? "").trim();
  if (!publicKey && !privateKey) return { enabled: false, reason: "keys_missing", timeZone };
  if (!validVapidKeys(publicKey, privateKey)) return { enabled: false, reason: "keys_invalid", timeZone };
  if (!/^(mailto:\S+@\S+|https:\/\/\S+)$/.test(contact)) return { enabled: false, reason: "contact_invalid", timeZone };
  return { enabled: true, vapid: { publicKey, privateKey, contact }, timeZone };
}
