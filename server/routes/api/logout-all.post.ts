import { NO_LOG_HEADER, clientIp, json, type ServerEvent } from "../../lib/http.ts";
import { log } from "../../lib/log.ts";
import { principalOf } from "../../lib/principal.ts";
import { bumpUserEpoch } from "../../lib/user-store.ts";
import { clearedSessionCookies, withCookies } from "../../lib/session-cookie.ts";

/**
 * «Выйти на всех устройствах»: bump this user's session epoch (users.json) so
 * every cookie of this user (this device included, and any stolen copy) stops
 * working. Other profiles stay signed in. (Everyone at once: delete
 * data/.session-secret or bump data/.session-epoch and restart.)
 * Requires a valid session and a same-origin request (01.auth middleware).
 */
export default function logoutAll(event: ServerEvent): Response {
  const user = principalOf(event);
  if (!user) return json(401, { error: "unauthorized" });
  try {
    bumpUserEpoch(user.login);
  } catch (error) {
    log("error", "auth.revoke_failed", { ip: clientIp(event) }, error);
    return json(
      503,
      { error: "storage_error", message: "Не удалось сохранить на сервере (папка данных недоступна для записи)." },
      { [NO_LOG_HEADER]: "1" },
    );
  }
  log("info", "auth.logout_all", { ip: clientIp(event), user: user.login });
  return withCookies(json(200, { ok: true }), clearedSessionCookies(event));
}
