import { NO_LOG_HEADER, json } from "../../lib/http.ts";
import { log } from "../../lib/log.ts";
import { dataDir, getStore } from "../../lib/sync-store.ts";

let lastFailureLog = 0;

/** Unauthenticated liveness/readiness probe for Docker HEALTHCHECK. */
export default async function health(): Promise<Response> {
  const dataWritable = await getStore().isWritable();
  if (!dataWritable) {
    const now = Date.now();
    if (now - lastFailureLog > 5 * 60 * 1000) {
      lastFailureLog = now;
      log("error", "health.unhealthy", { dataDir: dataDir(), reason: "data directory is not writable" });
    }
  }
  return json(
    dataWritable ? 200 : 503,
    { ok: dataWritable, uptime: Math.round(process.uptime()), dataWritable },
    dataWritable ? {} : { [NO_LOG_HEADER]: "1" },
  );
}
