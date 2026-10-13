/** Wiring of push to the app: config, the store in DATA_DIR, the user's tasks. */
import { principalForLogin } from "../principal.ts";
import { aclFor } from "../sync-access.ts";
import { dataDir, getStore } from "../sync-store.ts";
import { readPushConfig, type PushConfig } from "./config.ts";
import type { ReminderTask } from "./schedule.ts";
import type { PushMessage } from "./scheduler.ts";
import { PushStore, type StoredSub } from "./store.ts";
import { resolvesPublic } from "./endpoint.ts";
import { sendPush, type SendResult, type VapidKeys } from "./webpush.ts";

let store: { dir: string; store: PushStore } | null = null;
let config: PushConfig | null = null;

export function pushConfig(): PushConfig {
  config ??= readPushConfig();
  return config;
}

export function pushStore(): PushStore {
  const dir = dataDir();
  if (!store || store.dir !== dir) store = { dir, store: PushStore.inDir(dir) };
  return store.store;
}

export async function tasksFor(login: string): Promise<ReminderTask[]> {
  const user = principalForLogin(login);
  if (!user) return [];
  const acl = aclFor(user);
  const doc = acl ? await getStore().getFor(login, acl) : await getStore().get();
  return doc.data.tasks as ReminderTask[];
}

export async function sendTo(vapid: VapidKeys, sub: StoredSub, message: PushMessage): Promise<SendResult> {
  // Never POST into the home network, whatever the subscription says.
  if (!(await resolvesPublic(sub.endpoint))) return { ok: false, gone: true, status: 0, retry: false };
  // The topic lets the push service replace an undelivered older copy of the same reminder.
  const topic = message.tag.replace(/[^A-Za-z0-9_-]/g, "").slice(-32) || undefined;
  return sendPush(sub, message, vapid, { topic, ttl: message.test ? 600 : 6 * 3600 });
}
