/**
 * Sends due task reminders to every subscribed device of a user.
 *
 * - runs every 30 s (server/plugins/push-scheduler.ts);
 * - restart-safe: what was sent is kept in push.json, and a reminder missed
 *   while the server was down is still sent within GRACE_MS;
 * - no duplicates: a reminder is claimed (written) before it is sent; it is
 *   given back only when no device got it and the failure is temporary;
 * - dead subscriptions (404/410) are removed.
 */
import { dueReminders, validTimeZone, type ReminderTask } from "./schedule.ts";
import type { PushStore, StoredSub } from "./store.ts";
import type { SendResult, VapidKeys } from "./webpush.ts";

export type PushMessage = { title: string; body: string; tag: string; url: string; taskId?: string; test?: boolean };

export type SchedulerDeps = {
  store: PushStore;
  vapid: VapidKeys;
  defaultTimeZone: string;
  /** The user's current tasks (their own view under the sharing rules). */
  loadTasks: (login: string) => Promise<ReminderTask[]>;
  send: (sub: StoredSub, message: PushMessage) => Promise<SendResult>;
  now?: () => number;
  onLog?: (event: string, fields: Record<string, unknown>) => void;
};

export function timeZoneOf(subs: StoredSub[], fallback: string): string {
  const latest = [...subs].sort((a, b) => b.createdAt - a.createdAt).find((s) => validTimeZone(s.tz));
  return latest?.tz ?? fallback;
}

/** Send `message` to every device of `login`; drops dead ones. Returns how many got it. */
export async function deliver(deps: SchedulerDeps, login: string, subs: StoredSub[], message: PushMessage): Promise<{ delivered: number; retry: boolean }> {
  let delivered = 0;
  let retry = false;
  for (const sub of subs) {
    const result = await deps.send(sub, message);
    if (result.ok) delivered++;
    else if (result.gone) {
      await deps.store.unsubscribe(login, sub.endpoint);
      deps.onLog?.("push.gone", { user: login });
    } else {
      retry ||= result.retry;
      deps.onLog?.("push.failed", { user: login, status: result.status });
    }
  }
  return { delivered, retry };
}

export async function runTick(deps: SchedulerDeps): Promise<{ sent: number }> {
  const now = (deps.now ?? Date.now)();
  const file = await deps.store.read();
  let sent = 0;
  for (const [login, subs] of Object.entries(file.subs)) {
    if (!subs.length) continue;
    let tasks: ReminderTask[];
    try {
      tasks = await deps.loadTasks(login);
    } catch {
      continue;
    }
    const due = dueReminders({ tasks, login, now, tz: timeZoneOf(subs, deps.defaultTimeZone) });
    if (!due.length) continue;
    const fresh = new Set(await deps.store.claim(login, due.map((item) => item.key), now));
    for (const item of due) {
      if (!fresh.has(item.key)) continue;
      const current = await deps.store.subsOf(login);
      const result = await deliver(deps, login, current, {
        title: item.title,
        body: item.body,
        tag: `task:${item.taskId}`,
        url: `/?task=${encodeURIComponent(item.taskId)}`,
        taskId: item.taskId,
      });
      if (result.delivered > 0) sent++;
      else if (result.retry) await deps.store.release(login, item.key);
    }
  }
  return { sent };
}
