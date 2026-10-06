/**
 * Crash instead of limping on: Nitro's own handlers only log uncaught errors,
 * which can leave a half-broken process serving requests. We log one clear
 * line and exit(1) so Docker's `restart: unless-stopped` starts a fresh one.
 * Also logs startup info and eagerly validates auth config (fail-closed notice).
 */
import { getAuthConfig } from "../lib/auth.ts";
import { log } from "../lib/log.ts";
import { dataDir, getStore } from "../lib/sync-store.ts";

const FLAG = "__poraProcessGuard";

export default function processGuard(): void {
  const g = globalThis as Record<string, unknown>;
  if (g[FLAG]) return;
  g[FLAG] = true;

  const die = (kind: string) => (error: unknown) => {
    log("error", `process.${kind}`, { action: "exit(1) — Docker перезапустит контейнер" }, error);
    process.exit(1);
  };
  process.on("uncaughtException", die("uncaughtException"));
  process.on("unhandledRejection", die("unhandledRejection"));

  log("info", "server.start", {
    node: process.version,
    port: process.env.NITRO_PORT ?? process.env.PORT ?? "3000",
    dataDir: dataDir(),
    appUrl: process.env.APP_URL || undefined,
    uid: typeof process.getuid === "function" ? process.getuid() : undefined,
  });
  getAuthConfig();
  void getStore()
    .isWritable()
    .then((ok) => {
      if (!ok) {
        log("error", "data.not_writable", {
          dataDir: dataDir(),
          hint: "папка данных недоступна для записи: проверьте volume ./data:/data и права (см. docs/SYNOLOGY.md)",
        });
      }
    });
}
