/**
 * Task reminders on the phone: every 30 s, due reminders go out as Web Push
 * (see server/lib/push/scheduler.ts). Off when the VAPID keys are not in .env.
 */
import { log } from "../lib/log.ts";
import { runTick } from "../lib/push/scheduler.ts";
import { pushConfig, pushStore, sendTo, tasksFor } from "../lib/push/service.ts";

const FLAG = "__poraPushScheduler";
const TICK_MS = 30_000;

export default function pushScheduler(): void {
  const g = globalThis as Record<string, unknown>;
  if (g[FLAG]) return;
  g[FLAG] = true;
  const config = pushConfig();
  if (!config.enabled) {
    if (config.reason !== "keys_missing") log("warn", "push.disabled", { reason: config.reason, note: "проверьте PUSH_VAPID_* и PUSH_CONTACT в .env" });
    return;
  }
  log("info", "push.enabled", { timeZone: config.timeZone });
  const vapid = config.vapid;
  let running = false;
  const tick = () => {
    if (running) return;
    running = true;
    runTick({
      store: pushStore(),
      vapid,
      defaultTimeZone: config.timeZone,
      loadTasks: tasksFor,
      send: (sub, message) => sendTo(vapid, sub, message),
      onLog: (event, fields) => log("info", event, fields),
    })
      .then(({ sent }) => {
        if (sent) log("info", "push.sent", { count: sent });
      })
      .catch((error) => log("warn", "push.tick_failed", {}, error))
      .finally(() => {
        running = false;
      });
  };
  setTimeout(tick, 5_000).unref?.();
  setInterval(tick, TICK_MS).unref?.();
}
