import { NO_LOG_HEADER, clientIp, json, type ServerEvent } from "../../lib/http.ts";
import { log } from "../../lib/log.ts";
import { bumpSessionEpoch } from "../../lib/session-epoch.ts";
import { clearedSessionCookies, withCookies } from "../../lib/session-cookie.ts";

/**
 * «Выйти на всех устройствах»: bump the server-side session epoch so every
 * issued cookie (this device included, and any stolen copy) stops working.
 * Requires a valid session and a same-origin request (01.auth middleware).
 */
export default function logoutAll(event: ServerEvent): Response {
  try {
    bumpSessionEpoch();
  } catch (error) {
    log("error", "auth.revoke_failed", { ip: clientIp(event) }, error);
    return json(
      503,
      { error: "storage_error", message: "Не удалось сохранить на сервере (папка данных недоступна для записи)." },
      { [NO_LOG_HEADER]: "1" },
    );
  }
  log("info", "auth.logout_all", { ip: clientIp(event) });
  return withCookies(json(200, { ok: true }), clearedSessionCookies(event));
}
