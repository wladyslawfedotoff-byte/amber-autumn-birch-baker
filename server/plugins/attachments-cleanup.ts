/**
 * Every 6 hours: remove files of deleted tasks/projects after
 * ATTACH_ORPHAN_DAYS (default 30). See server/lib/attachments/cleanup.ts.
 */
import { attachConfig } from "../lib/attachments/config.ts";
import { runCleanup } from "../lib/attachments/cleanup.ts";
import { attachStore } from "../lib/attachments/store.ts";
import { log } from "../lib/log.ts";
import { getStore } from "../lib/sync-store.ts";

const FLAG = "__poraAttachCleanup";
const EVERY_MS = 6 * 60 * 60 * 1000;

export default function attachmentsCleanup(): void {
  const g = globalThis as Record<string, unknown>;
  if (g[FLAG]) return;
  g[FLAG] = true;
  let running = false;
  const tick = () => {
    if (running) return;
    running = true;
    const { orphanDays } = attachConfig();
    void (async () => {
      const doc = await getStore().get();
      const result = await runCleanup({
        store: attachStore(),
        data: doc.data,
        now: Date.now(),
        graceMs: orphanDays * 24 * 60 * 60 * 1000,
        onLog: (event, fields) => log("info", event, fields),
      });
      if (result.marked || result.removed) log("info", "attach.cleanup", { ...result, orphanDays });
    })()
      .catch((error) => log("warn", "attach.cleanup_failed", {}, error))
      .finally(() => {
        running = false;
      });
  };
  setTimeout(tick, 60_000).unref?.();
  setInterval(tick, EVERY_MS).unref?.();
}
