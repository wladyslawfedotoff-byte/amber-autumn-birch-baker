/**
 * «Помощник → Отложить»: questions that no model could answer are kept per
 * user in DATA_DIR/assistant and asked again in the background (5, 10, then
 * every 15 minutes, for a day at most). The answer replaces the failed message
 * and shows up in the bell; any changes in it still wait for «Применить».
 */
import { aiEnabled, readAiConfig } from "../lib/ai/config.ts";
import { getAssistant } from "../lib/ai/service.ts";
import { log } from "../lib/log.ts";

const FLAG = "__poraAssistantQueue";
const TICK_MS = 60_000;

export default function assistantQueue(): void {
  const g = globalThis as Record<string, unknown>;
  if (g[FLAG] || !aiEnabled(readAiConfig())) return;
  g[FLAG] = true;
  let running = false;
  const timer = setInterval(() => {
    if (running) return;
    running = true;
    getAssistant()
      .processQueue()
      .then((stats) => {
        if (stats.answered || stats.retried || stats.expired) log("info", "assistant.queue", stats);
      })
      .catch((error) => log("warn", "assistant.queue_failed", {}, error))
      .finally(() => {
        running = false;
      });
  }, TICK_MS);
  timer.unref?.();
}
